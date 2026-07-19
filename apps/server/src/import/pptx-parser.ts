/**
 * PPTX → SlideSpec[] 解析器（純函式，無 DB／無網路）。借 v1 import/parsers/pptx.ts，重寫對齊 v2（含 noUncheckedIndexedAccess 守護）。
 *
 * 排序：直接列舉 ppt/slides/slideN.xml 按 N 排序（簡化路徑，不解析正式播放序 rels）。
 * notes：假設 notesSlideN.xml 與 slideN.xml 的 N 相同（常見慣例）。
 * 主題：從 ppt/theme/theme1.xml 抽 clrScheme/fontScheme，per-slide 背景覆寫蓋 bg。
 * template：依版面名 + 區塊結構推斷（image-full > section > stats > closing > content；第 0 頁一律 title）。
 * 圖片：p:pic → 內嵌 data URI（超過大小上限或不支援格式則略過並記 notes）。
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { randomUUID } from "node:crypto";
import type { SlideBlock, SlideSpec, SlideTemplate, SlideTheme } from "@meetcopilot/shared";

const FORCE_ARRAY_TAGS = new Set(["p:sp", "a:p", "a:r", "a:t", "p:pic"]);

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    textNodeName: "#text",
    trimValues: true,
    isArray: (name) => FORCE_ARRAY_TAGS.has(name),
  });
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** 遞迴收集節點下所有 <a:t> 文字內容（近似依文件序）。 */
function collectText(node: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === "string" || typeof n === "number" || typeof n === "boolean") return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n === "object") {
      for (const [key, value] of Object.entries(n as Record<string, unknown>)) {
        if (key === "a:t") {
          for (const t of asArray(value as string | string[])) {
            if (typeof t === "string") out.push(t);
            else if (t && typeof t === "object" && "#text" in (t as Record<string, unknown>)) {
              out.push(String((t as Record<string, unknown>)["#text"]));
            }
          }
        } else {
          walk(value);
        }
      }
    }
  };
  walk(node);
  return out;
}

