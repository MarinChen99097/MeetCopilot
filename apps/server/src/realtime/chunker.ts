/**
 * Per-session audio segmenter (M3, borrowed from v1 realtime/chunker.ts, rewritten for v2's headerless frames).
 *
 * v2 change: the WS binary frame is raw 16-bit LE PCM 16kHz mono with NO header and NO channel byte
 * (API_CONTRACT §6 — single mixed capture connection; speaker is inferred downstream by LLM, not by track).
 * So this chunker buffers a single mono stream and computes each segment's start offset from an internal
 * sample clock (server-authoritative time; the frame carries none).
 *
 * Flush conditions (either triggers a cut):
 *  - accumulated ≥ 4s (SEGMENT_MAX_SAMPLES), OR
 *  - segment ≥ 1s (MIN_SEGMENT_SAMPLES) AND trailing 600ms RMS below the silence floor.
 * Output = 44-byte WAV (PCM16LE mono 16kHz) + segment start ms.
 */

const SAMPLE_RATE = 16_000;
const SEGMENT_MAX_SAMPLES = SAMPLE_RATE * 4; // 4s hard cut
const MIN_SEGMENT_SAMPLES = SAMPLE_RATE * 1; // 1s min before a silence cut
const SILENCE_WINDOW_SAMPLES = Math.round(SAMPLE_RATE * 0.6); // 600ms
/** Silence RMS floor (int16 scale, full-scale 32768). Empirical MVP value; recalibrate with real recordings. */
const SILENCE_RMS_THRESHOLD = 400;

export interface ChunkResult {
  wav: Buffer;
  tMs: number;
}

export class Chunker {
  private frames: Int16Array[] = [];
  private totalSamples = 0;
  /** Monotonic count of all samples ever pushed → derives segment start offset (server clock). */
  private consumedSamples = 0;
  private segmentStartMs: number | null = null;

  /** Push a PCM16 frame; returns a segment when a cut fires, else null. */
  push(pcm16: Int16Array): ChunkResult | null {
    if (pcm16.length === 0) return null;

    if (this.segmentStartMs === null) {
      this.segmentStartMs = Math.floor(this.consumedSamples / (SAMPLE_RATE / 1000));
    }
    this.frames.push(pcm16);
    this.totalSamples += pcm16.length;
    this.consumedSamples += pcm16.length;

    if (this.totalSamples >= SEGMENT_MAX_SAMPLES) return this.flush();
    if (this.totalSamples >= MIN_SEGMENT_SAMPLES && this.trailingRms() < SILENCE_RMS_THRESHOLD) {
      return this.flush();
    }
    return null;
  }

  /** Discard buffered (not-yet-transcribed) audio — e.g. consent revoke: never store, never transcribe. */
  reset(): void {
    this.frames = [];
    this.totalSamples = 0;
    this.segmentStartMs = null;
  }

  private trailingRms(): number {
    let need = SILENCE_WINDOW_SAMPLES;
    let sumSquares = 0;
    let counted = 0;
    for (let i = this.frames.length - 1; i >= 0 && need > 0; i--) {
      const f = this.frames[i]!;
      const take = Math.min(need, f.length);
      for (let j = f.length - take; j < f.length; j++) {
        const s = f[j]!;
        sumSquares += s * s;
        counted++;
      }
      need -= take;
    }
    if (counted === 0) return Infinity;
    return Math.sqrt(sumSquares / counted);
  }

  private flush(): ChunkResult {
    const merged = new Int16Array(this.totalSamples);
    let offset = 0;
    for (const f of this.frames) {
      merged.set(f, offset);
      offset += f.length;
    }
    const tMs = this.segmentStartMs ?? 0;
    this.frames = [];
    this.totalSamples = 0;
    this.segmentStartMs = null;
    return { wav: encodeWav(merged), tMs };
  }
}

/** Decode a raw PCM16LE Buffer (WS binary frame) into Int16 samples. Trailing odd byte (partial sample) dropped. */
export function pcmBufferToInt16(buf: Buffer): Int16Array {
  const usableBytes = buf.byteLength - (buf.byteLength % 2);
  const out = new Int16Array(usableBytes / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2);
  return out;
}

/** Write a 44-byte standard WAV header (PCM16LE mono 16kHz) + samples. */
function encodeWav(samples: Int16Array): Buffer {
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i]!, 44 + i * 2);
  return buf;
}
