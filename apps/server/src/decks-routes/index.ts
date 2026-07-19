/**
 * Decks / DynamicSlide 路由（API_CONTRACT §4）。掛在 /api、authRequired 之後（見 src/index.ts），
 * 故每個 handler 都有 req.auth，租戶由 req.auth.orgId 推導（前端永不傳 orgId）。
 *
 *   GET    /decks                         → {items:DeckSummary[], total}
 *   POST   /decks                         → 201 Deck（手動建立空 deck；CRUD 超集）
 *   POST   /decks/generate                → 201 Deck（wizard 生成）
 *   POST   /decks/import   (multipart)    → 201 Deck（pptx/pdf → SlideSpec[]）
 *   GET    /decks/:id                     → {deck:DeckRef, slides:SlideSpec[]}
 *   PATCH  /decks/:id/slides/:index       → {slide}（會前/pending 編輯；違反 I1 → 409）
 *   DELETE /decks/:id                     → 204
 *   POST   /decks/:id/image-jobs          → 202 {jobId}（pre-meeting 生圖）
 *   GET    /image-jobs/:id                → ImageJobView
 *   GET    /decks/:id/export.pptx         → .pptx 下載（RFC5987 檔名）
 *   POST   /extract-url                   → {title?, text}（wizard grounding；SSRF-guarded）
 *   POST   /extract-pdf    (multipart)    → {text}
 *
 * I1（append-only）權威守門在 DeckRepository（updateSlide → I1ViolationError）；此層把它對映成 409。
 */
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import type { CrmCore } from "@meetcopilot/crm";
import { I1ViolationError, DeckNotFoundError, OriginalSlideLockedError } from "@meetcopilot/crm";
import type { GenerateDeckInput, SlideSpec, SlideBlock, ImageKind, NewDeck } from "@meetcopilot/shared";
import {
  IMAGE_KINDS,
  MAX_DECK_PAGES,
  MIN_DECK_PAGES,
  SLIDE_TEMPLATES,
  type SlideTemplate,
} from "@meetcopilot/shared";
import type { AppConfig } from "../config.js";
import { createGeminiClient } from "../gemini.js";
import { OpenAIImageProvider } from "../providers/image.js";
import { createGenerationService, GenerationEmptyError } from "../generation/generation-service.js";
import { createPptxExporter } from "../generation/pptx-exporter.js";
import { createImageService } from "../decks/image-service.js";
import { extractFromUrl } from "../import/extract.js";
import { runInWorker } from "../import/run-in-worker.js";
import {
  asyncHandler,
  orgId,
  userId,
  param,
  str,
  badRequest,
  notFound,
  isOneOf,
  contentDisposition,
} from "../crm-routes/helpers.js";
import type { Meter } from "../ops/meter.js";
import { signAssetUrl } from "../lib/signed-url.js";
import { createImportDeckHandler } from "./import-handler.js";
import { createExportDeckHandler } from "./export-handler.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** /extract-pdf 純文字抽取（供 grounding）的 worker 逾時；輸入較單純，用較短上限。 */
const PDF_EXTRACT_TIMEOUT_MS = 15_000;

/** 原始頁 SlideSpec 內部參照前綴：落庫存 `asset:<assetId>`，getDeck 讀出時換成當下簽章 URL（不存死 URL）。 */
const ASSET_REF_PREFIX = "asset:";

/**
 * 遞迴把 SlideBlock 內的 `asset:<assetId>` 圖片參照換成短效簽章 URL（僅 image block；two-col 遞迴進子區塊）。
 * 匯入原始頁的 spec 存內部參照，讀取時動態簽——避免落庫過期 URL（契約 §3 注入點＝route 層）。
 */
function resolveBlockAssetRefs(block: SlideBlock, deckId: string): SlideBlock {
  if (block.type === "image" && block.dataUri.startsWith(ASSET_REF_PREFIX)) {
    const assetId = block.dataUri.slice(ASSET_REF_PREFIX.length);
    return { ...block, dataUri: signAssetUrl(deckId, assetId) };
  }
  if (block.type === "two-col") {
    return {
      ...block,
      left: block.left.map((b) => resolveBlockAssetRefs(b, deckId)),
      right: block.right.map((b) => resolveBlockAssetRefs(b, deckId)),
    };
  }
  return block;
}

