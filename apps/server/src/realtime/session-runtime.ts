/**
 * LiveSessionRuntime — per-meeting in-process state, implementing the frozen SessionRuntime seam
 * (realtime/copilot.ts). Held in the RealtimeHub's Map<meetingId, LiveSessionRuntime>.
 *
 * Owns: committedIndex mirror (I1 guard reads this), consent gate, the per-session ASR + AnalysisEngine
 * instances, the approval queue (Suggestion + TTL timers), and the research quota counter.
 *
 * Cleanup (v1 gap: sessions grew monotonically): `dispose()` clears every timer/buffer so a hub that reclaims
 * a session on end / disconnect-timeout leaves nothing behind (bounded teardown, L13).
 */
import type { SignalItem, Suggestion, WsRole } from "@meetcopilot/shared";
import type { SessionRuntime } from "./copilot.js";
import type { AsrProvider } from "../asr/asr-provider.js";
import type { AnalysisEngine } from "../analysis/analysis-engine.js";
import { WINDOW_MAX_AGE_MS } from "../analysis/gemini-analysis.js";

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
 * （`chunker.ts` 的 `consumedSamples / (SAMPLE_RATE/1000)`，**只在 PCM frame 進來時前進**），兩個時鐘只在
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
    // Drop any buffered audio in the ASR chunker (never transcribe post-teardown).
    const asr = this.asr as { reset?: () => void };
    if (typeof asr.reset === "function") asr.reset();
  }
}
