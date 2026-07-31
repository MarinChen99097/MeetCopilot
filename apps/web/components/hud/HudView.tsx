"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type {
  ChecklistItem,
  InfoCard,
  ServerMessage,
  SignalItem,
  SlideSpec,
  Suggestion,
  TranscriptSegment,
} from "@meetcopilot/shared";
import { API_BASE } from "@/lib/api";
import { useRealtime, wsStatusLabel, type WsStatus } from "@/lib/useRealtime";
import {
  readMeetingCreds,
  saveMeetingCreds,
  clearMeetingCreds,
  parsePastedCreds,
  type MeetingCreds,
} from "@/lib/meeting-session";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { useElapsedLabel } from "@/components/copilot/use-elapsed";
import { TranscriptStream } from "./TranscriptStream";
import { InfoCardStream, filterIntel, type IntelTab } from "./InfoCardStream";
import { SuggestionDeck, type SuggestionAction } from "./SuggestionQueue";
import { DeepResearchBox, type ResearchLine } from "./DeepResearchBox";
import { ChecklistPanel, type ChecklistActionKind, type ChecklistWireStatus } from "./ChecklistPanel";

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

/**
 * 報告者 HUD / 建議流。兩個 layout（2026-07-30 重設計；**WS 協定零改動**，純 UI 重組）：
 *
 *  - `"stack"`（預設，/hud 第二裝置）：手機直式——頂列（LIVE＋經過時間＋簡報頁）→ 清單進度列
 *    → I2 批准卡 → 情報卡（對方的資料／我們可以說 tab）→ 逐字稿與深查（次要，摺疊）。
 *    設計稿的手機視圖把逐字稿與深查整個拿掉；這裡改成**摺疊保留**——第二裝置可用性不得回退（RWD 紅線）。
 *  - `"desk"`（cockpit 中欄＋右欄）：回傳兩個 `<section>` 當 grid 子節點——中欄＝頂列＋批准卡＋逐字稿＋深查，
 *    右欄＝待講清單＋情報 tab。
 *
 * standalone 自行從 storage 讀 creds；嵌在 cockpit 時 creds 由 parent 擁有（capture 端一建立 session 就連上，
 * 不用重整），貼連結／重新連結（第二裝置專用）在 embedded 時不出現。
 */
