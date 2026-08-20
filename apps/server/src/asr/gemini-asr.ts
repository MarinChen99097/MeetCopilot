/**
 * GeminiAsrProvider — implements the frozen AsrProvider seam (asr/asr-provider.ts) using @google/genai
 * segmented transcription (borrowed from v1 asr/index.ts + gemini.transcribeChunk).
 *
 * Instance-per-session: the frozen `onFinal(cb: (seg) => void)` callback carries no sessionId, so each
 * SessionRuntime owns its own provider instance and the callback context implies the session. `pushAudio`
 * still takes sessionId per the frozen signature (kept for forward-compat / interface conformance).
 *
 * Bounded (L13): each transcription is wrapped in a deadline so a hung upstream never wedges the pipeline.
 * We instantiate GoogleGenAI directly here (not via the shared GeminiClient) so this seam owns its audio
 * call without editing shared gemini.ts (which M2 generation touches in parallel).
 */
import { GoogleGenAI } from "@google/genai";
import type { AudioChannels } from "@meetcopilot/shared";
import type { GeminiConfig } from "../config.js";
import type { AsrFrameContext, AsrProvider, AsrSegment } from "./asr-provider.js";
import { Chunker, pcmBufferToInt16 } from "../realtime/chunker.js";

const TRANSCRIBE_DEADLINE_MS = 20_000;