/** 在 shape 節點內找出 <p:ph type="..."/> 的 type；找不到型別時 OOXML 預設語意為 "body"。 */
function findPlaceholderType(shape: Record<string, unknown>): string | undefined {
  let found: string | undefined;
  const walk = (n: unknown): void => {
    if (found !== undefined || n == null) return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if ("p:ph" in obj) {
        const ph = obj["p:ph"] as Record<string, unknown> | string | undefined;
        const type = ph && typeof ph === "object" ? (ph["@_type"] as string | undefined) : undefined;
        found = type ?? "body";
        return;
      }
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(shape);
  return found;
}

/** shape 內每個段落 (a:p) 的純文字，已過濾空段落。 */
function paragraphTexts(shape: Record<string, unknown>): string[] {
  const txBody = shape["p:txBody"] as Record<string, unknown> | undefined;
  if (!txBody) return [];
  const paras = asArray(txBody["a:p"] as unknown as Record<string, unknown>[]);
  return paras
    .map((p) => collectText(p).join(""))
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

const TITLE_TYPES = new Set(["title", "ctrTitle"]);
const SKIP_NOTES_TYPES = new Set(["sldNum", "hdr", "ftr", "dt", "sldImg"]);

const STAT_VALUE_RE = /^[+-]?\d[\d,.]*\s*(%|[kKmMbB]|[xX])?$/;
const STAT_LABEL_MAX_LEN = 60;

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};

// 原以「解壓後 base64 長度」判圖片是否過大——但那是解壓完才檢查，惡意檔可在解壓當下就撐爆記憶體（zip bomb）。
// 改用「串流位元組上限」在解壓過程即時計數並中止；此常數保留為原有效門檻的來源（換算成原始位元組）。
const MAX_IMAGE_BASE64_CHARS = 400 * 1024;
// 單張內嵌圖片解壓上限（原始位元組）：由原 base64 長度門檻換算（base64 每 3 bytes → 4 chars），維持既有效果。
const MAX_IMAGE_BYTES = Math.floor((MAX_IMAGE_BASE64_CHARS * 3) / 4);
// 單一 XML entry 解壓上限：正常 slide/theme/rels XML 遠小於此；設 16MiB 足以攔下高壓縮比 zip bomb。
const MAX_XML_BYTES = 16 * 1024 * 1024;
// 整份 pptx 所有 entry 累計解壓上限：擋「大量小 entry」型炸彈（單一 entry cap 擋不住的攤平攻擊）。
const MAX_TOTAL_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
// slide 頁數上限：擋「灌爆頁數」型炸彈；正常簡報遠低於此。
const MAX_SLIDES = 1000;

/** 解壓縮位元組超過上限時丟出（image 路徑捕捉此型別 → 略過該圖；XML 路徑不捕捉 → 中止整份解析）。 */
class ZipEntryTooLargeError extends Error {
  constructor(entryName: string, cap: number) {
    super(`zip entry 解壓超過大小上限（${entryName}，上限 ${cap} bytes）`);
    this.name = "ZipEntryTooLargeError";
  }
}

/** 跨 entry 的累計解壓位元組預算（單次 parsePptx 共用一個實例）。 */
interface SizeBudget {
  total: number;
}

/**
 * 串流解壓單一 zip entry 並在位元組數超過 cap（或超過整份總量）時「即刻」destroy 串流並 reject。
 * 這是防 zip bomb 的關鍵：不先把整個 entry 解到記憶體再檢查，而是邊解邊數、超標即斷。
 * declared uncompressedSize 只當便宜快篩（可被竄改，故仍以下方串流實際計數為準）。
 */
function readEntryCapped(entry: JSZip.JSZipObject, cap: number, budget: SizeBudget): Promise<Buffer> {
  // 便宜快篩：宣告的解壓大小若已超標，連串流都不用開就拒（可偽造，僅作最省成本的前置攔截）。
  const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
  if (typeof declared === "number" && declared > cap) {
    return Promise.reject(new ZipEntryTooLargeError(entry.name, cap));
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let entryTotal = 0;
    let settled = false;
    const stream = entry.nodeStream("nodebuffer") as NodeJS.ReadableStream & { destroy?: (err?: Error) => void };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    const abort = (err: Error): void => {
      try {
        stream.destroy?.();
      } catch {
        /* destroy 失敗亦忽略：settled 已擋掉後續事件 */
      }
      finish(() => reject(err));
    };
    stream.on("data", (chunk: Buffer | string) => {
      if (settled) return;
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      entryTotal += b.length;
      budget.total += b.length;
      if (entryTotal > cap) {
        abort(new ZipEntryTooLargeError(entry.name, cap));
        return;
      }
      if (budget.total > MAX_TOTAL_DECOMPRESSED_BYTES) {
        abort(new ZipEntryTooLargeError(`${entry.name}（整份總量）`, MAX_TOTAL_DECOMPRESSED_BYTES));
        return;
      }
      chunks.push(b);
    });
    stream.on("error", (err: Error) => finish(() => reject(err)));
    stream.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
  });
}

/** 以位元組上限串流讀出 entry 並以 UTF-8 解碼（取代 .async("string") 的無上限解壓）。 */
async function readEntryText(entry: JSZip.JSZipObject, cap: number, budget: SizeBudget): Promise<string> {
  const buf = await readEntryCapped(entry, cap, budget);
  return buf.toString("utf8");
}

interface SlideRel {
  id: string;
  type: string;
  target: string;
}

