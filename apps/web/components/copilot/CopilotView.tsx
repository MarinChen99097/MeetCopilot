"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { AudioChannels, CompanySummary, DeckSummary, ServerMessage } from "@meetcopilot/shared";
import { API_BASE, ApiError, createMeeting, draftMeetingObjective, endMeeting, listCompanies, listDecks, requestDeckTextExtract } from "@/lib/api";
import { startCapture, CaptureError, type CaptureController } from "@/lib/audio-capture";
import { useRealtime, wsStatusKey, type WsStatus } from "@/lib/useRealtime";
import { clearMeetingCreds, readMeetingCreds, saveMeetingCreds, type MeetingCreds } from "@/lib/meeting-session";
import { ToastProvider, useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Spinner } from "@/components/ui/Spinner";
import { Link, useRouter } from "@/i18n/navigation";
import { VuMeter } from "./VuMeter";
import { useElapsedLabel } from "./use-elapsed";

/** capture-surface lifecycle phases (drives which panel renders).
 *  "ended"＝使用者按了瀏覽器的「停止分享」（本機音軌沒了，會議還活著，可再開始聆聽）；
 *  "meeting-ended"＝會議已在 server 端結束（不可回頭，正在導回首頁）；
 *  "end-failed"＝結束會議的請求失敗，**server 端狀態不明**（`store.end` 可能已成功、只是之後或回應途中出錯）。
 *  三者語意不同，不可互用。特別是 "end-failed" **絕不能**退回 "idle"——那等於在狀態不明時給一顆
 *  「開始聆聽」：會議若真的已結束，那顆鈕只會叫出分享泡泡、要到權限、再被 server 的握手閘關掉，
 *  使用者卻以為自己回到了會議中。（**安全性不靠這個 phase**：已結束的會議不得被復活由
 *  `apps/server/src/realtime/ws-handshake-gate.ts` 保證。） */
