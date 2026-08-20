/**
 * Per-session audio segmenter (M3, borrowed from v1 realtime/chunker.ts, rewritten for v2's headerless frames).
 *
 * v2 change: the WS binary frame is raw 16-bit LE PCM 16kHz mono with NO header and NO channel byte
 * (API_CONTRACT §6 — single mixed capture connection; speaker is inferred downstream by LLM, not by track).
 * So this chunker buffers a single mono stream and takes each segment's start offset from the frame context
 * the caller hands in (server-authoritative time; the frame itself carries none).
 *
 * Stereo capture (`channels=2`) does NOT change any of the above: `realtime/hub.ts`'s `pushAudio` splits the
 * interleaved frame into two mono buffers and drives ONE Chunker per channel, so what arrives here is always
 * pure mono. What the sentence above no longer covers is the speaker: in stereo the track IS the answer
 * (left = presenter, right = client) and the LLM inference is skipped — that decision lives entirely in the
 * hub; nothing in this file is channel-aware.
 *
 * Flush conditions (any of these triggers a cut):
 *  - accumulated ≥ 4s (SEGMENT_MAX_SAMPLES), OR
 *  - segment ≥ 1s (MIN_SEGMENT_SAMPLES) AND trailing 600ms RMS below the silence floor, OR
 *  - `flushPending()` — hub 在**聲道模式切換**時強制切段（見下）。
 * Output = 44-byte WAV (PCM16LE mono 16kHz) + segment start ms + 擷取當下的聲道模式，
 * **或 null＝這一段整段都在靜音底噪之下而丟棄**（見 `flush`，省掉零產出的 ASR 呼叫）。
 *
 * **時鐘所有權**：本檔**不擁有任何時鐘**。全系統唯一的音訊時鐘是
 * `realtime/session-runtime.ts` 的 `LiveSessionRuntime.advanceAudioClock`（per-session，由 `hub.pushAudio`
 * 每個 frame 前進一次），段落起點一律取自 `AsrFrameContext.tMs`——所以 `push()` 的脈絡是**必填**的。
 * 右軌是會議中途才建立的，讓各軌自己數樣本會使兩軌的段落時間相差整個 mono 時段
 * （分析滾動窗、HUD 時間軸、DB `t`、uncheck 冷卻全部跟著錯）。
 */
import type { AudioChannels } from "@meetcopilot/shared";
import type { AsrFrameContext } from "../asr/asr-provider.js";

/** 16kHz mono——本系統音訊時鐘的取樣率（session 層的共用時鐘也用它換算 ms，勿另寫一份）。 */
export const SAMPLE_RATE = 16_000;

/** 取樣數 → 毫秒（**單一換算點**：session 共用時鐘與 chunker 的段落起點必須用同一條公式）。 */
export function samplesToMs(samples: number): number {
  return Math.floor(samples / (SAMPLE_RATE / 1000));
}

const SEGMENT_MAX_SAMPLES = SAMPLE_RATE * 4; // 4s hard cut
const MIN_SEGMENT_SAMPLES = SAMPLE_RATE * 1; // 1s min before a silence cut
const SILENCE_WINDOW_SAMPLES = Math.round(SAMPLE_RATE * 0.6); // 600ms
/** Silence RMS floor (int16 scale, full-scale 32768). Empirical MVP value; recalibrate with real recordings. */
const SILENCE_RMS_THRESHOLD = 400;

export interface ChunkResult {
  wav: Buffer;
  tMs: number;
  /** 這一段音訊**被擷取當下**的聲道模式（切段起點時從 `AsrFrameContext` 快照）。 */
  channels: AudioChannels;
}

export class Chunker {
  private frames: Int16Array[] = [];
  private totalSamples = 0;
  /** 本段起點的脈絡快照（共用時鐘上的位置＋擷取當下的聲道模式）；null＝目前沒有進行中的段落。 */
  private segment: { startMs: number; channels: AudioChannels } | null = null;
  /**
   * 本段目前的峰值 `|sample|`（丟棄全靜音段用，見 `flush`）。
   * 只掃**新進來的那個 frame**、每個取樣一次比較——比既有的 `trailingRms()` 便宜（後者每次 push 都要
   * 回頭重掃尾端 600ms＝9600 個取樣，且會重複掃到同一批資料）。
   */
  private segmentPeak = 0;

