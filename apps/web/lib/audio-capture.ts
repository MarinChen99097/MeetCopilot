/**
 * Audio capture pipeline for /copilot (account B, Chrome/Edge desktop).
 *
 * getDisplayMedia({video, audio}) → drop the video track (we only want the tab's mixed audio) →
 * **best-effort getUserMedia for the presenter's own microphone** → AudioContext@16k →
 * AudioWorklet (`/pcm-worklet.js`) resamples to raw 16-bit LE PCM 16 kHz frames (~250 ms) →
 * `onFrame(ArrayBuffer)` for the WS binary channel (API_CONTRACT §6).
 *
 * TWO SHAPES, decided at startCapture() time and reported as `CaptureController.channels`:
 *  - mic granted → **stereo**: ChannelMergerNode with **mic on input 0 (LEFT = presenter)** and tab
 *    audio on **input 1 (RIGHT = the other side)**; frames are interleaved Int16 LE, left first
 *    (4000 pairs = 16000 bytes per 250 ms). The caller must negotiate `?channels=2` on the WS URL.
 *  - mic denied / missing / busy → **mono**, byte-for-byte the legacy path (4000 samples = 8000
 *    bytes). The microphone is an ENHANCEMENT: tab audio is the core feature, so a mic failure is a
 *    silent downgrade, never a CaptureError.
 *
 * The proven flow is `tools/capture-test.html`; this is its productionized form. Key guarantees:
 *  - ZERO-TRACK GUARD: if the user forgot to tick "Share tab audio" the stream has 0 audio tracks →
 *    we throw `CaptureError('zero-track')` so the UI can show the red re-share guidance.
 *  - track `ended` (user hit the browser's "Stop sharing") → `onEnded()` so the UI can re-prompt.
 *    Only the DISPLAY tracks are watched — losing the mic must not tear down the meeting.
 *  - a passive AnalyserNode tap powers the VU meter via `getLevel()` (proves audio is really flowing);
 *    in stereo BOTH sources feed it, so either side speaking moves the meter.
 *  - fully bounded teardown (`stop()` disconnects every node, closes the context, stops EVERY track —
 *    display AND microphone, so the tab's recording indicator actually goes out), AND graph
 *    construction runs inside one try/catch that does the same on any failure: when we throw, nobody
 *    holds a controller, so a leaked mic track could never be released.
 *  - the mic request is time-boxed (MIC_TIMEOUT_MS): `getUserMedia` does not settle while its
 *    permission bubble is open, and an unanswered bubble must not strand `startCapture` forever.
 */
import type { AudioChannels } from "@meetcopilot/shared";

/** Discriminated capture failure; `code` drives the surface's error state (zero-track is the load-bearing one).
 *  Deliberately has NO microphone code: a mic failure is a silent downgrade to mono, not an error state. */
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
  /** A ~250ms raw PCM frame (16-bit LE, 16kHz). Mono ⇒ 8000 bytes; stereo ⇒ 16000 bytes interleaved,
   *  left (mic/presenter) first — see `CaptureController.channels`. */
  onFrame: (pcm: ArrayBuffer) => void;
  /** The shared audio track ended (user pressed the browser's "Stop sharing"). */
  onEnded: () => void;
}

export interface CaptureController {
  /** Current audio level 0..1 (RMS-ish) for the VU meter; 0 after stop. */
  getLevel(): number;
  /** displaySurface hint from the chosen source (e.g. "browser"), if the browser reports it. */
  displaySurface: string | null;
  /**
   * Channels actually being emitted this session — the value the caller must put in the WS
   * `channels` query param. 1 = mono tab mix; 2 = interleaved L(mic/presenter)+R(tab/other side).
   *
   * OPTIONAL because `/sim`'s `mp3-capture.ts` builds a CaptureController too and deliberately stays
   * mono; callers read it as `ctrl.channels ?? 1` (absent ⇒ mono, matching the server's fail-safe).
   */
  channels?: AudioChannels;
  /** Stop everything: disconnect graph, close context, stop tracks. Idempotent. */
  stop(): void;
}

