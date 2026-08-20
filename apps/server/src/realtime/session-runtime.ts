/**
 * LiveSessionRuntime — per-meeting in-process state, implementing the frozen SessionRuntime seam
 * (realtime/copilot.ts). Held in the RealtimeHub's Map<meetingId, LiveSessionRuntime>.
 *
 * Owns: committedIndex mirror (I1 guard reads this), consent gate, the per-session ASR + AnalysisEngine
 * instances, the approval queue (Suggestion + TTL timers), and the research quota counter.
 * ASR is 1 track for a mono capture and 2 for a stereo one (`asr` = mono/left/presenter, `asrRight` =
 * right/client, lazily attached on the first stereo frame — see `attachRightAsr`); `dispose()` resets BOTH.
 *
 * Cleanup (v1 gap: sessions grew monotonically): `dispose()` clears every timer/buffer so a hub that reclaims
 * a session on end / disconnect-timeout leaves nothing behind (bounded teardown, L13).
 */
import type { AudioChannels, SignalItem, Suggestion, WsRole } from "@meetcopilot/shared";
import type { SessionRuntime } from "./copilot.js";
import type { AsrProvider } from "../asr/asr-provider.js";
import type { AnalysisEngine } from "../analysis/analysis-engine.js";
import { WINDOW_MAX_AGE_MS } from "../analysis/gemini-analysis.js";
import { samplesToMs } from "./chunker.js";

export type SuggestionStatus = "suggested" | "applied" | "discarded";

/**
 * 手動 uncheck 的冷卻期長度（023 §7.5）＝**分析滾動窗的最大年齡**，單一真相直接取自分析引擎
 * （`analysis/gemini-analysis.ts` 的 `WINDOW_MAX_AGE_MS`；刻意不在此處另寫 90000）。
 *
 * 為什麼是這個值：報告者 uncheck 的當下，**害該項被誤判的那段逐字稿還留在滾動窗裡**，而分析節流只有 5 秒
 * → 下一輪模型看到同一個窗＋該項又回到 pending → 很可能再回報同一個 id → `markCovered` 只擋非 pending，
 * 對它完全無效 → 又被劃掉（uncheck 實質無效，報告者只能改用語意錯誤的 skip）。窗一輪替過去，模型若**仍**
 * 回報該項，那就是來自**新的**對話內容＝真的講到了，此時應該放行。
 *
 * ⚠️ **單位是「音訊時鐘毫秒」，不是牆鐘毫秒**（§7.5 v1.2 更正）：窗的年齡是用音訊取樣時鐘算的
 * （本檔的 `advanceAudioClock`，**只在 PCM frame 進來時前進**），兩個時鐘只在
 * 音訊持續流動時等價。撤回同意／capture 斷線期間音訊時鐘凍結、牆鐘照走 → 牆鐘版會提早放行，
 * 而那段害它被誤判的逐字稿**還在窗裡** → 恢復後第一輪分析就把同一項再劃掉（打地鼠原樣復活）。
 * 因此冷卻一律拿 `audioClockMs()` 的高水位相減。
 */
export const UNCHECK_COOLDOWN_MS = WINDOW_MAX_AGE_MS;

interface QueuedSuggestion {
  suggestion: Suggestion;
  status: SuggestionStatus;
  timer: NodeJS.Timeout;
}

export interface SessionRuntimeDeps {
  meetingId: string;
  orgId: string;
  presenterUserId: string;
  /** Optional bound deck (present/append only make sense with a deck). */
  deckId?: string;
  /** Counterpart context for CRM retrieval whitelist (CRM_SCHEMA §9). */
  companyId?: string;
  dealId?: string;
  initialCommittedIndex: number;
  /**
   * Ephemeral-by-default privacy flag (M5 §A). false (default) → transcript segments stay in SessionRuntime
   * memory and are NEVER written to meeting_transcript_segments (gone on dispose). true → segments persist
   * (redacted). Loaded from meetings.persist_transcript by the hub when the runtime is materialized.
   */
  persistTranscript?: boolean;
  researchQuota: number;
  asr: AsrProvider;
  engine: AnalysisEngine;
  /** Reads currently-connected roles from the hub's room (session_state sync). */
  rolesProvider: () => WsRole[];
  /** Fired when a queued suggestion hits its TTL → hub broadcasts suggestion_result discarded. */
  onSuggestionExpire: (meetingId: string, suggestionId: string) => void;
}

