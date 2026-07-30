/**
 * C2 匯入 deck 逐頁文字抽取管線（MEETING_CHECKLIST_CONTRACT §11；凍結 v1.4）。
 *
 * 三態語意（§11.1 v1.4）：text_extract `NULL`＝尚未抽過；`''`＝抽過、確認無字（負結果標記）；非空＝逐頁文字。
 * parser 抽出空 → 留 NULL（交讀圖判定）；**讀圖回空 → 寫 `''`**——否則純圖 deck 每輪回填重燒讀圖、
 * 且讀圖上限 slice 每輪取同批＝第 maxPages+1 頁起永久飢餓。
 *
 * 兩個入口、同一條管線（fill-empty 冪等，只補 text_extract 為 NULL 且 spec 文字為空的原始頁）：
 *  - 匯入期：conversion-job 在 setImportStatus('ready') **之後**呼叫（deck 先 ready、UX 不變）；
 *    任何失敗只 log，絕不影響匯入本身（§11.1）。
 *  - 回填：POST /api/decks/:id/extract-text → maybeStartTextExtract（C1 之前匯入的 deck 全是 NULL；§11.5）。
 *
 * 流程：
 *  1) 原檔輕量抽字 parsePptxText/parsePdfText（經 runInWorker，逾時可終止；只回 string[]，不走 SlideSpec 路徑）。
 *  2) 頁序對齊守門（§11.2）：解析器回 null（pptx 解不出 sldIdLst／pdf 頁索引不可靠且數量對不上）或
 *     解析頁數 ≠ 原始頁數（隱藏頁、吞頁）→ **整份逐頁文字丟棄，一頁都不寫**，全數走讀圖 fallback
 *     （PNG 上的字 Gemini 讀得到，結果天然對齊）。寧可付讀圖成本，不可寫入可能錯位的文字。
 *  3) 讀圖 fallback（§11.3）：該頁文字 < TEXT_EXTRACT_MIN_CHARS → Gemini 讀該頁 page_image PNG 逐字轉錄；
 *     硬上限 TEXT_EXTRACT_VISION_MAX_PAGES（超出留 NULL＋log 截斷）、並行 TEXT_EXTRACT_VISION_CONCURRENCY、
 *     attempts=1（enhancement 非關鍵路徑）。計費 meteredGeminiClient kind='gemini_extract'。
 *
 * 併發去重：module-level in-flight Set（同 deck 第二發 no-op；Cloud Run max-instances=1，in-memory 即可）。
 * 本模組**僅限匯入期與回填 job 呼叫，嚴禁 realtime／會中路徑**（I1：text_extract 只在匯入期寫入）。
 */
import { Type } from "@google/genai";
import type { CrmCore } from "@meetcopilot/crm";
import type { DeckSlide } from "@meetcopilot/shared";
import { extractSlideText } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { runInWorker } from "./run-in-worker.js";

/** 每頁寫入上限（§11.1：trim 後截斷；checklist outline 全份也才 12,000 字）。 */
export const PAGE_TEXT_MAX_CHARS = 8000;

/** 輕量抽字 worker 逾時（文字-only，遠輕於 SlideSpec 路徑；比照 /extract-pdf 的 15s 放寬一級）。 */
const PARSE_TIMEOUT_MS = 30_000;

/** 該頁文字低於此字數 → 走讀圖 fallback（§11.3；env TEXT_EXTRACT_MIN_CHARS，預設 20）。 */
export function textExtractMinChars(): number {
  const n = Number(process.env.TEXT_EXTRACT_MIN_CHARS ?? 20);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 20;
}

/** 讀圖頁數硬上限（§11.3；env TEXT_EXTRACT_VISION_MAX_PAGES，預設 20——掃描型 100 頁 PDF 不得變 100 次呼叫）。 */
export function visionMaxPages(): number {
  const n = Number(process.env.TEXT_EXTRACT_VISION_MAX_PAGES ?? 20);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 20;
}

/** 讀圖並行度（§11.3；env TEXT_EXTRACT_VISION_CONCURRENCY，預設 2）。 */
export function visionConcurrency(): number {
  const n = Number(process.env.TEXT_EXTRACT_VISION_CONCURRENCY ?? 2);
  return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : 2;
}

/** 讀圖轉錄的 responseSchema（§11.3：{text:string}）。 */
const VISION_SCHEMA = {
  type: Type.OBJECT,
  properties: { text: { type: Type.STRING } },
  required: ["text"],
} as const;

/** 讀圖轉錄 prompt（§11.3 逐字要求）。 */
const VISION_PROMPT =
  "逐字轉錄這張簡報頁面圖片上的所有可見文字，依閱讀順序（由上到下、由左到右）輸出為單一字串。" +
  "保留原文語言，不翻譯、不摘要、不解釋、不新增任何圖片上沒有的文字。頁面沒有可見文字時，text 回空字串。";

