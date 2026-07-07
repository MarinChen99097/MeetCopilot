/**
 * AsrProvider — M3 frozen interface (M234_CONTRACT §M3). NO IMPLEMENTATION here.
 * The M3 build agent implements against this signature (borrows v1; Gemini segmented transcription).
 * Behind this seam so a future swap to Google STT v2 (S2) touches nothing else.
 * Audio in = raw 16-bit LE PCM 16kHz mono frames (API_CONTRACT §6). External sockets MUST be bounded (deadline+kill, L13).
 */

/** A finalized transcript segment emitted by ASR (minimal shape; speaker inference happens downstream). */
export interface AsrSegment {
  t: number; // ms
  text: string;
}

export interface AsrProvider {
  /** Accumulate a binary PCM frame for a session. */
  pushAudio(sessionId: string, pcm: Buffer): void;
  /** Register the final-segment callback (final segment → analysis). */
  onFinal(cb: (seg: AsrSegment) => void): void;
}
