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
  /**
   * Sampling temperature (default: model default, ~1.0). Lower = more deterministic. For structured
   * EXTRACTION (crawl→CRM) pass a low value (~0.3): at the default temperature the same page yields wildly
   * different product counts run-to-run (observed 1 vs 33 on cyberpower.com) — low temp stabilizes enumeration.
   */
  temperature?: number;
  /**
   * Thinking-token budget for models with a thinking phase (gemini-3.x flash), mapped to
   * config.thinkingConfig.thinkingBudget. 0 = DISABLED, -1 = AUTOMATIC (the API default); a low positive
   * value caps the thinking phase. WHY it matters: thinking tokens are drawn from the SAME maxOutputTokens
   * budget, so on a SMALL task with a tight cap the model can spend the whole budget "thinking" and emit
   * zero JSON → finishReason=MAX_TOKENS (observed on per-contact background + per-product detail extraction).
   * For those small focused tasks, cap thinking low so the JSON always fits. Omit → model default (AUTOMATIC).
   */
  thinkingBudget?: number;
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

/** 每次呼叫的預設逾時（client 層）：一般文字/embedding/grounding 30s。 */
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * generateJson 專用逾時 120s：deck 生成走非串流、單次可能 >30s（多頁 + responseSchema），
 * 用 client 預設 30s 會誤殺正常長生成。ASR 走自己的 GoogleGenAI（不共用本 client），維持自身短 deadline。
 */
const GENERATE_JSON_TIMEOUT_MS = 120_000;
/**
 * generateGrounded 專用逾時 90s：Google-Search grounding 升模到 gemini-3.5-flash 後單次常 >30s，
 * 用 client 預設 30s 會誤殺正常長 grounding（E2E 觀察到 attempt 1/2 與 2/2 皆 AbortError／504 DEADLINE_EXCEEDED）。
 */
const GENERATE_GROUNDED_TIMEOUT_MS = 90_000;

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 4_000;
/** honor upstream Retry-After 時的上限（避免被上游要求等太久拖垮排隊）。 */
const RETRY_AFTER_CAP_MS = 5_000;