export function HudInner({
  embedded = false,
  creds: credsProp,
  rootTag = "main",
  layout = "stack",
  topbarExtra,
}: {
  embedded?: boolean;
  creds?: MeetingCreds | null;
  rootTag?: "main" | "section";
  layout?: "stack" | "desk";
  /** desk：頂列右側由 cockpit 提供的控制（電腦版／手機版切換）。 */
  topbarExtra?: ReactNode;
} = {}) {
  const toast = useToast();
  const t = useTranslations("hud");
  const Root = rootTag;
  const [creds, setCreds] = useState<MeetingCreds | null>(embedded ? credsProp ?? null : null);
  const [resolved, setResolved] = useState(false);

  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [signals, setSignals] = useState<SignalItem[]>([]);
  const [cards, setCards] = useState<InfoCard[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [quota, setQuota] = useState<number | null>(null);
  const [researchLines, setResearchLines] = useState<ResearchLine[]>([]);
  // 待講清單（MEETING_CHECKLIST_CONTRACT §8）。null status＝本場沒有清單 → 面板不佔版面。
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [checklistStatus, setChecklistStatus] = useState<ChecklistWireStatus | null>(null);
  const [currentSlideIdx, setCurrentSlideIdx] = useState<number | undefined>(undefined);
  const [tab, setTab] = useState<IntelTab>("them");
  /**
   * I2：已送出、**等 server 裁決**的建議 id。前端不再樂觀把卡片抽掉——只有 `suggestion_result`
   * （或 expiresAt 逾時）才會讓它消失。掐斷 WS 時卡片留在原地＋維持 in-flight，畫面永遠等於 server 真相。
   */
  const [pendingActions, setPendingActions] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Latch "we connected at least once" so we never render the live stream panels (which show
  // "聆聽中，尚無…") for a session that has NEVER connected — that fake "listening" look is the bug.
  const [everConnected, setEverConnected] = useState(false);
  const [connectedAt, setConnectedAt] = useState<number | null>(null);
  const clock = useElapsedLabel(connectedAt);

  useEffect(() => {
    if (embedded) {
      // Cockpit-controlled: mirror the parent's creds (re-runs when the capture side creates the session).
      setCreds(credsProp ?? null);
      setResolved(true);
      return;
    }
    setCreds(readMeetingCreds());
    setResolved(true);
  }, [embedded, credsProp]);

  const settle = useCallback((id: string) => {
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    setPendingActions((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
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
          // **唯一**會讓卡片消失的伺服器事件（另一條是本地 expiresAt 逾時）。
          settle(msg.suggestionId);
          if (msg.status === "applied") {
            toast.push({
              kind: "success",
              message:
                msg.newSlideIndex !== undefined
                  ? t("toastApplied", { page: msg.newSlideIndex + 1 })
                  : t("toastAppliedPlain"),
            });
          } else {
            toast.push({ kind: "info", message: t("toastSkipped") });
          }
          break;
        case "research_status":
          setQuota(msg.remainingQuota);
          setResearchLines((prev) => upsertResearch(prev, { jobId: msg.jobId, status: msg.status }));
          break;
        case "checklist":
          // **REPLACE 語意**（本檔唯一的整份覆寫 reducer；其餘 case 都是 append/dedupe——別照抄成 append）。
          // 全量 snapshot＝唯一真相：斷線重連自我修復，也是手動勾選的最終結果來源（I2，前端不樂觀更新）。
          setChecklistStatus(msg.status);
          setChecklist(msg.items);
          // 契約 §5：currentSlideIdx 可選；沒帶時保留既有值（別把高亮清掉）。
          if (msg.currentSlideIdx !== undefined) setCurrentSlideIdx(msg.currentSlideIdx);
          break;
        case "session_state":
          // First session_state = a *working* connection (a bad-token socket opens then closes 4001
          // WITHOUT ever sending state). Latch here — NOT on bare socket-open — so a failed auth never
          // flips us into the live-stream view with empty "聆聽中…" panels.
          setEverConnected(true);
          setConnectedAt((prev) => prev ?? Date.now());
          // Reconnect resync: DON'T clear the accumulated streams; server just re-affirms session facts.
          // committedIndex ＝ checklist snapshot 的 currentSlideIdx 同源（runtime 高水位），拿來 seed「正在講」高亮。
          setCurrentSlideIdx(msg.committedIndex);
          break;
        case "error":
          toast.push({ kind: "error", message: `${msg.code}: ${msg.message}` });
          break;
        default:
          break;
      }
    },
    [toast, t, settle],
  );

  const realtime = useRealtime({
    apiBase: creds?.wsUrl ?? API_BASE,
    wsToken: creds?.wsToken ?? null,
    meetingId: creds?.meetingId ?? null,
    role: "hud",
    enabled: !!creds,
    onMessage,
  });

  // "重新貼連結": drop the stored creds and fall back to the paste panel (for a stale/expired link).
  const relink = useCallback(() => {
    clearMeetingCreds();
    setEverConnected(false);
    setConnectedAt(null);
    setCreds(null);
  }, []);

  /**
   * I2 批准動作。**不樂觀更新**：只送 wire 訊息並把 id 標成 in-flight；卡片與 deck 的真相
   * 一律等 server 的 `suggestion_result`。授權（presenter 身分）在 server 判定，前端不代為判斷。
   */
  const onAct = useCallback(
    (id: string, action: SuggestionAction, editedSlide?: SlideSpec) => {
      setPendingActions((prev) => new Set(prev).add(id));
      realtime.send({ type: "suggestion_action", suggestionId: id, action, editedSlide });
    },
    [realtime],
  );

  const onExpire = useCallback((id: string) => settle(id), [settle]);

  const onDeepResearch = useCallback(
    (query: string) => {
      realtime.send({ type: "deep_research", query });
    },
    [realtime],
  );

  /**
   * 報告者手動改清單項目（I2：presenter-only，授權在 server）。
   * **刻意不做樂觀更新**——只送訊息，狀態一律等 server 回的全量 `checklist` snapshot 覆蓋；
   * 非 presenter 會收到 `error{forbidden_not_presenter}`，此時本地狀態沒被動過，畫面自然仍是真相。
   */
  const onChecklistAction = useCallback(
    (itemId: string, action: ChecklistActionKind) => {
      realtime.send({ type: "checklist_action", itemId, action });
    },
    [realtime],
  );

  const shell = (children: ReactNode, extra = "") => <Root className={`mc-hudm${extra}`}>{children}</Root>;

  /**
   * desk layout 的早退骨架：回傳的必須是**兩個** grid 子節點——只回一個的話三欄版面會瞬間塌掉。
   * 三個早退分支（未解析／embedded 無 session／首次連線前）共用它，避免各抄一份而走樣。
   * `busy` 未帶 → aria-busy 為 undefined（React 直接不輸出該屬性，與原本沒寫是同一份 DOM）。
   */
  const deskFrame = (main: ReactNode, busy = false) => (
    <>
      <section className="mc-desk__main" aria-busy={busy ? "true" : undefined}>
        {main}
      </section>
      <section className="mc-desk__side" aria-busy={busy ? "true" : undefined} />
    </>
  );

  if (!resolved) {
    if (layout === "desk") return deskFrame(null, true);
    return shell(null, " is-busy");
  }
  if (!creds) {
    // Embedded (cockpit): no paste panel — the capture side owns session creation. Show a gentle placeholder.
    if (embedded) {
      const note = (
        <div className="mc-hudm__note" role="status">
          <span className="mc-hudm__spinner" aria-hidden="true" />
          <p className="mc-hudm__notetitle">{t("noSessionTitle")}</p>
          <p className="mc-hudm__notedesc">{t("noSessionDesc")}</p>
        </div>
      );
      if (layout === "desk") return deskFrame(note);
      return shell(note);
    }
    return <ConnectPanel onConnected={setCreds} />;
  }

  // Before the FIRST successful connect, never show the live stream panels (they read as "已在聆聽").
  if (!everConnected) {
    const connecting = (
      <ConnectingState
        status={realtime.status}
        reason={realtime.failureReason}
        onRetry={realtime.retry}
        onRelink={relink}
        showRelink={!embedded}
      />
    );
    if (layout === "desk") return deskFrame(connecting);
    return shell(connecting);
  }

  const banner =
    realtime.status !== "open" ? (
      realtime.status === "failed" ? (
        <div className="mc-hudm__banner is-fail" role="alert">
          <span>{realtime.failureReason ?? t("connFailed")}</span>
          <span className="mc-hudm__banneracts">
            <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={realtime.retry}>
              {t("retry")}
            </button>
            {embedded ? null : (
              <button type="button" className="mc-btn mc-btn--ghost mc-btn--sm" onClick={relink}>
                {t("relink")}
              </button>
            )}
          </span>
        </div>
      ) : (
        <div className="mc-hudm__banner" role="status">
          {wsStatusLabel(realtime.status)}
        </div>
      )
    ) : null;

  const intelTabs = (
    <div className="mc-tabs3" role="tablist" aria-label={t("intel.tabsLabel")}>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "them"}
        className={`mc-tabs3__btn${tab === "them" ? " is-on" : ""}`}
        onClick={() => setTab("them")}
      >
        {t("intel.tabThem")}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === "us"}
        className={`mc-tabs3__btn${tab === "us" ? " is-on" : ""}`}
        onClick={() => setTab("us")}
      >
        {t("intel.tabUs")}
      </button>
    </div>
  );

  const approval = (variant: "desk" | "mobile") => (
    <SuggestionDeck
      suggestions={suggestions}
      pending={pendingActions}
      onAct={onAct}
      onExpire={onExpire}
      variant={variant}
    />
  );

  // ── desk layout（cockpit 中欄＋右欄）──────────────────────────────
  if (layout === "desk") {
    return (
      <>
        <section className="mc-desk__main">
          <div className="mc-desk__topbar">
            <span className="mc-desk__connpill mc-mono">{wsStatusLabel(realtime.status)}</span>
            {clock ? <span className="mc-desk__clock mc-mono">{clock}</span> : null}
            {topbarExtra}
          </div>
          {banner}
          {approval("desk")}
          <TranscriptStream segments={segments} signals={signals} variant="desk" />
          <DeepResearchBox remainingQuota={quota} lines={researchLines} onSubmit={onDeepResearch} />
        </section>

        <section className="mc-desk__side">
          <ChecklistPanel
            items={checklist}
            status={checklistStatus}
            currentSlideIdx={currentSlideIdx}
            onAction={onChecklistAction}
            variant="desk"
          />
          {intelTabs}
          <div className="mc-desk__intel">
            <InfoCardStream cards={filterIntel(cards, tab)} variant="desk" />
          </div>
        </section>
      </>
    );
  }

  // ── stack layout（/hud 第二裝置：手機直式）──────────────────────────
  return shell(
    <>
      <div className="mc-hudm__top">
        <span className="mc-hudm__dot" aria-hidden="true" />
        <span className="mc-hudm__live mc-mono">{clock ? t("liveWithClock", { clock }) : t("live")}</span>
        {currentSlideIdx !== undefined && currentSlideIdx >= 0 ? (
          <span className="mc-hudm__page mc-mono">{t("slidePage", { n: currentSlideIdx + 1 })}</span>
        ) : null}
      </div>

      {banner}

      {/* 清單：手機上收合成一行（進度＋下一項），點一下展開仍可勾選——行為不回退。 */}
      <ChecklistPanel
        items={checklist}
        status={checklistStatus}
        currentSlideIdx={currentSlideIdx}
        onAction={onChecklistAction}
        variant="bar"
      />
      {approval("mobile")}

      <div className="mc-hudm__section">
        <span className="mc-kicker">{t("intel.title")}</span>
        {intelTabs}
        <InfoCardStream cards={filterIntel(cards, tab)} variant="mobile" />
      </div>

      {/* 設計稿的手機版沒有這兩塊；保留成摺疊區——第二裝置可用性不得回退（RWD 紅線）。 */}
      <details className="mc-hudm__more">
        <summary>{t("transcript.title")}</summary>
        <TranscriptStream segments={segments} signals={signals} variant="mobile" />
      </details>
      <details className="mc-hudm__more">
        <summary>{t("research.title")}</summary>
        <DeepResearchBox remainingQuota={quota} lines={researchLines} onSubmit={onDeepResearch} />
      </details>
    </>,
  );
}

/** Pre-first-connect state: honest connecting/failed UI (no fake "聆聽中…" stream panels). */
function ConnectingState({
  status,
  reason,
  onRetry,
  onRelink,
  showRelink = true,
}: {
  status: WsStatus;
  reason: string | null;
  onRetry: () => void;
  onRelink: () => void;
  showRelink?: boolean;
}) {
  const t = useTranslations("hud");
  const failed = status === "failed";
  return (
    <div className={`mc-hudm__note${failed ? " is-failed" : ""}`} role={failed ? "alert" : "status"}>
      {!failed ? <span className="mc-hudm__spinner" aria-hidden="true" /> : null}
      <p className="mc-hudm__notetitle">{failed ? t("connFailedTitle") : wsStatusLabel(status)}</p>
      <p className="mc-hudm__notedesc">{failed ? (reason ?? t("connFailed")) : t("connecting")}</p>
      {failed ? (
        <div className="mc-hudm__noteacts">
          <button type="button" className="mc-btn mc-btn--primary" onClick={onRetry}>
            {t("connRetry")}
          </button>
          {showRelink ? (
            <button type="button" className="mc-btn mc-btn--ghost" onClick={onRelink}>
              {t("relink")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** No creds ⇒ second-device join: paste the session link (or "meetingId wsToken") handed off from /copilot. */
function ConnectPanel({ onConnected }: { onConnected: (c: MeetingCreds) => void }) {
  const t = useTranslations("hud.connect");
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parsePastedCreds(value);
    if (!parsed) {
      setErr(t("parseError"));
      return;
    }
    saveMeetingCreds(parsed);
    onConnected(parsed);
  }

  return (
    <main className="mc-hudm mc-hudm--connect">
      <span className="mc-kicker mc-kicker--page">{t("kicker")}</span>
      <h1 className="mc-hudm__h1">{t("title")}</h1>
      <p className="mc-hudm__lead">{t("lead")}</p>
      <form className="mc-hudm__connform" onSubmit={submit}>
        <textarea
          className="mc-input"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("placeholder")}
          aria-label={t("fieldLabel")}
        />
        {err ? <p className="mc-hudm__err">{err}</p> : null}
        <button type="submit" className="mc-btn mc-btn--primary">
          {t("submit")}
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
