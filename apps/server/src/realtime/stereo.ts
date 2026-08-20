/**
 * Stereo capture frame de-interleaver (API_CONTRACT §6, `channels=2`).
 *
 * Wire format (frozen cross-end contract): **interleaved Int16 LE, LEFT sample first**.
 * One sample-pair = 4 bytes (L lo, L hi, R lo, R hi). 250ms @16kHz = 4000 pairs = 8000 Int16 = 16000 bytes.
 * Channel semantics: **left = microphone = presenter**, **right = tab audio = client**.
 *
 * WHY THIS LIVES HERE (upstream of the ASR seam, called by `hub.pushAudio`):
 * everything downstream of the hub — `Chunker`, `GeminiAsrProvider`, `AsrProvider` — assumes a **pure mono**
 * 16kHz stream and MUST keep assuming it. The system's ONLY audio clock is
 * `LiveSessionRuntime.advanceAudioClock` (per session, advanced ONCE per frame by `hub.pushAudio`), and it
 * feeds `TranscriptSegment.t` → HUD timeline / DB `t` / the analysis engine's 90s rolling window / the uncheck
 * cooldown. It is counted in mono-equivalent samples, so letting interleaved data through would make one
 * sample-pair look like two samples and run that clock at 2× speed for every consumer at once. So the split is
 * finished here and each ASR track receives an ordinary mono buffer, exactly as in the mono path.
 *
 * Statelessness is load-bearing (see `deinterleaveStereo`).
 */

/** Bytes per interleaved sample-pair (L Int16 + R Int16). */
export const STEREO_FRAME_BYTES = 4;

/** One frame split into two independent mono PCM16LE buffers. */
export interface StereoSplit {
  /** Left channel = microphone = presenter. */
  left: Buffer;
  /** Right channel = tab audio = client. */
  right: Buffer;
}

/**
 * Split an interleaved stereo PCM16LE frame into two mono PCM16LE buffers.
 *
 * **Partial-pair handling**: a trailing chunk shorter than one full pair (byteLength % 4 !== 0) is DISCARDED
 * and NOTHING is carried into the next call. This function is deliberately **stateless** — that is what
 * guarantees every frame starts on a left sample, so a malformed frame can never flip L/R polarity for the
 * frames that follow (an L/R swap is silent, self-consistent, and near-impossible to notice downstream:
 * every later transcript segment would simply be attributed to the wrong speaker). The cost of a bad frame
 * is at most 1 dropped sample (62.5µs); the cost of a polarity flip is the rest of the meeting.
 * Note `chunker.ts`'s `pcmBufferToInt16` only aligns on `% 2`, which is correct for mono but NOT sufficient
 * here — hence the `% 4` alignment done at this layer instead.
 *
 * Hot path (once per ~250ms per meeting): straight byte copies into pre-sized buffers, no intermediate
 * arrays, no per-sample function calls. Byte-wise copy also keeps the little-endian order untouched
 * (no decode/re-encode round trip).
 */
export function deinterleaveStereo(pcm: Buffer): StereoSplit {
  const pairs = Math.floor(pcm.byteLength / STEREO_FRAME_BYTES);
  const left = Buffer.allocUnsafe(pairs * 2);
  const right = Buffer.allocUnsafe(pairs * 2);
  // allocUnsafe is safe here precisely because the loop writes every one of the `pairs * 2` bytes below.
  for (let i = 0; i < pairs; i++) {
    const src = i * STEREO_FRAME_BYTES;
    const dst = i * 2;
    left[dst] = pcm[src]!;
    left[dst + 1] = pcm[src + 1]!;
    right[dst] = pcm[src + 2]!;
    right[dst + 1] = pcm[src + 3]!;
  }
  return { left, right };
}