type Phase =
  | "setup"
  | "idle"
  | "requesting"
  | "listening"
  | "zero-track"
  | "ended"
  | "meeting-ended"
  | "end-failed"
  | "error";

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
  onMeetingEnded,
}: {
  embedded?: boolean;
  creds?: MeetingCreds | null;
  onCreds?: (c: MeetingCreds) => void;
  rootTag?: "main" | "section";
  /** "page"＝standalone 單欄；"rail"＝cockpit 左欄控制軌（設計稿形態）。 */
  variant?: "page" | "rail";
  /** rail：「把提示傳到手機」——由 cockpit 提供（開啟第二裝置交接面板）。 */
  onHandoff?: () => void;
  /** 會議已在 server 端結束，請 parent 清掉 creds（HUD 那條 socket 只吃 parent 的 creds，與 phase 無關）。 */
  onMeetingEnded?: () => void;
} = {}) {
  const toast = useToast();
  const t = useTranslations("copilot");
  // WS 連線狀態／斷線原因的文案在共用的 `ws` namespace（/copilot、/hud、/sim 同一份；判定函式回 key，
  // 因為它在 React 之外的 socket callback 裡跑，見 lib/ws.ts 的 WsReasonKey）。
  const tw = useTranslations("ws");
  const router = useRouter();
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
  // 「結束這場會議」：確認框開關 ＋ in-flight 旗標（ConfirmDialog 沒有 busy/disabled prop，防連點由呼叫端自己管）。
  // `endingMeeting` **只**服務 `confirmEndMeeting` 開頭那道 guard，不再綁任何 `disabled`：它為 true 的
  // 那段期間 phase 已在**同一批更新**裡被設成 "meeting-ended"，於是兩顆曾經綁過它的按鈕
  //（end-failed 的「再試一次結束」、`!meetingClosed` 裡的「結束這場會議」）在那個 phase 下都不渲染
  // ——綁上去恆為 false，是一條讀起來像防護、實際永遠不會發生的分支。
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [endingMeeting, setEndingMeeting] = useState(false);
  // 這次擷取實際送出的聲道數（1＝只有分頁音訊；2＝交錯 L 麥克風／R 分頁）。**必須在 setPhase("listening")
  // 之前**寫入：`useRealtime` 的 `enabled` 由 phase 決定，先設聲道數才能保證 socket 開的時候格式已定。
  const [captureChannels, setCaptureChannels] = useState<AudioChannels>(1);
  // 開始聆聽的時刻（client 事件）→ 左欄 mono 時鐘顯示真實經過時間；null＝還沒開始，不渲染時鐘。
  const [listeningSince, setListeningSince] = useState<number | null>(null);
  const clock = useElapsedLabel(listeningSince);

  const controllerRef = useRef<CaptureController | null>(null);
  const consentRef = useRef(false);
  const sendAudioRef = useRef<(f: ArrayBuffer) => void>(() => {});
  /**
   * in-flight `startCapture()` 的世代編號（取消權）。`startCapture` 可能耗時數秒（麥克風權限泡泡最長
   * 等 `MIC_TIMEOUT_MS = 10000`），這段期間使用者可以按「停止聆聽」「結束這場會議」、或直接讓元件卸載。
   * 每次 `stopCapture()`（＝上述三處的共同出口）與每次 `start()` 都把它 +1；`start()` 在 await 之後
   * 比對自己那一代還是不是最新的，不是就**主動 stop() 那個 controller、不寫 ref、不改 phase**。
   * 沒有它會有兩種真實失效：(a) 使用者以為停了、幾秒後 phase 被推回 listening ＝ 音訊重新外送（隱私）；
   * (b) 元件已卸載，controller 寫進沒人碰得到的 ref ＝ 螢幕分享與麥克風軌永遠不會被釋放。
   */
  const startEpochRef = useRef(0);

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
    channels: captureChannels,
    onMessage,
    onOpen: () => realtime.send({ type: "consent", granted: consentRef.current }),
  });
  sendAudioRef.current = realtime.sendAudio;

  // ── capture control ─────────────────────────────────────────────
  /**
   * 停止本機收音，並**作廢任何 in-flight 的 `startCapture()`**（世代 +1）。
   * 這是「停止聆聽／結束這場會議／unmount cleanup」三處的共同出口，所以取消權只需要在這裡實作一次
   * ——三處都已經（且必須繼續）呼叫它。
   */
  const stopCapture = useCallback(() => {
    startEpochRef.current += 1;
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
    // 這一代的編號。await 期間任何 stopCapture()（停止聆聽／結束會議／卸載）或另一次 start() 都會讓它過期。
    startEpochRef.current += 1;
    const epoch = startEpochRef.current;
    try {
      const ctrl = await startCapture({
        onFrame,
        // `onEnded` 也吃同一道世代閘：已取消的 controller 若還發得出 `ended`，會把畫面推去 "ended"
        // ＋長出一顆「重新開始聆聽」。今天它發不出來（`audio-capture` 的 `stop()` 會 removeEventListener），
        // 但那是別的檔案的實作細節，不該當成這裡的正確性前提。
        onEnded: () => {
          if (startEpochRef.current !== epoch) return;
          onEnded();
        },
      });
      if (startEpochRef.current !== epoch) {
        // 已被取消：**主動釋放**這個 controller 的螢幕分享／麥克風軌（stop() 是 idempotent）。
        // 不 stop 的話分頁的分享／麥克風指示燈會一直亮著，而且沒有任何 UI 拿得到它。
        ctrl.stop();
        return; // 不寫 controllerRef、不改 phase（否則畫面會從 idle／meeting-ended 被推回 listening）
      }
      controllerRef.current = ctrl;
      // 順序是硬契約：`enabled: phase === "listening"` 讓 socket 只在進 listening 後才建，而聲道數
      // **在同一個同步區塊、且在 setPhase 之前**寫入 → React 18 會把兩個 setState 批成同一次 render，
      // 就算沒批（React 17 語意）也是先 render 出新的 channels、enabled 仍為 false，下一次才連線。
      // 兩種情況都不存在「socket 先開、聲道數後到」的窗口。麥克風被拒 → ctrl.channels 為 1（mp3-capture
      // 那種不提供此欄位的 controller 也一樣落 1），與現行 mono 行為完全一致。
      setCaptureChannels(ctrl.channels ?? 1);
      setListeningSince(Date.now());
      setPhase("listening");
    } catch (e) {
      // 同一道取消閘：已取消的 start 失敗了也不該把畫面推去 zero-track／error
      // （使用者已經停止聆聽或結束會議，跳一個擷取錯誤只會讓人以為剛才的動作沒生效）。
      if (startEpochRef.current !== epoch) return;
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

  /**
   * 「結束這場會議」——確認後才跑，**順序是硬契約**：
   *   1) 關 dialog ＋ 上 in-flight 鎖（防連點）
   *   2) stopCapture()：停掉本機收音
   *   3) setPhase("meeting-ended")：`enabled: phase === "listening"` 轉 false → useRealtime 的 effect
   *      cleanup 主動 close 這條 capture socket
   *   4) 等 socket 斷掉之後才 POST /end → server 的 `ws.close(1000, "meeting ended")` 不會打到還活著的連線
   *   5) clearMeetingCreds() → 6) onMeetingEnded()（parent 清 creds，HUD 那條 socket 才會斷）→ 7) toast ＋ 導回首頁
   */
  const confirmEndMeeting = useCallback(async () => {
    if (!creds || endingMeeting) return;
    setConfirmEndOpen(false);
    setEndingMeeting(true);
    stopCapture();
    setListeningSince(null);
    // 「這場會議」四列吃的是 server 推播的快照——離開 listening 就該清（與 stopListening 一致），
    // 否則會停在已結束會議的最後狀態（已連裝置／已播到第幾頁）。放這裡＝成功與失敗路徑都清得掉。
    setServerState(null);
    setPhase("meeting-ended");

    // 本地狀態已無效時共用的收尾（成功／404 都要跑）。
    const dropSession = () => {
      clearMeetingCreds();
      onMeetingEnded?.();
    };

    try {
      await endMeeting(creds.meetingId);
      dropSession();
      setEndingMeeting(false);
      toast.push({ kind: "success", message: t("endMeetingDone") });
      router.push("/");
    } catch (e) {
      // 404＝會議不存在或已結束：本地狀態同樣無效 → 照樣清掉並導回去（只是換個文案）。
      if (e instanceof ApiError && e.status === 404) {
        dropSession();
        setEndingMeeting(false);
        toast.push({ kind: "info", message: t("endMeetingGone") });
        router.push("/");
        return;
      }
      // 其他錯誤（網路／5xx）：**server 端狀態不明**——`store.end` 可能已經成功，只是之後才出錯、
      // 或回應在途中斷掉。舊寫法退回 "idle" 是錯的：那在狀態不明時給了一顆「開始聆聽」，按下去會
      // 重新要分享／麥克風權限，然後（會議若真的已結束）被 server 的握手閘打回來。改落 "end-failed"：
      // 誠實說明不確定，只給兩個確定有意義的出口（再試一次結束／離開這場會議）。
      setEndingMeeting(false);
      setPhase("end-failed");
      toast.push({ kind: "error", message: t("endMeetingFailed") });
    }
  }, [creds, endingMeeting, stopCapture, onMeetingEnded, toast, t, router]);

  /**
   * 「離開這場會議」（只在 end-failed 出現）：不再打 server，純粹丟掉本地已失效／不可信的 session
   * 並導回首頁。收音早已停掉（confirmEndMeeting 一開頭就 stopCapture），所以離開不會留下任何軌。
   */
  const leaveMeeting = useCallback(() => {
    clearMeetingCreds();
    onMeetingEnded?.();
    router.push("/");
  }, [onMeetingEnded, router]);

  /**
   * 會議在**別處**被結束（server 用 close 1000 關掉這條 capture socket）→ 本地也必須落到 meeting-ended。
   * 否則畫面停在 listening＋失敗面板，使用者按「停止聆聽」再按「開始聆聽」會再走一次分享／麥克風
   * 授權，然後被 server 的握手閘（`ws-handshake-gate.ts`）以 1000 打回來——白做工又看不懂為什麼。
   * **這是 UX 收尾，不是防線**：那道閘才是「completed 會議不得重建 runtime」的保證。
   * 只動本地狀態：不清 creds、不通知 parent、不導航——使用者沒有下任何指令，不該被強制帶走。
   * （自己按「結束這場會議」不會走到這裡：那條路先 setPhase("meeting-ended") 讓 effect cleanup 主動關 socket，
   *   `disposed` 為 true，onClose 根本不會判定失敗。）
   */
  useEffect(() => {
    if (realtime.failureKind !== "ended") return;
    stopCapture();
    setListeningSince(null);
    setServerState(null);
    setPhase("meeting-ended");
    // storage 裡那組 creds 指向一場已結束的會議：留著的話重新整理／再進 /copilot 就會拿它連一次、
    // 再被握手閘拒一次。清掉＝重整後回到建會表單，這才是已結束會議該有的樣子。
    // **只清 storage**，不呼叫 onMeetingEnded()——parent 一清 creds 本元件就被卸載，使用者連
    // 「會議已結束」都來不及看到，而且他並沒有下任何指令。
    clearMeetingCreds();
  }, [realtime.failureKind, stopCapture]);

  // Stop capture on unmount —— 同時作廢 in-flight 的 startCapture（stopCapture 會 +1 世代），
  // 否則權限泡泡還開著時被卸載，稍後 resolve 的 controller 會寫進沒人碰得到的 ref ＝ 軌永遠不釋放。
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
  /**
   * 這場會議已經不可能再收音了：已結束（meeting-ended），或結束請求失敗、server 狀態不明（end-failed）。
   * 兩者的 UI 規則一致——**不渲染任何收音相關互動**（VU 表／同意閘／分享教學／開始聆聽／結束會議鈕）：
   * socket 已斷，那些互動不是無效就是有害（見各處註解）。
   */
  const meetingClosed = phase === "meeting-ended" || phase === "end-failed";
  /**
   * 收攤畫面那句話。三個渲染點（rail 的 meeting-ended 分支、rail 的 end-failed 分支、standalone 面板）
   * 講的是同一件事，**只能有一份選擇邏輯**——先前兩個 rail 分支各硬編一句、standalone 再用三元式
   * 重算同一個選擇，等於同一個 phase 有三個地方可以走樣。
   */
  const closedText = phase === "meeting-ended" ? t("endMeetingDone") : t("endMeetingUncertain");

  // 「這場會議」欄位：全部是 server/本地已知的真實事實（設計稿的「用的簡報／手機提示已連上 1 台」等
  // 欄位後端沒有 → 不渲染、不塞假值）。
  const facts: Array<{ k: string; v: string }> = [
    { k: t("factLink"), v: tw(wsStatusKey(realtime.status)) },
    { k: t("factRoles"), v: serverState?.connectedRoles?.length ? serverState.connectedRoles.join(" · ") : "—" },
    { k: t("factPage"), v: serverState ? String(serverState.committedIndex + 1) : "—" },
    // 會議已收攤時 `serverState` 已清（confirmEndMeeting），若沿用 fallback 會落到 local
    // `consentGranted` → 同意閘門明明已不渲染，這列卻還寫「已同意」。與其他三列一致顯示無資料。
    {
      k: t("factConsent"),
      v: meetingClosed
        ? "—"
        : (serverState ? serverState.consent : consentGranted)
          ? t("factConsentOn")
          : t("factConsentOff"),
    },
  ];

  if (variant === "rail") {
    return (
      <Root className="mc-rail" aria-label={t("captureLabel")}>
        <div className="mc-rail__live">
          <span className={`mc-rail__dot${live ? " is-live" : ""}`} aria-hidden="true" />
          {/* `meeting-ended`／`end-failed` 時 `live` 為 false，若沿用二元式會顯示「未開始」——與事實相反
              （會議是已結束／結束狀態未確認）。 */}
          <span className="mc-rail__livetext mc-mono">
            {phase === "meeting-ended"
              ? t("railEnded")
              : phase === "end-failed"
                ? t("railEndFailed")
                : live
                  ? t("railLive")
                  : t("railIdle")}
          </span>
          {clock ? <span className="mc-rail__clock mc-mono">{clock}</span> : null}
        </div>

        {/* 會議收攤後就沒有音量可看（active 早已是 false、柱子全貼底）→ 整條收起來，不留死版面。 */}
        {!meetingClosed ? (
          <VuMeter getLevel={getLevel} active={phase === "listening"} label={t("vuLabel")} />
        ) : null}

        {/* 合規：同意閘永遠在最顯眼的位置，且**絕不預設勾選**。未勾＝PCM 不送分析。
            會議收攤後整塊（checkbox ＋ hint）不渲染：socket 已斷，`toggleConsent` 的
            `realtime.send` 會靜默 no-op，但 local state 與 hint 文案照樣翻轉 ＝ 隱私閘門上的假互動
            （使用者以為自己撤回／給予了同意，實際什麼都沒送出）。改 `disabled` 不夠——那仍暗示
            「等一下就能操作」；會議已結束，同意與否已無作用對象，直接不渲染。 */}
        {!meetingClosed ? (
          <>
            <label className={`mc-consent3${consentGranted ? " is-on" : ""}`}>
              <input type="checkbox" checked={consentGranted} onChange={toggleConsent} />
              <span className="mc-consent3__text">{t("consentInline")}</span>
            </label>
            <p className="mc-rail__hint">
              {analyzing ? t("consentAnalyzing") : consentGranted ? t("consentWaiting") : t("consentInlineHint")}
            </p>
          </>
        ) : null}

        <div className="mc-rail__acts">
          {phase === "meeting-ended" ? (
            // 會議已結束：只留狀態文字＋一個純本地的出口。**不渲染任何「開始／重新開始聆聽」鈕**
            // ——那會誘導使用者對已結束的會議重新 start()（拿失效的 creds 連一個 completed meeting）。
            // 出口是必要的：自己按「結束這場會議」時下一步就導航了，但**會議在別處被結束**時
            // （上方 failureKind effect）沒有任何導航，少了這顆鈕就是一個沒有出路的死畫面。
            <>
              <p className="mc-rail__ended" role="status">
                {closedText}
              </p>
              <button type="button" className="mc-btn mc-btn--ghost mc-rail__second" onClick={leaveMeeting}>
                {t("endMeetingLeave")}
              </button>
            </>
          ) : phase === "end-failed" ? (
            // 結束失敗、server 狀態不明：同樣**不給「開始聆聽」**——狀態不明時那顆鈕只會重新要授權，
            // 會議若真的已結束再被握手閘打回來。只給兩個確定有意義的出口：再打一次 /end（冪等；
            // 已結束會回 404，走既有的「已經結束了」分支）、或純本地離開（不碰 server）。
            <>
              <p className="mc-rail__ended" role="status">
                {closedText}
              </p>
              <button type="button" className="mc-btn mc-btn--primary mc-rail__main" onClick={confirmEndMeeting}>
                {t("endMeetingRetryAction")}
              </button>
              <button type="button" className="mc-btn mc-btn--ghost mc-rail__second" onClick={leaveMeeting}>
                {t("endMeetingLeave")}
              </button>
            </>
          ) : (
            <>
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
            </>
          )}
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
        {/* 連線失敗。**只有 `canRetry` 時才給重試鈕**：終態按了只會再被 server 用同一個 close code
            關一次（會議已結束時是握手閘的 1000），是一顆保證無效的按鈕。
            終態改成一句說明；失敗原因（`failureReasonKey` → `ws` namespace 文案）本來就會分辨是
            「會議已結束」還是「憑證／帳號」。 */}
        {realtime.status === "failed" ? (
          <div className="mc-rail__alert is-err" role="alert">
            <p>{realtime.failureReasonKey ? tw(realtime.failureReasonKey) : t("connFailed")}</p>
            {realtime.canRetry ? (
              <button type="button" className="mc-btn mc-btn--sm" onClick={realtime.retry}>
                {t("connRetry")}
              </button>
            ) : (
              <p>{t("connTerminalHint")}</p>
            )}
          </div>
        ) : null}

        {/* 分享前的分頁音訊教學：就在按鈕正上方出現（just-in-time），開始聆聽後收起來。
            會議收攤後也要收起來——不會再有下一次分享，這時還教人怎麼勾「分享分頁音訊」只會誤導
            （`live` 在那些 phase 為 false，故必須額外排除）。 */}
        {!live && !meetingClosed ? (
          <details className="mc-rail__tutorial" open>
            <summary>{t("tabAudioTitle")}</summary>
            <ol>
              <li>{t("tabAudioStep1")}</li>
              <li>{t("tabAudioStep2")}</li>
              <li>{t("tabAudioStep3")}</li>
            </ol>
            {/* 補充說明，不是第 4 步 → 放 <ol> 之後，不塞進清單。 */}
            <p className="mc-tut3__note">{t("tabAudioNote")}</p>
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

        {/* 破壞性動作：刻意與上方主要動作區拉開（次級 ghost 樣式＋分隔線），放在「這場會議」資訊區下方。
            `requesting`（權限泡泡開著、擷取還沒 resolve）時 disabled：那一刻結束會議會讓本元件在
            in-flight 的 `startCapture` resolve 前就卸載。**根因**已由世代取消機制擋住（resolve 後會主動
            stop() 並且不寫 ref），這裡只是不要讓人踩進那個競態。 */}
        {!meetingClosed ? (
          <div className="mc-rail__danger">
            <button
              type="button"
              className="mc-btn mc-btn--ghost"
              onClick={() => setConfirmEndOpen(true)}
              disabled={phase === "requesting"}
            >
              {t("endMeeting")}
            </button>
          </div>
        ) : null}

        <p className="mc-rail__platform" role="note">
          {t("capturePlatform")}
        </p>

        {/* `!meetingClosed` 一併擋掉一個窄競態：確認框開著時會議在別處被結束 → phase 翻成 meeting-ended，
            對話框卻還掛在畫面上、按鈕仍可按（結果是 404 → 導回首頁，安全但語意混亂）。收攤了就收框。 */}
        {confirmEndOpen && !meetingClosed ? (
          <ConfirmDialog
            title={t("endMeetingConfirmTitle")}
            message={t("endMeetingConfirmBody")}
            confirmLabel={t("endMeetingConfirmYes")}
            cancelLabel={t("endMeetingConfirmNo")}
            confirmTone="danger"
            onConfirm={confirmEndMeeting}
            onCancel={() => setConfirmEndOpen(false)}
          />
        ) : null}
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

      {/* 會議收攤（meeting-ended／end-failed）：standalone 版沒有「結束這場會議」入口，正常走不到這裡，
          但 socket 若被 server 以 1000 關掉就會落進來（見上方 failureKind 的 effect）。**必須先攔**——
          否則會掉到最後那個 else 分支，長出一顆對已結束會議的「開始聆聽」。 */}
      {meetingClosed ? (
        <section className="mc-panel mc-cap3__panel">
          <p className="mc-rail__ended" role="status">
            {closedText}
          </p>
        </section>
      ) : phase === "zero-track" ? (
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
      {/* 補充說明，不是第 4 步 → 放 <ol> 之後，不塞進清單。 */}
      <p className="mc-tut3__note">{t("tabAudioNote")}</p>
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
