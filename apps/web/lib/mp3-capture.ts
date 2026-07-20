/**
 * MP3（或任何瀏覽器可解碼的音檔）→ 會中收音管線的「測試音源」。
 *
 * 產出與正式 getDisplayMedia 收音（lib/audio-capture.ts）**完全相同**的 frame：
 * raw 16-bit LE PCM、16 kHz、mono、無 header（~250ms/frame）→ `onFrame(ArrayBuffer)` 丟 WS binary（API_CONTRACT §6）。
 * 因此下游（consent → realtime.sendAudio → server ASR → 分析 → 補充頁）與真會議一字不差，只是音源換成匯入的檔案。
 *
 * 解碼：AudioContext.decodeAudioData → OfflineAudioContext 重取樣成 16 kHz mono → Int16 → 依節奏逐 frame 送出。
 * 回傳與 startCapture 相同形狀的 CaptureController，讓呼叫端（MeetingSimulator）能與正式路徑共用膠水。
 */
import { CaptureError, type CaptureCallbacks, type CaptureController } from "./audio-capture";

const TARGET_RATE = 16000;
const FRAME_SAMPLES = 4000; // 250ms @16k（對齊生產 worklet 的 frameMs）
const FRAME_MS = 250;
// 檔案大小上限：整檔會被讀進記憶體＋解碼＋重取樣＋複製成 Int16（1 小時 16k mono ≈ 115MB）。
// 200MB 對「一場會議錄音」很寬鬆，但擋掉誤選超大檔把分頁記憶體吃爆而無友善錯誤。
const MAX_FILE_BYTES = 200 * 1024 * 1024;

export interface Mp3CaptureOptions {
  /** 播放倍速（1＝擬真 250ms/frame；>1＝加速灌，縮短等待）。 */
  speed?: number;
  /** 進度回呼（0..1）。 */
  onProgress?: (fraction: number) => void;
}

function pickAudioContext(): typeof AudioContext {
  const AC =
    (typeof window !== "undefined" && (window.AudioContext as typeof AudioContext)) ||
    (typeof window !== "undefined" &&
      ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext));
  if (!AC) throw new CaptureError("unsupported", "此瀏覽器不支援 AudioContext，無法解碼音檔。");
  return AC;
}

/** 解碼 file → 16kHz mono Int16Array（全部先算好，之後照節奏送）。 */
async function decodeToPcm16(file: File): Promise<Int16Array> {
  if (file.size > MAX_FILE_BYTES) {
    throw new CaptureError(
      "unknown",
      `音檔過大（${(file.size / 1024 / 1024).toFixed(0)}MB）。請用 ≤200MB 的檔案（約 1 小時內的會議錄音）。`,
    );
  }
  const AC = pickAudioContext();
  const bytes = await file.arrayBuffer();
  const decodeCtx = new AC();
  let decoded: AudioBuffer;
  try {
    // slice(0)：decodeAudioData 可能 detach buffer，複製一份保險。
    decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
  } catch (err) {
    try {
      await decodeCtx.close();
    } catch {
      /* ignore */
    }
    throw new CaptureError("unknown", `無法解碼音檔（需 mp3/wav/m4a 等瀏覽器支援格式）：${(err as Error).message}`);
  }
  try {
    await decodeCtx.close();
  } catch {
    /* ignore */
  }

  // 重取樣 + 混單聲道：OfflineAudioContext @16k 一次搞定。
  const frames = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
  const Offline =
    (window.OfflineAudioContext as typeof OfflineAudioContext) ||
    ((window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
      .webkitOfflineAudioContext as typeof OfflineAudioContext);
  if (!Offline) throw new CaptureError("unsupported", "此瀏覽器不支援 OfflineAudioContext，無法重取樣。");
  const off = new Offline(1, frames, TARGET_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const mono = rendered.getChannelData(0); // Float32 mono @16k

  const int16 = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = mono[i]! < -1 ? -1 : mono[i]! > 1 ? 1 : mono[i]!;
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

/**
 * 開始把 mp3 當即時收音灌出。回傳的 CaptureController 與 startCapture 相同：getLevel / displaySurface / stop。
 * 音檔跑完自動呼叫 cb.onEnded()（等同真收音時使用者按「停止分享」）。
 */
export async function startMp3Capture(
  file: File,
  cb: CaptureCallbacks,
  opts: Mp3CaptureOptions = {},
): Promise<CaptureController> {
  const int16 = await decodeToPcm16(file);
  const total = int16.length;
  const speed = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const intervalMs = Math.max(1, FRAME_MS / speed);

  let offset = 0;
  let stopped = false;
  let lastRms = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  timer = setInterval(() => {
    if (stopped) return;
    if (offset >= total) {
      clear();
      if (!stopped) {
        stopped = true;
        cb.onEnded();
      }
      return;
    }
    const end = Math.min(offset + FRAME_SAMPLES, total);
    // 複製成獨立 ArrayBuffer（subarray 會共享底層 buffer；送出前切乾淨一份，長度=正好 2*samples bytes）。
    const frame = int16.slice(offset, end);
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i]! / 32768;
      sum += v * v;
    }
    lastRms = Math.sqrt(sum / Math.max(1, frame.length));
    cb.onFrame(frame.buffer);
    offset = end;
    opts.onProgress?.(offset / total);
  }, intervalMs);

  return {
    displaySurface: "mp3",
    getLevel(): number {
      if (stopped) return 0;
      const db = lastRms > 0 ? 20 * Math.log10(lastRms) : -Infinity;
      const level = (db + 60) / 60;
      return level < 0 ? 0 : level > 1 ? 1 : level;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      clear();
    },
  };
}
