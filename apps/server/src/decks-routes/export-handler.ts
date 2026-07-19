/**
 * GET /api/decks/:id/export 的 handler（契約 §7 匯出雙路）。
 *
 * 撈 deck+slides（補充頁＝kind='spec'）→ 依 deck.sourceKind 分派：
 *   - 'pptx'：0 補充頁→直接回原 pptx bytes；否則 renderSupplementPptx → mergePptx(原 pptx, 補充 pptx) → 可編 pptx。
 *   - 'pdf' ：0 補充頁→直接回原 pdf bytes；否則 renderSupplementPdf → mergePdf(原 pdf, 補充 pdf)（pdf-lib）→ pdf。
 *   - 'native'（無 source_asset）：現行全 pptxgenjs 重建（回退相容，等同既有 export.pptx）。
 * Content-Type/Content-Disposition（RFC5987 真標題＋副檔名）依 sourceKind 設定。
 *
 * **凍結掛法**：index.ts 以 router.get("/decks/:id/export", createExportDeckHandler(core, config, meter)) 掛載。
 * 既有 GET /decks/:id/export.pptx 由 index.ts 保留不動。
 */
import type { RequestHandler } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { SlideSpec } from "@meetcopilot/shared";
import type { AppConfig } from "../config.js";
import type { Meter } from "../ops/meter.js";
import { asyncHandler, orgId, param, notFound, contentDisposition } from "../crm-routes/helpers.js";
import { createPptxExporter } from "../generation/pptx-exporter.js";
import { renderSupplementPptx, renderSupplementPdf } from "../generation/supplement-render.js";
import { mergePptx } from "../generation/pptx-merge.js";
import { mergePdf } from "../generation/pdf-merge.js";
import { readPptxCanvasInches, readPdfCanvasInches } from "../generation/canvas-size.js";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PDF_MIME = "application/pdf";

export function createExportDeckHandler(core: CrmCore, _config: AppConfig, _meter?: Meter): RequestHandler {
  const pptxExporter = createPptxExporter();

  return asyncHandler(async (req, res) => {
    const oid = orgId(req);
    const deckId = param(req, "id");
    const found = await core.decks.findWithSlides(oid, deckId);
    if (!found) {
      notFound(res, "deck not found");
      return;
    }
    const { deck, slides } = found;
    // 補充頁＝kind='spec'（原始頁 kind='original' 不進渲染，改由原檔 bytes 提供）。
    const supplementSpecs: SlideSpec[] = slides.filter((s) => s.kind === "spec").map((s) => s.spec);

    try {
      if (deck.sourceKind === "pptx" || deck.sourceKind === "pdf") {
        const source = await core.deckAssets.getSourceAsset(deckId);
        if (!source) {
          // 原檔遺失（ready 態理論上必有原檔）→ 502 人話。
          res.status(502).json({ error: "原始檔遺失，無法匯出" });
          return;
        }
        const isPptx = deck.sourceKind === "pptx";
        let outBuf: Buffer;
        if (supplementSpecs.length === 0) {
          outBuf = source.bytes; // 0 補充頁：直接回原檔 bytes（不合併）。
        } else if (isPptx) {
          // 補充頁以原檔畫布尺寸（sldSz）產出 → 合併回原 pptx 不破版（讀不到尺寸則退回預設）。
          const canvas = (await readPptxCanvasInches(source.bytes)) ?? undefined;
          const sup = await renderSupplementPptx(supplementSpecs, canvas);
          outBuf = await mergePptx(source.bytes, sup);
        } else {
          // 補充頁以原 pdf 第一頁尺寸產出 → 接尾後與原頁同尺寸（讀不到尺寸則退回預設）。
          const canvas = (await readPdfCanvasInches(source.bytes)) ?? undefined;
          const sup = await renderSupplementPdf(supplementSpecs, canvas);
          outBuf = await mergePdf(source.bytes, sup);
        }
        res.setHeader("Content-Type", isPptx ? PPTX_MIME : PDF_MIME);
        res.setHeader("Content-Disposition", contentDisposition(deck.title, isPptx ? "pptx" : "pdf"));
        res.send(outBuf);
        return;
      }

      // native（無原檔）：現行全 pptxgenjs 重建（回退相容）。
      if (slides.length === 0) {
        res.status(409).json({ error: "deck has no slides to export" });
        return;
      }
      const buffer = await pptxExporter.export(
        deck,
        slides.map((s) => s.spec),
      );
      res.setHeader("Content-Type", PPTX_MIME);
      res.setHeader("Content-Disposition", contentDisposition(deck.title, "pptx"));
      res.send(buffer);
    } catch (err) {
      res.status(502).json({ error: `export failed: ${(err as Error).message}` });
    }
  });
}