export class LiveSessionRuntime implements SessionRuntime {
  readonly meetingId: string;
  readonly orgId: string;
  readonly presenterUserId: string;
  readonly deckId?: string;
  readonly companyId?: string;
  readonly dealId?: string;
  committedIndex: number;
  consent = false;
  /** Ephemeral-by-default (M5 §A): only persist transcript segments to DB when this is true. */
  readonly persistTranscript: boolean;
  /**
   * 主 ASR 軌。mono 場次＝唯一一軌（混音）；stereo 場次＝**左聲道＝麥克風＝報告者**。
   * 語意在兩種模式下都是「這條軌收到的永遠是 mono PCM」（stereo 在 `hub.pushAudio` 就拆乾淨了）。
   */
  readonly asr: AsrProvider;
  readonly engine: AnalysisEngine;

  /** Deck length mirror (grows on append) — needed for the I1 patchMinIndex(op, deckLength) guard. */
  deckLength: number;

  /** 單調遞增的 ASR chunk 序號（計費冪等 key 用；每個 final 逐字段 +1，隨 runtime 一起 dispose）。 */
  asrChunkSeq = 0;

  /**
   * 上次 page_commit 的時戳（epoch-ms；023 待講清單「翻頁勾稽」用，契約 §7.2）。
   * undefined＝本場還沒翻過頁 → 第一次 commit 不做任何 cover 判定（沒有「前一頁停留時間」可算）。
   */
  lastCommitAt?: number;

  /**
   * 023 對話勾稽的 evidence 來源（最近一段**已 redact 且本場已同意持久化**的逐字文字）。
   * hub 只在 `route.persist` 存在時賦值——checklist.evidence 會落庫，ephemeral 場次（persistTranscript=false）
   * 必須恆 undefined，否則等於偷偷持久化逐字稿（違反 M5 §A）。
   */
  lastEvidenceText?: string;

  /**
   * 023 §7.5：報告者手動 uncheck 過的 itemId → uncheck 當下的**音訊時鐘高水位**（ms，非牆鐘；見
   * `UNCHECK_COOLDOWN_MS` 的時鐘域說明）。
   *
   * 值為 `null`＝uncheck 當下**取不到音訊時鐘**（窗是空的／音訊還沒開始流）→ 沒有可用基準，
   * 先掛帳；第一次讀到時鐘時再把它 pin 成基準（在那之前一律視為**仍在冷卻**＝fail-safe）。
   *
   * 冷卻期內**只抑制 `covered_by='transcript'` 的自動 cover**；`'slide'`（報告者自己的導覽行為）
   * 與手動 `check`（報告者的直接指令）都不受限。項目**仍留在分析 prompt 的 pending 清單**裡
   * （§7.1 形狀不變），只是不許自動劃掉。
   * per-session 狀態，`dispose()` 一併清空（L13 bounded teardown）。
   */
  private readonly recentlyUnchecked = new Map<string, number | null>();

  /**
   * 右聲道（＝分頁音訊＝對方＝`"client"`）的 ASR 軌。
   *
   * **只有 stereo 場次才存在**，而且是 hub 收到本場**第一個 stereo frame 時才 lazily 建立**（`attachRightAsr`）——
   * runtime 可能由先連上的 hud/present 連線 materialize，那時還不知道 capture 端會用幾聲道，
   * 所以聲道數不能當成建構參數。mono 場次此欄恆 `undefined`＝**不會平白多建一個 provider 實例**。
   */
  private rightAsr?: AsrProvider;

  /**
   * **本場共用音訊時鐘**：已消費的 mono-equivalent 取樣數（16kHz）。由 `hub.pushAudio` 每個 frame 前進一次
   *（stereo 的一個 frame ＝一組 sample-pair ＝**前進一次**，不是兩次），兩軌共用。
   *
   * 為什麼時鐘要在 session 層而不是各自的 `Chunker`：右軌是**會議中途**（第一個 stereo frame）才建立的，
   * 讓它自己從 0 起算的話，左軌早已跑了整個 mono 時段 → 兩軌的 `TranscriptSegment.t` 相差那麼多，
   * 而 `gemini-analysis.ts` 的 `trimWindow` 是拿「窗內最新一段的 t」去濾 90 秒以上的舊段——
   * 任何一個左軌段最後進窗就會把所有右軌段濾光（**單向清空客戶那一路**，而 objection/budget/competitor
   * 幾乎只來自客戶）。HUD 時間軸、DB `t`、`audioClockMs()`→uncheck 冷卻也全部跟著錯。
   *
   * 只在有音訊真的進來時前進（consent 未同意／capture 斷線期間凍結）——這正是 §7.5 v1.2 要的音訊時鐘語意。
   */
  private audioSamples = 0;

