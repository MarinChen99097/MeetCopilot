"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { CompanySummary, DeckSummary, ServerMessage } from "@meetcopilot/shared";
import { API_BASE, ApiError, createMeeting, draftMeetingObjective, listCompanies, listDecks, requestDeckTextExtract } from "@/lib/api";
import { startCapture, CaptureError, type CaptureController } from "@/lib/audio-capture";
import { useRealtime, wsStatusLabel, type WsStatus } from "@/lib/useRealtime";
import { readMeetingCreds, saveMeetingCreds, type MeetingCreds } from "@/lib/meeting-session";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { Spinner } from "@/components/ui/Spinner";
import { Link } from "@/i18n/navigation";
import { VuMeter } from "./VuMeter";
import { useElapsedLabel } from "./use-elapsed";

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
 * Capture surface（擷取控制）。
 *
 * 2026-07-30 重設計（DESIGN_APPLY W3）：cockpit 改成三欄 Signal Desk，本元件成為**左欄控制軌**
 * （`variant="rail"`，原稿 :169-199 的形態：LIVE 列＋VU 表＋主按鈕＋「這場會議」欄位）。
 * standalone（/copilot 舊 wrapper）維持原本的單欄卡片流（`variant="page"`）。
 *
 * **合規零變更**：consent 同意閘（未同意→PCM 不送分析）與 TabShareTutorial 兩者在兩個 variant 都在，
 * 只是換皮；zero-track／error／ended 三個例外態也全部保留（設計稿沒畫，但那是設計稿的缺口）。
 *
 * 嵌在 cockpit 時 creds 由 parent 擁有（`creds` 傳入），session 建立走 parent 的 SetupPanel。
 */
