/**
 * POST /api/decks/import 的 handler（契約 §4 匯入流程）。
 *
 * 流程：修檔名編碼 → 依 magic bytes 判 pptx（zip PK + ppt/presentation.xml）/pdf（%PDF），非二者回 400 人話錯誤 →
 *   讀真標題（pptx: docProps/core.xml <dc:title> → 第一張 title placeholder；pdf: metadata Title；皆無用修正編碼後檔名去副檔名）→
 *   建 processing deck（core.decks.create；pptx 帶基底 theme 供補充頁配色）→ 存原檔 deck_assets(kind=source_*) →
 *   core.importJobs.enqueue → 背景啟動轉檔（fire-and-forget，不 await）→ 回 202 { deckId, jobId }。
 *
 * 掛法（index.ts 凍結）：`router.post("/decks/import", upload.single("file"), createImportDeckHandler(core, config, meter))`；
 *   multer memoryStorage + 50MB 上限在 index.ts。本檔只填內部、不動掛法簽名。
 *
 * 檔名編碼：index.ts 的 multer 未設 defParamCharset（凍結、不改），預設 'latin1' 會把中文檔名解成亂碼位元組——
 *   本檔以 `Buffer.from(name,'latin1').toString('utf8')` 還原（純 ASCII round-trip 不變）。
 *
 * source_asset_id：Deck domain 未表面化該欄、且 create 後無 setter，而原檔查法一律走
 *   `core.deckAssets.getSourceAsset(deckId)`（依 deck_id 反查），故建 deck 時不帶 sourceAssetId、於 create 後再存原檔即可。
 */
import type { RequestHandler } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { NewDeck, DeckLanguage, SlideTheme } from "@meetcopilot/shared";
import { PDFDocument } from "pdf-lib";
import type { AppConfig } from "../config.js";
import type { Meter } from "../ops/meter.js";
import { asyncHandler, orgId, userId } from "../crm-routes/helpers.js";
import { createGeminiClient } from "../gemini.js";
import { readPptxMeta } from "../import/pptx-parser.js";
import { runConversionJob } from "../import/conversion-job.js";
import { runTextExtract } from "../import/text-extract.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";

/** 還原 multer latin1 檔名 → utf8（修中文檔名亂碼）；壞資料退回原字串。 */
function fixOriginalName(name: string | undefined): string {
  if (!name) return "";
  try {
    return Buffer.from(name, "latin1").toString("utf8");
  } catch {
    return name;
  }
}

/** 去路徑 + 去副檔名，作為真標題缺省時的 fallback。 */
function stripExtension(name: string): string {
  const base = name.replace(/^.*[\\/]/, "");
  return base.replace(/\.[^.]+$/, "").trim();
}

/** magic bytes：%PDF（25 50 44 46）。 */
function startsWithPdf(b: Buffer): boolean {
  return b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
}

/** magic bytes：ZIP 本地檔頭 PK（50 4B）——pptx/docx/xlsx 皆為 zip，需再驗 presentation.xml。 */
function startsWithZip(b: Buffer): boolean {
  return b.length >= 2 && b[0] === 0x50 && b[1] === 0x4b;
}

/** pdf metadata Title（pdf-lib）；缺省/讀取失敗回 undefined（呼叫端用檔名 fallback）。 */
async function readPdfTitle(bytes: Buffer): Promise<string | undefined> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    const t = doc.getTitle();
    const trimmed = t?.trim();
    return trimmed && trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

/** 匯入語言：允許 multipart 附帶 language 欄（'zh-TW'|'en'），否則預設 'zh-TW'。 */
function coerceLanguage(v: unknown): DeckLanguage {
  return v === "en" ? "en" : "zh-TW";
}

