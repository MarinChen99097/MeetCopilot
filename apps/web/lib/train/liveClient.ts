/**
 * TrainLiveClient — browser ↔ Gemini Live voice bridge for /train (M4b).
 *
 * Architecture (API_FINDINGS §A, S3 spike): the browser connects **directly** to Gemini Live
 * with the short-lived ephemeral token minted by `POST /api/train/sessions`; audio never transits
 * our server. This module owns:
 *   - mic capture  → 16 kHz mono PCM16 (AudioWorklet) → session.sendRealtimeInput
 *   - model audio  → 24 kHz mono PCM16 → gapless AudioBufferSourceNode scheduling (barge-in aware)
 *   - a call state machine (connecting / listening / ai-speaking / user-speaking / interrupted / reconnecting / ended / error)
 *   - live bidirectional captions + finalized transcript turns
 *   - >15-min seamless continuity via sessionResumption + contextWindowCompression
 *   - a HARD wall-clock deadline + forced teardown so the socket can never hang (L13).
 *
 * SEAM (M4a train server — now implemented): the ephemeral token locks BOTH the persona
 * `systemInstruction` AND a per-persona voice `speechConfig` into the token via
 * `liveConnectConstraints`. The server picks a stable prebuilt voice by contactId (same contact →
 * same voice, different contacts spread across the pool) so the client cannot choose or override it.
 * `TrainLive` (API_CONTRACT §7) therefore carries no systemInstruction/voice — the client only
 * supplies transport config (modalities, transcription, resumption, compression).
 *
 * The `@google/genai` SDK is loaded via dynamic import so it stays out of SSR and the initial bundle.
 */
import type { LiveServerMessage, Session } from "@google/genai";
import type { TrainTurn } from "@meetcopilot/shared";

/** Call-screen state machine (PROMPT 6: connecting / AI 說 / 你說 / 被打斷). */
export type TrainCallState =
  | "connecting"
  | "listening"
  | "ai-speaking"
  | "user-speaking"
  | "interrupted"
  | "reconnecting"
  | "ended"
  | "error";

/** Live partial captions (still-being-spoken text for each side). */
export interface LivePartials {
  rep: string;
  ai: string;
}

export interface TrainLiveCallbacks {
  onState(state: TrainCallState): void;
  /** Partial (in-flight) captions for the current turn. */
  onPartial(partials: LivePartials): void;
  /** A finalized transcript turn (accumulated for upload + report). */
  onTurn(turn: TrainTurn): void;
  /** Mic RMS level 0..1 for the "you-speaking" waveform. */
  onMicLevel(level: number): void;
  /** Fired after a seamless resumption reconnect (drives the subtle 「已續連」 hint). */
  onResumed(): void;
  /** Terminal, user-facing error message (zh-TW). */
  onError(message: string): void;
}

export interface TrainLiveOptions {
  ephemeralToken: string;
  model: string;
  /**
   * Optional persona systemInstruction. Per the frozen contract this is normally undefined
   * (locked into the ephemeral token by M4a); kept as an override hook only.
   */
  systemInstruction?: string;
  /** Hard wall-clock cap; the socket is force-closed at this bound (default 60 min). */
  maxDurationMs?: number;
}

const CAPTURE_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;
const DEFAULT_MAX_DURATION_MS = 60 * 60 * 1000;
const SETUP_TIMEOUT_MS = 15000;
const MAX_RECONNECTS = 5;
/** Backoff between reconnect attempts (bounded; F2 re-arms the retry policy on every failed attempt). */
const RECONNECT_BASE_BACKOFF_MS = 500;
const RECONNECT_MAX_BACKOFF_MS = 8000;
const USER_SPEAKING_HOLD_MS = 450;
const MIC_LEVEL_THRESHOLD = 0.045;

/**
 * AudioWorklet processor: downsampled Float32 (context is 16 kHz) → PCM16, batched ~32 ms.
 * `_target=512` samples @ 16 kHz = 32 ms per chunk — aligns with the official capture.worklet.js
 * "20–40 ms chunks" best practice for low end-to-end latency (128-sample render quanta accumulate
 * to exactly 512, so each flush is one clean 512-sample block).
 */
