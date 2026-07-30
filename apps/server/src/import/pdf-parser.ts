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
  /** pdf.js PDFPageProxy 的 0-based 頁索引（v1.10 起即存在）；parsePdfText 以它為收集鍵。 */
  pageIndex?: number;
  /** 1-based 頁碼（pageIndex 的 getter 對應）；pageIndex 缺失時的備援鍵。 */
  pageNumber?: number;
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

// ─────────────────────────────────────────────────────────────
// C2 逐頁純文字抽取（MEETING_CHECKLIST_CONTRACT §11.1/§11.2）。
// 輕量路徑：只回 string[]，不建 SlideSpec。**逐頁收集以頁索引為鍵**——pdf-parse 對單頁 pagerender
// 失敗會 .catch(()=>"") 靜默吞頁（lib/pdf-parse.js:86），順序 push 會讓後續頁整體位移；
// 以 pageData.pageIndex 為鍵收集＋缺頁補空字串佔位，單頁失敗不位移其他頁。
// ─────────────────────────────────────────────────────────────

/**
 * 以頁索引鍵組回完整頁陣列：缺頁（單頁 getTextContent 失敗被 pdf-parse 靜默吞掉）以空字串**佔位**，
 * 不位移後續頁。export 供單元測試直接驗佔位語意。
 */
export function assemblePdfPages(byIndex: Map<number, string>, numPages: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < numPages; i++) out.push(byIndex.get(i) ?? "");
  return out;
}

/**
 * pdf → 逐頁純文字（索引鍵收集；順序＝實體頁序，天然與 pdftoppm 點陣化頁序一致）。
 * 回 `string[]`（長度恆＝numpages；單頁失敗＝該頁空字串佔位）；**對齊無效**（拿不到可靠頁索引且
 * 順序收集數量對不上、或 numpages 不可信）回 `null`——呼叫端走讀圖 fallback（契約 §11.2）。
 */
export async function parsePdfText(buffer: Buffer): Promise<string[] | null> {
  const byIndex = new Map<number, string>();
  const seq: string[] = []; // pageIndex 不可得時的順序備援（只能靠數量守門）
  let indexUnreliable = false;

  const pagerender = (pageData: PdfPageData): Promise<string> =>
    pageData
      .getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
      .then((content) => {
        const text = renderPageText(content);
        const idx =
          typeof pageData.pageIndex === "number"
            ? pageData.pageIndex
            : typeof pageData.pageNumber === "number"
              ? pageData.pageNumber - 1
              : undefined;
        if (idx === undefined || idx < 0) indexUnreliable = true;
        else byIndex.set(idx, text);
        seq.push(text);
        return text;
      });

  // pdf.js v1.10 對「非 0 byteOffset 的 Buffer 視圖」（Node pooled Buffer 常態）會誤用底層 ArrayBuffer 全段
  // → 讀到鄰居位元組、xref 錯位（實測 'bad XRef entry'）。一律傳精確拷貝：new Uint8Array(typedArray)＝copy。
  const bytes = new Uint8Array(buffer);
  const data = (await pdfParse(bytes, { pagerender })) as { numpages?: unknown } | undefined;
  const numPages = typeof data?.numpages === "number" && Number.isInteger(data.numpages) ? data.numpages : 0;
  if (numPages <= 0) return null;

  if (!indexUnreliable) return assemblePdfPages(byIndex, numPages);
  // 頁索引不可靠：只能靠數量守門——順序收集齊全（無吞頁）才可信，否則對齊無效。
  return seq.length === numPages ? seq : null;
}
