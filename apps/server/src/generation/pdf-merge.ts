/**
 * mergePdf(originalPdf, supplementPdf) → 合併後 PDF Buffer（契約 §7 pdf 雙路匯出）。
 *
 * pdf-lib 載入原 PDF，把補充頁（已由 renderSupplementPdf 轉好的小 PDF）逐頁 copy 到**尾端**，save。
 * 原 PDF 的頁在前段原封保留、補充頁 append 在後——與 I1（只 append 尾端）一致。
 */
import { PDFDocument } from "pdf-lib";

export async function mergePdf(originalPdf: Buffer, supplementPdf: Buffer): Promise<Buffer> {
  // ignoreEncryption：容忍「僅檢視/輕度保護」的來源 PDF（能載入即可 append）。
  const orig = await PDFDocument.load(originalPdf, { ignoreEncryption: true });
  const sup = await PDFDocument.load(supplementPdf, { ignoreEncryption: true });

  const copied = await orig.copyPages(sup, sup.getPageIndices());
  for (const page of copied) orig.addPage(page);

  const bytes = await orig.save();
  return Buffer.from(bytes);
}