const CAPTURE_WORKLET_SRC = `
class McCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this._chunks = []; this._n = 0; this._target = 512; }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch && ch.length) {
      const pcm = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        let s = ch[i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this._chunks.push(pcm);
      this._n += pcm.length;
      if (this._n >= this._target) {
        const out = new Int16Array(this._n);
        let o = 0;
        for (const c of this._chunks) { out.set(c, o); o += c.length; }
        this._chunks = []; this._n = 0;
        this.port.postMessage(out.buffer, [out.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('mc-capture', McCaptureProcessor);
`;

function abToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function base64ToInt16(b64: string): Int16Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.length >> 1);
}

function rms(int16: Int16Array): number {
  if (!int16.length) return 0;
  let sum = 0;
  for (let i = 0; i < int16.length; i++) {
    const v = int16[i]! / 0x8000;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / int16.length) * 4);
}

/**
 * One live practice call. Construct → `start()`; `stop()` for a clean user-initiated end.
 * All timers/sockets/audio graphs are torn down on stop/error so nothing can leak (L13).
 */
export class TrainLiveClient {
  private readonly opts: Required<Pick<TrainLiveOptions, "maxDurationMs">> & TrainLiveOptions;
  private readonly cb: TrainLiveCallbacks;

  private session: Session | null = null;
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private captureNode: AudioWorkletNode | null = null;

  // playback scheduling / barge-in
  private nextPlayTime = 0;
  private readonly activeSources = new Set<AudioBufferSourceNode>();

  // caption accumulation
  private repPartial = "";
  private aiPartial = "";

