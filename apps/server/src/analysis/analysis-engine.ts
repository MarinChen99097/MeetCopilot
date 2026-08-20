/**
 * AnalysisEngine — M3 frozen interface (M234_CONTRACT §M3). NO IMPLEMENTATION here.
 * The M3 build agent implements against this signature (borrows v1; rolling-window incremental analysis →
 * structured signals). Emits only above threshold. Async callbacks MUST NOT tear down the process
 * (unhandledRejection guard already installed in index.ts).
 *
 * 023（MEETING_CHECKLIST_CONTRACT §7.1）擴充「對話勾稽」——**零額外 LLM 呼叫**，併進既有分析呼叫：
 *   - `setPendingChecklist` 注入本場尚未完成的待講項目（空陣列＝prompt 完全不加該節，零額外 token）。
 *   - 分析結果多帶 `coveredItemIds`（本輪對話明確涵蓋的項目 id）。
 * 相容性：`onSignals` 的第一參數（SignalItem[]）不變，第二參數為新增；`setPendingChecklist` 刻意設為
 * **optional**，讓既有/測試用的精簡 engine 實作無需改動即仍滿足本介面。
 */
import type { SignalItem, TranscriptSpeaker } from "@meetcopilot/shared";
import type { AsrSegment } from "../asr/asr-provider.js";

/** 餵進分析 prompt 的 pending 待講項目最小形狀（契約 §7.1 逐字）。 */
export interface PendingChecklistHint {
  id: string;
  title: string;
  keywords: string[];
}

/** 一輪分析的完整結果。`signals`＝原本 onSignals 的唯一 payload；`coveredItemIds`＝023 新增。 */
export interface AnalysisResult {
  signals: SignalItem[];
  /** 本輪對話明確涵蓋的待講項目 id（已 sanitize：必在 pending 集合內、去重）。 */
  coveredItemIds?: string[];
}

export interface AnalysisEngine {
  /**
   * Feed a finalized segment into the session's rolling window.
   *
   * `speaker`（選填）＝該段的說話者：stereo 擷取（API_CONTRACT §6 `channels=2`）時由**聲道**確定
   *（左＝presenter、右＝client）、mono 時由 LLM 推斷（可能 `unknown`）。實作端據此在 prompt 行首加
   * 說話者前綴，讓模型分得出哪句是報告者、哪句是客戶。
   * **刻意 optional**（參數與實作皆是）：既有/測試用的兩參數精簡 engine 無需改動即仍滿足本介面。
   */
  ingest(sessionId: string, seg: AsrSegment, speaker?: TranscriptSpeaker): void;
  /**
   * 023 §7.5（v1.2）：**唯讀**存取器——回傳「目前滾動窗內最新一段的 `t`」，即本場**音訊取樣時鐘**的高水位
   * （ms；來源＝`realtime/session-runtime.ts` 的 `LiveSessionRuntime.advanceAudioClock`，
   * **只在 PCM frame 進來時前進**）。
   *
   * 為什麼需要它：滾動窗的年齡是用這個時鐘算的（`latestT - s.t <= WINDOW_MAX_AGE_MS`），所以任何要「對齊窗輪替」
   * 的冷卻計時**必須同域**。撤回同意／capture 斷線期間音訊時鐘凍結，牆鐘卻繼續走——用 `Date.now()` 會提早放行，
   * 讓還在窗裡的同一段逐字稿把報告者的 uncheck 再推翻一次（打地鼠）。
   *
   * 窗是空的（音訊還沒開始流）→ 回 `undefined`。呼叫端取不到值時**必須 fail-safe 成「仍在冷卻」**
   * （寧可多擋一下自動勾稽，也不要推翻報告者；契約 §7.1「寧漏勿誤」同向）。
   * 刻意 optional：既有/測試用的精簡 engine 實作無需改動即仍滿足本介面。
   */
  latestWindowT?(): number | undefined;
  /**
   * Register the signals callback (fires when the confidence threshold is met).
   * 023：第二參數帶完整 AnalysisResult（含 coveredItemIds）；只要 signals 或 coveredItemIds 其一非空即觸發。
   */
  onSignals(cb: (items: SignalItem[], result: AnalysisResult) => void): void;
  /**
   * 023 待講清單對話勾稽：注入本場 pending 項目（呼叫端負責「must 優先、再依 idx」排序並上限
   * CHECKLIST_PROMPT_MAX_PENDING；實作端再防禦性截一次）。傳空陣列＝關閉該節。
   */
  setPendingChecklist?(items: PendingChecklistHint[]): void;
}
