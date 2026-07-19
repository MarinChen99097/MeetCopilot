/**
 * mergePptx(originalPptx, supplementPptx) → 合併後 .pptx Buffer（契約 §7 pptx 雙路匯出）。
 *
 * 策略（正式化自 spike scratchpad/merge.cjs，並補齊多 master/layout＋chart/embeddings＋app.xml 頁數）：
 *   把補充頁（pptxgenjs 產的小 deck）的**整條可達部件圖**（slides→layouts→masters→theme，
 *   加 media / charts / colors / style / embeddings）嫁接到原 pptx 的**尾端**。補充頁自帶
 *   master/layout/theme（PowerPoint 允許多 master），**不**重指原 master。
 *
 * 位元組保真：原 pptx 的所有部件一律 byte-for-byte 複製，只改 3 條 spine 檔
 *   （[Content_Types].xml、ppt/presentation.xml、ppt/_rels/presentation.xml.rels）＋ docProps/app.xml 頁數。
 *
 * 撞名安全：新部件名對「taken 集＝原 zip 全部件路徑 ∪ 原 [Content_Types] Override PartName」配名——
 *   後者重要，因 pptxgenjs 產的原檔會過度宣告不存在的 slideMasterN Override。
 *
 * ID 唯一：每個嫁接 master 配全新 sldMasterId id；每個 master 內的 sldLayoutId id 全部重編為全新唯一值
 *   （避免跨 master 的 sldMasterId/sldLayoutId 撞號 → PowerPoint 修復）。
 *
 * 可達閉包：從補充頁的每張 slide 出發，順著 rels（略過 External／notesSlide）遞迴收集要嫁接的部件，
 *   故不會嫁接孤兒部件（如 notesMaster 的 theme），也保證每個 master 的所有 layout 都在。
 */
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NOTES_SLIDE_SUFFIX = "/notesSlide";

/** 副檔名 → Default ContentType 後備（補充頁 [Content_Types] 缺 Default 時用）。 */
const CT_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpg",
  gif: "image/gif",
  svg: "image/svg+xml",
  emf: "image/x-emf",
  wmf: "image/x-wmf",
  bmp: "image/bmp",
  tiff: "image/tiff",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  bin: "application/vnd.openxmlformats-officedocument.oleObject",
};

// ─────────────────────────────────────────────────────────────
// 路徑工具
// ─────────────────────────────────────────────────────────────

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}

function extOf(p: string): string {
  const m = p.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1]!.toLowerCase() : "";
}

/** 把 rels 的相對 target（相對於部件所在目錄）解析成套件內絕對部件路徑（無前導斜線）。 */
function resolvePath(baseDir: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const stack = baseDir.split("/").filter(Boolean);
  for (const part of target.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}

/** 計算從 fromDir 到 toPath 的相對路徑（供改寫 rels target）。 */
function relativize(fromDir: string, toPath: string): string {
  const from = fromDir.split("/").filter(Boolean);
  const to = toPath.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => "..");
  const down = to.slice(i);
  return [...up, ...down].join("/");
}

/** rels 部件對應路徑（dir/_rels/base.rels）。 */
function relsPathFor(part: string): string {
  const dir = dirname(part);
  const base = basename(part);
  return dir ? `${dir}/_rels/${base}.rels` : `_rels/${base}.rels`;
}

function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────
// XML 解析（fast-xml-parser）
// ─────────────────────────────────────────────────────────────

interface Rel {
  id: string;
  type: string;
  target: string;
  mode?: string;
}

const relParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "Relationship",
});

const ctParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => name === "Override" || name === "Default",
});

function parseRels(xml: string): Rel[] {
  const doc = relParser.parse(xml) as {
    Relationships?: { Relationship?: Array<Record<string, string>> };
  };
  const arr = doc.Relationships?.Relationship ?? [];
  return arr.map((r) => ({
    id: r["@_Id"] ?? "",
    type: r["@_Type"] ?? "",
    target: r["@_Target"] ?? "",
    ...(r["@_TargetMode"] ? { mode: r["@_TargetMode"] } : {}),
  }));
}

function relTag(r: Rel): string {
  let t = `<Relationship Id="${escapeXmlAttr(r.id)}" Type="${escapeXmlAttr(r.type)}" Target="${escapeXmlAttr(r.target)}"`;
  if (r.mode) t += ` TargetMode="${escapeXmlAttr(r.mode)}"`;
  return t + "/>";
}

