"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ServerMessage } from "@meetcopilot/shared";
import { API_BASE, ApiError, createMeeting } from "@/lib/api";
import { startCapture, CaptureError, type CaptureController } from "@/lib/audio-capture";
import { useRealtime, wsStatusLabel, type WsStatus } from "@/lib/useRealtime";
import { readMeetingCreds, saveMeetingCreds, type MeetingCreds } from "@/lib/meeting-session";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { VuMeter } from "./VuMeter";

/** capture-surface lifecycle phases (drives which panel renders). */
type Phase = "setup" | "idle" | "requesting" | "listening" | "zero-track" | "ended" | "error";

interface SessionState {
  consent: boolean;
  committedIndex: number;
  connectedRoles: string[];
}

/** /copilot standalone wrapper — kept for backward compat / anyone importing CopilotView; the /copilot page now
 *  renders the cockpit. No app chrome (I3-adjacent: this tab is never shared). */
export function CopilotView() {
  return (
    <ToastProvider>
      <CopilotInner />
    </ToastProvider>
  );
}

/**
 * Capture surface. Standalone renders its own `<main className="mc-cap">` and self-reads creds from storage.
 * When embedded in the cockpit (CockpitView), the parent owns creds: it passes them via `creds` and is notified
 * via `onCreds` — so the sibling HUD connects to the same session the moment SetupPanel creates it (no page
 * reload) — and `rootTag` becomes `section` (the cockpit owns the single `<main>`).
 */
