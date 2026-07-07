/**
 * AnalysisEngine — M3 frozen interface (M234_CONTRACT §M3). NO IMPLEMENTATION here.
 * The M3 build agent implements against this signature (borrows v1; rolling-window incremental analysis →
 * structured signals). Emits only above threshold. Async callbacks MUST NOT tear down the process
 * (unhandledRejection guard already installed in index.ts).
 */
import type { SignalItem } from "@meetcopilot/shared";
import type { AsrSegment } from "../asr/asr-provider.js";

export interface AnalysisEngine {
  /** Feed a finalized segment into the session's rolling window. */
  ingest(sessionId: string, seg: AsrSegment): void;
  /** Register the signals callback (fires when the confidence threshold is met). */
  onSignals(cb: (items: SignalItem[]) => void): void;
}