  /**
   * 目前處於中斷的 ASR 軌集合（fix 3：`asr_unavailable` 告警去重從 provider 層提升到 **session 層**）。
   * provider 的 `unavailableSignaled` 只做單一軌的邊緣偵測；「HUD 每次 outage 只看到一個 toast」由這裡保證。
   */
  private readonly asrOutages = new Set<AsrProvider>();

  private research: number;
  private readonly queue = new Map<string, QueuedSuggestion>();
  private disposed = false;

  constructor(private readonly deps: SessionRuntimeDeps) {
    this.meetingId = deps.meetingId;
    this.orgId = deps.orgId;
    this.presenterUserId = deps.presenterUserId;
    this.deckId = deps.deckId;
    this.companyId = deps.companyId;
    this.dealId = deps.dealId;
    this.committedIndex = deps.initialCommittedIndex;
    this.persistTranscript = deps.persistTranscript ?? false;
    this.deckLength = Math.max(0, deps.initialCommittedIndex + 1);
    this.research = deps.researchQuota;
    this.asr = deps.asr;
    this.engine = deps.engine;
  }

  connectedRoles(): WsRole[] {
    return this.deps.rolesProvider();
  }

  // ── 雙聲道 ASR（API_CONTRACT §6 `channels=2`）──────────────────────────
  /** 右聲道 ASR 軌（＝客戶）；mono 場次為 `undefined`。**存在與否**＝右軌要不要建（見 hub `ensureRightAsr`）。 */
  get asrRight(): AsrProvider | undefined {
    return this.rightAsr;
  }

  /**
   * **本場目前存在的所有 ASR 軌**（mono＝1 條，stereo＝2 條）。
   *
   * 「對每一軌做 X」一律走這個 getter，不要在呼叫端寫兩行具名欄位——`dispose()`（每軌都要 reset，
   * 漏一軌＝consent 撤回後客戶那路仍在轉寫＝隱私破口）與 hub 的 `applyChannelMode`（每軌都要在切換點
   * 強制切段）本來是同一件事寫了兩種寫法。收成 getter 之後，「未來加軌時漏掉一個」在結構上就不可能發生。
   */
  get asrTracks(): AsrProvider[] {
    return this.rightAsr ? [this.asr, this.rightAsr] : [this.asr];
  }

  /**
   * **目前**進站音訊的聲道數，由 `hub.pushAudio` 每個 frame 透過 `noteChannelMode` 更新
   * （預設 1；沒有音訊進來過就維持 1）。唯讀對外，寫入只有 `noteChannelMode` 一個入口。
   *
   * 為什麼是「每 frame 更新的鏡像」而不是「一旦 stereo 就永遠 stereo」的黏著旗標：capture 可以在同一場
   * runtime 的生命週期內換模式——例如使用者第一次給了麥克風授權（stereo），斷線重連時改成拒絕，
   * 前端就會退回 mono 重連到**同一場 meeting**（斷線寬限期內 runtime 不會被回收）。黏著旗標會讓那之後
   * 的混音段全部被貼上 `presenter`，而它其實是雙方混在一起的音訊。**收成唯讀不改變這個語意。**
   *
   * 用途：speaker 判定的 **fallback**——正式路徑讀的是 `AsrSegment.channels`（**擷取當下**的模式快照），
   * 只有段落沒帶快照時（測試／精簡替身直接注入的兩欄位 segment）才退回這個「目前模式」鏡像。
   * 「模式有沒有變」則由 `noteChannelMode` 的回傳值回答，呼叫端不必自己比。
   *
   * 右軌從頭到尾不看它——右軌收到的資料**依定義**只可能來自右聲道，就算模式已切回 mono、
   * 它把先前緩衝的音訊 flush 出來，那仍然是客戶的聲音。
   */
  get audioChannels(): AudioChannels {
    return this.channelMode;
  }
  private channelMode: AudioChannels = 1;

  /**
   * 記下這個 frame 的聲道模式。回傳 `true` ＝**模式真的改變了**，呼叫端此時（且只有此時）要先把兩軌
   * chunker 裡屬於舊模式的殘料強制切出去（見 hub `applyChannelMode`）。
   * 判斷與賦值合成一次呼叫，免得呼叫端各自寫一份「先比再指派」而漏掉其中一半。
   */
  noteChannelMode(channels: AudioChannels): boolean {
    if (this.channelMode === channels) return false;
    this.channelMode = channels;
    return true;
  }

