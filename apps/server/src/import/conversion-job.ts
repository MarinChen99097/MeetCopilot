/**
 * 匯入轉檔背景 job（契約 §5）。由 import-handler fire-and-forget 啟動（不 await），錯誤全數收進
 * deck.import_status/import_error 與 import_jobs.status/error，永不拋回請求。
 *
 * 流程（getSourceAsset 為原檔權威查法，依 deckId 反查 deck_assets）：
 *   setJobStatus(running) → getSourceAsset → 依 mime 選 pptx/pdf 點陣化 → 逐頁：
 *     insertAsset(page_image) → appendSlide(image-full spec, {kind:'original', assetId}) →
 *   setOriginalCount(N) → setImportStatus(ready) → setJobStatus(done)。
 *   任一步失敗 → setImportStatus(failed, 人話) + setJobStatus(failed, 人話)。
 *
 * 原始頁 SlideSpec＝既有 `image-full` 模板 + 單一 image block，dataUri 落內部參照 `asset:<assetId>`
 * （getDeck route 讀出時才換成短效簽章 URL，不存死 URL）——重用既有 SlideRenderer 的 image-full 分支，零新模板。
 *
 * 主題（配色）：pptx 的基底 theme 已由 import-handler 在 deck **建立時**帶入 core.decks.create({ theme })
 * （凍結的 DeckRepository 無 setTheme，而原檔 bytes 於上傳時即在手，故在 create 落庫最省且型別安全）。本 job 不再另設 theme。
 */
import { randomUUID } from "node:crypto";
import type { CrmCore } from "@meetcopilot/crm";
import type { SlideSpec, SlideSource } from "@meetcopilot/shared";
import { rasterizePptxToImages, rasterizePdfToImages, RasterizeError } from "./deck-rasterize.js";

/**
 * 點陣化相依（可注入，供單元測試 mock，不必真的呼叫 soffice/pdftoppm）。
 * 預設＝真實 CLI wrapper；測試傳假的回傳固定 PNG buffer 以驗 job 狀態流轉與 spec 生成。
 */
export interface ConversionDeps {
  rasterizePptxToImages: (bytes: Buffer) => Promise<Buffer[]>;
  rasterizePdfToImages: (bytes: Buffer) => Promise<Buffer[]>;
}

const defaultDeps: ConversionDeps = { rasterizePptxToImages, rasterizePdfToImages };

/**
 * 原始頁 SlideSpec：`image-full` + 單一 image block（dataUri＝內部參照 `asset:<assetId>`）。
 * source 用實際來源（pptx/pdf）——SlideSource 聯集無 'import'，故不能用契約草稿的 `source:'import'`（見回報）。
 */
function buildImageFullSpec(assetId: string, source: SlideSource): SlideSpec {
  return {
    id: randomUUID(),
    template: "image-full",
    blocks: [{ type: "image", dataUri: `asset:${assetId}` }],
    source,
  };
}

/** 對外（deck.import_error）一律人話：已知的 RasterizeError 直接用其訊息；其餘（DB/未知）給通用中文，不外洩內部字串。 */
function humanError(err: unknown): string {
  if (err instanceof RasterizeError && err.message) return err.message;
  return "簡報轉檔失敗，請稍後再試或改用其他檔案";
}

/**
 * 執行一支轉檔 job。deps 預設用真實點陣化；deckId 為原檔/頁圖歸屬鍵，orgId 供 appendSlide/insertAsset 租戶欄。
 */
export async function runConversionJob(
  core: CrmCore,
  deckId: string,
  orgId: string,
  jobId: string,
  deps: ConversionDeps = defaultDeps,
): Promise<void> {
  try {
    await core.importJobs.setJobStatus(jobId, "running");

    const source = await core.deckAssets.getSourceAsset(deckId);
    if (!source) throw new RasterizeError("找不到原始檔，請重新匯入");

    const isPdf = source.mime === "application/pdf" || source.mime.toLowerCase().includes("pdf");
    const slideSource: SlideSource = isPdf ? "pdf" : "pptx";

    const images = isPdf
      ? await deps.rasterizePdfToImages(source.bytes)
      : await deps.rasterizePptxToImages(source.bytes);

    if (images.length === 0) throw new RasterizeError("檔案沒有可轉換的頁面");

    // 逐頁：存 page_image asset → 建 image-full 原始頁（前段鎖定，唯讀）。順序＝點陣化回傳的頁序。
    for (let i = 0; i < images.length; i++) {
      const png = images[i]!;
      const assetId = await core.deckAssets.insertAsset({
        deckId,
        orgId,
        kind: "page_image",
        pageIndex: i,
        mime: "image/png",
        bytes: png,
      });
      const spec = buildImageFullSpec(assetId, slideSource);
      await core.decks.appendSlide(orgId, deckId, spec, { kind: "original", assetId });
    }

    // 前段鎖定原始頁數＝N；isOriginal(i)=i<originalCount（前端唯一判定來源）。
    await core.decks.setOriginalCount(deckId, images.length);
    await core.decks.setImportStatus(deckId, "ready");
    await core.importJobs.setJobStatus(jobId, "done");
  } catch (err) {
    const human = humanError(err);
    console.error(`[import] conversion job ${jobId} (deck ${deckId}) failed:`, err);
    // 兩處狀態回寫各自 try/catch——即使一處寫失敗也盡力把另一處標 failed，避免前端卡在「轉檔中」。
    try {
      await core.decks.setImportStatus(deckId, "failed", human);
    } catch (e) {
      console.error(`[import] failed to persist import_status=failed for deck ${deckId}:`, e);
    }
    try {
      await core.importJobs.setJobStatus(jobId, "failed", human);
    } catch (e) {
      console.error(`[import] failed to persist job ${jobId} failed:`, e);
    }
  }
}
