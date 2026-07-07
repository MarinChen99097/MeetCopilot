/**
 * Gemini client wrapper (@google/genai). Borrowed pattern from v1 (apps/server/src/gemini.ts), rewritten
 * as a config-injected factory (no import-time env coupling → unit-testable).
 *  - generateJson: JSON mode via responseMimeType="application/json" + responseSchema, with bounded retry.
 *  - Multimodal: optional reference images passed as inlineData parts (style refs; still JSON out, not image gen).
 * Callers own the retry ceiling; a fully-failed call throws (see ARCHITECTURE_PLAN §7).
 * Not configured (no GEMINI_API_KEY) → throws; routes map that to 502 (M1+).
 */
import { GoogleGenAI } from "@google/genai";
import type { GeminiConfig } from "./config.js";

export interface GenerateJsonOptions {
  /** Model id; default = cfg.textModel. */
  model?: string;
  system?: string;
  prompt: string;
  /** Gemini Schema object (build with @google/genai Type enum). */
  schema: Record<string, unknown>;
  /** Optional multimodal reference images. `data` = raw base64 (no data: prefix). */
  images?: { mimeType: string; data: string }[];
  /** Retry attempts (default 2). */
  attempts?: number;
}

export interface GeminiClient {
  isConfigured(): boolean;
  generateJson<T>(opts: GenerateJsonOptions): Promise<T>;
  embed(text: string): Promise<number[]>;
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[gemini:${label}] attempt ${attempt}/${attempts} failed: ${(err as Error).message}`);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function createGeminiClient(cfg: GeminiConfig): GeminiClient {
  let cached: GoogleGenAI | null = null;
  const client = (): GoogleGenAI => {
    if (!cfg.apiKey) throw new Error("GEMINI_API_KEY not configured");
    if (!cached) cached = new GoogleGenAI({ apiKey: cfg.apiKey });
    return cached;
  };

  return {
    isConfigured: () => Boolean(cfg.apiKey),

    async generateJson<T>(opts: GenerateJsonOptions): Promise<T> {
      const ai = client();
      const model = opts.model ?? cfg.textModel;
      const attempts = opts.attempts ?? 2;
      const contents =
        opts.images && opts.images.length > 0
          ? [
              {
                role: "user",
                parts: [
                  { text: opts.prompt },
                  ...opts.images.map((im) => ({
                    inlineData: { mimeType: im.mimeType, data: im.data },
                  })),
                ],
              },
            ]
          : opts.prompt;

      return withRetry<T>(
        async () => {
          const response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.system,
              responseMimeType: "application/json",
              responseSchema: opts.schema as never,
            },
          });
          const text = response.text;
          if (!text) throw new Error("empty Gemini response");
          try {
            return JSON.parse(text) as T;
          } catch (err) {
            throw new Error(
              `Gemini JSON parse failed: ${(err as Error).message}; head: ${text.slice(0, 300)}`,
            );
          }
        },
        attempts,
        "generateJson",
      );
    },

    async embed(text: string): Promise<number[]> {
      const ai = client();
      const response = await ai.models.embedContent({ model: cfg.embedModel, contents: text });
      const values = response.embeddings?.[0]?.values;
      if (!values) throw new Error("Gemini returned no embedding vector");
      return values;
    },
  };
}