export function CopilotInner({
  embedded = false,
  creds: credsProp,
  onCreds,
  rootTag = "main",
}: {
  embedded?: boolean;
  creds?: MeetingCreds | null;
  onCreds?: (c: MeetingCreds) => void;
  rootTag?: "main" | "section";
} = {}) {
  const toast = useToast();
  const Root = rootTag;
  // Embedded in the cockpit the page h1 is CockpitView's「會中副駕」— demote this capture heading to h2 so the
  // cockpit page has exactly one h1. Standalone (/copilot wrapper) keeps its own h1.
  const Heading = embedded ? "h2" : "h1";

  const [creds, setCreds] = useState<MeetingCreds | null>(embedded ? credsProp ?? null : null);
  const [resolved, setResolved] = useState(false);
  const [phase, setPhase] = useState<Phase>(embedded && credsProp ? "idle" : "setup");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [displaySurface, setDisplaySurface] = useState<string | null>(null);

  const [consentGranted, setConsentGranted] = useState(false);
  const [serverState, setServerState] = useState<SessionState | null>(null);

  const controllerRef = useRef<CaptureController | null>(null);
  const consentRef = useRef(false);
  const sendAudioRef = useRef<(f: ArrayBuffer) => void>(() => {});

  // Adopt a session's creds and (in cockpit) bubble them to the parent so the sibling HUD connects too.
  const adoptCreds = useCallback(
    (c: MeetingCreds) => {
      setCreds(c);
      setPhase("idle");
      onCreds?.(c);
    },
    [onCreds],
  );

  // Resolve creds on mount. Standalone: URL handoff → sessionStorage. Embedded: mirror the parent-controlled prop
  // (re-runs when the cockpit sets creds after SetupPanel, flipping this side out of "setup").
  useEffect(() => {
    if (embedded) {
      if (credsProp) {
        setCreds(credsProp);
        setPhase((p) => (p === "setup" ? "idle" : p));
      }
      setResolved(true);
      return;
    }
    const c = readMeetingCreds();
    if (c) {
      setCreds(c);
      setPhase("idle");
    }
    setResolved(true);
  }, [embedded, credsProp]);

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "session_state") {
      setServerState({ consent: msg.consent, committedIndex: msg.committedIndex, connectedRoles: msg.connectedRoles });
    } else if (msg.type === "error") {
      toast.push({ kind: "error", message: `${msg.code}: ${msg.message}` });
    }
  }, [toast]);

  const realtime = useRealtime({
    apiBase: creds?.wsUrl ?? API_BASE,
    wsToken: creds?.wsToken ?? null,
    meetingId: creds?.meetingId ?? null,
    role: "capture",
    enabled: phase === "listening",
    onMessage,
    onOpen: () => realtime.send({ type: "consent", granted: consentRef.current }),
  });
  sendAudioRef.current = realtime.sendAudio;

  // ── capture control ─────────────────────────────────────────────
  const stopCapture = useCallback(() => {
    controllerRef.current?.stop();
    controllerRef.current = null;
  }, []);

  const onFrame = useCallback((pcm: ArrayBuffer) => {
    // Privacy gate: stream audio to the analyzer ONLY after consent (未同意不啟動分析).
    if (consentRef.current) sendAudioRef.current(pcm);
  }, []);

  const onEnded = useCallback(() => {
    stopCapture();
    setPhase("ended");
  }, [stopCapture]);

  const start = useCallback(async () => {
    setErrorMsg("");
    setPhase("requesting");
    try {
      const ctrl = await startCapture({ onFrame, onEnded });
      controllerRef.current = ctrl;
      setDisplaySurface(ctrl.displaySurface);
      setPhase("listening");
    } catch (e) {
      if (e instanceof CaptureError && e.code === "zero-track") {
        setPhase("zero-track");
      } else {
        setErrorMsg(e instanceof Error ? e.message : "擷取失敗");
        setPhase("error");
      }
    }
  }, [onFrame, onEnded]);

  const stopListening = useCallback(() => {
    stopCapture();
    setPhase("idle");
    setServerState(null);
  }, [stopCapture]);

  // Stop capture on unmount.
  useEffect(() => () => stopCapture(), [stopCapture]);

  const toggleConsent = useCallback(() => {
    setConsentGranted((prev) => {
      const next = !prev;
      consentRef.current = next;
      realtime.send({ type: "consent", granted: next });
      return next;
    });
  }, [realtime]);

  const getLevel = useCallback(() => controllerRef.current?.getLevel() ?? 0, []);

  // ── render ──────────────────────────────────────────────────────
  if (!resolved) return <Root className="mc-cap" aria-busy="true" />;
  if (phase === "setup" && !creds) {
    return <SetupPanel rootTag={rootTag} embedded={embedded} onReady={adoptCreds} />;
  }

  const analyzing = phase === "listening" && consentGranted && realtime.status === "open";

  return (
    <Root className="mc-cap">
      <header className="mc-cap__head">
        <Heading className="mc-cap__h1">會中副駕 · 擷取端</Heading>
        <p className="mc-cap__lead">擷取這個 Meet 分頁的聲音（所有人混音）用於即時副駕。此瀏覽器分頁永不被分享。</p>
        <p className="mc-cap__platform" role="note">
          限桌面版 Chrome / Edge。帳號 B 的 Meet 分頁與本分頁需在同一瀏覽器 profile。
        </p>
      </header>

      {phase === "zero-track" ? (
        <ZeroTrackGuard onRetry={start} />
      ) : phase === "error" ? (
        <div className="mc-cap__errbox" role="alert">
          <p className="mc-cap__errmsg">{errorMsg || "擷取失敗。"}</p>
          <button type="button" className="mc-btn mc-btn--primary" onClick={start}>
            重新分享
          </button>
        </div>
      ) : phase === "ended" ? (
        <div className="mc-cap__errbox mc-cap__errbox--warn" role="alert">
          <p className="mc-cap__errmsg">分享已停止（你按了瀏覽器的「停止分享」）。</p>
          <button type="button" className="mc-btn mc-btn--primary" onClick={start}>
            重新開始聆聽
          </button>
        </div>
      ) : phase === "listening" || phase === "requesting" ? (
        <section className="mc-cap__live" aria-busy={phase === "requesting"}>
          <div className="mc-cap__vuwrap">
            <div className="mc-cap__vulabel">
              即時音量
              {phase === "requesting" ? <Spinner size={13} /> : null}
            </div>
            <VuMeter getLevel={getLevel} active={phase === "listening"} />
            <p className="mc-cap__vuhint">會議裡有人講話時音量表會跳動；若一直靜止，代表沒擷取到聲音。</p>
          </div>

          <ConsentGate
            granted={consentGranted}
            analyzing={analyzing}
            status={realtime.status}
            onToggle={toggleConsent}
          />

          <StatusBar
            status={realtime.status}
            failureReason={realtime.failureReason}
            onRetry={realtime.retry}
            state={serverState}
            localConsent={consentGranted}
          />

          <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={stopListening}>
            停止聆聽
          </button>
        </section>
      ) : (
        <section className="mc-cap__start">
          <TabShareTutorial />
          <button type="button" className="mc-btn mc-btn--primary mc-cap__startbtn" onClick={start}>
            🎧 開始聆聽
          </button>
        </section>
      )}
    </Root>
  );
}

/** Big red guard when the user forgot to tick "Share tab audio" — the most important error state. */
function ZeroTrackGuard({ onRetry }: { onRetry: () => void }) {
  return (
    <section className="mc-cap__zero" role="alert">
      <div className="mc-cap__zero-icon" aria-hidden="true">
        🔇
      </div>
      <h2 className="mc-cap__zero-title">沒有偵測到音訊！</h2>
      <p className="mc-cap__zero-body">
        來源選擇器裡<strong>沒有勾「分享分頁音訊 / Share tab audio」</strong>，或你選了不含音訊的來源（整個螢幕／視窗通常不含音訊）。
      </p>
      <ol className="mc-cap__steps">
        <li>選「Chrome 分頁」，挑那個 Meet 分頁。</li>
        <li>
          <strong>務必勾選左下角「分享分頁音訊 / Share tab audio」。</strong>
        </li>
      </ol>
      <button type="button" className="mc-btn mc-btn--primary" onClick={onRetry}>
        重新分享
      </button>
    </section>
  );
}

