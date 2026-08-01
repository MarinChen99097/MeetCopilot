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
import { safetyNetRecord } from "./ops/metering-context.js";

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
  /**
   * MAX_TOKENS 時改用「獨立重取樣」而非直接放棄（預設 false＝維持短路）。
   *
   * 何時該開：輸出**撞頂是抽樣性的退化迴圈**而非真的需要那麼多 token。2026-08-01 deck 生成實測：
   * 把上限從 16384 拉到 28992，失敗樣本照樣灌到 `26215+2761=28976` 撞頂——模型是「有多少吃多少」地
   * 重複繞圈，而同一份輸入的成功樣本 18～20 秒就寫完且遠低於預算（8 連跑 6 成功）。這種情況重取樣有效、加大上限無效。
   *
   * 何時**不要**開：呼叫端自己有「縮小輸入再重試」的策略（checklist-gen 砍半大綱、deep-extractor 減半頁面）——
   * 那些路徑要靠 isMaxTokensError 立刻拿到控制權，內部先重試只會拖慢並多燒 token。
   */
  resampleOnMaxTokens?: boolean;
  /**
   * RECITATION 重試時改用「**升級**重取樣」——逐次升溫（+0.2/hit，夾 1.4）＋在 systemInstruction 追加
   * 「用自己的話改寫、勿照抄」指示（預設 false＝**原溫、原 prompt、純重抽**）。
   *
   * 兩層設計的理由（2026-08-01 /code-review 裁決，ROM 17:54 決策 1）：
   *  - RECITATION 是**輸出端的抽樣旗標**，同 prompt 換一個 sample 多半就過 → 「可重試」該是全域行為（prod 事故的根修）。
   *  - 但「升溫＋改寫指示」是**內容層的干預**，會污染逐字忠實度：CRM 抽取端（research/extractor、
   *    research/deep-extractor）的 SYSTEM 明令「逐字取值、嚴禁捏造」，temperature 0.3/0.4 是實測釘死的
   *   （同一頁在預設溫度下產品數 1 vs 33）。若無條件套用，重取樣一觸發就會改寫抽出的值，而 provenance
   *    還指著原頁 → 假的可稽核性。故升級行為改 opt-in。
   *
   * 何時該開：輸出本來就該是**原創敘述**的生成端（deck 生成、reviseSlides）——那裡「換句話說」正是我們要的。
   * 何時不要開：任何「照著來源逐字取值」的抽取／分類／判讀路徑（預設即是）。
   */
  resampleOnRecitation?: boolean;
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
  /** 019（ezpage 對齊）：thinking/thoughts tokens（算 output 價）。 */
  reasoningTokens?: number;
  /** 019：cached input tokens（較便宜計價）。 */
  cachedInputTokens?: number;
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
  /** 019（ezpage 對齊）：thinking/thoughts tokens。 */
  thoughtsTokenCount?: number;
  /** 019：cached input tokens（部分回應以 promptTokenCount 內含快取，另回此欄細分）。 */
  cachedContentTokenCount?: number;
}

