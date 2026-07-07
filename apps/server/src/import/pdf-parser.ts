/**
 * PDF → SlideSpec[] 解析器（純函式，無 DB／無網路）。借 v1 import/parsers/pdf.ts，重寫對齊 v2。
 * 逐頁切分：優先 pagerender callback 精確逐頁；失敗退回整份文字以 \f 分頁。
 * 無可擷取文字的頁（掃描/圖片型）留空 blocks，只在 notes 標記（不塞可見標題）。
 */
import { randomUUID } from "node:crypto";
import type { SlideBlock, SlideSpec, SlideTemplate } from "@meetcopilot/shared";
// pdf-parse 為 ambient any（types/pdf-parse.d.ts）；default import 取可呼叫函式（同 extract.ts 手法）。
import pdfParse from "pdf-parse";

interface PdfTextItem {
  str: string;
  transform: number[];
}
interface PdfTextContent {
  items: PdfTextItem[];
}
interface PdfPageData {
  getTextContent(options?: { normalizeWhitespace?: boolean; disableCombineTextItems?: boolean }): Promise<PdfTextContent>;
}

/** 依同一 Y 座標判斷是否同一行，組出該頁的純文字（換行分隔）。 */
function renderPageText(content: PdfTextContent): string {
  let lastY: number | undefined;
  let text = "";
  for (const item of content.items) {
    const y = item.transform[5];
    if (lastY === undefined || lastY === y) {
      text += item.str;
    } else {
      text += "\n" + item.str;
    }
    lastY = y;
  }
  return text;
}

export async function parsePdf(buffer: Buffer): Promise<SlideSpec[]> {
  const pageTexts: string[] = [];

  const pagerender = (pageData: PdfPageData): Promise<string> =>
    pageData
      .getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
      .then((content) => {
        const text = renderPageText(content);
        pageTexts.push(text);
        return text;
      });

  let fullText = "";
  try {
    const data = await pdfParse(buffer, { pagerender });
    fullText = data?.text ?? "";
  } catch {
    pageTexts.length = 0;
    const data = await pdfParse(buffer);
    fullText = data?.text ?? "";
  }

  const pages: string[] = pageTexts.length > 0 ? pageTexts : fullText.length > 0 ? fullText.split("\f") : [];

  return pages.map((pageText, i) => {
    const lines = pageText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const blocks: SlideBlock[] = [];
    if (lines.length > 0) {
      blocks.push({ type: "heading", text: lines[0]! });
      const rest = lines.slice(1);
      if (rest.length > 1) {
        blocks.push({ type: "bullets", items: rest });
      } else if (rest.length === 1) {
        blocks.push({ type: "paragraph", text: rest[0]! });
      }
    }

    const template: SlideTemplate = i === 0 ? "title" : "content";
    return {
      id: randomUUID(),
      template,
      blocks,
      notes: lines.length === 0 ? "[import] pdf 此頁未擷取到文字內容（可能為圖片/掃描頁）" : undefined,
      source: "pdf",
    } satisfies SlideSpec;
  });
}
