/**
 * pptx-merge 單元測試（契約 §10 驗收）：合併後
 *  - well-formed（無懸空 rels；所有內部 target 都指向存在的部件）
 *  - 頁數正確（sldIdLst = 原 + 補充；sldMasterIdLst = 原 + 補充 master）
 *  - 原始部件 byte 不變（除 spine + app.xml 外，全 byte-for-byte 保留）
 *  - docProps/app.xml <Slides> 更新
 *  - 補充頁的 media / chart 部件確實嫁接、且都在 [Content_Types] 宣告
 *
 * 測試資料以 pptxgenjs（exportDeckToPptx）現產：原 deck 無圖無表；補充 deck 一張含圖、一張含 chart。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { SlideSpec } from "@meetcopilot/shared";
import { exportDeckToPptx } from "./pptx-render.js";
import { mergePptx } from "./pptx-merge.js";
import { readPptxCanvasInches } from "./canvas-size.js";

/** 讀 pptx 的 <p:sldSz> cx/cy（EMU）——驗補充頁是否被產在與原檔相同的畫布。 */
async function sldSzEmu(buf: Buffer): Promise<{ cx: number; cy: number }> {
  const zip = await JSZip.loadAsync(buf);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  const tag = pres.match(/<p:sldSz\b[^>]*\/?>/)![0];
  return { cx: Number(tag.match(/\bcx="(\d+)"/)![1]), cy: Number(tag.match(/\bcy="(\d+)"/)![1]) };
}

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function spec(id: string, template: SlideSpec["template"], blocks: SlideSpec["blocks"]): SlideSpec {
  return { id, template, blocks, source: "ai" };
}

const ORIG_SPECS: SlideSpec[] = [
  spec("o1", "title", [
    { type: "heading", text: "Original Cover" },
    { type: "subheading", text: "Deck" },
  ]),
  spec("o2", "content", [
    { type: "heading", text: "Agenda" },
    { type: "bullets", items: ["A", "B", "C"] },
  ]),
  spec("o3", "stats", [
    { type: "heading", text: "Numbers" },
    { type: "stat", value: "42%", label: "growth" },
  ]),
];

const SUP_SPECS: SlideSpec[] = [
  spec("s1", "image-full", [
    { type: "image", dataUri: PNG_1x1 },
    { type: "heading", text: "Supplement Image" },
  ]),
  spec("s2", "content", [
    { type: "heading", text: "Supplement Chart" },
    {
      type: "chart",
      chartType: "bar",
      series: [
        { label: "Q1", value: 10 },
        { label: "Q2", value: 20 },
      ],
      caption: "demo",
    },
  ]),
];

function parts(zip: JSZip): string[] {
  return Object.keys(zip.files).filter((n) => !zip.files[n]!.dir);
}

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

const SPINE = new Set([
  "[Content_Types].xml",
  "ppt/presentation.xml",
  "ppt/_rels/presentation.xml.rels",
  "docProps/app.xml",
]);