function relsDoc(rels: Rel[]): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    rels.map(relTag).join("") +
    `</Relationships>`
  );
}

interface CtInfo {
  overrides: Map<string, string>; // partPath(無前導/) -> contentType
  defaults: Map<string, string>; // ext(lower) -> contentType
}

function parseContentTypes(xml: string): CtInfo {
  const doc = ctParser.parse(xml) as {
    Types?: { Override?: Array<Record<string, string>>; Default?: Array<Record<string, string>> };
  };
  const overrides = new Map<string, string>();
  for (const o of doc.Types?.Override ?? []) {
    const pn = o["@_PartName"];
    const ct = o["@_ContentType"];
    if (pn && ct) overrides.set(pn.replace(/^\//, ""), ct);
  }
  const defaults = new Map<string, string>();
  for (const d of doc.Types?.Default ?? []) {
    const ext = d["@_Extension"];
    const ct = d["@_ContentType"];
    if (ext && ct) defaults.set(ext.toLowerCase(), ct);
  }
  return { overrides, defaults };
}

// ─────────────────────────────────────────────────────────────
// zip helper
// ─────────────────────────────────────────────────────────────

async function readStr(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`missing part: ${path}`);
  return f.async("string");
}

// ─────────────────────────────────────────────────────────────
// 主函式
// ─────────────────────────────────────────────────────────────

export async function mergePptx(originalPptx: Buffer, supplementPptx: Buffer): Promise<Buffer> {
  const origZip = await JSZip.loadAsync(originalPptx);
  const supZip = await JSZip.loadAsync(supplementPptx);

  const origNames = Object.keys(origZip.files).filter((n) => !origZip.files[n]!.dir);
  const origCT = await readStr(origZip, "[Content_Types].xml");
  const supCT = await readStr(supZip, "[Content_Types].xml");
  const origCtInfo = parseContentTypes(origCT);
  const supCtInfo = parseContentTypes(supCT);

  // ---- taken 集：真實部件路徑 ∪ 原 [Content_Types] Override PartName ----
  const taken = new Set(origNames);
  for (const pn of origCtInfo.overrides.keys()) taken.add(pn);

  const alloc = (dir: string, stem: string, ext: string): string => {
    let i = 1;
    let p = `${dir}/${stem}${i}.${ext}`;
    while (taken.has(p)) {
      i++;
      p = `${dir}/${stem}${i}.${ext}`;
    }
    taken.add(p);
    return p;
  };

  const supNames = new Set(Object.keys(supZip.files).filter((n) => !supZip.files[n]!.dir));

  // ---- rels 快取（每部件一次解析）----
  const relsCache = new Map<string, Rel[]>();
  const getRels = async (part: string): Promise<Rel[]> => {
    if (relsCache.has(part)) return relsCache.get(part)!;
    const rp = relsPathFor(part);
    const rels = supNames.has(rp) ? parseRels(await readStr(supZip, rp)) : [];
    relsCache.set(part, rels);
    return rels;
  };

  // ---- 補充頁 slides（依 N 排序＝匯出頁序）----
  const supSlidePaths = [...supNames]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)![1]) - Number(b.match(/(\d+)\.xml$/)![1]));
  if (supSlidePaths.length === 0) throw new Error("supplement has no slides");

  // ---- 可達閉包：從 slides 出發順 rels 遞迴（略過 External / notesSlide）----
  const toGraft = new Set<string>();
  const queue = [...supSlidePaths];
  while (queue.length) {
    const part = queue.shift()!;
    if (toGraft.has(part)) continue;
    toGraft.add(part);
    const dir = dirname(part);
    for (const r of await getRels(part)) {
      if (r.mode === "External") continue;
      if (r.type.endsWith(NOTES_SLIDE_SUFFIX)) continue; // 丟棄 notes 鏈
      const abs = resolvePath(dir, r.target);
      if (supNames.has(abs) && !toGraft.has(abs)) queue.push(abs);
    }
  }

  // ---- 為每個嫁接部件配新名 ----
  const stemFor = (old: string): { dir: string; stem: string; ext: string } => {
    const ext = extOf(old);
    if (/^ppt\/slides\//.test(old)) return { dir: "ppt/slides", stem: "slide", ext };
    if (/^ppt\/slideLayouts\//.test(old)) return { dir: "ppt/slideLayouts", stem: "slideLayout", ext };
    if (/^ppt\/slideMasters\//.test(old)) return { dir: "ppt/slideMasters", stem: "slideMaster", ext };
    if (/^ppt\/theme\//.test(old)) return { dir: "ppt/theme", stem: "theme", ext };
    if (/^ppt\/charts\/colors/i.test(old)) return { dir: "ppt/charts", stem: "colors", ext };
    if (/^ppt\/charts\/style/i.test(old)) return { dir: "ppt/charts", stem: "style", ext };
    if (/^ppt\/charts\//.test(old)) return { dir: "ppt/charts", stem: "chart", ext };
    if (/^ppt\/media\//.test(old)) return { dir: "ppt/media", stem: "mcmerge", ext };
    if (/^ppt\/embeddings\//.test(old)) return { dir: "ppt/embeddings", stem: "mcmerge", ext };
    return { dir: dirname(old), stem: "mcmerge", ext };
  };
  const rename = new Map<string, string>(); // old -> new
  for (const old of toGraft) {
    const { dir, stem, ext } = stemFor(old);
    rename.set(old, alloc(dir, stem, ext));
  }

  // ---- 收集既有 ID，準備配全新唯一 master/layout id（跨 master 不撞號）----
  const origPres = await readStr(origZip, "ppt/presentation.xml");
  const origMasterIds = [...origPres.matchAll(/<p:sldMasterId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  const layoutIds: number[] = [];
  for (const mn of origNames.filter((n) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(n))) {
    const body = await readStr(origZip, mn);
    for (const m of body.matchAll(/<p:sldLayoutId\b[^>]*\bid="(\d+)"/g)) layoutIds.push(Number(m[1]));
  }
  let idCounter = Math.max(2147483647, ...origMasterIds, ...layoutIds);
  const nextId = (): number => ++idCounter; // 全新唯一 id（>= 2147483648，符合 ST_SlideMasterId/ST_SlideLayoutId）

  const graftedMasters = [...toGraft].filter((p) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(p));
  const graftedMasterSet = new Set(graftedMasters);
  const masterNewId = new Map<string, number>(); // oldMasterPath -> 新 sldMasterId id
  for (const gm of graftedMasters) masterNewId.set(gm, nextId());

  // ================= 就地嫁接：直接改寫 origZip（下方只覆寫 4 條 spine＋新增嫁接部件）=================
  // 原部件全數保持不動 → JSZip 沿用其「已載入的壓縮位元組」重打包，略過全 deck 的 decompress+recompress
  // （最高至 50MB 原檔的匯出主要 CPU 成本）。新嫁接部件名皆由 alloc 對 taken（原部件 ∪ 原 Override PartName）
  // 配名，保證不覆寫任何原始 entry；所有原始 origZip 讀取（origPres/origPresRels/origCT/app.xml）皆已在上方完成。
  const out = origZip;
  const APP_PATH = "docProps/app.xml";

  // ---- 寫入嫁接部件（master body 重編 layout id；其餘 verbatim）＋改寫其 rels ----
  for (const old of toGraft) {
    const neu = rename.get(old)!;
    if (graftedMasterSet.has(old)) {
      let body = await readStr(supZip, old);
      body = body.replace(/(<p:sldLayoutId\b[^>]*\bid=")\d+(")/g, (_m, a: string, b: string) => `${a}${nextId()}${b}`);
      out.file(neu, body);
    } else {
      out.file(neu, await supZip.file(old)!.async("nodebuffer"));
    }

    if (supNames.has(relsPathFor(old))) {
      const oldDir = dirname(old);
      const newDir = dirname(neu);
      const rebuilt: Rel[] = [];
      for (const r of await getRels(old)) {
        if (r.type.endsWith(NOTES_SLIDE_SUFFIX)) continue; // 丟棄 notes
        if (r.mode === "External") {
          rebuilt.push(r);
          continue;
        }
        const abs = resolvePath(oldDir, r.target);
        const mappedNew = rename.get(abs);
        if (mappedNew) {
          rebuilt.push({ ...r, target: relativize(newDir, mappedNew) });
        } else if (supNames.has(abs)) {
          continue; // 內部但未嫁接（閉包保證不該發生）→ 丟棄避免懸空
        } else {
          rebuilt.push(r); // 未知/絕對 → verbatim
        }
      }
      out.file(relsPathFor(neu), relsDoc(rebuilt));
    }
  }

  // ================= spine 編輯 =================
  // ---- presentation.xml.rels：加 master + slide 關係 ----
  const origPresRels = await readStr(origZip, "ppt/_rels/presentation.xml.rels");
  const relIdNums = [...origPresRels.matchAll(/\bId="rId(\d+)"/g)].map((m) => Number(m[1]));
  let nextRid = Math.max(0, ...relIdNums) + 1;
  const newPresRelTags: string[] = [];
  const masterRid = new Map<string, string>();
  for (const gm of graftedMasters) {
    const rid = `rId${nextRid++}`;
    masterRid.set(gm, rid);
    newPresRelTags.push(
      `<Relationship Id="${rid}" Type="${REL_NS}/slideMaster" Target="slideMasters/${basename(rename.get(gm)!)}"/>`,
    );
  }
  const slideRid = new Map<string, string>();
  for (const sp of supSlidePaths) {
    const rid = `rId${nextRid++}`;
    slideRid.set(sp, rid);
    newPresRelTags.push(
      `<Relationship Id="${rid}" Type="${REL_NS}/slide" Target="slides/${basename(rename.get(sp)!)}"/>`,
    );
  }
  out.file(
    "ppt/_rels/presentation.xml.rels",
    origPresRels.replace("</Relationships>", newPresRelTags.join("") + "</Relationships>"),
  );

  // ---- presentation.xml：加 sldMasterId + sldId（sldId 依補充頁序 append 尾端）----
  const sldIds = [...origPres.matchAll(/<p:sldId\b[^>]*\bid="(\d+)"/g)].map((m) => Number(m[1]));
  let nextSldId = Math.max(255, ...sldIds) + 1;
  const masterIdTags = graftedMasters
    .map((gm) => `<p:sldMasterId id="${masterNewId.get(gm)}" r:id="${masterRid.get(gm)}"/>`)
    .join("");
  const sldIdTags = supSlidePaths
    .map((sp) => `<p:sldId id="${nextSldId++}" r:id="${slideRid.get(sp)}"/>`)
    .join("");
  let mergedPres = origPres.replace("</p:sldMasterIdLst>", masterIdTags + "</p:sldMasterIdLst>");
  mergedPres = mergedPres.replace("</p:sldIdLst>", sldIdTags + "</p:sldIdLst>");
  out.file("ppt/presentation.xml", mergedPres);

  // ---- [Content_Types].xml：xml 部件加 Override（CT 取自補充頁自身宣告）；二進位補 Default ----
  const ctInserts: string[] = [];
  const addedDefaults = new Set<string>();
  for (const old of toGraft) {
    const neu = rename.get(old)!;
    const ct = supCtInfo.overrides.get(old);
    if (ct) {
      ctInserts.push(`<Override PartName="/${neu}" ContentType="${escapeXmlAttr(ct)}"/>`);
    } else {
      const ext = extOf(neu);
      if (ext && !origCtInfo.defaults.has(ext) && !addedDefaults.has(ext)) {
        const dct = supCtInfo.defaults.get(ext) ?? CT_BY_EXT[ext];
        if (dct) {
          ctInserts.push(`<Default Extension="${ext}" ContentType="${escapeXmlAttr(dct)}"/>`);
          addedDefaults.add(ext);
        }
      }
    }
  }
  out.file("[Content_Types].xml", origCT.replace("</Types>", ctInserts.join("") + "</Types>"));

  // ---- docProps/app.xml：更新 <Slides> 頁數（其餘 TitlesOfParts 等統計為資訊性，PowerPoint 容忍不一致）----
  if (origNames.includes(APP_PATH)) {
    const added = supSlidePaths.length;
    const app = await readStr(origZip, APP_PATH);
    out.file(APP_PATH, app.replace(/<Slides>(\d+)<\/Slides>/, (_m, n: string) => `<Slides>${Number(n) + added}</Slides>`));
  }

  const outBuf = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return outBuf;
}
