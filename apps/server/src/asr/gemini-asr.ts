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
  private client: GoogleGenAI | null = null;
  private inFlight = 0;

  constructor(
    private readonly cfg: GeminiConfig,
    private readonly sessionId: string,
  ) {}

  onFinal(cb: (seg: AsrSegment) => void): void {
    this.finalCb = cb;
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
      const text = (response.text ?? "").trim();
      if (text.length === 0) return; // blank/noise
      this.finalCb({ t: tMs, text });
    } catch (err) {
      console.warn(`[asr] transcribe failed (session=${this.sessionId} t=${tMs}): ${(err as Error).message}`);
    } finally {
      this.inFlight--;
    }
  }
}
