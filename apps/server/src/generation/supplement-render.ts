/**
 * 補充頁渲染（契約 §7）：把 append 的補充頁 SlideSpec[] 當一份小 deck 渲染成 pptx / pdf buffer，
 * 供 export-handler 嫁接（pptx-merge）／接尾（pdf-merge）回原檔。
 *
 * - renderSupplementPptx：直接重用既有 pptx-render.exportDeckToPptx（螢幕↔匯出配色一致；設計版型）。
 * - renderSupplementPdf ：先產小 pptx，再用 **LibreOffice soffice**（--convert-to pdf）包一層 pptx→pdf。
 *
 * 為何選 soffice 而非 chromium 列印（契約 §7/§11 二選一）：
 *   (1) 契約明列優先 soffice；(2) image 已為顯示轉圖裝了 LibreOffice（poppler+libreoffice-impress，
 *       見 Dockerfile.server / 契約 §8），不必再引入 chromium 列印路徑；(3) 補充頁走 exportDeckToPptx →
 *       soffice，與 pptx 路徑用同一份 pptx 渲染，補充頁在兩路（pptx/pdf）視覺完全一致。
 *
 * 執行期依賴：renderSupplementPdf 需執行環境有 `soffice`（Docker image 內；WP-DOCKER 的 apt 層提供）。
 *   本機無 soffice 時會丟明確錯誤，由 export-handler 對映成 502。mergePptx/mergePdf 的單元測試不經此路徑。
 *
 * 唯讀 FS 相容（Cloud Run）：所有暫存寫 os.tmpdir()（/tmp，tmpfs）；每次唯一 profile 目錄，收工刪。
 * 隔離（多併發）：每次 soffice 用獨立 UserInstallation + HOME/XDG_CACHE_HOME（fontconfig cache），避免互踩。
 */
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SlideSpec } from "@meetcopilot/shared";
import { exportDeckToPptx } from "./pptx-render.js";
import type { CanvasInches } from "./canvas-size.js";
import { childEnv, sofficePptxToPdf } from "../import/deck-rasterize.js";

/** pptx→pdf 逾時（ms）；補充頁通常僅數頁，90s 綽綽有餘。可用 env 調。 */
const PDF_TIMEOUT_MS = Number(process.env.SUPPLEMENT_PDF_TIMEOUT_MS) || 90_000;

/**
 * 補充頁 SlideSpec[] → 小 pptx buffer（重用設計版型渲染）。
 * `canvas`（吋，來自原檔 sldSz）可選：以原檔畫布尺寸產出補充頁 → 合併回原檔不破版；省略＝預設 10×5.625。
 */
export async function renderSupplementPptx(specs: SlideSpec[], canvas?: CanvasInches): Promise<Buffer> {
  // 補充頁當一份獨立小 deck；title/language 僅供 pptx 內部 metadata，不影響嫁接。
  return exportDeckToPptx({ title: "supplement", language: "zh-TW" }, specs, canvas);
}

/**
 * 補充頁 SlideSpec[] → 小 pdf buffer（先 pptx 再 soffice 轉 pdf）。
 * `canvas`（吋，來自原 pdf 第一頁尺寸）可選：補充 pptx 以同尺寸產出 → soffice→pdf 後與原頁同尺寸。
 */
export async function renderSupplementPdf(specs: SlideSpec[], canvas?: CanvasInches): Promise<Buffer> {
  const pptx = await renderSupplementPptx(specs, canvas);
  return convertPptxToPdf(pptx);
}

/**
 * pptx buffer → pdf buffer。委派 deck-rasterize 的共用 soffice 原始步驟（sofficePptxToPdf）——
 * 單一 profile 隔離 / childEnv（HOME/XDG/TMPDIR）/ SIGKILL 逾時 / ENOENT→人話 RasterizeError，
 * 與匯入點陣化路徑共用一份實作，不再各自 hand-roll execFile（唯讀 FS / 併發安全同源）。
 */
async function convertPptxToPdf(pptx: Buffer): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), "mcsuppdf-"));
  try {
    const env = childEnv(workDir);
    const inPath = path.join(workDir, "supplement.pptx");
    await writeFile(inPath, pptx);
    const pdfPath = await sofficePptxToPdf(inPath, workDir, env, PDF_TIMEOUT_MS);
    return await readFile(pdfPath);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