export interface TextExtractDeps {
  core: CrmCore;
  /** 未計費的 base client；有 meter 時管線內自行包 meteredGeminiClient（kind='gemini_extract'）。 */
  gemini: GeminiClient;
  meter?: Meter;
  /** 讀圖模型（config.gemini.extractModel）。 */
  extractModel: string;
  /** 測試注入：原檔 → 逐頁純文字（null＝對齊無效）。預設＝runInWorker('pptx-text'|'pdf-text')。 */
  parseText?: (kind: "pptx" | "pdf", bytes: Buffer) => Promise<string[] | null>;
}

export interface TextExtractArgs {
  orgId: string;
  deckId: string;
  /** 計費歸屬（§11.3：匯入＝匯入者、回填＝發起者；背景無脈絡可省略）。 */
  userId?: string;
  /** meter idempotency 前綴（匯入＝`textextract:${jobId}`；回填＝`textextract:${uuid}`），頁間由 seq 區分。 */
  idemPrefix: string;
}

/**
 * 預設輕量抽字：丟 worker thread 跑（沿用逾時/terminate 守護）。
 * buffer detach 警告（§11.1）：runInWorker 對「剛好整份底層 ArrayBuffer」做 zero-copy transfer，
 * transfer 後主執行緒 buffer 會 detach——一律傳 `Buffer.from(bytes)` 複本，原 bytes（DB 回傳物）不受影響。
 */
function parseTextViaWorker(kind: "pptx" | "pdf", bytes: Buffer): Promise<string[] | null> {
  return runInWorker<string[] | null>(kind === "pptx" ? "pptx-text" : "pdf-text", Buffer.from(bytes), PARSE_TIMEOUT_MS);
}

/** 同 deck 併發去重（§11.5；in-memory；Cloud Run max-instances=1）。 */
const inFlight = new Set<string>();

/**
 * fill-empty 判定（§11.1 v1.4 三態）：text_extract `NULL/undefined`＝尚未抽過 → 需要；
 * `''`＝抽過、確認無字（負結果標記）→ 跳過；非空＝已有字 → 跳過。spec 有字（native/AI 頁）也不需要。
 */
function needsText(s: DeckSlide): boolean {
  if (typeof s.textExtract === "string") return false; // ''（負結果）與非空皆為「已有結果」
  return extractSlideText(s.spec).trim().length === 0;
}

/** 取「需要抽字」的原始頁清單（kind='original' 且 idx < originalCount，依 idx 序）。 */
function pendingOriginals(originalCount: number, slides: DeckSlide[]): DeckSlide[] {
  return slides.filter((s) => s.kind === "original" && s.idx < originalCount && needsText(s));
}

/**
 * 跑一次抽字管線（fill-empty 冪等；in-flight 去重）。**永不 throw**（所有失敗只 log——
 * §11.1：任何失敗不得影響匯入/呼叫端）。同 deck 已在跑 → 直接 no-op。
 * 注意：in-flight 檢查與註冊在**第一個 await 之前**同步完成，fire-and-forget 呼叫下的併發第二發也擋得住。
 */
export function runTextExtract(deps: TextExtractDeps, args: TextExtractArgs): Promise<void> {
  if (inFlight.has(args.deckId)) return Promise.resolve();
  inFlight.add(args.deckId);
  return doRun(deps, args)
    .catch((err) => {
      console.error(`[text-extract] deck ${args.deckId} 抽字管線失敗（deck 狀態不受影響）:`, err);
    })
    .finally(() => {
      inFlight.delete(args.deckId);
    });
}

/**
 * 回填入口（§11.5）：需要跑 → fire-and-forget 啟動並回 'started'；
 * 不需要（native deck／匯入未完成／已全有字）→ 'not-needed'；同 deck 進行中 → 'in-flight'（呼叫端同樣回 202）。
 */
export async function maybeStartTextExtract(
  deps: TextExtractDeps,
  args: TextExtractArgs,
): Promise<"started" | "not-needed" | "in-flight"> {
  if (inFlight.has(args.deckId)) return "in-flight";
  const found = await deps.core.decks.findWithSlides(args.orgId, args.deckId);
  if (!found) return "not-needed";
  const { deck, slides } = found;
  if (deck.sourceKind !== "pptx" && deck.sourceKind !== "pdf") return "not-needed"; // native deck
  if (deck.importStatus !== "ready") return "not-needed"; // 匯入未完成/失敗
  if (deck.originalCount <= 0) return "not-needed";
  if (pendingOriginals(deck.originalCount, slides).length === 0) return "not-needed"; // 已全有結果（含 '' 負標記）
  void runTextExtract(deps, args); // runTextExtract 自帶 in-flight 去重與全域 catch
  return "started";
}

