"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { InfoCard, ServerMessage, SignalItem, SlideSpec, Suggestion, TranscriptSegment } from "@meetcopilot/shared";
import { API_BASE } from "@/lib/api";
import { useRealtime } from "@/lib/useRealtime";
import { readMeetingCreds, saveMeetingCreds, parsePastedCreds, type MeetingCreds } from "@/lib/meeting-session";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { TranscriptStream } from "./TranscriptStream";
import { InfoCardStream } from "./InfoCardStream";
import { SuggestionQueue, type SuggestionAction } from "./SuggestionQueue";
import { DeepResearchBox, type ResearchLine } from "./DeepResearchBox";

const MAX_SEGMENTS = 200;
const MAX_SIGNALS = 12;
const MAX_CARDS = 30;

/** /hud — presenter HUD on a second device (mobile-portrait first). Only ever on the rep's device (I3). */
export function HudView() {
  return (
    <ToastProvider>
      <HudInner />
    </ToastProvider>
  );
}

function HudInner() {
  const toast = useToast();
  const [creds, setCreds] = useState<MeetingCreds | null>(null);
  const [resolved, setResolved] = useState(false);

  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [cards, setCards] = useState<InfoCard[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [quota, setQuota] = useState<number | null>(null);
  const [researchLines, setResearchLines] = useState<ResearchLine[]>([]);

  useEffect(() => {
    setCreds(readMeetingCreds());
    setResolved(true);
  }, []);

  const onMessage = useCallback(
    (msg: ServerMessage) => {
      switch (msg.type) {
        case "transcript":
          setSegments((prev) => upsertSegment(prev, msg.segment));
          break;
        case "signals":
          setSignals((prev) => dedupeById([...prev, ...msg.items]).slice(-MAX_SIGNALS));
          break;
        case "info_card":
          setCards((prev) => dedupeById([msg.card, ...prev]).slice(0, MAX_CARDS));
          break;
        case "suggestion":
          setSuggestions((prev) => (prev.some((s) => s.id === msg.suggestion.id) ? prev : [...prev, msg.suggestion]));
          break;
        case "suggestion_result":
          setSuggestions((prev) => prev.filter((s) => s.id !== msg.suggestionId));
          if (msg.status === "applied") {
            toast.push({
              kind: "success",
              message: msg.newSlideIndex !== undefined ? `已加入第 ${msg.newSlideIndex + 1} 頁` : "建議已套用",
            });
          } else {
            toast.push({ kind: "info", message: "建議已略過" });
          }
          break;
        case "research_status":
          setQuota(msg.remainingQuota);
          setResearchLines((prev) => upsertResearch(prev, { jobId: msg.jobId, status: msg.status }));
          break;
        case "session_state":
          // Reconnect resync: DON'T clear the accumulated streams; server just re-affirms session facts.
          break;
        case "error":
          toast.push({ kind: "error", message: `${msg.code}: ${msg.message}` });
          break;
        default:
          break;
      }
    },
    [toast],
  );

  const realtime = useRealtime({
    apiBase: creds?.wsUrl ?? API_BASE,
    wsToken: creds?.wsToken ?? null,
    meetingId: creds?.meetingId ?? null,
    role: "hud",
    enabled: !!creds,
    onMessage,
  });

  const onAct = useCallback(
    (id: string, action: SuggestionAction, editedSlide?: SlideSpec) => {
      realtime.send({ type: "suggestion_action", suggestionId: id, action, editedSlide });
      // Optimistically advance the queue so keyboard A/S targets the next item immediately.
      setSuggestions((prev) => prev.filter((s) => s.id !== id));
    },
    [realtime],
  );

  const onExpire = useCallback((id: string) => {
    setSuggestions((prev) => (prev.some((s) => s.id === id) ? prev.filter((s) => s.id !== id) : prev));
  }, []);

  const onDeepResearch = useCallback(
    (query: string) => {
      realtime.send({ type: "deep_research", query });
    },
    [realtime],
  );

  if (!resolved) return <main className="mc-hud" aria-busy="true" />;
  if (!creds) return <ConnectPanel onConnected={setCreds} />;

  const disconnected = realtime.status !== "open" && realtime.status !== "idle";

  return (
    <main className="mc-hud">
      {disconnected ? (
        <div className="mc-hud__banner" role="status">
          {realtime.status === "reconnecting" ? "重新連線中…" : "連線中…"}
        </div>
      ) : null}

      <SuggestionQueue suggestions={suggestions} onAct={onAct} onExpire={onExpire} />
      <TranscriptStream segments={segments} signals={signals} />
      <InfoCardStream cards={cards} />
      <DeepResearchBox remainingQuota={quota} lines={researchLines} onSubmit={onDeepResearch} />
    </main>
  );
}

/** No creds ⇒ second-device join: paste the session link (or "meetingId wsToken") handed off from /copilot. */
function ConnectPanel({ onConnected }: { onConnected: (c: MeetingCreds) => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parsePastedCreds(value);
    if (!parsed) {
      setErr("無法解析。請貼上完整 session 連結，或「meetingId wsToken」。");
      return;
    }
    saveMeetingCreds(parsed);
    onConnected(parsed);
  }

  return (
    <main className="mc-hud mc-hud--connect">
      <h1 className="mc-hud__connect-title">連上會議 HUD</h1>
      <p className="mc-hud__connect-lead">
        這是報告者第二裝置的副駕抬頭顯示。請從擷取端（/copilot）取得 session 連結或掃 QR 開啟；
        或在下方貼上連結手動連上。
      </p>
      <form className="mc-hud__connectform" onSubmit={submit}>
        <textarea
          className="mc-input"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="貼上 session 連結，或 meetingId wsToken"
          aria-label="session 連結"
        />
        {err ? <p className="mc-hud__connect-err">{err}</p> : null}
        <button type="submit" className="mc-btn mc-btn--primary">
          連上
        </button>
      </form>
    </main>
  );
}

// ── stream reducers (pure) ──────────────────────────────────────────
function upsertSegment(prev: TranscriptSegment[], seg: TranscriptSegment): TranscriptSegment[] {
  const idx = prev.findIndex((s) => s.id === seg.id);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = seg;
    return next;
  }
  const appended = [...prev, seg];
  return appended.length > MAX_SEGMENTS ? appended.slice(appended.length - MAX_SEGMENTS) : appended;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out;
}

function upsertResearch(prev: ResearchLine[], line: ResearchLine): ResearchLine[] {
  const idx = prev.findIndex((l) => l.jobId === line.jobId);
  if (idx >= 0) {
    const next = prev.slice();
    next[idx] = line;
    return next;
  }
  return [line, ...prev].slice(0, 6);
}