async function loadRelsFor(
  zip: JSZip,
  xmlFileName: string,
  parser: XMLParser,
  budget: SizeBudget,
): Promise<SlideRel[]> {
  const slashIdx = xmlFileName.lastIndexOf("/");
  const dir = slashIdx >= 0 ? xmlFileName.slice(0, slashIdx) : "";
  const base = slashIdx >= 0 ? xmlFileName.slice(slashIdx + 1) : xmlFileName;
  const relsPath = `${dir}/_rels/${base}.rels`;
  const relsFile = zip.file(relsPath);
  if (!relsFile) return [];
  try {
    const xml = await readEntryText(relsFile, MAX_XML_BYTES, budget);
    const parsed = xml ? parser.parse(xml) : undefined;
    const rels = asArray(
      (parsed as Record<string, unknown> | undefined)?.["Relationships"] &&
        ((parsed as Record<string, Record<string, unknown>>)["Relationships"]!["Relationship"] as unknown),
    );
    const out: SlideRel[] = [];
    for (const r of rels) {
      const obj = r as Record<string, unknown>;
      const id = obj["@_Id"];
      const type = obj["@_Type"];
      const target = obj["@_Target"];
      if (typeof id === "string" && typeof type === "string" && typeof target === "string") {
        out.push({ id, type, target });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function resolveZipPath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack = baseDir.split("/").filter(Boolean);
  for (const part of target.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

function extOf(p: string): string {
  const m = p.match(/\.([a-zA-Z0-9]+)$/);
  return m && m[1] ? m[1].toLowerCase() : "";
}

function findBlipEmbedId(shape: Record<string, unknown>): string | undefined {
  let found: string | undefined;
  const walk = (n: unknown): void => {
    if (found !== undefined || n == null) return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item);
      return;
    }
    if (typeof n === "object") {
      const obj = n as Record<string, unknown>;
      if ("a:blip" in obj) {
        const blip = obj["a:blip"] as Record<string, unknown> | undefined;
        const embed = blip?.["@_r:embed"];
        if (typeof embed === "string" && embed.length > 0) {
          found = embed;
          return;
        }
      }
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(shape);
  return found;
}

function picAltText(shape: Record<string, unknown>): string | undefined {
  const nvPicPr = shape["p:nvPicPr"] as Record<string, unknown> | undefined;
  const cNvPr = nvPicPr?.["p:cNvPr"] as Record<string, unknown> | undefined;
  const descr = cNvPr?.["@_descr"];
  const name = cNvPr?.["@_name"];
  const alt = (typeof descr === "string" && descr.trim()) || (typeof name === "string" && name.trim());
  return alt && alt.length > 0 ? alt : undefined;
}

async function buildImageBlock(
  zip: JSZip,
  shape: Record<string, unknown>,
  mediaRelsById: Map<string, string>,
  budget: SizeBudget,
): Promise<{ block: SlideBlock; skipReason?: undefined } | { block: undefined; skipReason: "tooLarge" | "other" }> {
  const embedId = findBlipEmbedId(shape);
  if (!embedId) return { block: undefined, skipReason: "other" };
  const target = mediaRelsById.get(embedId);
  if (!target) return { block: undefined, skipReason: "other" };

  const mediaPath = resolveZipPath("ppt/slides", target);
  const ext = extOf(mediaPath);
  const mime = MIME_BY_EXT[ext];
  if (!mime) return { block: undefined, skipReason: "other" };

  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return { block: undefined, skipReason: "other" };

  try {
    // 串流解壓＋位元組上限：邊解邊數，超標即 destroy 串流並丟 ZipEntryTooLargeError（防 zip bomb 撐爆記憶體）。
    const bytes = await readEntryCapped(mediaFile, MAX_IMAGE_BYTES, budget);
    const base64 = bytes.toString("base64");
    const alt = picAltText(shape);
    const block: SlideBlock = alt
      ? { type: "image", dataUri: `data:${mime};base64,${base64}`, alt }
      : { type: "image", dataUri: `data:${mime};base64,${base64}` };
    return { block };
  } catch (err) {
    // 超過大小上限 → 標記 tooLarge（維持原「過大則略過並記 notes」語意）；其餘解析錯誤 → other。
    if (err instanceof ZipEntryTooLargeError) return { block: undefined, skipReason: "tooLarge" };
    return { block: undefined, skipReason: "other" };
  }
}

function collectShapesAndPics(spTree: Record<string, unknown> | undefined): {
  shapes: Record<string, unknown>[];
  pics: Record<string, unknown>[];
} {
  const shapes: Record<string, unknown>[] = [];
  const pics: Record<string, unknown>[] = [];
  const visit = (node: Record<string, unknown> | undefined): void => {
    if (!node) return;
    for (const sp of asArray(node["p:sp"] as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      shapes.push(sp);
    }
    for (const pic of asArray(node["p:pic"] as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      pics.push(pic);
    }
    for (const grp of asArray(node["p:grpSp"] as Record<string, unknown> | Record<string, unknown>[] | undefined)) {
      visit(grp);
    }
  };
  visit(spTree);
  return { shapes, pics };
}

interface SlideBlocksResult {
  blocks: SlideBlock[];
  imageSkippedTooLarge: boolean;
  imageSkippedOther: boolean;
}

async function extractSlideBlocks(
  slideXmlObj: unknown,
  zip: JSZip,
  mediaRelsById: Map<string, string>,
  budget: SizeBudget,
): Promise<SlideBlocksResult> {
  const root = slideXmlObj as Record<string, any> | undefined;
  const spTree = root?.["p:sld"]?.["p:cSld"]?.["p:spTree"];
  const { shapes, pics } = collectShapesAndPics(spTree);

  const blocks: SlideBlock[] = [];
  let headingTaken = false;

  for (const shape of shapes) {
    const texts = paragraphTexts(shape);
    if (texts.length === 0) continue;

    const phType = findPlaceholderType(shape);
    if (!headingTaken && phType !== undefined && TITLE_TYPES.has(phType)) {
      blocks.push({ type: "heading", text: texts.join(" ") });
      headingTaken = true;
      continue;
    }

    if (texts.length === 2 && STAT_VALUE_RE.test(texts[0]!.trim()) && texts[1]!.length <= STAT_LABEL_MAX_LEN) {
      blocks.push({ type: "stat", value: texts[0]!.trim(), label: texts[1]! });
    } else if (texts.length > 1) {
      blocks.push({ type: "bullets", items: texts });
    } else {
      blocks.push({ type: "paragraph", text: texts[0]! });
    }
  }

  let imageSkippedTooLarge = false;
  let imageSkippedOther = false;
  for (const pic of pics) {
    const result = await buildImageBlock(zip, pic, mediaRelsById, budget);
    if (result.block) {
      blocks.push(result.block);
    } else if (result.skipReason === "tooLarge") {
      imageSkippedTooLarge = true;
    } else {
      imageSkippedOther = true;
    }
  }

  return { blocks, imageSkippedTooLarge, imageSkippedOther };
}

function extractNotesText(notesXmlObj: unknown): string | undefined {
  const root = notesXmlObj as Record<string, any> | undefined;
  const shapes: Record<string, unknown>[] = asArray(root?.["p:notes"]?.["p:cSld"]?.["p:spTree"]?.["p:sp"]);

  const lines: string[] = [];
  for (const shape of shapes) {
    const phType = findPlaceholderType(shape);
    if (phType !== undefined && SKIP_NOTES_TYPES.has(phType)) continue;
    lines.push(...paragraphTexts(shape));
  }
  const text = lines.join("\n").trim();
  return text.length > 0 ? text : undefined;
}

function numberFromXmlName(name: string): number | null {
  const m = name.match(/(\d+)\.xml$/);
  return m && m[1] ? parseInt(m[1], 10) : null;
}

function schemeColorHex(colorNode: unknown): string | undefined {
  if (colorNode == null || typeof colorNode !== "object") return undefined;
  const obj = colorNode as Record<string, unknown>;
  const srgb = obj["a:srgbClr"] as Record<string, unknown> | undefined;
  if (srgb && typeof srgb === "object") {
    const val = srgb["@_val"];
    if (typeof val === "string" && val.length > 0) return `#${val}`;
  }
  const sys = obj["a:sysClr"] as Record<string, unknown> | undefined;
  if (sys && typeof sys === "object") {
    const lastClr = sys["@_lastClr"];
    if (typeof lastClr === "string" && lastClr.length > 0) return `#${lastClr}`;
  }
  return undefined;
}

function solidFillSrgbHex(fillNode: unknown): string | undefined {
  if (fillNode == null || typeof fillNode !== "object") return undefined;
  const obj = fillNode as Record<string, unknown>;
  const srgb = obj["a:srgbClr"] as Record<string, unknown> | undefined;
  if (srgb && typeof srgb === "object") {
    const val = srgb["@_val"];
    if (typeof val === "string" && val.length > 0) return `#${val}`;
  }
  return undefined;
}

function fontTypeface(fontNode: unknown): string | undefined {
  if (fontNode == null || typeof fontNode !== "object") return undefined;
  const latin = (fontNode as Record<string, unknown>)["a:latin"] as Record<string, unknown> | undefined;
  if (latin && typeof latin === "object") {
    const typeface = latin["@_typeface"];
    if (typeof typeface === "string" && typeface.trim().length > 0) return typeface;
  }
  return undefined;
}

function extractBaseTheme(themeXmlObj: unknown): SlideTheme {
  const theme: SlideTheme = {};
  const root = themeXmlObj as Record<string, any> | undefined;
  const themeElements = root?.["a:theme"]?.["a:themeElements"];
  if (!themeElements || typeof themeElements !== "object") return theme;

  const clrScheme = themeElements["a:clrScheme"];
  if (clrScheme && typeof clrScheme === "object") {
    const bg = schemeColorHex(clrScheme["a:lt1"]);
    const text = schemeColorHex(clrScheme["a:dk1"]);
    const accent = schemeColorHex(clrScheme["a:accent1"]);
    if (bg) theme.bg = bg;
    if (text) theme.text = text;
    if (accent) theme.accent = accent;
  }

  const fontScheme = themeElements["a:fontScheme"];
  if (fontScheme && typeof fontScheme === "object") {
    const headingFont = fontTypeface(fontScheme["a:majorFont"]);
    const bodyFont = fontTypeface(fontScheme["a:minorFont"]);
    if (headingFont) theme.headingFont = headingFont;
    if (bodyFont) theme.bodyFont = bodyFont;
  }

  return theme;
}

async function loadBaseTheme(zip: JSZip, parser: XMLParser, budget: SizeBudget): Promise<SlideTheme> {
  try {
    const themeFiles = zip
      .file(/^ppt\/theme\/theme\d+\.xml$/)
      .map((f) => ({ file: f, n: numberFromXmlName(f.name) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.n - b.n);
    const themeFile = themeFiles.find((t) => t.n === 1)?.file ?? themeFiles[0]?.file;
    if (!themeFile) return {};

    const xml = await readEntryText(themeFile, MAX_XML_BYTES, budget);
    const parsed = parser.parse(xml);
    return extractBaseTheme(parsed);
  } catch {
    return {};
  }
}

function extractSlideBackgroundColor(slideXmlObj: unknown): string | undefined {
  try {
    const root = slideXmlObj as Record<string, any> | undefined;
    const bg = root?.["p:sld"]?.["p:cSld"]?.["p:bg"];
    if (!bg || typeof bg !== "object") return undefined;
    const bgPr = bg["p:bgPr"];
    if (!bgPr || typeof bgPr !== "object") return undefined;
    const solidFill = (bgPr as Record<string, unknown>)["a:solidFill"];
    return solidFillSrgbHex(solidFill);
  } catch {
    return undefined;
  }
}

async function loadSlideLayoutName(
  zip: JSZip,
  slideRels: SlideRel[],
  parser: XMLParser,
  layoutNameCache: Map<string, string | undefined>,
  budget: SizeBudget,
): Promise<string | undefined> {
  const layoutRel = slideRels.find((r) => r.type.endsWith("/slideLayout"));
  if (!layoutRel) return undefined;
  const layoutPath = resolveZipPath("ppt/slides", layoutRel.target);
  if (layoutNameCache.has(layoutPath)) return layoutNameCache.get(layoutPath);

  const layoutFile = zip.file(layoutPath);
  if (!layoutFile) {
    layoutNameCache.set(layoutPath, undefined);
    return undefined;
  }
  try {
    const xml = await readEntryText(layoutFile, MAX_XML_BYTES, budget);
    const parsed = parser.parse(xml) as Record<string, any>;
    const name = parsed?.["p:sldLayout"]?.["p:cSld"]?.["@_name"];
    const result = typeof name === "string" && name.trim().length > 0 ? name.trim() : undefined;
    layoutNameCache.set(layoutPath, result);
    return result;
  } catch {
    layoutNameCache.set(layoutPath, undefined);
    return undefined;
  }
}

function inferTemplate(params: {
  index: number;
  isLast: boolean;
  blocks: SlideBlock[];
  layoutName: string | undefined;
}): SlideTemplate {
  if (params.index === 0) return "title";

  const layoutLower = params.layoutName?.toLowerCase() ?? "";
  const imageBlocks = params.blocks.filter((b) => b.type === "image");
  const textBlocks = params.blocks.filter((b) => b.type !== "image");
  const hasBody = params.blocks.some(
    (b) => b.type === "bullets" || b.type === "paragraph" || b.type === "stat" || b.type === "two-col",
  );
  const statCandidateCount = params.blocks.filter((b) => b.type === "stat").length;

  if (imageBlocks.length > 0 && textBlocks.length <= 1) return "image-full";
  if (layoutLower.includes("picture") && imageBlocks.length > 0 && textBlocks.length <= 2) return "image-full";

  if (
    layoutLower.includes("section") ||
    layoutLower.includes("divider") ||
    (!params.isLast && !hasBody && imageBlocks.length === 0 && params.blocks.some((b) => b.type === "heading"))
  ) {
    return "section";
  }

  if (statCandidateCount >= 2 || layoutLower.includes("stat")) return "stats";

  if (params.isLast) {
    const hasBullets = params.blocks.some((b) => b.type === "bullets");
    if (!hasBullets && textBlocks.length <= 2) return "closing";
  }

  return "content";
}

export async function parsePptx(buffer: Buffer): Promise<SlideSpec[]> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = createParser();

  // 單次解析共用的解壓總量預算（防 zip bomb 攤平攻擊）。
  const budget: SizeBudget = { total: 0 };

  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .map((f) => ({ file: f, n: numberFromXmlName(f.name) ?? 0 }))
    .sort((a, b) => a.n - b.n);

  // slide 頁數上限：擋「灌爆頁數」型炸彈；正常簡報遠低於此。
  if (slideFiles.length > MAX_SLIDES) {
    throw new ZipEntryTooLargeError(`ppt/slides（共 ${slideFiles.length} 頁）`, MAX_SLIDES);
  }

  const notesFiles = new Map<number, JSZip.JSZipObject>();
  for (const f of zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) {
    const n = numberFromXmlName(f.name);
    if (n !== null) notesFiles.set(n, f);
  }

  const baseTheme = await loadBaseTheme(zip, parser, budget);
  const slides: SlideSpec[] = [];
  const layoutNameCache = new Map<string, string | undefined>();

  for (let i = 0; i < slideFiles.length; i++) {
    const entry = slideFiles[i]!;
    const { file, n } = entry;
    const xml = await readEntryText(file, MAX_XML_BYTES, budget);
    const parsed = parser.parse(xml);

    const slideRels = await loadRelsFor(zip, file.name, parser, budget);
    const mediaRelsById = new Map(
      slideRels.filter((r) => r.type.endsWith("/image")).map((r) => [r.id, r.target] as const),
    );
    const { blocks, imageSkippedTooLarge, imageSkippedOther } = await extractSlideBlocks(
      parsed,
      zip,
      mediaRelsById,
      budget,
    );

    let notes: string | undefined;
    const notesFile = notesFiles.get(n);
    if (notesFile) {
      const notesXml = await readEntryText(notesFile, MAX_XML_BYTES, budget);
      notes = extractNotesText(parser.parse(notesXml));
    }

    if (blocks.length === 0) {
      const marker = "[import] pptx 此頁未擷取到文字或圖片內容";
      notes = notes ? `${notes}\n${marker}` : marker;
    }
    if (imageSkippedTooLarge) {
      const marker = "[import] pptx 此頁有圖片因超過大小上限而略過內嵌";
      notes = notes ? `${notes}\n${marker}` : marker;
    }
    if (imageSkippedOther) {
      const marker = "[import] pptx 此頁有圖片因格式不支援或無法解析而略過";
      notes = notes ? `${notes}\n${marker}` : marker;
    }

    const theme: SlideTheme = { ...baseTheme };
    const bgOverride = extractSlideBackgroundColor(parsed);
    if (bgOverride) theme.bg = bgOverride;

    const layoutName = await loadSlideLayoutName(zip, slideRels, parser, layoutNameCache, budget);
    const template = inferTemplate({
      index: i,
      isLast: i === slideFiles.length - 1,
      blocks,
      layoutName,
    });
    slides.push({
      id: randomUUID(),
      template,
      blocks,
      notes,
      source: "pptx",
      theme,
    });
  }

  return slides;
}

// ─────────────────────────────────────────────────────────────
// 匯入重構（契約 §4/§5）：pptx 輕量中繼資料讀取（真標題 + 基底主題）。
// 匯入改「原封點陣圖」路徑（soffice→pdftoppm），不再用 parsePptx/extractSlideBlocks 拆文字建 deck。
// 上方 parsePptx 及其 helper 一律保留（parse-worker 的 "pptx" 動態 import 仍指向此匯出；現行匯入不再呼叫它）。
// ─────────────────────────────────────────────────────────────

/** docProps/core.xml 的 <dc:title> 純文字；空白/缺省回 undefined。 */
function readCoreTitle(parsed: unknown): string | undefined {
  const root = parsed as Record<string, any> | undefined;
  const cp = root?.["cp:coreProperties"] ?? root?.["coreProperties"];
  const dcTitle = cp?.["dc:title"];
  const text =
    typeof dcTitle === "string"
      ? dcTitle
      : dcTitle && typeof dcTitle === "object" && "#text" in (dcTitle as Record<string, unknown>)
        ? String((dcTitle as Record<string, unknown>)["#text"])
        : undefined;
  const trimmed = text?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** 第一張 slide 的 title placeholder 文字（core.xml 無標題時的 fallback）。 */
function readFirstSlideTitle(parsedSlide: unknown): string | undefined {
  const root = parsedSlide as Record<string, any> | undefined;
  const spTree = root?.["p:sld"]?.["p:cSld"]?.["p:spTree"];
  const { shapes } = collectShapesAndPics(spTree);
  for (const shape of shapes) {
    const phType = findPlaceholderType(shape);
    if (phType !== undefined && TITLE_TYPES.has(phType)) {
      const joined = paragraphTexts(shape).join(" ").trim();
      if (joined.length > 0) return joined;
    }
  }
  return undefined;
}

/** 匯入用 pptx 中繼資料。 */
export interface PptxMeta {
  /** 是否確為 PowerPoint 簡報（存在 ppt/presentation.xml）——擋 docx/xlsx 誤判成 pptx。 */
  isPresentation: boolean;
  /** 真標題（core.xml dc:title → 第一張 title placeholder）；皆無回 undefined（呼叫端用檔名 fallback）。 */
  title?: string;
  /** 補充頁配色用的基底主題（clrScheme/fontScheme）；缺省回 {}。 */
  theme: SlideTheme;
}

/**
 * 匯入用的 pptx 輕量中繼資料讀取（只開一次 zip）：確認是否為簡報、讀真標題、抽基底主題。
 * 不做 block/文字擷取（匯入改原封點陣圖路徑）。zip-bomb 位元組上限沿用 parsePptx 的守護（readEntryText + budget）。
 */
export async function readPptxMeta(buffer: Buffer): Promise<PptxMeta> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = createParser();
  const budget: SizeBudget = { total: 0 };

  const isPresentation = zip.file("ppt/presentation.xml") !== null;
  if (!isPresentation) return { isPresentation: false, theme: {} };

  // 真標題：docProps/core.xml <dc:title> → 第一張 title placeholder。
  let title: string | undefined;
  const coreFile = zip.file("docProps/core.xml");
  if (coreFile) {
    try {
      title = readCoreTitle(parser.parse(await readEntryText(coreFile, MAX_XML_BYTES, budget)));
    } catch {
      title = undefined;
    }
  }
  if (!title) {
    const slide1 = zip.file("ppt/slides/slide1.xml");
    if (slide1) {
      try {
        title = readFirstSlideTitle(parser.parse(await readEntryText(slide1, MAX_XML_BYTES, budget)));
      } catch {
        title = undefined;
      }
    }
  }

  const theme = await loadBaseTheme(zip, parser, budget);
  return { isPresentation: true, title, theme };
}