export function CopilotInner({
  embedded = false,
  creds: credsProp,
  onCreds,
  rootTag = "main",
  variant = "page",
  onHandoff,
}: {
  embedded?: boolean;
  creds?: MeetingCreds | null;
  onCreds?: (c: MeetingCreds) => void;
  rootTag?: "main" | "section";
  /** "page"＝standalone 單欄；"rail"＝cockpit 左欄控制軌（設計稿形態）。 */
  variant?: "page" | "rail";
  /** rail：「把提示傳到手機」——由 cockpit 提供（開啟第二裝置交接面板）。 */
  onHandoff?: () => void;
} = {}) {
  const toast = useToast();
  const t = useTranslations("copilot");
  const Root = rootTag;
  // Embedded in the cockpit the page h1 is CockpitView's — demote this capture heading to h2 so the
  // cockpit page has exactly one h1. Standalone (/copilot wrapper) keeps its own h1.
  const Heading = embedded ? "h2" : "h1";

  const [creds, setCreds] = useState<MeetingCreds | null>(embedded ? credsProp ?? null : null);
  const [resolved, setResolved] = useState(false);
  const [phase, setPhase] = useState<Phase>(embedded && credsProp ? "idle" : "setup");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const [consentGranted, setConsentGranted] = useState(false);
  const [serverState, setServerState] = useState<SessionState | null>(null);
  // 開始聆聽的時刻（client 事件）→ 左欄 mono 時鐘顯示真實經過時間；null＝還沒開始，不渲染時鐘。
  const [listeningSince, setListeningSince] = useState<number | null>(null);
  const clock = useElapsedLabel(listeningSince);

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
    setListeningSince(null);
    setPhase("ended");
  }, [stopCapture]);

  const start = useCallback(async () => {
    setErrorMsg("");
    setPhase("requesting");
    try {
      const ctrl = await startCapture({ onFrame, onEnded });
      controllerRef.current = ctrl;
      setListeningSince(Date.now());
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
    setListeningSince(null);
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
  if (!resolved) return <Root className={variant === "rail" ? "mc-rail" : "mc-cap3"} aria-busy="true" />;
  if (phase === "setup" && !creds) {
    return <SetupPanel rootTag={rootTag} embedded={embedded} onReady={adoptCreds} />;
  }

  const analyzing = phase === "listening" && consentGranted && realtime.status === "open";
  const live = phase === "listening" || phase === "requesting";

  // 「這場會議」欄位：全部是 server/本地已知的真實事實（設計稿的「用的簡報／手機提示已連上 1 台」等
  // 欄位後端沒有 → 不渲染、不塞假值）。
  const facts: Array<{ k: string; v: string }> = [
    { k: t("factLink"), v: wsStatusLabel(realtime.status) },
    { k: t("factRoles"), v: serverState?.connectedRoles?.length ? serverState.connectedRoles.join(" · ") : "—" },
    { k: t("factPage"), v: serverState ? String(serverState.committedIndex + 1) : "—" },
    { k: t("factConsent"), v: (serverState ? serverState.consent : consentGranted) ? t("factConsentOn") : t("factConsentOff") },
  ];

  if (variant === "rail") {
    return (
      <Root className="mc-rail" aria-label={t("captureLabel")}>
        <div className="mc-rail__live">
          <span className={`mc-rail__dot${live ? " is-live" : ""}`} aria-hidden="true" />
          <span className="mc-rail__livetext mc-mono">{live ? t("railLive") : t("railIdle")}</span>
          {clock ? <span className="mc-rail__clock mc-mono">{clock}</span> : null}
        </div>

        <VuMeter getLevel={getLevel} active={phase === "listening"} label={t("vuLabel")} />

        {/* 合規：同意閘永遠在最顯眼的位置，且**絕不預設勾選**。未勾＝PCM 不送分析。 */}
        <label className={`mc-consent3${consentGranted ? " is-on" : ""}`}>
          <input type="checkbox" checked={consentGranted} onChange={toggleConsent} />
          <span className="mc-consent3__text">{t("consentInline")}</span>
        </label>
        <p className="mc-rail__hint">
          {analyzing ? t("consentAnalyzing") : consentGranted ? t("consentWaiting") : t("consentInlineHint")}
        </p>

        <div className="mc-rail__acts">
          {live ? (
            <button type="button" className="mc-btn mc-btn--primary mc-rail__main" onClick={stopListening}>
              {t("stopListening")}
            </button>
          ) : (
            <button type="button" className="mc-btn mc-btn--primary mc-rail__main" onClick={start}>
              {t("startListening")}
            </button>
          )}
          {onHandoff ? (
            <button type="button" className="mc-btn mc-btn--ghost mc-rail__second" onClick={onHandoff}>
              {t("handoffToPhone")}
            </button>
          ) : null}
        </div>

        {/* 例外態（設計稿沒畫，但都是真實會發生的狀況——不可刪） */}
        {phase === "zero-track" ? <ZeroTrackGuard onRetry={start} compact /> : null}
        {phase === "error" ? (
          <div className="mc-rail__alert is-err" role="alert">
            <p>{errorMsg || t("captureFailed")}</p>
            <button type="button" className="mc-btn mc-btn--sm" onClick={start}>
              {t("reshare")}
            </button>
          </div>
        ) : null}
        {phase === "ended" ? (
          <div className="mc-rail__alert is-warn" role="alert">
            <p>{t("sharingStopped")}</p>
            <button type="button" className="mc-btn mc-btn--sm" onClick={start}>
              {t("restartListening")}
            </button>
          </div>
        ) : null}
        {realtime.status === "failed" ? (
          <div className="mc-rail__alert is-err" role="alert">
            <p>{realtime.failureReason ?? t("connFailed")}</p>
            <button type="button" className="mc-btn mc-btn--sm" onClick={realtime.retry}>
              {t("connRetry")}
            </button>
          </div>
        ) : null}

        {/* 分享前的分頁音訊教學：就在按鈕正上方出現（just-in-time），開始聆聽後收起來。 */}
        {!live ? (
          <details className="mc-rail__tutorial" open>
            <summary>{t("tabAudioTitle")}</summary>
            <ol>
              <li>{t("tabAudioStep1")}</li>
              <li>{t("tabAudioStep2")}</li>
              <li>{t("tabAudioStep3")}</li>
            </ol>
          </details>
        ) : null}

        <div className="mc-rail__facts">
          <span className="mc-kicker">{t("factsTitle")}</span>
          {facts.map((f) => (
            <div className="mc-rail__fact" key={f.k}>
              <span>{f.k}</span>
              <strong>{f.v}</strong>
            </div>
          ))}
        </div>

        <p className="mc-rail__platform" role="note">
          {t("capturePlatform")}
        </p>
      </Root>
    );
  }

  // ── standalone（單欄卡片流）─────────────────────────────────────
  return (
    <Root className="mc-cap3">
      <header className="mc-cap3__head">
        <span className="mc-kicker">{t("cockpitKicker")}</span>
        <Heading className="mc-cap3__h1">{t("captureHeading")}</Heading>
        <p className="mc-cap3__lead">{t("captureLead")}</p>
      </header>

      {phase === "zero-track" ? (
        <ZeroTrackGuard onRetry={start} />
      ) : phase === "error" ? (
        <div className="mc-rail__alert is-err" role="alert">
          <p>{errorMsg || t("captureFailed")}</p>
          <button type="button" className="mc-btn mc-btn--primary" onClick={start}>
            {t("reshare")}
          </button>
        </div>
      ) : phase === "ended" ? (
        <div className="mc-rail__alert is-warn" role="alert">
          <p>{t("sharingStopped")}</p>
          <button type="button" className="mc-btn mc-btn--primary" onClick={start}>
            {t("restartListening")}
          </button>
        </div>
      ) : live ? (
        <section className="mc-panel mc-cap3__panel" aria-busy={phase === "requesting"}>
          <div className="mc-rail__live">
            <span className="mc-rail__dot is-live" aria-hidden="true" />
            <span className="mc-rail__livetext mc-mono">{t("railLive")}</span>
            {phase === "requesting" ? <Spinner size={13} /> : null}
            {clock ? <span className="mc-rail__clock mc-mono">{clock}</span> : null}
          </div>
          <VuMeter getLevel={getLevel} active={phase === "listening"} label={t("vuLabel")} />
          <label className={`mc-consent3${consentGranted ? " is-on" : ""}`}>
            <input type="checkbox" checked={consentGranted} onChange={toggleConsent} />
            <span className="mc-consent3__text">{t("consentInline")}</span>
          </label>
          <p className="mc-rail__hint">
            {analyzing ? t("consentAnalyzing") : consentGranted ? t("consentWaiting") : t("consentInlineHint")}
          </p>
          <div className="mc-rail__facts">
            {facts.map((f) => (
              <div className="mc-rail__fact" key={f.k}>
                <span>{f.k}</span>
                <strong>{f.v}</strong>
              </div>
            ))}
          </div>
          <button type="button" className="mc-btn" onClick={stopListening}>
            {t("stopListening")}
          </button>
        </section>
      ) : (
        <section className="mc-panel mc-cap3__panel">
          <TabShareTutorial />
          <label className={`mc-consent3${consentGranted ? " is-on" : ""}`}>
            <input type="checkbox" checked={consentGranted} onChange={toggleConsent} />
            <span className="mc-consent3__text">{t("consentInline")}</span>
          </label>
          <p className="mc-rail__hint">{t("consentInlineHint")}</p>
          <button type="button" className="mc-btn mc-btn--primary mc-cap3__start" onClick={start}>
            {t("startListening")}
          </button>
          <p className="mc-rail__platform" role="note">
            {t("capturePlatform")}
          </p>
        </section>
      )}
    </Root>
  );
}

/** Big guard when the user forgot to tick "Share tab audio" — the most important error state.
 *  One-tap retry that re-calls start() (a fresh getDisplayMedia gesture), labelled to remind about tab audio. */
function ZeroTrackGuard({ onRetry, compact = false }: { onRetry: () => void; compact?: boolean }) {
  const t = useTranslations("copilot");
  return (
    <section className={`mc-zero3${compact ? " is-compact" : ""}`} role="alert">
      <span className="mc-kicker mc-kicker--warn">{t("zeroTrackKicker")}</span>
      <p className="mc-zero3__title">{t("zeroTrackTitle")}</p>
      <p className="mc-zero3__body">{t("zeroTrackBody")}</p>
      <ol className="mc-zero3__steps">
        <li>{t("tabAudioStep1")}</li>
        <li>{t("tabAudioStep2")}</li>
      </ol>
      <button type="button" className="mc-btn mc-btn--primary mc-btn--sm" onClick={onRetry}>
        {t("zeroTrackRetry")}
      </button>
    </section>
  );
}

/** Illustrated tab-picker guidance (our UI; the system picker itself can't be styled). */
function TabShareTutorial() {
  const t = useTranslations("copilot");
  return (
    <div className="mc-tut3">
      <span className="mc-kicker">{t("tabAudioTitle")}</span>
      <ol className="mc-tut3__steps">
        <li>{t("tabAudioStep1")}</li>
        <li>{t("tabAudioStep2")}</li>
        <li>{t("tabAudioStep3")}</li>
      </ol>
    </div>
  );
}

/**
 * No creds ⇒ this account (B) creates the live session (POST /api/meetings → wsToken). Requires login.
 *
 * MEETING_CHECKLIST_CONTRACT §9：除標題外多了「選簡報／選對方公司／會議目標」三欄，**全部可留空**——
 * 三欄全空時行為與加清單前完全一致（server 不生成 checklist、不報錯），主動線仍是「填標題→建立 session」一步。
 * 目標欄放在 `<details>` 次要位置；選了簡報或公司時自動打 `draft-objective` 預填（使用者一改就不再覆寫），
 * 並 fire-and-forget 觸發 deck 逐頁抽字回填。**這三個觸發在重設計後逐字保留**（只換皮）。
 */
export function SetupPanel({ onReady, rootTag = "main", embedded = false }: { onReady: (c: MeetingCreds) => void; rootTag?: "main" | "section"; embedded?: boolean }) {
  const Root = rootTag;
  const t = useTranslations("copilot");
  // Same one-h1 rule as CopilotInner: embedded under the cockpit's h1, this setup heading is an h2.
  const Heading = embedded ? "h2" : "h1";
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [decks, setDecks] = useState<DeckSummary[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [deckId, setDeckId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [objective, setObjective] = useState("");
  // 使用者一旦動過目標欄，自動草擬就不再覆寫（人工優先）。
  const [objectiveEdited, setObjectiveEdited] = useState(false);
  const [drafting, setDrafting] = useState(false);
  // 草擬用 title 但**不當 effect dep**（否則每敲一個字就打一次 API）。
  const titleRef = useRef(title);
  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  // 下拉選項：載不到就維持空陣列 → 該欄不渲染（低門檻：絕不因為選填資料載失敗而擋住建會）。
  useEffect(() => {
    let alive = true;
    listDecks()
      .then((p) => {
        if (alive) setDecks(p.items);
      })
      .catch(() => {});
    listCompanies({ pageSize: 50 })
      .then((p) => {
        if (alive) setCompanies(p.items);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // 選中 deck → fire-and-forget 觸發匯入 deck 逐頁文字回填（MEETING_CHECKLIST_CONTRACT §11.5；
  // 與 draft-objective 同時機的唯一前端觸發點）。server 自行判斷 no-op（native deck／已全有字），
  // 靜默 enhancement：零 UI 狀態、失敗不報錯、不輪詢。
  useEffect(() => {
    if (!deckId) return;
    requestDeckTextExtract(deckId).catch(() => {
      /* 靜默：回填失敗不影響建會，checklist 走「無簡報文字」既有路徑 */
    });
  }, [deckId]);

  // 選了簡報或公司 → 自動草擬會議目標（契約 §6.1；資料不足時 server 回空字串，當「沒建議」處理即可）。
  useEffect(() => {
    if (objectiveEdited) return;
    if (!deckId && !companyId) return;
    let alive = true;
    setDrafting(true);
    draftMeetingObjective({
      deckId: deckId || undefined,
      companyId: companyId || undefined,
      title: titleRef.current.trim() || undefined,
    })
      .then((r) => {
        if (alive && r.objective) setObjective(r.objective);
      })
      .catch(() => {
        /* 草擬失敗＝維持空白，不報錯、不擋流程 */
      })
      .finally(() => {
        if (alive) setDrafting(false);
      });
    return () => {
      alive = false;
    };
  }, [deckId, companyId, objectiveEdited]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setNeedLogin(false);
    try {
      const res = await createMeeting({
        title: title.trim() || "會議",
        deckId: deckId || undefined,
        companyId: companyId || undefined,
        objective: objective.trim() || undefined,
      });
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
    <Root className="mc-setup3">
      <header className="mc-setup3__head">
        <span className="mc-kicker mc-kicker--page">{t("setupKicker")}</span>
        <Heading className="mc-setup3__h1">{t("setupTitle")}</Heading>
        <p className="mc-setup3__lead">{t("setupLead")}</p>
      </header>

      <form className="mc-panel mc-setup3__form" onSubmit={submit}>
        <label className="mc-field">
          <span>{t("titleLabel")}</span>
          <input id="meeting-title" name="meeting-title" className="mc-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("titlePlaceholder")} />
        </label>

        {decks.length > 0 ? (
          <label className="mc-field">
            <span>{t("deckLabel")}</span>
            <select
              id="meeting-deck"
              name="meeting-deck"
              className="mc-input"
              value={deckId}
              onChange={(e) => setDeckId(e.target.value)}
            >
              <option value="">{t("optionNone")}</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {companies.length > 0 ? (
          <label className="mc-field">
            <span>{t("companyLabel")}</span>
            <select
              id="meeting-company"
              name="meeting-company"
              className="mc-input"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">{t("optionNone")}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <details className="mc-setup3__objective">
          <summary>{t("objectiveSummary")}</summary>
          <label className="mc-field">
            <span>{t("objectiveLabel")}</span>
            <input
              id="meeting-objective"
              name="meeting-objective"
              className="mc-input"
              value={objective}
              onChange={(e) => {
                setObjectiveEdited(true);
                setObjective(e.target.value);
              }}
              placeholder={drafting ? t("objectiveDrafting") : t("objectivePlaceholder")}
              aria-busy={drafting || undefined}
            />
            <span className="mc-field__hint">{t("objectiveHint")}</span>
          </label>
        </details>

        {needLogin ? (
          <p className="mc-setup3__err">
            {t.rich("needLogin", {
              login: (chunks) => <Link href="/login">{chunks}</Link>,
            })}
          </p>
        ) : null}
        {err ? <p className="mc-setup3__err">{err}</p> : null}
        <button type="submit" className="mc-btn mc-btn--primary mc-setup3__submit" disabled={busy}>
          {busy ? <Spinner size={14} /> : t("createSession")}
        </button>
      </form>
    </Root>
  );
}