/**
 * Tab-audio constraints. The tab mix is already a clean digital signal, so every browser DSP stage is
 * off — AGC would pump the far end's levels and NS/AEC would chew on speech that never touched a mic.
 * **Do NOT reuse these for the microphone** (see MIC_CONSTRAINTS).
 */
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/**
 * Microphone constraints — deliberately the OPPOSITE of AUDIO_CONSTRAINTS.
 *
 * `echoCancellation: true` is load-bearing, not a preference: the far end is coming out of the
 * presenter's speakers, so an unprocessed mic would re-record the other side and bleed the RIGHT
 * channel's content into the LEFT one. That destroys the whole point of the stereo split (both
 * channels end up containing both people, and the transcript can no longer attribute anything).
 * NS/AGC ride along because Chrome's AEC lives in the same WebRTC audio-processing module and is at
 * its best with the full chain engaged — and because unlike the tab mix this really is a physical
 * capture: NS drops room/fan/keyboard noise and AGC normalizes a mic whose distance varies a lot,
 * both of which raise ASR accuracy rather than distort a pristine signal.
 */
const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** Map a **getDisplayMedia** rejection to a CaptureError code (the copy is share-specific on purpose;
 *  microphone failures never reach here — they fall back to mono silently). */
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

function stopTracks(tracks: MediaStreamTrack[]): void {
  for (const t of tracks) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Twin of `stopTracks` for graph nodes: disconnect every one, nulls skipped.
 *
 * Each node gets its OWN try/catch on purpose — one node throwing must never skip the rest of the
 * list, or a teardown would stop half-way and leave the remainder wired into a context we are about
 * to close. Both teardown sites (the stereo-merge failure path and `stop()`) share this so the
 * "disconnect everything" rule exists once instead of being re-typed per site.
 */
function disconnectAll(nodes: Array<AudioNode | null>): void {
  for (const n of nodes) {
    try {
      n?.disconnect();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Wire the stereo split: **LEFT = mic = presenter**, **RIGHT = tab = the other side**.
 *
 * ChannelMergerNode inputs are single-channel, so a stereo tab mix is down-mixed into the right
 * channel — exactly what we want. Node construction can fail for any reason; when it does we drop
 * back to mono rather than failing the whole capture, which means this function owns the FULL
 * cleanup of what it allocated: disconnect whatever got built, and **stop the mic tracks** so the
 * tab's recording indicator does not stay lit for a microphone nothing is reading any more.
 *
 * Returns null ⇒ caller runs the unchanged mono path (`graphHead` = tabSource, `channels` = 1).
 */
function tryStereoMerge(
  ctx: AudioContext,
  tabSource: AudioNode,
  micStream: MediaStream,
  micTracks: MediaStreamTrack[],
): { micSource: MediaStreamAudioSourceNode; merger: ChannelMergerNode } | null {
  let micSource: MediaStreamAudioSourceNode | null = null;
  let merger: ChannelMergerNode | null = null;
  try {
    micSource = ctx.createMediaStreamSource(micStream);
    merger = ctx.createChannelMerger(2);
    micSource.connect(merger, 0, 0); // input 0 → LEFT
    tabSource.connect(merger, 0, 1); // input 1 → RIGHT
    return { micSource, merger };
  } catch {
    disconnectAll([micSource, merger]);
    stopTracks(micTracks); // release the mic immediately so the indicator does not stay lit
    return null;
  }
}

/**
 * How long we wait for the microphone before giving up and going mono.
 *
 * Load-bearing: `getUserMedia` does NOT settle while Chrome's permission bubble is open. Without a
 * bound, a user who ignores or never notices that bubble would leave `startCapture` pending forever —
 * the tab share is already running, yet the surface is stuck in `phase: "requesting"` with zero frames,
 * no WS, and no way out. Falling back to mono after a long-but-finite wait is strictly better: the core
 * feature (tab audio) keeps working, and the mic is only ever an enhancement.
 */
const MIC_TIMEOUT_MS = 10000;

/**
 * Best-effort microphone acquisition. Returns null on ANY failure (permission denied, no device,
 * device busy, no getUserMedia, a stream that somehow carries no audio track, or the user simply not
 * answering the prompt within MIC_TIMEOUT_MS) — the caller then runs the unchanged mono path.
 * Never throws, never hangs.
 */
async function tryGetMic(): Promise<MediaStream | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;

  const ask: Promise<MediaStream | null> = navigator.mediaDevices
    .getUserMedia({ audio: MIC_CONSTRAINTS })
    .then((s) => {
      if (s.getAudioTracks().length === 0) {
        stopTracks(s.getTracks()); // no audio in an "audio" stream → nothing to merge; release it now
        return null;
      }
      return s;
    })
    .catch(() => null); // NotAllowedError / NotFoundError / NotReadableError / … → mono, silently

  let timer: ReturnType<typeof setTimeout> | undefined;
  const bail = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), MIC_TIMEOUT_MS);
  });
  const won = await Promise.race([ask, bail]);
  if (timer !== undefined) clearTimeout(timer);
  if (won) return won;

  // We gave up (or it failed). If a late "Allow" still produces a stream, nobody is holding it — the
  // tab's recording indicator would stay lit forever. Release it the moment it arrives.
  void ask.then((late) => {
    if (late) stopTracks(late.getTracks());
  });
  return null;
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
    stopTracks(stream.getTracks());
    throw new CaptureError("zero-track", "沒有偵測到音訊軌（未勾『分享分頁音訊』）。");
  }

  // Microphone comes AFTER the zero-track guard on purpose: never prompt for the mic on a run we are
  // about to abort anyway. A failure here is not an error — it just keeps us on the mono path.
  const micStream = await tryGetMic();
  const micTracks = micStream ? micStream.getAudioTracks() : [];

  /** Stops EVERY track we hold — display AND microphone. Missing the mic here would leave the tab's
   *  recording indicator lit after "stop listening", i.e. the user believes they are still being heard.
   *  Declared BEFORE the AudioContext so every failure path below can release both. */
  const cleanupTracks = () => {
    stopTracks(audioTracks);
    stopTracks(micTracks);
  };

  // The mic prompt is modal-ish and can sit there for seconds: the user may hit the browser's "Stop
  // sharing" meanwhile. The `ended` listener is not attached yet, so nothing would notice — we would
  // build the whole graph on a dead track and sit in "listening" streaming pure silence.
  if (!audioTracks.some((t) => t.readyState === "live")) {
    cleanupTracks();
    throw new CaptureError("denied", "分享在開始前就被停止了，請重新開始聆聽並保持分享。");
  }

  // Build the audio graph.
  const AC: typeof AudioContext =
    (window.AudioContext as typeof AudioContext) ||
    ((window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext as typeof AudioContext);
  let ctx: AudioContext;
  try {
    ctx = new AC({ sampleRate: 16000 });
  } catch {
    try {
      ctx = new AC(); // some engines reject an explicit rate; the worklet resamples defensively
    } catch (err) {
      // Nothing else has been allocated yet — just release the tracks (mic included).
      cleanupTracks();
      throw new CaptureError("unsupported", err instanceof Error ? err.message : "無法建立 AudioContext");
    }
  }

  // ONE guarded block from here to the returned controller. Every allocation below (worklet module,
  // source/merger/analyser/gain nodes, connections) can throw, and the microphone is already live at
  // this point — an unguarded throw would reject `startCapture` with the mic still hot and the tab's
  // recording indicator lit forever, with no controller for anyone to call stop() on.
  try {
    await ctx.audioWorklet.addModule("/pcm-worklet.js");

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* ignore */
      }
    }

    const tabSource = ctx.createMediaStreamSource(new MediaStream(audioTracks));

    // Stereo merge — only when we actually got a mic, and only if the nodes build (see tryStereoMerge:
    // a failure there releases the mic and returns null, i.e. a silent downgrade to the mono path).
    // `stereo` is the ONE fact the rest of the graph reads: null ⇒ mono everywhere.
    const stereo = micStream ? tryStereoMerge(ctx, tabSource, micStream, micTracks) : null;
    const channels: AudioChannels = stereo ? 2 : 1;
    const graphHead: AudioNode = stereo?.merger ?? tabSource;

    // Passive analyser tap for the VU meter (does not need onward connection to read data). In stereo we
    // wire BOTH sources into it — multiple connections to one input are summed, so the meter reacts to
    // either side speaking no matter how the analyser down-mixes internally.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    tabSource.connect(analyser);
    if (stereo) stereo.micSource.connect(analyser);
    const meterBuf = new Float32Array(analyser.fftSize);

    // Worklet: graphHead → worklet → (muted) destination. Routing to destination keeps the processor
    // scheduled; the processor writes no output, so the muted gain emits silence (no echo/playback).
    const workletOptions: AudioWorkletNodeOptions = {
      processorOptions: { targetSampleRate: 16000, frameMs: 250, channels },
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    };
    if (channels === 2) {
      // Pin the input to exactly 2 DISCRETE channels: without this the default ("max"/"speakers") could
      // let the node down-mix the merger's L/R into one channel and the worklet would see mono.
      workletOptions.channelCount = 2;
      workletOptions.channelCountMode = "explicit";
      workletOptions.channelInterpretation = "discrete";
    } else {
      // Mono is the mic-denied fallback, and denial is common — so this path carries the WHOLE meeting.
      // The worklet reads input[0] only, so we must make Web Audio DOWN-MIX before it gets there: with
      // the node defaults ("max"/"speakers") a stereo tab mix arrives as 2 channels and the right half —
      // half of what the other side said — is silently DISCARDED rather than mixed in. "explicit" + a
      // channelCount of 1 + "speakers" is the standard (L+R)/2 down-mix.
      // Note `/sim` is unaffected: lib/mp3-capture.ts does its own OfflineAudioContext(1, …) down-mix and
      // never goes through these node options.
      workletOptions.channelCount = 1;
      workletOptions.channelCountMode = "explicit";
      workletOptions.channelInterpretation = "speakers";
    }
    const worklet = new AudioWorkletNode(ctx, "pcm-downsampler", workletOptions);
    worklet.port.onmessage = (e: MessageEvent) => {
      if (e.data instanceof ArrayBuffer) cb.onFrame(e.data);
    };
    const sink = ctx.createGain();
    sink.gain.value = 0;
    graphHead.connect(worklet);
    worklet.connect(sink);
    sink.connect(ctx.destination);

    let stopped = false;
    // ONLY the display tracks signal "the user stopped sharing". A microphone track ending (device
    // unplugged, taken by another app) must NOT end the meeting — the tab audio is still flowing.
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
      // Drop the frame handler too: a frame already in flight would otherwise still reach onFrame
      // after stop() (harmless today thanks to the consent gate + closed socket, but not by design).
      worklet.port.onmessage = null;
      // Every node we created, including the stereo-only ones (absent in mono → null → skipped).
      disconnectAll([tabSource, stereo?.micSource ?? null, stereo?.merger ?? null, analyser, worklet, sink]);
      cleanupTracks();
      try {
        void ctx.close();
      } catch {
        /* ignore */
      }
    };

    return {
      displaySurface,
      channels,
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
  } catch (err) {
    // Nothing was handed back, so nobody can call stop() — release EVERYTHING here or the mic stays
    // hot and the tab keeps showing the recording indicator with no way to turn it off.
    try {
      void ctx.close(); // closing the context also tears down every node built inside it
    } catch {
      /* ignore */
    }
    cleanupTracks();
    throw new CaptureError("worklet", err instanceof Error ? err.message : "音訊管線建立失敗");
  }
}
