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
import type { GeminiConfig } from "../config.js";
import type { AsrProvider, AsrSegment } from "./asr-provider.js";
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
   * construction (like onFinal) to broadcast an `asr_unavailable` error to the presenter's HUD. Fired ONCE
   * per outage: `unavailableSignaled` dedups, and clears on the next successful transcribe (incl. blank).
   * Because this provider is instance-per-session (1:1 with a LiveSessionRuntime), that flag is effectively
   * the per-SessionRuntime dedup flag C3 calls for.
   */
  private unavailableCb: (() => void) | null = null;
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

  /** Accumulate a raw PCM16LE frame; on a segment boundary, transcribe and emit onFinal. */
  pushAudio(_sessionId: string, pcm: Buffer): void {
    const samples = pcmBufferToInt16(pcm);
    const chunk = this.chunker.push(samples);
    if (!chunk) return;
    // Fire-and-forget: transcription is async but ordering within a session is preserved well enough for
    // rolling analysis; any failure degrades to a dropped segment (logged), never a thrown/hung pipeline.
    void this.transcribe(chunk.wav, chunk.tMs);
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

  private async transcribe(wav: Buffer, tMs: number): Promise<void> {
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
      // ASR is healthy again → allow the next genuine outage to re-signal.
      this.unavailableSignaled = false;
      this.lastSuccessSeq = Math.max(this.lastSuccessSeq, seq);
      const text = (response.text ?? "").trim();
      if (text.length === 0) return; // blank/noise: emit nothing (unchanged silence semantics)
      this.finalCb({ t: tMs, text });
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