/** 對整張 SlideSpec 做 asset-ref → 簽章 URL 置換（回新物件，不 mutate）。 */
function resolveSpecAssetRefs(spec: SlideSpec, deckId: string): SlideSpec {
  return { ...spec, blocks: spec.blocks.map((b) => resolveBlockAssetRefs(b, deckId)) };
}

const DECK_LANGUAGES = ["zh-TW", "en"] as const;
const OBJECTIVES = ["pitch", "introduce", "fundraise", "report", "training"] as const;

/** 把任意輸入窄化成 string[]（過濾非字串）；非陣列回 undefined。 */
function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : undefined;
}

/** 解析並驗證 wizard 生成輸入（GenerateDeckInput）；不合法回 {error}。 */
function parseGenerateInput(body: Record<string, unknown>): { input: GenerateDeckInput } | { error: string } {
  const topic = str(body.topic);
  if (!topic) return { error: "topic is required" };
  const pagesNum = Math.trunc(Number(body.pages));
  if (!Number.isFinite(pagesNum) || pagesNum < MIN_DECK_PAGES || pagesNum > MAX_DECK_PAGES) {
    return { error: `pages must be an integer between ${MIN_DECK_PAGES} and ${MAX_DECK_PAGES}` };
  }
  if (!isOneOf(body.language, DECK_LANGUAGES)) return { error: "language must be 'zh-TW' or 'en'" };

  const input: GenerateDeckInput = { topic, pages: pagesNum, language: body.language };
  if (isOneOf(body.objective, OBJECTIVES)) input.objective = body.objective;
  const keyPoints = strArray(body.keyPoints);
  if (keyPoints) input.keyPoints = keyPoints;
  const metrics = strArray(body.metrics);
  if (metrics) input.metrics = metrics;
  if (str(body.audience)) input.audience = str(body.audience);
  if (str(body.tone)) input.tone = str(body.tone);
  if (str(body.style)) input.style = str(body.style);
  if (typeof body.logoDataUri === "string") input.logoDataUri = body.logoDataUri;
  const refs = strArray(body.refImageDataUris);
  if (refs) input.refImageDataUris = refs;
  if (typeof body.sourceText === "string") input.sourceText = body.sourceText.slice(0, 12000);
  if (str(body.companyId)) input.companyId = str(body.companyId);
  return { input };
}

/** 最小 SlideSpec 結構驗證（會前編輯 PATCH）；回 null 代表不合法。 */
function coerceSlideSpec(raw: unknown): SlideSpec | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!SLIDE_TEMPLATES.includes(obj.template as SlideTemplate)) return null;
  if (!Array.isArray(obj.blocks)) return null;
  const source = obj.source === "pptx" || obj.source === "pdf" || obj.source === "ai" ? obj.source : "ai";
  return {
    ...(obj as unknown as SlideSpec),
    id: typeof obj.id === "string" && obj.id ? obj.id : randomUUID(),
    template: obj.template as SlideTemplate,
    source,
  };
}

/**
 * 把 extractFromUrl 丟出的技術錯誤映成「人話」中文＋合適狀態碼（P2：網址匯入錯誤分案）。
 * 四類分案：來源限流 / 被擋（內網·拒絕存取）/ 逾時 / 格式不符；其餘走通用可行動 fallback。
 * 一律不外洩上游原始開發字串（去掉舊的 `url import failed:` 前綴）。
 */
