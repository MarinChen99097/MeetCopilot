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
  /**
   * Hard cap on output tokens (default 8192). Bounds cost/latency AND guards against degenerate
   * runaway generation (a small model can loop into a multi-hundred-KB unterminated string → parse
   * failure that otherwise grinds a background job for minutes). A rich company profile fits well under this.
   */
  maxOutputTokens?: number;
}

/** 一則 grounding 引用（Google Search grounding 的來源）。 */
export interface GroundingCitation {
  title: string;
  url: string;
}

/** grounded 生成結果（開放研究即答；API_CONTRACT §3 POST /api/research/ground）。 */
export interface GroundedResult {
  answer: string;
  citations: GroundingCitation[];
}

export interface GenerateGroundedOptions {
  model?: string;
  system?: string;
  prompt: string;
  attempts?: number;
}

/** 一次呼叫的用量（供計費；token 取自 API usageMetadata，缺則 undefined）。 */
export interface TokenUsage {
  /** 實際使用的 model id（估價 key）。 */
  model: string;
  inputTokens?: number;
  outputTokens?: number;
}

/** 業務結果 + 計費用量（*Metered 變體的回傳）。 */
export interface Metered<T> {
  value: T;
  usage: TokenUsage;
}

export interface GeminiClient {
  isConfigured(): boolean;
  generateJson<T>(opts: GenerateJsonOptions): Promise<T>;
  /**
   * generateJson 的計費變體：回傳結果 + token 用量（Meter 包裝用）。
   * generateJson 內部即委派本方法並丟棄 usage，故行為完全一致。
   */
  generateJsonMetered<T>(opts: GenerateJsonOptions): Promise<Metered<T>>;
  /** Google Search grounding：回答 + 引用來源（GroundingProvider 用）。 */
  generateGrounded(opts: GenerateGroundedOptions): Promise<GroundedResult>;
  embed(text: string): Promise<number[]>;
  /** embed 的計費變體：回傳向量 + token 用量。 */
  embedMetered(text: string): Promise<Metered<number[]>>;
}

/** @google/genai 的 groundingMetadata 子形狀（跨版本寬鬆取用，避免型別耦合）。 */
interface GroundingChunkLoose {
  web?: { uri?: string; title?: string };
}

/** @google/genai 的 usageMetadata 子形狀（跨版本寬鬆取用）。 */
interface UsageMetadataLoose {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/** 從 generateContent/embedContent 回應寬鬆讀出 token 用量（缺欄→undefined，不臆造）。 */
function readUsage(model: string, meta: UsageMetadataLoose | undefined): TokenUsage {
  return {
    model,
    inputTokens: typeof meta?.promptTokenCount === "number" ? meta.promptTokenCount : undefined,
    outputTokens: typeof meta?.candidatesTokenCount === "number" ? meta.candidatesTokenCount : undefined,
  };
}

/**
 * Strip a leading/trailing markdown code fence (```json … ```), which some models emit even under
 * responseMimeType="application/json". Returns the inner JSON text; leaves already-clean text untouched.
 */
function stripJsonFences(text: string): string {
  const t = text.trim();
  if (!t.startsWith("```")) return t;
  return t
    .replace(/^```[a-zA-Z0-9]*\s*/, "") // opening fence + optional lang tag
    .replace(/\s*```$/, "") // closing fence
    .trim();
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

  async function generateJsonMetered<T>(opts: GenerateJsonOptions): Promise<Metered<T>> {
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

      return withRetry<Metered<T>>(
        async () => {
          const response = await ai.models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: opts.system,
              responseMimeType: "application/json",
              responseSchema: opts.schema as never,
              maxOutputTokens: opts.maxOutputTokens ?? 8192,
            },
          });
          const text = response.text;
          if (!text) throw new Error("empty Gemini response");
          const cleaned = stripJsonFences(text);
          const usage = readUsage(model, response.usageMetadata as UsageMetadataLoose | undefined);
          try {
            return { value: JSON.parse(cleaned) as T, usage };
          } catch (err) {
            throw new Error(
              `Gemini JSON parse failed: ${(err as Error).message}; head: ${cleaned.slice(0, 300)}`,
            );
          }
        },
        attempts,
        "generateJson",
      );
  }

  async function generateGrounded(opts: GenerateGroundedOptions): Promise<GroundedResult> {
      const ai = client();
      const model = opts.model ?? cfg.textModel;
      const attempts = opts.attempts ?? 2;
      return withRetry<GroundedResult>(
        async () => {
          const response = await ai.models.generateContent({
            model,
            contents: opts.prompt,
            config: {
              systemInstruction: opts.system,
              tools: [{ googleSearch: {} }],
            },
          });
          const answer = response.text;
          if (!answer) throw new Error("empty Gemini grounded response");
          const chunks =
            (response.candidates?.[0]?.groundingMetadata?.groundingChunks as
              | GroundingChunkLoose[]
              | undefined) ?? [];
          const seen = new Set<string>();
          const citations: GroundingCitation[] = [];
          for (const c of chunks) {
            const url = c.web?.uri;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            citations.push({ title: c.web?.title ?? url, url });
          }
          return { answer, citations };
        },
        attempts,
        "generateGrounded",
      );
  }

  async function embedMetered(text: string): Promise<Metered<number[]>> {
      const ai = client();
      const response = await ai.models.embedContent({ model: cfg.embedModel, contents: text });
      const values = response.embeddings?.[0]?.values;
      if (!values) throw new Error("Gemini returned no embedding vector");
      const usage = readUsage(
        cfg.embedModel,
        (response as { usageMetadata?: UsageMetadataLoose }).usageMetadata,
      );
      // embedContent 常不回 usageMetadata；無回報時用字元數粗估 input token（~4 chars/token），
      // 讓 embedding 也有非零成本觀測（M5_CONTRACT §B「無則估」）。
      if (usage.inputTokens === undefined) usage.inputTokens = Math.max(1, Math.ceil(text.length / 4));
      return { value: values, usage };
  }

  return {
    isConfigured: () => Boolean(cfg.apiKey),
    generateJsonMetered,
    async generateJson<T>(opts: GenerateJsonOptions): Promise<T> {
      return (await generateJsonMetered<T>(opts)).value;
    },
    generateGrounded,
    embedMetered,
    async embed(text: string): Promise<number[]> {
      return (await embedMetered(text)).value;
    },
  };
}