function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export class GeminiAsrProvider implements AsrProvider {
  private readonly chunker = new Chunker();
  private finalCb: ((seg: AsrSegment) => void) | null = null;
  /**
   * Optional outage callback (contract C3). Beyond the frozen AsrProvider seam — the hub wires it after
   * construction (like onFinal). Fired ONCE per outage **of this track**: `unavailableSignaled` dedups, and
   * clears on the next successful transcribe (incl. blank).
   *
   * ⚠️ **這個旗標只負責「單一軌的邊緣偵測」，不再是使用者可見告警的去重點**。雙聲道之後一場會議有
   * 兩個 provider（左＝報告者、右＝客戶）＝兩份旗標，API 額度用盡時兩路各 signal 一次 → HUD 疊出兩個
   * 一模一樣的 toast。C3 要求的「每次 outage 只告警一次」因此上移到 **session 層**
   *（`LiveSessionRuntime.noteAsrUnavailable` 兩軌共用一個判定，見 `realtime/hub.ts` 的 `wireAsr`）。
   * 本層維持 per-track 邊緣（進入中斷 → `unavailableCb`；恢復 → `availableCb`），session 層才決定要不要廣播。
   */
  private unavailableCb: (() => void) | null = null;
  /**
   * 這一軌從中斷恢復（signaled → 下一次成功轉寫）時觸發，好讓 session 層把本軌從「壞掉的軌」集合移除；
   * 全部軌都恢復後，下一次中斷才能再次告警（否則一場會議只會告警一次就永遠靜音）。
   */
  private availableCb: (() => void) | null = null;
  private unavailableSignaled = false;
  private client: GoogleGenAI | null = null;
  private inFlight = 0;
  /**
   * 併發去重用的單調序號（C3 reorder-robust）：transcribe() 是 fire-and-forget，可能亂序完成。
   * dispatchSeq 每次呼叫遞增；lastSuccessSeq 記錄「已成功」的最大序號。落後成功之後才失敗的掉隊者
   * （seq <= lastSuccessSeq）視為過期，不再誤觸 asr_unavailable（避免恢復後的假告警彈窗）。
   */
  private dispatchSeq = 0;
  private lastSuccessSeq = 0;

  constructor(
    private readonly cfg: GeminiConfig,
    private readonly sessionId: string,
  ) {}

  onFinal(cb: (seg: AsrSegment) => void): void {
    this.finalCb = cb;
  }

  /** Register the genuine-outage callback (see `unavailableCb`). Not part of the frozen AsrProvider seam. */
  onUnavailable(cb: () => void): void {
    this.unavailableCb = cb;
  }

  /** Register the recovery callback (see `availableCb`). Not part of the frozen AsrProvider seam. */
  onAvailable(cb: () => void): void {
    this.availableCb = cb;
  }

  /** Accumulate a raw PCM16LE frame; on a segment boundary, transcribe and emit onFinal. */
  pushAudio(_sessionId: string, pcm: Buffer, ctx: AsrFrameContext): void {
    const samples = pcmBufferToInt16(pcm);
    const chunk = this.chunker.push(samples, ctx);
    if (!chunk) return;
    // Fire-and-forget: transcription is async but ordering within a session is preserved well enough for
    // rolling analysis; any failure degrades to a dropped segment (logged), never a thrown/hung pipeline.
    void this.transcribe(chunk.wav, chunk.tMs, chunk.channels);
  }

  /**
   * 強制切段送轉寫（hub 在**聲道模式切換**時呼叫，見 `realtime/hub.ts` 的 `applyChannelMode`）。
   * 殘料不足一段／整段靜音 → chunker 直接丟棄並回 null（見 `Chunker.flushPending`／`Chunker.flush`）。
   */
  flushPending(): void {
    const chunk = this.chunker.flushPending();
    if (chunk) void this.transcribe(chunk.wav, chunk.tMs, chunk.channels);
  }

  /** Drop buffered audio (consent revoke). Never stored, never transcribed. */
  reset(): void {
    this.chunker.reset();
  }

  private ai(): GoogleGenAI {
    if (!this.cfg.apiKey) throw new Error("GEMINI_API_KEY not configured");
    if (!this.client) this.client = new GoogleGenAI({ apiKey: this.cfg.apiKey });
    return this.client;
  }

  private async transcribe(wav: Buffer, tMs: number, channels: AudioChannels): Promise<void> {
    if (!this.finalCb) return;
    const seq = ++this.dispatchSeq;
    this.inFlight++;
    try {
      const response = await withDeadline(
        this.ai().models.generateContent({
          model: this.cfg.extractModel, // 3.5-flash tier (not lite) for reliable multilingual transcription
          contents: [
            {
              role: "user",
              parts: [
                { text: "逐字轉寫，保留原語言（可能中英夾雜），只回文字，不要加任何說明。" },
                { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
              ],
            },
          ],
        }),
        TRANSCRIBE_DEADLINE_MS,
        "asr.transcribe",
      );
      // A successful transcribe (the upstream call resolved — even if the result is blank/quiet audio) means
      // ASR is healthy again → allow the next genuine outage to re-signal, and tell the session layer this
      // track is back (only then can the session's shared "already warned" gate re-arm).
      if (this.unavailableSignaled) {
        this.unavailableSignaled = false;
        try {
          this.availableCb?.();
        } catch (cbErr) {
          console.warn(`[asr] onAvailable callback threw (session=${this.sessionId}): ${(cbErr as Error).message}`);
        }
      }
      this.lastSuccessSeq = Math.max(this.lastSuccessSeq, seq);
      const text = (response.text ?? "").trim();
      if (text.length === 0) return; // blank/noise: emit nothing (unchanged silence semantics)
      // `channels` 是**擷取當下**的模式快照（切段起點），不是現在的模式——轉寫最長 20 秒，這段飛行期間
      // capture 可能已經換過模式；下游 speaker 判定必須用它（見 hub `wireAsr`）。
      this.finalCb({ t: tMs, text, channels });
    } catch (err) {
      console.warn(`[asr] transcribe failed (session=${this.sessionId} t=${tMs}): ${(err as Error).message}`);
      // Genuine transcribe failure (upstream throw / deadline / exhausted) — distinct from the blank-audio
      // path above, which returns without throwing. Signal the outage ONCE (contract C3); the flag clears on
      // the next successful transcribe. Guard the callback so a broadcast error can never wedge the pipeline.
      // reorder-robust：只有「不比已成功者舊」的失敗才告警——掉隊者在恢復成功之後才失敗時不再假告警。
      if (seq > this.lastSuccessSeq && !this.unavailableSignaled) {
        this.unavailableSignaled = true;
        try {
          this.unavailableCb?.();
        } catch (cbErr) {
          console.warn(`[asr] onUnavailable callback threw (session=${this.sessionId}): ${(cbErr as Error).message}`);
        }
      }
    } finally {
      this.inFlight--;
    }
  }
}
