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
  const t = useTranslations("copilot");
  const Root = rootTag;
  // Embedded in the cockpit the page h1 is CockpitView's「MeetCopilot」— demote this capture heading to h2 so the
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
        {/* 2026-07-28：原本這三行是硬編碼中文，且這裡的叫法與側欄、頁標題三處各不相同（偵察卡點 7）。
            已改走 i18n 並統一到「MeetCopilot · 擷取端」。 */}
        <Heading className="mc-cap__h1">{t("captureHeading")}</Heading>
        <p className="mc-cap__lead">{t("captureLead")}</p>
        <p className="mc-cap__platform" role="note">
          {t("capturePlatform")}
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
          {/* (b) Tab-audio guidance rendered just-in-time, immediately before the getDisplayMedia picker fires. */}
          <TabShareTutorial />
          {/* (a) Inline consent at the start card so「audio never reaches ASR」is a visible gate, not a hidden one.
              NEVER default-checked; only gates whether PCM reaches the analyzer (onFrame), never the I2 approval gate. */}
          <div className="mc-cap__consent">
            <label className="mc-cap__consent-row">
              <input type="checkbox" checked={consentGranted} onChange={toggleConsent} />
              <span>{t("consentInline")}</span>
            </label>
          </div>
          <p className="mc-cap__vuhint">{t("consentInlineHint")}</p>
          {/* (d) One light step: session already exists (created upstream), so consent + guidance + start live
              together here. getDisplayMedia fires in this button's own user gesture — no createMeeting awaited between. */}
          <button type="button" className="mc-btn mc-btn--primary mc-cap__startbtn" onClick={start}>
            {t("startListening")}
          </button>
        </section>
      )}
    </Root>
  );
}

/** Big red guard when the user forgot to tick "Share tab audio" — the most important error state.
 *  (c) One-tap retry that re-calls start() (a fresh getDisplayMedia gesture), labelled to remind about tab audio. */
function ZeroTrackGuard({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("copilot");
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
        {t("zeroTrackRetry")}
      </button>
    </section>
  );
}

/** Illustrated tab-picker guidance (our UI; the system picker itself can't be styled).
 *  Rendered just-in-time at the start card, right before the getDisplayMedia picker fires. */
function TabShareTutorial() {
  const t = useTranslations("copilot");
  return (
    <div className="mc-cap__tutorial">
      <p className="mc-cap__tutorial-lead">{t("tabAudioTitle")}</p>
      <ol className="mc-cap__steps">
        <li>{t("tabAudioStep1")}</li>
        <li>{t("tabAudioStep2")}</li>
        <li>{t("tabAudioStep3")}</li>
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

/**
 * No creds ⇒ this account (B) creates the live session (POST /api/meetings → wsToken). Requires login.
 *
 * MEETING_CHECKLIST_CONTRACT §9：除標題外多了「選簡報／選對方公司／會議目標」三欄，**全部可留空**——
 * 三欄全空時行為與加清單前完全一致（server 不生成 checklist、不報錯），主動線仍是「填標題→建立 session」一步。
 * 目標欄放在 `<details>` 次要位置；選了簡報或公司時自動打 `draft-objective` 預填（使用者一改就不再覆寫）。
 */
function SetupPanel({ onReady, rootTag = "main", embedded = false }: { onReady: (c: MeetingCreds) => void; rootTag?: "main" | "section"; embedded?: boolean }) {
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

        <details className="mc-cap__objective">
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
