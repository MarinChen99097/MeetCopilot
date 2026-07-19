/**
 * 讀原始檔的畫布尺寸（吋），供補充頁以**相同尺寸**產出（缺陷修正：不再寫死 10×5.625）。
 * 補充頁座標為絕對 EMU（pptx）／point（pdf）——若尺寸與原檔不符，合併回原檔會只佔左上一角而破版。
 *
 * - pptx：讀 ppt/presentation.xml 的 <p:sldSz cx cy>（EMU）÷ 914400。
 * - pdf ：pdf-lib 讀第 0 頁 getSize()（point）÷ 72。
 * 讀不到/異常一律回 null → 呼叫端退回 exportDeckToPptx 的預設尺寸（不致命）。
 */
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";

const EMU_PER_INCH = 914400;
const PT_PER_INCH = 72;

/** 匯出/渲染共用的畫布尺寸（吋）。 */
export interface CanvasInches {
  widthInches: number;
  heightInches: number;
}

/** 讀原 pptx 的畫布尺寸（吋）：ppt/presentation.xml 的 <p:sldSz cx cy>。讀不到回 null。 */
export async function readPptxCanvasInches(pptxBytes: Buffer): Promise<CanvasInches | null> {
  try {
    const zip = await JSZip.loadAsync(pptxBytes);
    const f = zip.file("ppt/presentation.xml");
    if (!f) return null;
    const xml = await f.async("string");
    // 先鎖定 <p:sldSz .../> 標籤本身，再取其 cx/cy——避免誤取 presentation.xml 內另有的 <p:notesSz>。
    const tag = xml.match(/<p:sldSz\b[^>]*\/?>/)?.[0];
    if (!tag) return null;
    const cx = Number(tag.match(/\bcx="(\d+)"/)?.[1]);
    const cy = Number(tag.match(/\bcy="(\d+)"/)?.[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || cx <= 0 || cy <= 0) return null;
    return { widthInches: cx / EMU_PER_INCH, heightInches: cy / EMU_PER_INCH };
  } catch {
    return null;
  }
}

/** 讀原 pdf 的畫布尺寸（吋）：第 0 頁 getSize()（point）÷ 72。讀不到回 null。 */
export async function readPdfCanvasInches(pdfBytes: Buffer): Promise<CanvasInches | null> {
  try {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    if (doc.getPageCount() === 0) return null;
    const { width, height } = doc.getPage(0).getSize();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    return { widthInches: width / PT_PER_INCH, heightInches: height / PT_PER_INCH };
  } catch {
    return null;
  }
}