  /**
   * 掛上右聲道 ASR 軌（hub 在本場第一個 stereo frame 抵達時呼叫；重複呼叫由 hub 端先查 `asrRight` 擋掉）。
   * 回傳 `false`＝runtime 已 dispose（consent 撤回／會議結束後的遲到 frame）→ 呼叫端**必須自己把這個
   * provider 收掉**，絕不可讓它留在外面繼續轉寫（那正是隱私破口）。
   */
  attachRightAsr(asr: AsrProvider): boolean {
    if (this.disposed) return false;
    this.rightAsr = asr;
    return true;
  }

  /**
   * 取得**這個 frame 起點**在共用音訊時鐘上的位置（ms），並把時鐘前進 `samples` 個取樣。
   * 一個 stereo frame 只呼叫一次（左右兩軌共用回傳值），否則時鐘會跑兩倍快。
   */
  advanceAudioClock(samples: number): number {
    const tMs = samplesToMs(this.audioSamples);
    this.audioSamples += samples;
    return tMs;
  }

  /**
   * 目前已擷取的音訊總長（ms）——本場唯一「讀而不動時鐘」的存取器（`advanceAudioClock(0)` 逐字等價，
   * 但那個寫法讀起來像會有副作用）。**測試／診斷用**：產線路徑一律走 `advanceAudioClock`，hub 不呼叫它。
   *
   * **與 `audioClockMs()` 不同**：這是「送進 ASR 的音訊有多長」（擷取端高水位），
   * `audioClockMs()` 是「分析滾動窗內最新一段的 t」（下游高水位，會落後一整段的長度）。
   * 冷卻判定一律用後者（§7.5 v1.2 的單一真相）。
   */
  capturedAudioMs(): number {
    return samplesToMs(this.audioSamples);
  }

  // ── ASR 中斷告警的 session 層去重（契約 C3）──────────────────────────────
  /**
   * 某一軌進入中斷。回傳 `true` ＝本場**從「全部健康」轉為「有軌壞掉」**，呼叫端此時（且只有此時）廣播
   * `asr_unavailable`。第二軌隨後也壞掉 → 回 `false` → HUD 不會疊出第二個一模一樣的 toast。
   */
  noteAsrUnavailable(track: AsrProvider): boolean {
    if (this.disposed) return false;
    const wasHealthy = this.asrOutages.size === 0;
    this.asrOutages.add(track);
    return wasHealthy;
  }

  /**
   * 某一軌恢復。**全部軌都恢復**後（集合空）下一次中斷才會再次告警——所以「壞→好→又壞」照樣看得到提示，
   * 不會變成一場會議只告警一次就永遠靜音。
   */
  noteAsrRecovered(track: AsrProvider): void {
    this.asrOutages.delete(track);
  }

  /** 目前有幾條軌在中斷（測試／診斷用；0＝本場 ASR 全部健康）。 */
  asrOutageCount(): number {
    return this.asrOutages.size;
  }

  remainingResearchQuota(): number {
    return this.research;
  }

  /** Decrement the research quota if any remains; returns false when exhausted (auto + manual share it). */
  consumeResearchQuota(): boolean {
    if (this.research <= 0) return false;
    this.research -= 1;
    return true;
  }

  // ── 023 §7.5 手動 uncheck 冷卻期（**音訊時鐘**計時，v1.2）─────────────────
  /**
   * 本場音訊時鐘的目前高水位（ms）＝分析滾動窗內最新一段的 `t`，**單一真相在分析引擎**
   * （`latestWindowT()`）。取不到（窗是空的＝音訊還沒流／engine 沒實作該存取器）→ `undefined`，
   * 呼叫端據此 fail-safe。
   */
  audioClockMs(): number | undefined {
    // 防禦性：engine 可能是精簡替身（未實作該存取器），極端情況下甚至沒被注入 → 一律回 undefined 走 fail-safe，
    // **絕不** throw（這是會中路徑，丟例外會連帶打掉整輪勾稽）。
    const engine = this.engine as { latestWindowT?: () => number | undefined } | undefined;
    const latest = engine?.latestWindowT?.();
    return typeof latest === "number" && Number.isFinite(latest) ? latest : undefined;
  }