export function createImportDeckHandler(
  core: CrmCore,
  config: AppConfig,
  meter?: Meter,
): RequestHandler {
  // C2 抽字階段（MEETING_CHECKLIST_CONTRACT §11）：base Gemini client 於工廠期建一次（config 不變）；
  // 計費（kind='gemini_extract'、orgId/userId、idemPrefix=textextract:${jobId}）在 runTextExtract 內包 metered client。
  const gemini = createGeminiClient(config.gemini);
  return asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      res.status(400).json({ error: "缺少檔案，請選擇要匯入的 .pptx 或 .pdf 檔案" });
      return;
    }
    const bytes = file.buffer;
    const originalName = fixOriginalName(file.originalname);
    const fallbackTitle = stripExtension(originalName) || "匯入簡報";
    const language = coerceLanguage((req.body as Record<string, unknown> | undefined)?.language);
    const oid = orgId(req);
    const uid = userId(req);

    // 判來源：magic bytes 為權威（副檔名不可信）。pptx 需 zip + ppt/presentation.xml 雙重確認（擋 docx/xlsx 誤判）。
    let sourceKind: "pptx" | "pdf";
    let mime: string;
    let title: string | undefined;
    let theme: SlideTheme | undefined;

    if (startsWithPdf(bytes)) {
      sourceKind = "pdf";
      mime = PDF_MIME;
      title = await readPdfTitle(bytes);
    } else if (startsWithZip(bytes)) {
      let meta;
      try {
        meta = await readPptxMeta(bytes);
      } catch {
        res.status(400).json({ error: "檔案無法讀取，請確認是有效的 .pptx 或 .pdf 檔案" });
        return;
      }
      if (!meta.isPresentation) {
        res.status(400).json({ error: "只支援 PowerPoint 簡報（.pptx）與 PDF（.pdf）檔案" });
        return;
      }
      sourceKind = "pptx";
      mime = PPTX_MIME;
      title = meta.title;
      if (meta.theme && Object.keys(meta.theme).length > 0) theme = meta.theme;
    } else {
      res.status(400).json({ error: "只支援 PowerPoint 簡報（.pptx）與 PDF（.pdf）檔案" });
      return;
    }

    const finalTitle = (title && title.trim()) || fallbackTitle;

    // 建 processing deck。pptx 的基底 theme 於此落庫（供補充頁配色；轉檔 job 端無 setTheme 可用）。
    const newDeck: NewDeck = {
      title: finalTitle,
      language,
      source: sourceKind,
      sourceKind,
      importStatus: "processing",
      originalCount: 0,
    };
    if (theme) newDeck.theme = theme;
    const deck = await core.decks.create(oid, newDeck);

    let jobId: string;
    try {
      // 存原檔 bytes（原封顯示/匯出的權威；conversion-job 與 export 皆以 getSourceAsset(deckId) 反查）。
      await core.deckAssets.insertAsset({
        deckId: deck.id,
        orgId: oid,
        kind: sourceKind === "pdf" ? "source_pdf" : "source_pptx",
        mime,
        bytes,
      });
      jobId = await core.importJobs.enqueue(deck.id, oid);
    } catch (err) {
      // create 後、enqueue 前失敗（罕見 DB 錯）：把 deck 標 failed，避免卡在「轉檔中」孤兒狀態，再拋回 500。
      await core.decks
        .setImportStatus(deck.id, "failed", "匯入初始化失敗，請重新匯入")
        .catch((e) => console.error("[import] failed to mark deck failed after enqueue error:", e));
      throw err;
    }

    // 背景啟動轉檔（fire-and-forget，不 await）：錯誤收進 deck.import_status/job，永不拋回請求。
    // extractText＝C2 抽字階段（§11.1）：conversion-job 於 ready 之後呼叫；失敗只 log，不影響匯入。
    // userId＝匯入者（§11.3 計費歸屬）；idemPrefix 帶 jobId（每次匯入唯一，頁間由 seq 區分）。
    void runConversionJob(core, deck.id, oid, jobId, {
      extractText: (args) =>
        runTextExtract(
          { core, gemini, meter, extractModel: config.gemini.extractModel },
          { orgId: args.orgId, deckId: args.deckId, userId: uid, idemPrefix: `textextract:${args.jobId}` },
        ),
    }).catch((err) => console.error("[import] runConversionJob crashed:", err));

    res.status(202).json({ deckId: deck.id, jobId });
  });
}