function classifyExtractError(err: unknown): { status: number; error: string } {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  const name = err instanceof Error ? err.name : "";
  // 來源限流（429/503）
  if (/限流|\b429\b|\b503\b/.test(msg)) {
    return { status: 429, error: "無法匯入：來源網站暫時限流，請稍等幾分鐘後再試，或改用其他來源。" };
  }
  // 被擋——內部/保留位址（SSRF 守門）
  if (/內部|保留位址|解析到內部/.test(msg)) {
    return { status: 422, error: "無法匯入：這看起來是內部或保留網路位址，請改用可公開存取的完整網頁網址。" };
  }
  // 被擋——來源網站拒絕存取（401/403/451）
  if (/來源回應\s*(401|403|451)/.test(msg)) {
    return {
      status: 422,
      error: "無法匯入：來源網站拒絕存取（可能有防爬蟲保護或需登入），請改用其他公開來源，或直接把內文貼到下方來源文字。",
    };
  }
  // 逾時（總預算 abort / DNS 逾時）
  if (name === "AbortError" || /逾時|timeout|timed out|aborted/i.test(msg)) {
    return { status: 504, error: "無法匯入：連線逾時，來源網站回應太慢，請稍後再試或改用其他來源。" };
  }
  // 來源伺服器錯誤（5xx）
  if (/來源回應\s*5\d\d/.test(msg)) {
    return { status: 502, error: "無法匯入：來源網站目前發生錯誤，請稍後再試或改用其他來源。" };
  }
  // 格式不符——非網頁內容型別 / 非 http(s) / 無法解析網域 / 網頁過大 / 重導異常
  if (/不支援的內容型別|只允許 http|無法解析網域|網頁過大|重導/.test(msg)) {
    return {
      status: 422,
      error: "無法匯入：這個網址不是可讀取的網頁（或格式不支援），請確認是公開網頁的完整網址（含 https://）。",
    };
  }
  // 其餘：通用可行動 fallback（不外洩原始訊息）
  return { status: 422, error: "無法匯入：抓取失敗，請確認網址正確、頁面可公開存取後再試。" };
}

