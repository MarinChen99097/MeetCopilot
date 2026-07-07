/**
 * transcript-privacy — the pure privacy-routing decision for a finalized transcript segment (M5 §A).
 *
 * One place decides, for a single final ASR segment, WHERE its text may go given the meeting's consent +
 * ephemeral settings. Keeping it pure (no I/O) makes the three invariants directly testable:
 *   - **Consent gate (I: no analysis/persist before consent):** consent=false → everything dropped (null),
 *     so neither the analysis LLM nor the DB ever sees a pre-consent segment.
 *   - **Ephemeral-by-default:** persistTranscript=false → `persist` is null (segment lives only in memory).
 *   - **PII redaction:** every egress that leaves the presenter's private HUD — the analysis LLM feed, the
 *     orchestrator context (feeds the research LLM), and the DB write — carries redacted text. Only the HUD
 *     (the presenter's own private aid, account B, I3-isolated) receives the raw segment.
 *
 * The hub applies whichever fields are non-null; a null field means "this sink must not receive it".
 */
import { redactPii, type TranscriptSegment } from "@meetcopilot/shared";

export interface TranscriptRouteInput {
  /** SessionRuntime.consent — false until the presenter confirms the counterpart consented. */
  consent: boolean;
  /** SessionRuntime.persistTranscript — meetings.persist_transcript (default false → ephemeral). */
  persistTranscript: boolean;
  /** The finalized segment with RAW text (speaker already inferred upstream on redacted text). */
  segment: TranscriptSegment;
}

export interface TranscriptRoute {
  /** Raw segment for the presenter HUD (I3-isolated). null → dropped (no consent). */
  hud: TranscriptSegment | null;
  /** Redacted segment to write to meeting_transcript_segments. null → ephemeral or no consent. */
  persist: TranscriptSegment | null;
  /** Redacted text to feed the analysis engine (→ signals LLM). null → no consent. */
  analysisText: string | null;
  /** Redacted segment for the orchestrator's rolling context (→ research LLM). null → no consent. */
  contextSegment: TranscriptSegment | null;
}

const DROPPED: TranscriptRoute = { hud: null, persist: null, analysisText: null, contextSegment: null };

/**
 * Decide where a finalized segment may flow. consent=false → fully dropped. Otherwise the HUD gets the raw
 * segment and every other sink gets redacted text; persistence additionally requires persistTranscript.
 */
export function routeTranscriptSegment(input: TranscriptRouteInput): TranscriptRoute {
  if (!input.consent) return DROPPED;
  const redactedText = redactPii(input.segment.text);
  const redacted: TranscriptSegment = { ...input.segment, text: redactedText };
  return {
    hud: input.segment,
    persist: input.persistTranscript ? redacted : null,
    analysisText: redactedText,
    contextSegment: redacted,
  };
}
