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

const MAX_IMAGE_BASE64_CHARS = 400 * 1024;

interface SlideRel {
  id: string;
  type: string;
  target: string;
}

async function loadRelsFor(zip: JSZip, xmlFileName: string, parser: XMLParser): Promise<SlideRel[]> {
  const slashIdx = xmlFileName.lastIndexOf("/");
  const dir = slashIdx >= 0 ? xmlFileName.slice(0, slashIdx) : "";
  const base = slashIdx >= 0 ? xmlFileName.slice(slashIdx + 1) : xmlFileName;
  const relsPath = `${dir}/_rels/${base}.rels`;
  const relsFile = zip.file(relsPath);
  if (!relsFile) return [];
  try {
    const xml = await relsFile.async("string");
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
    const bytes = await mediaFile.async("nodebuffer");
    const base64 = bytes.toString("base64");
    if (base64.length > MAX_IMAGE_BASE64_CHARS) {
      return { block: undefined, skipReason: "tooLarge" };
    }
    const alt = picAltText(shape);
    const block: SlideBlock = alt
      ? { type: "image", dataUri: `data:${mime};base64,${base64}`, alt }
      : { type: "image", dataUri: `data:${mime};base64,${base64}` };
    return { block };
  } catch {
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
    const result = await buildImageBlock(zip, pic, mediaRelsById);
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

async function loadBaseTheme(zip: JSZip, parser: XMLParser): Promise<SlideTheme> {
  try {
    const themeFiles = zip
      .file(/^ppt\/theme\/theme\d+\.xml$/)
      .map((f) => ({ file: f, n: numberFromXmlName(f.name) ?? Number.MAX_SAFE_INTEGER }))
      .sort((a, b) => a.n - b.n);
    const themeFile = themeFiles.find((t) => t.n === 1)?.file ?? themeFiles[0]?.file;
    if (!themeFile) return {};

    const xml = await themeFile.async("string");
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
    const xml = await layoutFile.async("string");
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

  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .map((f) => ({ file: f, n: numberFromXmlName(f.name) ?? 0 }))
    .sort((a, b) => a.n - b.n);

  const notesFiles = new Map<number, JSZip.JSZipObject>();
  for (const f of zip.file(/^ppt\/notesSlides\/notesSlide\d+\.xml$/)) {
    const n = numberFromXmlName(f.name);
    if (n !== null) notesFiles.set(n, f);
  }

  const baseTheme = await loadBaseTheme(zip, parser);
  const slides: SlideSpec[] = [];
  const layoutNameCache = new Map<string, string | undefined>();

  for (let i = 0; i < slideFiles.length; i++) {
    const entry = slideFiles[i]!;
    const { file, n } = entry;
    const xml = await file.async("string");
    const parsed = parser.parse(xml);

    const slideRels = await loadRelsFor(zip, file.name, parser);
    const mediaRelsById = new Map(
      slideRels.filter((r) => r.type.endsWith("/image")).map((r) => [r.id, r.target] as const),
    );
    const { blocks, imageSkippedTooLarge, imageSkippedOther } = await extractSlideBlocks(parsed, zip, mediaRelsById);

    let notes: string | undefined;
    const notesFile = notesFiles.get(n);
    if (notesFile) {
      const notesXml = await notesFile.async("string");
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

    const layoutName = await loadSlideLayoutName(zip, slideRels, parser, layoutNameCache);
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
