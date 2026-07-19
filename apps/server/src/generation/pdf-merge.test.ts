/**
 * pdf-merge 單元測試（契約 §10 驗收）：合併後
 *  - 頁數 = 原 + 補充
 *  - 補充頁 append 在尾端（以不同頁面尺寸驗證前段為原、後段為補充）
 */
import { describe, it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { mergePdf } from "./pdf-merge.js";
import { readPdfCanvasInches } from "./canvas-size.js";

async function makePdf(n: number, w: number, h: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) {
    const p = doc.addPage([w, h]);
    p.drawText(`page ${i}`, { x: 20, y: h - 40, size: 12 });
  }
  return Buffer.from(await doc.save());
}

describe("mergePdf", () => {
  it("appends supplement pages to the tail; count = original + supplement", async () => {
    const orig = await makePdf(3, 600, 400);
    const sup = await makePdf(2, 300, 300);

    const merged = await mergePdf(orig, sup);
    const doc = await PDFDocument.load(merged);
    const pages = doc.getPages();

    expect(doc.getPageCount()).toBe(5);
    // 前 3 頁＝原（600×400）；後 2 頁＝補充（300×300）——驗證原頁在前、補充 append 尾端。
    for (let i = 0; i < 3; i++) {
      expect(Math.round(pages[i]!.getWidth())).toBe(600);
      expect(Math.round(pages[i]!.getHeight())).toBe(400);
    }
    for (let i = 3; i < 5; i++) {
      expect(Math.round(pages[i]!.getWidth())).toBe(300);
      expect(Math.round(pages[i]!.getHeight())).toBe(300);
    }
  });

  it("single supplement page → count = original + 1", async () => {
    const orig = await makePdf(4, 600, 400);
    const sup = await makePdf(1, 600, 400);
    const merged = await mergePdf(orig, sup);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(5);
  });

  it("reads original pdf canvas (13.333×7.5) so supplement can be produced at the same size", async () => {
    // 原 pdf＝寬螢幕 13.333"×7.5" = 960×540 pt（非 10×5.625 的 720×405）。
    const WIDE_W = Math.round(13.333 * 72); // 960
    const WIDE_H = Math.round(7.5 * 72); // 540
    const orig = await makePdf(3, WIDE_W, WIDE_H);

    // export-handler 路徑：讀原檔第一頁尺寸 → 供補充頁以同尺寸產出。
    const canvas = await readPdfCanvasInches(orig);
    expect(canvas).not.toBeNull();
    expect(canvas!.widthInches).toBeCloseTo(WIDE_W / 72, 3);
    expect(canvas!.heightInches).toBeCloseTo(WIDE_H / 72, 3);

    // 模擬 renderSupplementPdf 以原尺寸（吋×72＝pt）產補充頁 → 補充頁與原頁同尺寸。
    const supW = Math.round(canvas!.widthInches * 72);
    const supH = Math.round(canvas!.heightInches * 72);
    const sup = await makePdf(1, supW, supH);

    const merged = await mergePdf(orig, sup);
    const doc = await PDFDocument.load(merged);
    expect(doc.getPageCount()).toBe(4);
    const pages = doc.getPages();
    // 尾端補充頁與原頁同尺寸（不被塞成 10×5.625 的 720×405）。
    expect(Math.round(pages[3]!.getWidth())).toBe(WIDE_W);
    expect(Math.round(pages[3]!.getHeight())).toBe(WIDE_H);
  });
});