/** 帶 retryable 旗標的錯誤（C1：retryable===false 時 withRetry 短路不重試）。 */
type RetryableError = Error & { retryable?: boolean; status?: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 是否為 client 端逾時/中止（httpOptions.timeout 觸發的 AbortError 之類）。 */
function isAbortOrTimeout(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === "string" ? e.name : "";
  const msg = typeof e.message === "string" ? e.message : "";
  return (
    /AbortError|RequestTimeoutError|RequestAbortedError/i.test(name) ||
    /\babort(ed)?\b|timed out|timeout|逾時/i.test(msg)
  );
}

/**
 * 正規化單次呼叫錯誤（C1）：
 *  - 真正的限流是帶數字 .status 的 ApiError（429/503）→ 原樣保留（可重試，交給 withRetry 退避 + Retry-After）。
 *  - client 端逾時/中止 → 設 retryable=false 並確保訊息含 timeout 關鍵字（避免白等第二次長逾時）。
 */
function normalizeCallError(err: unknown): Error {
  const e: RetryableError = err instanceof Error ? err : new Error(String(err));
  if (typeof (e as { status?: unknown }).status === "number") return e;
  if (isAbortOrTimeout(err)) {
    // 不可原地改 e.message：真實 client 逾時是 DOMException{name:"AbortError"}，其 .message 為 getter-only，
    // 賦值會拋 TypeError → 沖掉 retryable=false 旗標，害 withRetry 不短路而白等第二次長逾時。改回傳全新可寫 Error。
    const orig = e.message;
    const ne: RetryableError = new Error(
      /timeout|timed out|逾時|AbortError/i.test(orig) ? orig : `Gemini 呼叫逾時（timeout）：${orig}`,
    );
    ne.retryable = false;
    return ne;
  }
  return e;
}

/**
 * 從錯誤解析上游 Retry-After（毫秒）。C1：同時解析數字欄位與 ApiError.message 內的 retryDelay:"Ns" 字串。
 * Google API 的 429/503 訊息常內嵌 `"retryDelay":"5s"`；亦支援標準 `Retry-After: N`（秒）。
 */
function parseRetryAfterMs(err: unknown): number | undefined {
  const e = err as { retryAfterMs?: unknown; retryAfter?: unknown; message?: unknown };
  if (typeof e?.retryAfterMs === "number" && e.retryAfterMs >= 0) return e.retryAfterMs;
  if (typeof e?.retryAfter === "number" && e.retryAfter >= 0) return e.retryAfter * 1000;
  const msg = typeof e?.message === "string" ? e.message : "";
  const delay = msg.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i);
  if (delay?.[1]) return Math.round(parseFloat(delay[1]) * 1000);
  const retryAfter = msg.match(/Retry-After["']?\s*[:=]\s*["']?(\d+)/i);
  if (retryAfter?.[1]) return parseInt(retryAfter[1], 10) * 1000;
  return undefined;
}

/**
 * 兩次嘗試之間的退避（毫秒）。C1：確定性 jitter（不使用 Math.random，測試可重現）；
 * 若上游帶 Retry-After 則優先採用（上限 RETRY_AFTER_CAP_MS）。
 */
function backoffDelayMs(attempt: number, err: unknown): number {
  const retryAfter = parseRetryAfterMs(err);
  if (retryAfter !== undefined) return Math.min(retryAfter, RETRY_AFTER_CAP_MS);
  const expo = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  const jitter = (attempt * 131) % 250; // 確定性 jitter：依 attempt 推導，非亂數
  return expo + jitter;
}

/**
 * 有界重試（C1）：短路（.retryable===false 直接 rethrow 不重試）＋退避（確定性 jitter）＋
 * honor 上游 Retry-After。簽名固定為 withRetry(fn, { attempts, label })。
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts, label }: { attempts: number; label: string },
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[gemini:${label}] attempt ${attempt}/${attempts} failed: ${(err as Error).message}`);
      if ((err as RetryableError)?.retryable === false) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      if (attempt < attempts) await sleep(backoffDelayMs(attempt, err));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export function createGeminiClient(cfg: GeminiConfig): GeminiClient {
  let cached: GoogleGenAI | null = null;
  const client = (): GoogleGenAI => {
    if (!cfg.apiKey) throw new Error("GEMINI_API_KEY not configured");
    // client 層預設逾時 30s（httpOptions.timeout，@google/genai 認可的選項路徑）；
    // 個別呼叫可用 config.httpOptions.timeout 覆寫（generateJson 拉到 120s）。
    if (!cached) cached = new GoogleGenAI({ apiKey: cfg.apiKey, httpOptions: { timeout: DEFAULT_TIMEOUT_MS } });
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
          let response;
          try {
            response = await ai.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction: opts.system,
                responseMimeType: "application/json",
                responseSchema: opts.schema as never,
                maxOutputTokens: opts.maxOutputTokens ?? 8192,
                // 個別呼叫覆寫 client 預設 30s：deck 生成單次可能 >30s。
                httpOptions: { timeout: GENERATE_JSON_TIMEOUT_MS },
                ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
                // thinking token 上限（gemini-3.x flash）：小任務壓低，避免 thinking 吃光 maxOutputTokens → MAX_TOKENS。
                ...(opts.thinkingBudget !== undefined
                  ? { thinkingConfig: { thinkingBudget: opts.thinkingBudget } }
                  : {}),
              },
            });
          } catch (err) {
            // 逾時/中止 → retryable=false（不再白等一次 120s）；限流的 ApiError 原樣保留可重試。
            throw normalizeCallError(err);
          }
          // C1：finishReason!==STOP → 丟出可行動的 zh-TW 錯誤並標記 retryable=false（重試同樣會被截斷/擋下）。
          // 訊息含 "finishReason=<REASON>" 供 decks agent 分流（SAFETY/RECITATION→422、MAX_TOKENS→422）。
          // 轉為純字串，避免與 FinishReason 字串列舉直接比較觸發 TS「無交集」誤判。
          const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
          if (finishReason && finishReason !== "STOP") {
            const hint =
              finishReason === "MAX_TOKENS"
                ? "輸出過長被截斷，請減少頁數或精簡輸入後再試。"
                : finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST"
                  ? "內容可能觸發安全性限制，請調整主題或用語後再試。"
                  : finishReason === "RECITATION"
                    ? "內容可能涉及 recitation 限制，請調整輸入後再試。"
                    : "生成未正常結束，請調整輸入後再試。";
            const e: RetryableError = new Error(
              `Gemini 生成未正常結束（finishReason=${finishReason}）：${hint}`,
            );
            e.retryable = false;
            throw e;
          }
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
        { attempts, label: "generateJson" },
      );
  }

  async function generateGrounded(opts: GenerateGroundedOptions): Promise<GroundedResult> {
      const ai = client();
      const model = opts.model ?? cfg.textModel;
      // 504/DEADLINE_EXCEEDED 韌性：grounding 升模後偶發上游逾時 → 預設 3 次嘗試（帶退避；上游 504 帶數字 status→可重試）。
      const attempts = opts.attempts ?? 3;
      return withRetry<GroundedResult>(
        async () => {
          let response;
          try {
            response = await ai.models.generateContent({
              model,
              contents: opts.prompt,
              config: {
                systemInstruction: opts.system,
                tools: [{ googleSearch: {} }],
                // 覆寫 client 預設 30s：flash grounding 單次常 >30s（見 GENERATE_GROUNDED_TIMEOUT_MS 註解）。
                httpOptions: { timeout: GENERATE_GROUNDED_TIMEOUT_MS },
              },
            });
          } catch (err) {
            // client 逾時/中止 → retryable=false（不白等第二次 90s）；上游 504/限流的 ApiError（帶數字 status）原樣可重試。
            throw normalizeCallError(err);
          }
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
        { attempts, label: "generateGrounded" },
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