export function createDecksRouter(core: CrmCore, config: AppConfig, meter?: Meter): Router {
  const router = Router();
  const gemini = createGeminiClient(config.gemini);
  const generation = createGenerationService(core, gemini, config.gemini.extractModel, meter);
  const pptxExporter = createPptxExporter();
  const imageService = createImageService(
    core,
    new OpenAIImageProvider(config.openai),
    meter,
    config.openai.imageModel,
  );

  // ── GET /decks ──
  router.get(
    "/decks",
    asyncHandler(async (req, res) => {
      const items = await core.decks.list(orgId(req));
      res.json({ items, total: items.length });
    }),
  );

  // ── POST /decks（手動建立空 deck；CRUD 超集，非 §4 明列但 repo 支援） ──
  router.post(
    "/decks",
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const title = str(body.title);
      if (!title) {
        badRequest(res, "title is required");
        return;
      }
      if (!isOneOf(body.language, DECK_LANGUAGES)) {
        badRequest(res, "language must be 'zh-TW' or 'en'");
        return;
      }
      const input: NewDeck = { title, language: body.language, source: "ai" };
      if (str(body.companyId)) input.companyId = str(body.companyId);
      const deck = await core.decks.create(orgId(req), input);
      res.status(201).json(deck);
    }),
  );

  // ── POST /decks/generate ──
  router.post(
    "/decks/generate",
    asyncHandler(async (req, res) => {
      const parsed = parseGenerateInput((req.body ?? {}) as Record<string, unknown>);
      if ("error" in parsed) {
        badRequest(res, parsed.error);
        return;
      }
      if (!gemini.isConfigured()) {
        res.status(502).json({ error: "GEMINI_API_KEY not configured — cannot generate deck" });
        return;
      }
      try {
        const deck = await generation.generateDeck(orgId(req), parsed.input, userId(req));
        res.status(201).json(deck);
      } catch (err) {
        // C1：一律 server-side 記錄真實錯誤；回應絕不外洩上游原始訊息（可能含 prompt/內部細節）。
        console.error("[decks/generate] generation failed:", err);
        if (err instanceof GenerationEmptyError) {
          res.status(422).json({ error: "生成結果為空，請調整主題或增加頁數後再試" });
          return;
        }
        // 狀態優先：真正的限流（ApiError 帶數字 .status 429/503，或訊息含 RESOURCE_EXHAUSTED/quota）→ 429。
        const status = (err as { status?: unknown }).status;
        const msg = err instanceof Error ? err.message : String(err);
        if (status === 429 || status === 503 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) {
          res.status(429).json({ error: "AI 服務暫時限流，請稍後再試" });
        } else if (/finishReason=(?:SAFETY|RECITATION)|安全性|recitation/i.test(msg)) {
          res.status(422).json({ error: "內容可能觸發安全性限制，請調整主題或用語後再試" });
        } else if (/MAX_TOKENS/i.test(msg)) {
          res.status(422).json({ error: "輸出過長，請減少頁數或精簡輸入後再試" });
        } else if (/finishReason/i.test(msg)) {
          // 非 MAX_TOKENS 的異常結束（OTHER / MALFORMED_FUNCTION_CALL 等）：不要誤標「輸出過長」。
          res.status(422).json({ error: "生成未正常結束，請調整輸入後再試" });
        } else {
          // 其餘（含解析失敗、空回應、網路類）→ 502 通用 zh-TW，不回傳原始訊息。
          res.status(502).json({ error: "AI 服務暫時無法生成簡報，請稍後再試" });
        }
      }
    }),
  );

  // ── POST /decks/import（multipart pptx/pdf → 202 {deckId, jobId}；轉檔背景 job） ──
  // 匯入重構（契約 §4）：實作在 ./import-handler（WP-IMPORT）。此處只負責掛法：memoryStorage multer（50MB）
  // + 免解析的 handler 工廠。舊「解析文字建 deck」路徑已廢除（保存原檔 bytes、原封顯示/匯出）。
  router.post("/decks/import", upload.single("file"), createImportDeckHandler(core, config, meter));

  // ── GET /decks/:id ──
  router.get(
    "/decks/:id",
    asyncHandler(async (req, res) => {
      const found = await core.decks.findWithSlides(orgId(req), param(req, "id"));
      if (!found) {
        notFound(res, "deck not found");
        return;
      }
      const { deck, slides } = found;
      // 018：deck 頭帶新欄（sourceKind/originalCount/importStatus/importError）；前端據 originalCount 判 isOriginal。
      // 原始頁 spec 內的 `asset:<assetId>` 圖片參照在此換成當下短效簽章 URL（deck JSON 保持輕、不含 base64）。
      res.json({
        deck: {
          id: deck.id,
          title: deck.title,
          language: deck.language,
          committedIndex: deck.committedIndex,
          sourceKind: deck.sourceKind,
          originalCount: deck.originalCount,
          importStatus: deck.importStatus,
          ...(deck.importError ? { importError: deck.importError } : {}),
        },
        slides: slides.map((s) => resolveSpecAssetRefs(s.spec, deck.id)),
      });
    }),
  );

  // ── PATCH /decks/:id/slides/:index（會前/pending 編輯；I1 → 409） ──
  router.patch(
    "/decks/:id/slides/:index",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const deckId = param(req, "id");
      const index = Math.trunc(Number(param(req, "index")));
      if (!Number.isInteger(index) || index < 0) {
        badRequest(res, "index must be a non-negative integer");
        return;
      }
      const spec = coerceSlideSpec((req.body ?? {}).slide);
      if (!spec) {
        badRequest(res, "slide must be a valid SlideSpec (template + blocks)");
        return;
      }
      try {
        const saved = await core.decks.updateSlide(oid, deckId, index, spec);
        res.json({ slide: saved.spec });
      } catch (err) {
        // 018：原始簡報頁鎖定唯讀 → 409（人話）。與 I1（已播頁）並存，兩者皆 409。
        if (err instanceof OriginalSlideLockedError) {
          res.status(409).json({ error: "原始簡報頁不可編輯" });
          return;
        }
        if (err instanceof I1ViolationError) {
          res.status(409).json({ error: err.message });
          return;
        }
        if (err instanceof DeckNotFoundError) {
          notFound(res, err.message);
          return;
        }
        throw err;
      }
    }),
  );

  // ── DELETE /decks/:id（CRUD 超集） ──
  router.delete(
    "/decks/:id",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const existing = await core.decks.findById(oid, param(req, "id"));
      if (!existing) {
        notFound(res, "deck not found");
        return;
      }
      await core.decks.delete(oid, param(req, "id"));
      res.status(204).end();
    }),
  );

  // ── POST /decks/:id/image-jobs（pre-meeting 生圖） ──
  router.post(
    "/decks/:id/image-jobs",
    asyncHandler(async (req, res) => {
      const oid = orgId(req);
      const deckId = param(req, "id");
      const deck = await core.decks.findById(oid, deckId);
      if (!deck) {
        notFound(res, "deck not found");
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slideIndex = Math.trunc(Number(body.slideIndex));
      if (!Number.isInteger(slideIndex) || slideIndex < 0) {
        badRequest(res, "slideIndex must be a non-negative integer");
        return;
      }
      if (!isOneOf<ImageKind>(body.kind, IMAGE_KINDS)) {
        badRequest(res, "kind must be 'background' or 'full'");
        return;
      }
      if (!config.openai.apiKey) {
        res.status(502).json({ error: "OPENAI_API_KEY not configured — cannot generate images" });
        return;
      }
      const prompt = str(body.prompt);
      const { jobId } = await imageService.enqueue(oid, deckId, slideIndex, body.kind, prompt, userId(req));
      res.status(202).json({ jobId });
    }),
  );

  // ── GET /image-jobs/:id ──
  router.get(
    "/image-jobs/:id",
    asyncHandler(async (req, res) => {
      const job = await core.decks.findImageJob(orgId(req), param(req, "id"));
      if (!job) {
        notFound(res, "image job not found");
        return;
      }
      res.json({ status: job.status, dataUri: job.dataUri, error: job.error });
    }),
  );

  // ── GET /decks/:id/export（雙路匯出：副檔名依 source_kind；契約 §7） ──
  // 匯入重構：實作在 ./export-handler（WP-EXPORT）。既有 GET /decks/:id/export.pptx 保留不動（下方；既有前端不破）。
  router.get("/decks/:id/export", createExportDeckHandler(core, config, meter));

  // ── GET /decks/:id/export.pptx（既有；native/全 pptxgenjs 路徑，保留相容） ──
  router.get(
    "/decks/:id/export.pptx",
    asyncHandler(async (req, res) => {
      const found = await core.decks.findWithSlides(orgId(req), param(req, "id"));
      if (!found) {
        notFound(res, "deck not found");
        return;
      }
      const { deck, slides } = found;
      if (slides.length === 0) {
        res.status(409).json({ error: "deck has no slides to export" });
        return;
      }
      let buffer: Buffer;
      try {
        buffer = await pptxExporter.export(deck, slides.map((s) => s.spec));
      } catch (err) {
        res.status(502).json({ error: `export failed: ${(err as Error).message}` });
        return;
      }
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      res.setHeader("Content-Disposition", contentDisposition(deck.title, "pptx"));
      res.send(buffer);
    }),
  );

  // ── POST /extract-url（wizard grounding；SSRF-guarded in import/extract） ──
  router.post(
    "/extract-url",
    asyncHandler(async (req, res) => {
      const url = str((req.body ?? {}).url);
      if (!url) {
        badRequest(res, "url is required");
        return;
      }
      try {
        const { title, text } = await extractFromUrl(url);
        if (!text.trim()) {
          res
            .status(422)
            .json({ error: "無法匯入：這個頁面沒有可擷取的文字內容（可能是圖片或需登入的頁面）。" });
          return;
        }
        res.json({ title, text });
      } catch (err) {
        const { status, error } = classifyExtractError(err);
        res.status(status).json({ error });
      }
    }),
  );

  // ── POST /extract-pdf（multipart → text；wizard grounding，非 1:1 匯入） ──
  router.post(
    "/extract-pdf",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      if (!req.file) {
        badRequest(res, "missing file (multipart field name: file)");
        return;
      }
      try {
        // 純文字抽取同樣走可終止 worker（契約 C2）：pdf-parse 對惡意 PDF 可能拖住 CPU。
        const { text } = await runInWorker<{ text: string }>(
          "pdf-extract",
          req.file.buffer,
          PDF_EXTRACT_TIMEOUT_MS,
        );
        res.json({ text });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/逾時|timeout|timed out/i.test(msg)) {
          res.status(408).json({ error: "PDF 解析逾時，請改用較小的檔案" });
          return;
        }
        res.status(422).json({ error: "PDF 匯入失敗，請確認檔案為可擷取文字的 PDF" });
      }
    }),
  );

  return router;
}