/** 從 generateContent/embedContent 回應寬鬆讀出 token 用量（缺欄→undefined，不臆造）。 */
function readUsage(model: string, meta: UsageMetadataLoose | undefined): TokenUsage {
  return {
    model,
    inputTokens: typeof meta?.promptTokenCount === "number" ? meta.promptTokenCount : undefined,
    outputTokens: typeof meta?.candidatesTokenCount === "number" ? meta.candidatesTokenCount : undefined,
    reasoningTokens: typeof meta?.thoughtsTokenCount === "number" ? meta.thoughtsTokenCount : undefined,
    cachedInputTokens:
      typeof meta?.cachedContentTokenCount === "number" ? meta.cachedContentTokenCount : undefined,
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

/**
 * 模型輸出上限（tokens）。2026-08-01 以 `GET v1beta/models/gemini-3.5-flash` 實查：
 * inputTokenLimit=1048576、**outputTokenLimit=65536**（flash-lite 同值）。呼叫端算出來的預算一律夾到這個天花板。
 */
export const GEMINI_MAX_OUTPUT_TOKENS = 65_536;

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
export type RetryableError = Error & { retryable?: boolean; status?: number };

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

/**
 * finishReason=MAX_TOKENS 判定：generateJson 對截斷輸出丟出的錯誤訊息含 "finishReason=MAX_TOKENS"
 *（見下方 createGeminiClient 內的 C1 分流）。訊息字串的真相在本檔，判定式也住在本檔——
 * 呼叫端（checklist-gen／deep-extractor 的截斷重試）一律 import，不得各自複製 regex。
 */
export function isMaxTokensError(e: unknown): boolean {
  return e instanceof Error && /MAX_TOKENS/.test(e.message);
}

/**
 * finishReason=RECITATION 判定（與 isMaxTokensError 同規矩：字串真相住本檔，呼叫端 import 不複製 regex）。
 */
export function isRecitationError(e: unknown): boolean {
  return e instanceof Error && /RECITATION/.test(e.message);
}

/**
 * RECITATION **升級**重取樣參數（見 GenerateJsonOptions.resampleOnRecitation）。溫度基準取 Gemini 未指定時的預設（~1.0）。
 * 注意：這組常數只在 `resampleOnRecitation === true` 時生效；預設的 RECITATION 重試是原溫原 prompt 純重抽。
 */
const DEFAULT_TEMPERATURE = 1.0;
const RECITATION_TEMP_STEP = 0.2;
const RECITATION_TEMP_CAP = 1.4;
/** RECITATION 升級重取樣時追加到 systemInstruction 的改寫指示（只在 opt-in ＋重試路徑生效，happy path 不受影響）。 */
const RECITATION_REWRITE_HINT =
  "\n（重要）請完全用你自己的話重新組織內容：不要照抄或近似複述任何既有文案、文件或條列段落，" +
  "改寫句型與結構，確保輸出是原創敘述。";

/**
 * MAX_TOKENS 重取樣時追加的節制指示（只在重試路徑生效）。上一個樣本是把預算灌爆的退化迴圈，
 * 直接原樣重打或加大上限都沒用（實測會照樣吃滿），得明確要求收斂長度。
 */
const MAX_TOKENS_CONCISE_HINT =
  "\n（重要）上一次輸出過長被截斷。請大幅精簡：每個欄位只寫必要內容、不要重複或換句話說同一件事，" +
  "嚴格依照要求的數量產出，寧可簡短也必須把 JSON 完整寫完並正確收尾。";

/**
 * finishReason!==STOP → 可行動的 zh-TW 錯誤（訊息含 "finishReason=<REASON>" 供路由分流）。
 *
 * retryable 語意（2026-08-01 prod 事故定調）：
 *  - MAX_TOKENS／SAFETY／PROHIBITED_CONTENT／BLOCKLIST：同輸入重打結果一樣 → retryable=false 短路，不白等。
 *  - **RECITATION：不短路**（全域，無條件）。它是「輸出端」的抽樣旗標（這一筆 sample 被判定太像既有素材），
 *    同一個 prompt 換一個 sample 多半就過——prod 實證：使用者 07:39:55 被擋，31 秒後同輸入重按即 201。
 *    交回 withRetry 重抽。**預設的重抽＝原溫、原 prompt**（對逐字抽取端零污染）；只有呼叫端明示
 *    `resampleOnRecitation` 才會逐次升溫＋追加改寫指示（見 GenerateJsonOptions.resampleOnRecitation）。
 *  - 其餘（OTHER／MALFORMED_FUNCTION_CALL 等）：維持 retryable=false（保守，行為不變）。
 *
 * `resampleOnMaxTokens`＝呼叫端明示「我的 MAX_TOKENS 是退化迴圈，請重取樣」時，MAX_TOKENS 也不短路
 *（見 GenerateJsonOptions.resampleOnMaxTokens 的實測依據）。預設 false＝維持既有短路行為。
 */
export function finishReasonError(
  finishReason: string,
  opts: { resampleOnMaxTokens?: boolean } = {},
): RetryableError {
  const hint =
    finishReason === "MAX_TOKENS"
      ? "輸出過長被截斷，請減少頁數或精簡輸入後再試。"
      : finishReason === "SAFETY" || finishReason === "PROHIBITED_CONTENT" || finishReason === "BLOCKLIST"
        ? "內容可能觸發安全性限制，請調整主題或用語後再試。"
        : finishReason === "RECITATION"
          ? "內容與既有素材過度相似（recitation），正在改寫重取樣。"
          : "生成未正常結束，請調整輸入後再試。";
  const e: RetryableError = new Error(`Gemini 生成未正常結束（finishReason=${finishReason}）：${hint}`);
  // RECITATION 一律交給 withRetry 重取樣；MAX_TOKENS 只在呼叫端明示時重取樣；其餘一律短路。
  const resample =
    finishReason === "RECITATION" || (finishReason === "MAX_TOKENS" && opts.resampleOnMaxTokens === true);
  if (!resample) e.retryable = false;
  return e;
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
      const maxOutputTokens = opts.maxOutputTokens ?? 8192;
      /** 本次呼叫已撞到幾次 RECITATION（觀測用；只在 resampleOnRecitation 時才拿來加溫度）。 */
      let recitationHits = 0;
      /** 本次呼叫已撞到幾次 MAX_TOKENS（只在 resampleOnMaxTokens 時會累加並重取樣）。 */
      let maxTokensHits = 0;
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
          // RECITATION 的**升級**重取樣（opt-in）：同 prompt 同溫度重打可能複製出同一段被判定「疑似背誦」的輸出，
          // 故每撞一次就拉高 temperature 並追加改寫指示，逼出真正獨立的 sample。
          // 未開旗標時（預設，含所有 CRM 抽取端）＝**原溫、原 prompt 純重抽**：temperature 與 systemInstruction
          // 逐位元等同首次呼叫，不得有任何污染（ROM 2026-08-01 17:54 決策 1）。首次呼叫在任一情況下都不受影響。
          const escalateRecitation = opts.resampleOnRecitation === true && recitationHits > 0;
          const temperature = escalateRecitation
            ? Math.min(
                (opts.temperature ?? DEFAULT_TEMPERATURE) + RECITATION_TEMP_STEP * recitationHits,
                RECITATION_TEMP_CAP,
              )
            : opts.temperature;
          // 重試 hint 一次算完：兩個常數都非空字串 → retryHints 為空 ⇔ 兩個旗標皆關 ⇔ 首次呼叫／純重抽，
          // 此時 systemInstruction 原封不動回傳 opts.system（含 undefined，維持「連鍵的有無都一樣」）。
          const retryHints =
            (escalateRecitation ? RECITATION_REWRITE_HINT : "") +
            (maxTokensHits > 0 ? MAX_TOKENS_CONCISE_HINT : "");
          const systemInstruction = retryHints ? `${opts.system ?? ""}${retryHints}` : opts.system;
          let response;
          try {
            response = await ai.models.generateContent({
              model,
              contents,
              config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema: opts.schema as never,
                maxOutputTokens,
                // 個別呼叫覆寫 client 預設 30s：deck 生成單次可能 >30s。
                httpOptions: { timeout: GENERATE_JSON_TIMEOUT_MS },
                ...(temperature !== undefined ? { temperature } : {}),
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
          // C1：finishReason!==STOP → 丟出可行動的 zh-TW 錯誤（分流與 retryable 語意見 finishReasonError）。
          // 訊息含 "finishReason=<REASON>" 供 decks agent 分流（SAFETY/RECITATION/MAX_TOKENS→422）。
          // 轉為純字串，避免與 FinishReason 字串列舉直接比較觸發 TS「無交集」誤判。
          const finishReason = response.candidates?.[0]?.finishReason as string | undefined;
          // usage 的型別放寬只做一次：非 STOP 的觀測 log 與正常路徑的 readUsage 共用同一份。
          const u = response.usageMetadata as UsageMetadataLoose | undefined;
          if (finishReason && finishReason !== "STOP") {
            // 觀測：把 usage 一起記下——下次診斷 MAX_TOKENS／RECITATION 不必再靠猜（2026-08-01 事故教訓）。
            console.warn(
              `[gemini:generateJson] finishReason=${finishReason} model=${model} ` +
                `promptTokens=${u?.promptTokenCount ?? "?"} outputTokens=${u?.candidatesTokenCount ?? "?"} ` +
                `thoughtTokens=${u?.thoughtsTokenCount ?? "?"} maxOutputTokens=${maxOutputTokens} ` +
                `recitationHits=${recitationHits} maxTokensHits=${maxTokensHits}`,
            );
            if (finishReason === "RECITATION") recitationHits++;
            if (finishReason === "MAX_TOKENS") maxTokensHits++;
            throw finishReasonError(finishReason, { resampleOnMaxTokens: opts.resampleOnMaxTokens });
          }
          const text = response.text;
          if (!text) throw new Error("empty Gemini response");
          const cleaned = stripJsonFences(text);
          const usage = readUsage(model, u);
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
    generateJsonMetered, // Metered 變體：不掛安全網（metered wrapper 走此路，避免雙記）
    // 公開 generateJson/generateGrounded/embed 掛安全網：有計費脈絡且未抑制時補記一筆（019；raw 呼叫不漏記）。
    async generateJson<T>(opts: GenerateJsonOptions): Promise<T> {
      const m = await generateJsonMetered<T>(opts);
      safetyNetRecord({
        model: m.usage.model,
        inputTokens: m.usage.inputTokens,
        outputTokens: m.usage.outputTokens,
        reasoningTokens: m.usage.reasoningTokens,
        cachedInputTokens: m.usage.cachedInputTokens,
      });
      return m.value;
    },
    async generateGrounded(opts: GenerateGroundedOptions): Promise<GroundedResult> {
      const r = await generateGrounded(opts);
      // grounded 無 usageMetadata → 字元/4 粗估（與手動 meter 的估法一致）。
      safetyNetRecord({
        model: opts.model ?? cfg.textModel,
        inputTokens: Math.max(1, Math.ceil((opts.prompt?.length ?? 0) / 4)),
        outputTokens: Math.max(0, Math.ceil((r.answer?.length ?? 0) / 4)),
      });
      return r;
    },
    embedMetered, // Metered 變體：不掛安全網
    async embed(text: string): Promise<number[]> {
      const m = await embedMetered(text);
      safetyNetRecord(
        { model: m.usage.model, inputTokens: m.usage.inputTokens, outputTokens: m.usage.outputTokens },
        "embedding",
      );
      return m.value;
    },
  };
}
