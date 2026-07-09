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
import { I1ViolationError, DeckNotFoundError } from "@meetcopilot/crm";
import type { DeckLanguage, GenerateDeckInput, SlideSpec, ImageKind, NewDeck } from "@meetcopilot/shared";
import {
  IMAGE_KINDS,
  MAX_DECK_PAGES,
  MIN_DECK_PAGES,
  SLIDE_TEMPLATES,
  extractSlideText,
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
import { detectLanguage } from "../import/detect-language.js";
import { asyncHandler, orgId, param, str, badRequest, notFound, isOneOf } from "../crm-routes/helpers.js";
import type { Meter } from "../ops/meter.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** 匯入解析（pptx/pdf → SlideSpec[]）在 worker thread 的逾時上限（契約 C2）；到期強制 terminate → 408。 */
const IMPORT_PARSE_TIMEOUT_MS = 30_000;
/** /extract-pdf 純文字抽取（供 grounding）的 worker 逾時；輸入較單純，用較短上限。 */
const PDF_EXTRACT_TIMEOUT_MS = 15_000;

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

/** Content-Disposition（RFC5987）：ASCII fallback + filename*（UTF-8 百分比編碼）。 */
function contentDisposition(title: string): string {
  const clean = title.replace(/[\r\n"\\]/g, "").trim() || "deck";
  const ascii = clean.replace(/[^\x20-\x7E]/g, "_").replace(/_+/g, "_").trim() || "deck";
  const encoded = encodeURIComponent(`${clean}.pptx`).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}.pptx"; filename*=UTF-8''${encoded}`;
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
        const deck = await generation.generateDeck(orgId(req), parsed.input);
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

  // ── POST /decks/import（multipart pptx/pdf → Deck） ──
  router.post(
    "/decks/import",
    upload.single("file"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        badRequest(res, "missing file (multipart field name: file)");
        return;
      }
      const name = file.originalname ?? "";
      const isPptx =
        /\.pptx$/i.test(name) ||
        file.mimetype === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      const isPdf = /\.pdf$/i.test(name) || file.mimetype === "application/pdf";
      if (!isPptx && !isPdf) {
        badRequest(res, "unsupported file type (only .pptx or .pdf)");
        return;
      }

      // 解析在可終止 worker thread 執行（契約 C2）：CPU 密集又可能被惡意輸入拖住，逾時強制 terminate，
      // 不卡死 express 請求執行緒。逾時 reject "匯入解析逾時" → 下方 catch 映射成 408。
      let slides: SlideSpec[];
      try {
        slides = await runInWorker<SlideSpec[]>(
          isPptx ? "pptx" : "pdf",
          file.buffer,
          IMPORT_PARSE_TIMEOUT_MS,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/逾時|timeout|timed out/i.test(msg)) {
          res.status(408).json({ error: "匯入解析逾時，請改用較小或較簡單的檔案" });
          return;
        }
        // 不外洩 worker/解析器內部訊息。
        res.status(502).json({ error: "檔案解析失敗，請確認檔案未毀損後再試" });
        return;
      }

      // 全空守門：解析成功但每一頁都掃不出任何文字（掃描/圖片型檔案）→ 422，不建立空殼 deck。
      if (slides.length === 0 || slides.every((s) => extractSlideText(s).trim() === "")) {
        res.status(422).json({ error: "檔案未擷取到可用內容（可能是掃描或純圖片型檔案）" });
        return;
      }

      const texts = slides.flatMap((s) => extractSlideText(s).split("\n")).filter(Boolean);
      const detected = detectLanguage(texts);
      const language: DeckLanguage = detected === "unknown" ? "zh-TW" : detected;
      const title = name.replace(/\.(pptx|pdf)$/i, "").trim() || "Imported deck";

      const deck = await core.decks.create(orgId(req), {
        title,
        language,
        source: isPptx ? "pptx" : "pdf",
        slides,
      });
      res.status(201).json(deck);
    }),
  );

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
      res.json({
        deck: { id: deck.id, title: deck.title, language: deck.language, committedIndex: deck.committedIndex },
        slides: slides.map((s) => s.spec),
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
      const { jobId } = await imageService.enqueue(oid, deckId, slideIndex, body.kind, prompt);
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

  // ── GET /decks/:id/export.pptx ──
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
      res.setHeader("Content-Disposition", contentDisposition(deck.title));
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
          res.status(422).json({ error: "source has no extractable text" });
          return;
        }
        res.json({ title, text });
      } catch (err) {
        res.status(422).json({ error: `url import failed: ${(err as Error).message}` });
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