  /**
   * 記下一次手動 uncheck（由 hub 的 checklistAction 在 setStatus 確認成功後呼叫）。
   * 記的是**當下的音訊時鐘高水位**（不是 `Date.now()`）——冷卻要對齊的是分析窗的輪替，而窗的年齡就用這個時鐘算。
   * 取不到時鐘 → 記 `null`（等第一次讀到時鐘再 pin 基準；在那之前 `isUncheckCooling` 恆 true）。
   *
   * 順手清掉已走完一整個窗的紀錄 → Map 大小恆 ≤「冷卻期內被 uncheck 的項目數」（且鍵是 itemId，
   * 天然 ≤ 本場清單長度；有界，L13）。時鐘取不到時無法判齡 → 本次不淘汰（下次取到時鐘會補淘汰）。
   */
  noteUnchecked(itemId: string, audioT: number | undefined = this.audioClockMs()): void {
    if (this.disposed) return;
    if (audioT != null) {
      for (const [id, at] of this.recentlyUnchecked) {
        if (at != null && audioT - at >= UNCHECK_COOLDOWN_MS) this.recentlyUnchecked.delete(id);
      }
    }
    this.recentlyUnchecked.set(itemId, audioT ?? null);
  }

  /**
   * 該項是否仍在手動 uncheck 的冷卻期內（→ transcript 自動 cover 必須跳過它）。
   * 放行條件＝`latestAudioT - uncheckAudioT >= UNCHECK_COOLDOWN_MS`（同一個音訊時鐘域）。
   *
   * fail-safe（契約 §7.5 v1.2 明令）：**取不到音訊時鐘就當作仍在冷卻**——寧可多擋一下自動勾稽，
   * 也不要讓報告者的 uncheck 被 AI 推翻（與 §7.1「寧漏勿誤、誤劃比漏劃傷害大」同向）。
   * 實務上也擋不到什麼：transcript 路徑要能命中，本來就得先有逐字段進窗（那時時鐘必然可讀）。
   */
  isUncheckCooling(itemId: string, audioT: number | undefined = this.audioClockMs()): boolean {
    if (!this.recentlyUnchecked.has(itemId)) return false;
    if (audioT == null) return true; // fail-safe：無時鐘可比 → 維持冷卻
    const at = this.recentlyUnchecked.get(itemId) ?? null;
    if (at == null) {
      // uncheck 當下沒有時鐘（音訊那時還沒流）→ 用「第一次讀到的高水位」當基準，冷卻自此起算。
      this.recentlyUnchecked.set(itemId, audioT);
      return true;
    }
    if (audioT - at >= UNCHECK_COOLDOWN_MS) {
      this.recentlyUnchecked.delete(itemId); // 走完一整個窗即淘汰（放行，且不再重複比對）
      return false;
    }
    return true; // 含 audioT < at 的異常情形（時鐘後退）→ 維持冷卻，同樣是安全側
  }

  // ── approval queue (I2) ────────────────────────────────────────────────
  enqueueSuggestion(suggestion: Suggestion): void {
    if (this.disposed) return;
    const ttl = Math.max(0, suggestion.expiresAt - Date.now());
    const timer = setTimeout(() => {
      const entry = this.queue.get(suggestion.id);
      if (!entry || entry.status !== "suggested") return;
      entry.status = "discarded";
      this.deps.onSuggestionExpire(this.meetingId, suggestion.id);
    }, ttl);
    // Do not keep the event loop alive solely for a suggestion timer.
    if (typeof timer.unref === "function") timer.unref();
    this.queue.set(suggestion.id, { suggestion, status: "suggested", timer });
  }

  getSuggestion(id: string): QueuedSuggestion | undefined {
    return this.queue.get(id);
  }

  /** Transition a suggestion out of `suggested`; clears its TTL timer. No-op if already decided/unknown. */
  settleSuggestion(id: string, status: "applied" | "discarded"): boolean {
    const entry = this.queue.get(id);
    if (!entry || entry.status !== "suggested") return false;
    clearTimeout(entry.timer);
    entry.status = status;
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.queue.values()) clearTimeout(entry.timer);
    this.queue.clear();
    // 023 §7.5：冷卻紀錄與其他 per-session 狀態同生命週期（hub.disposeSession → runtime.dispose）。
    this.recentlyUnchecked.clear();
    // ASR 中斷集合同理（L13 bounded teardown）：不留下指向已 reset provider 的參照。
    this.asrOutages.clear();
    // Drop any buffered audio in the ASR chunker (never transcribe post-teardown).
    // ⚠️ **每一軌都要 reset**：漏掉右軌＝consent 撤回／會議結束後，客戶那一路的緩衝音訊仍會被送去轉寫
    //（隱私破口）。走 `asrTracks`（單一走訪點）而不是寫兩行，避免未來加軌時又漏一個。
    // `reset` 不在凍結的 `AsrProvider` 接縫上（精簡替身可以沒有它）→ 這裡刻意 duck-typed 呼叫。
    for (const track of this.asrTracks) (track as { reset?: () => void }).reset?.();
  }
}