describe("mergePptx", () => {
  it("grafts supplement onto the tail: well-formed, correct counts, byte-stable originals, app.xml updated", async () => {
    const origBuf = await exportDeckToPptx({ title: "orig", language: "zh-TW" }, ORIG_SPECS);
    const supBuf = await exportDeckToPptx({ title: "sup", language: "zh-TW" }, SUP_SPECS);
    const merged = await mergePptx(origBuf, supBuf);

    const oZip = await JSZip.loadAsync(origBuf);
    const sZip = await JSZip.loadAsync(supBuf);
    const mZip = await JSZip.loadAsync(merged);
    const mNames = new Set(parts(mZip));

    // ── 頁數：sldId = 3 + 2 = 5 ──
    const mPres = await mZip.file("ppt/presentation.xml")!.async("string");
    expect([...mPres.matchAll(/<p:sldId\b/g)].length).toBe(5);

    // ── master：sldMasterId = 原 + 補充 ──
    const oPres = await oZip.file("ppt/presentation.xml")!.async("string");
    const sPres = await sZip.file("ppt/presentation.xml")!.async("string");
    const oMasters = [...oPres.matchAll(/<p:sldMasterId\b/g)].length;
    const sMasters = [...sPres.matchAll(/<p:sldMasterId\b/g)].length;
    expect([...mPres.matchAll(/<p:sldMasterId\b/g)].length).toBe(oMasters + sMasters);

    // ── docProps/app.xml <Slides> 更新為 5 ──
    const app = await mZip.file("docProps/app.xml")!.async("string");
    expect(app).toMatch(/<Slides>5<\/Slides>/);

    // ── 原始部件 byte 不變（除 spine + app.xml）──
    for (const name of parts(oZip)) {
      if (SPINE.has(name)) continue;
      const oBytes = await oZip.file(name)!.async("nodebuffer");
      const mFile = mZip.file(name);
      expect(mFile, `merged missing original part ${name}`).toBeTruthy();
      const mBytes = await mFile!.async("nodebuffer");
      expect(Buffer.compare(oBytes, mBytes), `original part changed: ${name}`).toBe(0);
    }

    // ── 新 slide 部件皆有 [Content_Types] Override ──
    const ct = await mZip.file("[Content_Types].xml")!.async("string");
    const oSlides = new Set(parts(oZip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)));
    const newSlides = parts(mZip).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n) && !oSlides.has(n));
    expect(newSlides.length).toBe(2);
    for (const s of newSlides) {
      expect(ct.includes(`PartName="/${s}"`), `no content-type override for ${s}`).toBe(true);
    }

    // ── 補充頁 media（圖）與 chart 部件確實嫁接 ──
    const countMatch = (zip: JSZip, re: RegExp): number => parts(zip).filter((n) => re.test(n)).length;
    expect(countMatch(mZip, /^ppt\/media\//)).toBeGreaterThan(countMatch(oZip, /^ppt\/media\//));
    expect(countMatch(mZip, /^ppt\/charts\/chart\d+\.xml$/)).toBeGreaterThan(
      countMatch(oZip, /^ppt\/charts\/chart\d+\.xml$/),
    );

    // ── well-formed：每個 rels 的內部 target 都指向存在的部件（無懸空）──
    for (const name of parts(mZip)) {
      if (!name.endsWith(".rels")) continue;
      const baseDir = name.replace(/\/?_rels\/[^/]+$/, "");
      const relsXml = await mZip.file(name)!.async("string");
      for (const m of relsXml.matchAll(/<Relationship\b[^>]*?\/>/g)) {
        const tag = m[0];
        const mode = (tag.match(/TargetMode="([^"]*)"/) || [])[1];
        if (mode === "External") continue;
        const target = (tag.match(/Target="([^"]*)"/) || [])[1];
        if (!target) continue;
        const resolved = resolvePath(baseDir, target);
        expect(mNames.has(resolved), `dangling rel in ${name}: ${target} → ${resolved}`).toBe(true);
      }
    }

    // ── presentation.xml.rels 的新 slide/master 目標存在 ──
    const presRels = await mZip.file("ppt/_rels/presentation.xml.rels")!.async("string");
    for (const m of presRels.matchAll(/Target="([^"]*)"/g)) {
      const resolved = resolvePath("ppt", m[1]!);
      // 略過外部（無此類）；相對套件路徑須存在
      if (/^https?:/i.test(m[1]!)) continue;
      expect(mNames.has(resolved), `presentation.xml.rels dangling: ${m[1]}`).toBe(true);
    }
  });

  it("supplement is produced at the original (non-16:9) canvas size, not hardcoded 10×5.625", async () => {
    // 原檔＝寬螢幕 13.333×7.5（PowerPoint/Keynote 預設），非 16:9 標準 10×5.625。
    const WIDE = { widthInches: 13.333, heightInches: 7.5 };
    const origBuf = await exportDeckToPptx({ title: "orig", language: "zh-TW" }, ORIG_SPECS, WIDE);

    // export-handler 路徑：讀原檔 sldSz → 以該尺寸產補充頁。
    const canvas = await readPptxCanvasInches(origBuf);
    expect(canvas).not.toBeNull();
    expect(canvas!.widthInches).toBeCloseTo(13.333, 2);
    expect(canvas!.heightInches).toBeCloseTo(7.5, 2);

    const supBuf = await exportDeckToPptx({ title: "sup", language: "zh-TW" }, SUP_SPECS, canvas!);

    // 核心斷言：補充頁的畫布（sldSz EMU）＝原檔畫布 → 合併回原檔不會只佔左上一角。
    const origSz = await sldSzEmu(origBuf);
    const supSz = await sldSzEmu(supBuf);
    expect(supSz).toEqual(origSz);

    // 合併後 sldSz 仍為原檔畫布（mergePptx 保留原檔 presentation.xml 的 sldSz）。
    const merged = await mergePptx(origBuf, supBuf);
    expect(await sldSzEmu(merged)).toEqual(origSz);

    // 對照：不給尺寸＝預設 10×5.625，其 EMU 與寬螢幕原檔不同 → 證明尺寸來自原檔而非寫死。
    const defaultBuf = await exportDeckToPptx({ title: "d", language: "zh-TW" }, SUP_SPECS);
    const defSz = await sldSzEmu(defaultBuf);
    expect(defSz.cx).not.toBe(origSz.cx);
    const defCanvas = await readPptxCanvasInches(defaultBuf);
    expect(defCanvas!.widthInches).toBeCloseTo(10, 2);
    expect(defCanvas!.heightInches).toBeCloseTo(5.625, 2);
  });

  it("throws when supplement has no slides (defensive; handler short-circuits 0 supplement upstream)", async () => {
    const origBuf = await exportDeckToPptx({ title: "orig", language: "zh-TW" }, ORIG_SPECS);
    const supBuf = await exportDeckToPptx({ title: "sup", language: "zh-TW" }, SUP_SPECS);
    const z = await JSZip.loadAsync(supBuf);
    for (const n of Object.keys(z.files)) {
      if (/^ppt\/slides\/slide\d+\.xml$/.test(n)) z.remove(n);
    }
    const stripped = await z.generateAsync({ type: "nodebuffer" });
    await expect(mergePptx(origBuf, stripped)).rejects.toThrow(/no slides/);
  });
});
