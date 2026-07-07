/**
 * Audio capture pipeline for /copilot (account B, Chrome/Edge desktop).
 *
 * getDisplayMedia({video, audio}) → drop the video track (we only want the tab's mixed audio) →
 * AudioContext@16k → AudioWorklet (`/pcm-worklet.js`) resamples to raw 16-bit LE PCM 16 kHz mono
 * frames (~250 ms) → `onFrame(ArrayBuffer)` for the WS binary channel (API_CONTRACT §6).
 *
 * The proven flow is `tools/capture-test.html`; this is its productionized form. Key guarantees:
 *  - ZERO-TRACK GUARD: if the user forgot to tick "Share tab audio" the stream has 0 audio tracks →
 *    we throw `CaptureError('zero-track')` so the UI can show the red re-share guidance.
 *  - track `ended` (user hit the browser's "Stop sharing") → `onEnded()` so the UI can re-prompt.
 *  - a passive AnalyserNode tap powers the VU meter via `getLevel()` (proves audio is really flowing).
 *  - fully bounded teardown (`stop()` disconnects nodes, closes the context, stops every track).
 */

/** Discriminated capture failure; `code` drives the surface's error state (zero-track is the load-bearing one). */
export type CaptureErrorCode = "unsupported" | "denied" | "zero-track" | "worklet" | "unknown";

export class CaptureError extends Error {
  constructor(
    public code: CaptureErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CaptureError";
  }
}

export interface CaptureCallbacks {
  /** A ~250ms raw PCM frame (16-bit LE, 16kHz, mono) ready to relay over WS as a binary frame. */
  onFrame: (pcm: ArrayBuffer) => void;
  /** The shared audio track ended (user pressed the browser's "Stop sharing"). */
  onEnded: () => void;
}

export interface CaptureController {
  /** Current audio level 0..1 (RMS-ish) for the VU meter; 0 after stop. */
  getLevel(): number;
  /** displaySurface hint from the chosen source (e.g. "browser"), if the browser reports it. */
  displaySurface: string | null;
  /** Stop everything: disconnect graph, close context, stop tracks. Idempotent. */
  stop(): void;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** Map a getDisplayMedia rejection to a CaptureError code. */
function mapGetError(err: unknown): CaptureError {
  const name = err instanceof Error ? err.name : String(err);
  if (name === "NotAllowedError" || name === "AbortError") {
    return new CaptureError("denied", "使用者取消或未授權分享。請再試一次並允許分享。");
  }
  if (name === "NotSupportedError" || name === "NotFoundError") {
    return new CaptureError("unsupported", "此瀏覽器不支援分頁音訊擷取（需桌面版 Chrome / Edge）。");
  }
  return new CaptureError("unknown", err instanceof Error ? err.message : "擷取失敗");
}

export async function startCapture(cb: CaptureCallbacks): Promise<CaptureController> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new CaptureError("unsupported", "此瀏覽器沒有 getDisplayMedia（需桌面版 Chrome / Edge）。");
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: AUDIO_CONSTRAINTS });
  } catch (err) {
    throw mapGetError(err);
  }

  // We only want audio — capture the displaySurface hint, then stop the video track immediately.
  let displaySurface: string | null = null;
  for (const v of stream.getVideoTracks()) {
    const s = v.getSettings?.() ?? {};
    if (typeof s.displaySurface === "string") displaySurface = s.displaySurface;
    try {
      v.stop();
    } catch {
      /* ignore */
    }
  }

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    // ZERO-TRACK GUARD — user did not tick "Share tab audio" (or picked a source without audio).
    for (const t of stream.getTracks()) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
    throw new CaptureError("zero-track", "沒有偵測到音訊軌（未勾『分享分頁音訊』）。");
  }

  // Build the audio graph.
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext) ||
    ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext);
  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 16000 });
  } catch {
    ctx = new AC(); // some engines reject an explicit rate; the worklet resamples defensively
  }

  const cleanupTracks = () => {
    for (const t of audioTracks) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
  };

  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");
  } catch (err) {
    try {
      await ctx.close();
    } catch {
      /* ignore */
    }
    cleanupTracks();
    throw new CaptureError("worklet", err instanceof Error ? err.message : "AudioWorklet 載入失敗");
  }

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* ignore */
    }
  }

  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));

  // Passive analyser tap for the VU meter (does not need onward connection to read data).
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const meterBuf = new Float32Array(analyser.fftSize);

  // Worklet: source → worklet → (muted) destination. Routing to destination keeps the processor
  // scheduled; the processor writes no output, so the muted gain emits silence (no echo/playback).
  const worklet = new AudioWorkletNode(ctx, "pcm-downsampler", {
    processorOptions: { targetSampleRate: 16000, frameMs: 250 },
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  worklet.port.onmessage = (e: MessageEvent) => {
    if (e.data instanceof ArrayBuffer) cb.onFrame(e.data);
  };
  const sink = ctx.createGain();
  sink.gain.value = 0;
  source.connect(worklet);
  worklet.connect(sink);
  sink.connect(ctx.destination);

  let stopped = false;
  const onTrackEnded = () => {
    if (stopped) return;
    cb.onEnded();
  };
  for (const t of audioTracks) t.addEventListener("ended", onTrackEnded);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const t of audioTracks) t.removeEventListener("ended", onTrackEnded);
    try {
      worklet.port.postMessage("stop");
    } catch {
      /* ignore */
    }
    for (const node of [source, analyser, worklet, sink]) {
      try {
        node.disconnect();
      } catch {
        /* ignore */
      }
    }
    cleanupTracks();
    try {
      void ctx.close();
    } catch {
      /* ignore */
    }
  };

  return {
    displaySurface,
    getLevel(): number {
      if (stopped) return 0;
      analyser.getFloatTimeDomainData(meterBuf);
      let sum = 0;
      for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i]! * meterBuf[i]!;
      const rms = Math.sqrt(sum / meterBuf.length);
      // Normalize: map ~-60dB..0dB to 0..1 for a lively meter.
      const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      const level = (db + 60) / 60;
      return level < 0 ? 0 : level > 1 ? 1 : level;
    },
    stop,
  };
}