  /** Push a PCM16 frame; returns a segment when a cut fires, else null. */
  push(pcm16: Int16Array, ctx: AsrFrameContext): ChunkResult | null {
    if (pcm16.length === 0) return null;

    // 段落起點＝**這個 frame 的起點**（chunker 只在 frame 邊界開新段），所以直接採用 frame 的脈絡：
    // 時間軸用 session 共用時鐘，模式用擷取當下的聲道數（而不是段落 flush／轉寫完成時的模式）。
    this.segment ??= { startMs: ctx.tMs, channels: ctx.channels };
    this.frames.push(pcm16);
    this.totalSamples += pcm16.length;
    for (let i = 0; i < pcm16.length; i++) {
      const level = Math.abs(pcm16[i]!);
      if (level > this.segmentPeak) this.segmentPeak = level;
    }

    if (this.totalSamples >= SEGMENT_MAX_SAMPLES) return this.flush();
    if (this.totalSamples >= MIN_SEGMENT_SAMPLES && this.trailingRms() < SILENCE_RMS_THRESHOLD) {
      return this.flush();
    }
    return null;
  }

  /**
   * 強制切段（hub 在**聲道模式切換**時呼叫）。回傳 null＝殘料**已丟棄**——不足一段
   * （< MIN_SEGMENT_SAMPLES，理由見下），或整段都在靜音底噪之下（見 `flush`）。
   *
   * 為什麼不足 1 秒就丟：那正是既有切段規則本來就不會單獨成段的長度（靜音切也要 ≥1 秒），
   * 硬送轉寫只會多打一次 Gemini 又換回破碎/幻覺文字。**留著更糟**——殘料會被黏到切換後的新模式音訊上，
   * 那就是這次要修的錯貼 speaker 本體。
   */
  flushPending(): ChunkResult | null {
    if (this.totalSamples < MIN_SEGMENT_SAMPLES) {
      this.reset();
      return null;
    }
    return this.flush();
  }

  /** Discard buffered (not-yet-transcribed) audio — e.g. consent revoke: never store, never transcribe. */
  reset(): void {
    this.frames = [];
    this.totalSamples = 0;
    this.segment = null;
    this.segmentPeak = 0;
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

  /**
   * 切出目前這一段。回傳 `null` ＝**整段都在靜音底噪之下、已丟棄**（不編 WAV、不送轉寫）。
   *
   * 為什麼要丟：切段規則是「≥1 秒且尾端 600ms RMS 低於底噪就切」，所以一條**完全沒人講話**的軌每累積滿
   * 1 秒就滿足條件 → 每段都是一次「1 秒 WAV(≈32KB) → base64(≈43KB) → Gemini round trip」，回來必定是空字串
   * 而直接丟掉。雙軌之後這不是邊角案例：雙方輪流講話就代表整場幾乎隨時**恰好有一條軌是靜音的**
   * （報告者講話時右軌靜音，反之亦然）→ 每分鐘約 60 次、每小時約 3,600 次零產出的呼叫／場，
   * 外加同量的 base64 配置與 20 秒 deadline timer。
   *
   * 判準用 **peak 而不是 RMS**：`peak < 門檻` 必然蘊含 `RMS < 門檻`，所以這個丟棄條件**嚴格比既有的靜音
   * 切段判定更保守**——一段安靜但確實有人講話的音訊（例如短促人聲後尾端靜下來）峰值遠高於底噪，
   * 不可能被誤丟。
   *
   * **不會在時間軸上開洞**：時鐘是 `LiveSessionRuntime.advanceAudioClock`（每個 frame 前進一次）驅動的，
   * 與切段／丟段次數無關；下一段的起點重新取自 `ctx.tMs`，所以丟掉的靜音仍然被計時。
   */
  private flush(): ChunkResult | null {
    const head = this.segment;
    if (!head || this.segmentPeak < SILENCE_RMS_THRESHOLD) {
      this.reset();
      return null;
    }
    const merged = new Int16Array(this.totalSamples);
    let offset = 0;
    for (const f of this.frames) {
      merged.set(f, offset);
      offset += f.length;
    }
    this.reset();
    return { wav: encodeWav(merged), tMs: head.startMs, channels: head.channels };
  }
}

/**
 * 一個 PCM16LE buffer 有幾個取樣。**這裡是該規則的唯一擁有者**（尾端奇數 byte 湊不成一個 sample → 不算）：
 * 音訊時鐘（`hub.pushAudio` → `runtime.advanceAudioClock`）與實際解碼出來的樣本數必須逐一對應，
 * 呼叫端不要自己再寫一份 `byteLength / 2`。
 */
export function pcmSampleCount(buf: Buffer): number {
  return (buf.byteLength - (buf.byteLength % 2)) / 2;
}

/** Decode a raw PCM16LE Buffer (WS binary frame) into Int16 samples. Trailing odd byte (partial sample) dropped. */
export function pcmBufferToInt16(buf: Buffer): Int16Array {
  const out = new Int16Array(pcmSampleCount(buf));
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