  // resumption + lifecycle
  private resumeHandle: string | null = null;
  private reconnects = 0;
  private aiSpeaking = false;
  private disposed = false;
  private reconnecting = false;
  private startedAt = 0;
  private userSpeakingTimer: ReturnType<typeof setTimeout> | null = null;
  private deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  private setupTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: TrainLiveOptions, callbacks: TrainLiveCallbacks) {
    this.opts = { ...options, maxDurationMs: options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS };
    this.cb = callbacks;
  }

  /** Boot the audio graph, request the mic, and open the first Live session. */
  async start(): Promise<void> {
    this.startedAt = Date.now();
    this.setState("connecting");
    try {
      await this.initAudio();
    } catch (err) {
      this.fail(this.micErrorMessage(err));
      return;
    }
    // Hard wall-clock bound: force a clean end no matter what (L13).
    this.deadlineTimer = setTimeout(() => this.stop("ended"), this.opts.maxDurationMs);
    await this.openSession(null);
  }

  /** User-initiated end (hang up) or deadline. Idempotent; safe to call from anywhere. */
  stop(reason: TrainCallState = "ended"): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finalizeTurns();
    this.clearTimers();
    try {
      this.session?.close();
    } catch {
      /* already closed */
    }
    this.session = null;
    this.stopPlayback();
    this.captureNode?.port.close();
    this.captureNode?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    void this.captureCtx?.close().catch(() => undefined);
    void this.playbackCtx?.close().catch(() => undefined);
    this.captureCtx = null;
    this.playbackCtx = null;
    this.setState(reason);
  }

  // ── audio graph ────────────────────────────────────────────────

  private async initAudio(): Promise<void> {
    const AC: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.captureCtx = new AC({ sampleRate: CAPTURE_SAMPLE_RATE });
    this.playbackCtx = new AC({ sampleRate: PLAYBACK_SAMPLE_RATE });

    const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SRC], { type: "application/javascript" }));
    try {
      await this.captureCtx.audioWorklet.addModule(workletUrl);
    } finally {
      URL.revokeObjectURL(workletUrl);
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const source = this.captureCtx.createMediaStreamSource(this.micStream);
    this.captureNode = new AudioWorkletNode(this.captureCtx, "mc-capture");
    this.captureNode.port.onmessage = (e: MessageEvent) => this.onCaptureChunk(e.data as ArrayBuffer);
    // Keep the graph pulled without audible feedback: node → muted gain → destination.
    const sink = this.captureCtx.createGain();
    sink.gain.value = 0;
    source.connect(this.captureNode);
    this.captureNode.connect(sink);
    sink.connect(this.captureCtx.destination);
  }

  private onCaptureChunk(buffer: ArrayBuffer): void {
    if (this.disposed) return;
    const int16 = new Int16Array(buffer);
    const level = rms(int16);
    this.cb.onMicLevel(level);
    if (!this.aiSpeaking && level > MIC_LEVEL_THRESHOLD) this.markUserSpeaking();

    if (this.session) {
      try {
        this.session.sendRealtimeInput({ audio: { data: abToBase64(buffer), mimeType: "audio/pcm;rate=16000" } });
      } catch {
        /* transient send race during reconnect — dropped frame is harmless */
      }
    }
  }

  private markUserSpeaking(): void {
    if (!this.aiSpeaking) this.setState("user-speaking");
    if (this.userSpeakingTimer) clearTimeout(this.userSpeakingTimer);
    this.userSpeakingTimer = setTimeout(() => {
      if (!this.aiSpeaking && !this.disposed) this.setState("listening");
    }, USER_SPEAKING_HOLD_MS);
  }

  private playPcm(int16: Int16Array): void {
    const ctx = this.playbackCtx;
    if (!ctx) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i]! / 0x8000;
    const buf = ctx.createBuffer(1, f32.length, PLAYBACK_SAMPLE_RATE);
    buf.copyToChannel(f32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextPlayTime);
    src.start(startAt);
    this.nextPlayTime = startAt + buf.duration;
    this.activeSources.add(src);
    src.onended = () => this.activeSources.delete(src);
  }

  /** Barge-in / interrupt: stop everything currently scheduled. */
  private stopPlayback(): void {
    for (const s of this.activeSources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.activeSources.clear();
    this.nextPlayTime = 0;
  }

  // ── Gemini Live session ────────────────────────────────────────

  private async openSession(resumeHandle: string | null): Promise<void> {
    let mod: typeof import("@google/genai");
    try {
      mod = await import("@google/genai");
    } catch {
      this.fail("無法載入語音模組，請重新整理後再試。");
      return;
    }
    const { GoogleGenAI, Modality } = mod;
    const ai = new GoogleGenAI({ apiKey: this.opts.ephemeralToken, httpOptions: { apiVersion: "v1alpha" } });

    // Guard against a hung handshake (L13). A hung *reconnect* handshake retries (bounded); a hung *initial*
    // handshake fails (nothing to resume — surfacing an error is the right UX).
    this.setupTimer = setTimeout(() => {
      if (this.session || this.disposed) return;
      if (resumeHandle) this.onSocketDown();
      else this.fail("連線逾時，請重試。");
    }, SETUP_TIMEOUT_MS);

    try {
      this.session = await ai.live.connect({
        model: this.opts.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          sessionResumption: resumeHandle ? { handle: resumeHandle } : {},
          contextWindowCompression: { slidingWindow: {} },
          ...(this.opts.systemInstruction ? { systemInstruction: this.opts.systemInstruction } : {}),
        },
        callbacks: {
          onopen: () => {
            if (this.setupTimer) clearTimeout(this.setupTimer);
            this.setupTimer = null;
            this.reconnecting = false;
            this.reconnects = 0; // recovered → refresh the retry budget for any future independent drop
            if (resumeHandle) this.cb.onResumed();
            this.setState("listening");
          },
          onmessage: (m: LiveServerMessage) => this.onMessage(m),
          onerror: () => this.onSocketDown(),
          onclose: () => this.onSocketDown(),
        },
      });
    } catch {
      // connect rejected before onopen (transient drop / failed reopen at goAway) — onSocketDown clears the
      // in-flight `reconnecting` flag so the retry policy re-arms instead of wedging (F2).
      this.onSocketDown();
    }
  }

  private onMessage(m: LiveServerMessage): void {
    if (this.disposed) return;
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.stopPlayback();
        this.aiSpeaking = false;
        this.finalizeTurns();
        this.setState("interrupted");
      }
      const parts = sc.modelTurn?.parts;
      if (parts) {
        for (const p of parts) {
          const data = p.inlineData?.data;
          if (data) {
            this.aiSpeaking = true;
            this.setState("ai-speaking");
            this.playPcm(base64ToInt16(data));
          }
        }
      }
      const outText = sc.outputTranscription?.text;
      if (outText) {
        this.aiPartial += outText;
        this.emitPartials();
      }
      const inText = sc.inputTranscription?.text;
      if (inText) {
        this.repPartial += inText;
        this.emitPartials();
      }
      if (sc.turnComplete) {
        this.aiSpeaking = false;
        this.finalizeTurns();
        this.setState("listening");
      }
    }
    const handle = m.sessionResumptionUpdate?.newHandle;
    if (handle && m.sessionResumptionUpdate?.resumable !== false) this.resumeHandle = handle;
    // goAway: server is about to drop us (≈15-min boundary). Pre-emptively resume for seamlessness.
    if (m.goAway) this.scheduleReconnect();
  }

  /** A connect attempt / live session ended without success. Clear in-flight state, then schedule a retry. */
  private onSocketDown(): void {
    if (this.disposed) return;
    if (this.setupTimer) {
      clearTimeout(this.setupTimer);
      this.setupTimer = null;
    }
    this.session = null;
    // F2: this attempt is over — ALWAYS clear `reconnecting` so scheduleReconnect isn't blocked by a stale
    // in-flight flag (the wedge). The retry policy (MAX_RECONNECTS + backoff) then re-arms cleanly.
    this.reconnecting = false;
    this.scheduleReconnect();
  }

  /** Bounded, backed-off retry scheduler (dedup via reconnecting + reconnectTimer). */
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnecting || this.reconnectTimer) return;
    if (!this.resumeHandle || this.reconnects >= MAX_RECONNECTS) {
      // No resume handle, or the retry budget is spent → give up (message if it never really connected).
      if (Date.now() - this.startedAt < 3000) this.fail("語音連線失敗，請稍後再試。");
      else this.stop("ended");
      return;
    }
    this.setState("reconnecting");
    const backoff = Math.min(RECONNECT_MAX_BACKOFF_MS, RECONNECT_BASE_BACKOFF_MS * 2 ** this.reconnects);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.doReconnect();
    }, backoff);
  }

  /** Seamless resumption: reuse the audio graph, reopen the session with the stored handle. */
  private doReconnect(): void {
    if (this.disposed || this.reconnecting) return;
    const handle = this.resumeHandle;
    if (!handle || this.reconnects >= MAX_RECONNECTS) {
      if (Date.now() - this.startedAt < 3000) this.fail("語音連線失敗，請稍後再試。");
      else this.stop("ended");
      return;
    }
    this.reconnecting = true;
    this.reconnects += 1;
    this.session = null;
    this.stopPlayback();
    this.setState("reconnecting");
    void this.openSession(handle);
  }

  // ── captions / transcript ──────────────────────────────────────

  private emitPartials(): void {
    this.cb.onPartial({ rep: this.repPartial, ai: this.aiPartial });
  }

  private finalizeTurns(): void {
    const t = Date.now();
    if (this.repPartial.trim()) {
      this.cb.onTurn({ speaker: "rep", text: this.repPartial.trim(), t });
      this.repPartial = "";
    }
    if (this.aiPartial.trim()) {
      this.cb.onTurn({ speaker: "ai", text: this.aiPartial.trim(), t });
      this.aiPartial = "";
    }
    this.emitPartials();
  }

  // ── helpers ────────────────────────────────────────────────────

  private setState(state: TrainCallState): void {
    if (!this.disposed || state === "ended" || state === "error") this.cb.onState(state);
  }

  private fail(message: string): void {
    if (this.disposed) return;
    this.cb.onError(message);
    this.stop("error");
  }

  private clearTimers(): void {
    for (const t of [this.userSpeakingTimer, this.deadlineTimer, this.setupTimer, this.reconnectTimer]) {
      if (t) clearTimeout(t);
    }
    this.userSpeakingTimer = null;
    this.deadlineTimer = null;
    this.setupTimer = null;
    this.reconnectTimer = null;
  }

  private micErrorMessage(err: unknown): string {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") return "麥克風權限被拒，請在瀏覽器允許麥克風後重試。";
    if (name === "NotFoundError") return "找不到麥克風裝置，請確認已接上麥克風。";
    return "無法啟動麥克風，請重試。";
  }
}