async function doRun(deps: TextExtractDeps, args: TextExtractArgs): Promise<void> {
  const { core } = deps;
  const { orgId, deckId } = args;
  const parseText = deps.parseText ?? parseTextViaWorker;

  const found = await core.decks.findWithSlides(orgId, deckId);
  if (!found) return;
  const { deck, slides } = found;
  if (deck.sourceKind !== "pptx" && deck.sourceKind !== "pdf") return;
  if (deck.importStatus !== "ready") return;
  const originalCount = deck.originalCount;
  if (originalCount <= 0) return;

  const pending = pendingOriginals(originalCount, slides);
  if (pending.length === 0) return;

  // 1) 原檔輕量抽字（worker）。任何失敗＝對齊無效（讀圖 fallback 兜底），逐頁隔離由佔位語意保證。
  let parsed: string[] | null = null;
  try {
    const src = await core.deckAssets.getSourceAsset(deckId);
    if (src) {
      const kind: "pptx" | "pdf" =
        src.mime === "application/pdf" || src.mime.toLowerCase().includes("pdf") ? "pdf" : "pptx";
      parsed = await parseText(kind, src.bytes);
    }
  } catch (err) {
    console.warn(`[text-extract] deck ${deckId} 原檔抽字失敗（整份走讀圖）:`, err);
    parsed = null;
  }

  // 2) 數量守門（§11.2）：解析頁數 ≠ 原始頁（PNG）數 → 對齊無效，整份丟棄、一頁都不寫。
  if (parsed !== null && parsed.length !== originalCount) {
    console.warn(
      `[text-extract] deck ${deckId} 解析頁數 ${parsed.length} ≠ 原始頁數 ${originalCount}，對齊無效——整份逐頁文字丟棄，走讀圖 fallback`,
    );
    parsed = null;
  }

  // 3) 逐頁寫入（trim、每頁 8000 字上限）；不足門檻 → 讀圖候選（parser 抽出空＝留 NULL 交讀圖，
  //    §11.1 v1.4 三態——負結果標記只有讀圖有資格寫）。逐頁 try/catch 隔離。
  const minChars = textExtractMinChars();
  const visionIdx: number[] = [];
  for (const s of pending) {
    const text = (parsed !== null ? (parsed[s.idx] ?? "") : "").trim().slice(0, PAGE_TEXT_MAX_CHARS);
    if (text.length >= Math.max(1, minChars)) {
      try {
        await core.decks.setSlideTextExtract(orgId, deckId, s.idx, text);
      } catch (err) {
        console.warn(`[text-extract] deck ${deckId} p${s.idx} 文字落庫失敗（該頁留 NULL）:`, err);
      }
    } else {
      visionIdx.push(s.idx);
    }
  }

  // 4) 讀圖 fallback（§11.3）：硬上限＋並行池＋attempts=1；計費 kind='gemini_extract'。
  if (visionIdx.length === 0) return;
  if (!deps.gemini.isConfigured()) {
    console.warn(`[text-extract] deck ${deckId} 有 ${visionIdx.length} 頁需讀圖，但 GEMINI_API_KEY 未設定——全數留 NULL`);
    return;
  }
  const maxPages = visionMaxPages();
  let targets = visionIdx;
  if (targets.length > maxPages) {
    console.warn(
      `[text-extract] deck ${deckId} 讀圖候選 ${targets.length} 頁 > 上限 ${maxPages}，截斷 ${targets.length - maxPages} 頁（留 NULL）`,
    );
    targets = targets.slice(0, maxPages);
  }
  if (targets.length === 0) return;

  const client = deps.meter
    ? meteredGeminiClient(deps.gemini, deps.meter, {
        orgId,
        kind: "gemini_extract",
        userId: args.userId,
        idemPrefix: args.idemPrefix,
      })
    : deps.gemini;

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const idx = targets[cursor++]!;
      try {
        const png = await core.deckAssets.getPageImage(orgId, deckId, idx);
        if (!png) {
          console.warn(`[text-extract] deck ${deckId} p${idx} 無 page_image（留 NULL）`);
          continue;
        }
        const out = await client.generateJson<{ text?: unknown }>({
          model: deps.extractModel,
          prompt: VISION_PROMPT,
          schema: VISION_SCHEMA as unknown as Record<string, unknown>,
          images: [{ mimeType: "image/png", data: png.toString("base64") }],
          attempts: 1, // 失敗該頁留 NULL、不重試——enhancement 非關鍵路徑（§11.3）
          temperature: 0, // 逐字轉錄要確定性
          thinkingBudget: 0, // 純轉錄無需思考；避免 thinking 吃光輸出預算（gemini.ts:44 教訓）
        });
        if (typeof out?.text !== "string") {
          console.warn(`[text-extract] deck ${deckId} p${idx} 讀圖回應缺 text 欄位（該頁留 NULL）`);
          continue; // 失敗 ≠ 確認無字：不寫負標記，留 NULL 讓下一輪重試
        }
        // §11.1 v1.4 三態：讀圖回空＝「抽過、確認無字」→ 寫 ''（負結果標記）。不寫的話該頁永遠 NULL
        // → 每次回填都重付讀圖成本（永不收斂），且 slice(0,maxPages) 每輪取同批＝後面的頁永久飢餓。
        await core.decks.setSlideTextExtract(orgId, deckId, idx, out.text.trim().slice(0, PAGE_TEXT_MAX_CHARS));
      } catch (err) {
        console.warn(`[text-extract] deck ${deckId} p${idx} 讀圖失敗（該頁留 NULL）:`, err);
      }
    }
  };
  const pool = Math.min(Math.max(1, visionConcurrency()), targets.length);
  await Promise.all(Array.from({ length: pool }, () => worker()));
}