/** Illustrated tab-picker guidance (our UI; the system picker itself can't be styled). */
function TabShareTutorial() {
  return (
    <div className="mc-cap__tutorial">
      <p className="mc-cap__tutorial-lead">按下後瀏覽器會彈出來源選擇器，請依序：</p>
      <ol className="mc-cap__steps">
        <li>
          選 <strong>「Chrome 分頁」</strong>（不是整個螢幕、不是視窗）
        </li>
        <li>
          挑 <strong>那個 Meet 分頁</strong>
        </li>
        <li>
          一定要勾 <strong>「分享分頁音訊 / Share tab audio」</strong>
        </li>
      </ol>
    </div>
  );
}

/** Consent gate — analysis does not start until the presenter confirms recording consent. */
function ConsentGate({
  granted,
  analyzing,
  status,
  onToggle,
}: {
  granted: boolean;
  analyzing: boolean;
  status: WsStatus;
  onToggle: () => void;
}) {
  const grantedLabel = analyzing
    ? "分析中"
    : status === "failed"
      ? "已同意（連線失敗）"
      : status === "open"
        ? "已同意（等待分析）"
        : "已同意（連線中…）";
  return (
    <div className={`mc-cap__consent ${granted ? "is-on" : ""}`}>
      <label className="mc-cap__consent-row">
        <input type="checkbox" checked={granted} onChange={onToggle} />
        <span>我已取得與會者同意錄音分析</span>
      </label>
      <span className={`mc-badge ${granted && status !== "failed" ? "mc-badge--ok" : "mc-badge--warn"}`}>
        {granted ? grantedLabel : "等待同意 · 分析未啟動"}
      </span>
    </div>
  );
}

/** Session status: WS connection, connected roles, committedIndex, consent (server-truth when known).
 *  A terminal `failed` state shows the reason + a [重試] action — never a silent "未連線". */
function StatusBar({
  status,
  failureReason,
  onRetry,
  state,
  localConsent,
}: {
  status: WsStatus;
  failureReason: string | null;
  onRetry: () => void;
  state: SessionState | null;
  localConsent: boolean;
}) {
  const connKind =
    status === "open"
      ? "mc-badge--ok"
      : status === "failed"
        ? "mc-badge--danger"
        : status === "reconnecting"
          ? "mc-badge--warn"
          : "mc-badge--muted";
  return (
    <>
      <dl className="mc-cap__status">
        <div>
          <dt>連線</dt>
          <dd>
            <span className={`mc-badge ${connKind}`}>{wsStatusLabel(status)}</span>
          </dd>
        </div>
        <div>
          <dt>已連角色</dt>
          <dd>{state?.connectedRoles?.length ? state.connectedRoles.join(" · ") : "—"}</dd>
        </div>
        <div>
          <dt>已播頁 (committedIndex)</dt>
          <dd>{state ? state.committedIndex : "—"}</dd>
        </div>
        <div>
          <dt>同意狀態</dt>
          <dd>{(state ? state.consent : localConsent) ? "已同意" : "未同意"}</dd>
        </div>
      </dl>
      {status === "failed" ? (
        <div className="mc-cap__connfail" role="alert">
          <p className="mc-cap__connfail-msg">{failureReason ?? "連線失敗。"}</p>
          <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={onRetry}>
            重試連線
          </button>
        </div>
      ) : null}
    </>
  );
}

/** No creds ⇒ this account (B) creates the live session (POST /api/meetings → wsToken). Requires login. */
function SetupPanel({ onReady, rootTag = "main", embedded = false }: { onReady: (c: MeetingCreds) => void; rootTag?: "main" | "section"; embedded?: boolean }) {
  const Root = rootTag;
  // Same one-h1 rule as CopilotInner: embedded under the cockpit's h1, this setup heading is an h2.
  const Heading = embedded ? "h2" : "h1";
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNeedLogin(false);
    try {
      const res = await createMeeting({ title: title.trim() || "會議" });
      const creds: MeetingCreds = { meetingId: res.meeting.id, wsToken: res.wsToken, wsUrl: res.wsUrl };
      saveMeetingCreds(creds);
      onReady(creds);
    } catch (e2) {
      if (e2 instanceof ApiError && (e2.status === 401 || e2.status === 403)) {
        setNeedLogin(true);
      } else {
        setErr(e2 instanceof ApiError ? e2.message : "建立 session 失敗");
      }
      setBusy(false);
    }
  }

  return (
    <Root className="mc-cap mc-cap--setup">
      <header className="mc-cap__head">
        <Heading className="mc-cap__h1">開始一場會議 session</Heading>
        <p className="mc-cap__lead">此端負責擷取會議分頁音訊。先建立 session 取得連線憑證，再開始聆聽。</p>
      </header>
      <form className="mc-cap__setupform" onSubmit={submit}>
        <label className="mc-field">
          <span>會議標題</span>
          <input id="meeting-title" name="meeting-title" className="mc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例：Acme 產品簡報" />
        </label>
        {needLogin ? (
          <p className="mc-cap__errmsg">
            尚未登入。請先 <Link href="/login">登入</Link> 後再建立 session。
          </p>
        ) : null}
        {err ? <p className="mc-cap__errmsg">{err}</p> : null}
        <button type="submit" className="mc-btn mc-btn--primary" disabled={busy}>
          {busy ? <Spinner size={14} /> : "建立 session"}
        </button>
      </form>
    </Root>
  );
}
