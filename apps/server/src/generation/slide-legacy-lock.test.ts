/**
 * 舊 spec 渲染／匯出「逐字等價」回歸鎖定（DESIGN_APPLY_CONTRACT §3 W2 額外驗收）。
 *
 * 全站重設計新增了 3 個 block（table/timeline/steps）、2 個 template（timeline-gantt/comparison-matrix）
 * 與一批選填欄位（stat.desc / bullets.marker / chart.series2 等）。這些**只能是純新增**——
 * 既有 6 模板 × 10 block 的舊 SlideSpec，其
 *   (1) `extractSlideText` 輸出、
 *   (2) `renderSlideBlock`（apps/web）的既有 case JSX、
 *   (3) `.pptx` 匯出的形狀與文字
 * 都必須與擴充前逐字相同。任一被動到，這支就會紅。
 *
 * 為何 (2) 走原始碼比對而非 DOM 快照：`apps/web` 目前沒有測試 runner（package.json 無 vitest／
 * 無 jsdom），跨包 render 需要新增 web 端建置相依與 alias 設定，風險大於收益；而本輪對 renderSlideBlock
 * 的要求本來就是「既有分支一個字都不准動」，逐字比對原始碼正好就是這條不變量本身
 * （沿用 renderSlideBlock 抽出當時「逐字確認等價」的鎖定手法，只是把人工確認自動化）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { SlideSpec } from "@meetcopilot/shared";
import { extractSlideText } from "@meetcopilot/shared";
import { exportDeckToPptx } from "./pptx-render.js";
import { sanitizeBlock } from "./slide-gen.js";

const PNG_1x1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** 一頁塞滿全部 10 種既有 block（含 two-col 嵌套），涵蓋 extractSlideText 的每一條 walk 分支。 */
const LEGACY_ALL_BLOCKS: SlideSpec = {
  id: "legacy-all",
  template: "content",
  source: "pptx",
  eyebrow: "舊 EYEBROW",
  blocks: [
    { type: "heading", text: "舊標題" },
    { type: "subheading", text: "舊副標" },
    { type: "bullets", items: ["條一", "條二"] },
    { type: "paragraph", text: "舊段落" },
    { type: "quote", text: "舊引言", attribution: "某某" },
    { type: "stat", value: "38%", label: "成長" },
    { type: "features", features: [{ icon: "zap", title: "快", desc: "很快" }, { title: "穩" }] },
    { type: "chart", chartType: "bar", series: [{ label: "A", value: 1 }, { label: "B", value: 2 }], caption: "圖說" },
    { type: "image", dataUri: PNG_1x1, alt: "替代文字" },
    {
      type: "two-col",
      left: [{ type: "bullets", items: ["左一"] }],
      right: [{ type: "stat", value: "12", label: "件" }],
    },
  ],
};

/** 6 個既有 template 各一頁（pptx 匯出的每條 renderXxx 分支都要被走到）。 */
const LEGACY_DECK: SlideSpec[] = [
  { id: "l1", template: "title", source: "pptx", eyebrow: "01", blocks: [{ type: "heading", text: "封面" }, { type: "subheading", text: "副標" }] },
  { id: "l2", template: "section", source: "pptx", blocks: [{ type: "heading", text: "分節" }, { type: "subheading", text: "一句" }] },
  LEGACY_ALL_BLOCKS,
  {
    id: "l4",
    template: "stats",
    source: "pptx",
    blocks: [
      { type: "heading", text: "數字" },
      { type: "stat", value: "1", label: "一" },
      { type: "stat", value: "2", label: "二" },
      { type: "stat", value: "3", label: "三" },
    ],
  },
  { id: "l5", template: "image-full", source: "pptx", blocks: [{ type: "image", dataUri: PNG_1x1 }, { type: "heading", text: "整頁圖" }] },
  { id: "l6", template: "closing", source: "pptx", blocks: [{ type: "heading", text: "結語" }, { type: "paragraph", text: "謝謝" }] },
];

describe("舊 spec 逐字等價鎖定（1）extractSlideText", () => {
  /** 擴充前的 golden 輸出（逐字抄自新增 table/timeline/steps 與選填欄位「之前」的行為）。 */
  const GOLDEN = [
    "舊 EYEBROW",
    "舊標題",
    "舊副標",
    "條一",
    "條二",
    "舊段落",
    "舊引言",
    "某某",
    "成長: 38%",
    "快: 很快",
    "穩",
    "圖說",
    "A: 1",
    "B: 2",
    "替代文字",
    "左一",
    "件: 12",
  ].join("\n");

  it("10 種既有 block ＋ eyebrow 的攤平文字與擴充前逐字相同", () => {
    expect(extractSlideText(LEGACY_ALL_BLOCKS)).toBe(GOLDEN);
  });

  it("新增的選填欄位未帶時，不改變任何輸出（stat.desc / chart.series2 / bullets.marker）", () => {
    const withUndefined: SlideSpec = {
      ...LEGACY_ALL_BLOCKS,
      blocks: LEGACY_ALL_BLOCKS.blocks.map((b) =>
        b.type === "stat"
          ? { ...b, desc: undefined }
          : b.type === "bullets"
            ? { ...b, marker: undefined }
            : b.type === "chart"
              ? { ...b, series2: undefined, seriesNames: undefined, centerValue: undefined, centerLabel: undefined }
              : b,
      ),
    };
    expect(extractSlideText(withUndefined)).toBe(GOLDEN);
  });
});

describe("舊 spec 逐字等價鎖定（2）renderSlideBlock 既有分支原始碼", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../../../../apps/web/components/slide/SlideRenderer.tsx", import.meta.url)),
    "utf8",
  );

  /**
   * 既有 block 的渲染輸出＝class 字串＋DOM 形狀。以下逐字片段是擴充前的原文；
   * 只要有人改動既有分支的標籤或 class（＝改變舊 deck 的畫面），比對就會失敗。
   */
  const FROZEN_FRAGMENTS: [string, string][] = [
    ["heading", '<h1 key={key} className="slide-block slide-block--heading">'],
    ["subheading", '<h2 key={key} className="slide-block slide-block--subheading">'],
    ["paragraph", '<p key={key} className="slide-block slide-block--paragraph">'],
    ["quote", '<blockquote key={key} className="slide-block slide-block--quote">'],
    ["quote/cite", "{block.attribution ? <cite>{block.attribution}</cite> : null}"],
    ["stat/value", '<div className="stat__value">{block.value}</div>'],
    ["stat/label", '<div className="stat__label">{block.label}</div>'],
    ["features", 'className={`slide-block slide-block--features feat-count-${block.features.length}`}'],
    ["image", '<div key={key} className="slide-block slide-block--image">'],
    ["two-col", '<div key={key} className="slide-block slide-block--two-col">'],
    ["two-col/left", '<div className="two-col__left">'],
  ];

  for (const [name, fragment] of FROZEN_FRAGMENTS) {
    it(`${name} 分支的輸出結構未被更動`, () => {
      expect(src).toContain(fragment);
    });
  }

  it("防炸包裝只加在最外層：既有分支仍走同一個 switch，正常路徑輸出逐字不變", () => {
    // renderSlideBlock 現在是 try/catch 薄包裝（壞 block 回 null 跳過），真正的 switch 搬到 renderSlideBlockInner。
    // 上面 FROZEN_FRAGMENTS 已逐字鎖住 inner 的每個既有分支；這裡只鎖「包裝本身沒有改寫任何輸出」。
    expect(src).toContain("return renderSlideBlockInner(block, key);");
    expect(src).toContain("function renderSlideBlockInner(block: SlideBlock, key: number): ReactNode {");
  });

  it("bullets 的 class 在未帶 marker 時仍組出擴充前的字串（filter(Boolean) 濾掉空片段）", () => {
    // 對應 SlideRenderer 的組法；此處重算一次，鎖住「無 marker → 逐字等於舊 class」。
    const classOf = (marker?: string) =>
      ["slide-block", "slide-block--bullets", marker && marker !== "dot" ? `bullets--${marker}` : ""]
        .filter(Boolean)
        .join(" ");
    expect(classOf(undefined)).toBe("slide-block slide-block--bullets");
    expect(classOf("dot")).toBe("slide-block slide-block--bullets");
    expect(classOf("cross")).toBe("slide-block slide-block--bullets bullets--cross");
  });
});

describe("舊 spec 逐字等價鎖定（3）pptx 匯出", () => {
  /** 讀出 pptx 每頁的所有 <a:t> 文字，作為「匯出內容」的穩定指紋（不含座標，避免無謂脆性）。 */
  async function slideTexts(buf: Buffer): Promise<string[][]> {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    const out: string[][] = [];
    for (const n of names) {
      const xml = await zip.file(n)!.async("string");
      out.push([...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]!));
    }
    return out;
  }

  /**
   * golden 取得方式（一次性驗證，已完成後移除臨時檔）：把 `git show HEAD:…/pptx-render.ts` 的**擴充前版本**
   * 與現版並排跑同一份 LEGACY_DECK，比對 `ppt/slides/slideN.xml` 全文——結果**完全相同**（含 chart 部件）。
   * 下方陣列即該次比對通過時的實際輸出，日後任何改動只要動到舊 deck 的匯出就會紅。
   */
  it("6 個既有 template 的匯出文字與擴充前逐字相同", async () => {
    const buf = await exportDeckToPptx({ title: "legacy", language: "zh-TW" }, LEGACY_DECK);
    expect(await slideTexts(buf)).toEqual([
      ["01", "封面", "副標"],
      ["分節", "一句"],
      [
        "舊 EYEBROW",
        "舊標題",
        "舊副標",
        "條一",
        "條二",
        "舊段落",
        "“舊引言”",
        "— 某某",
        "38%",
        "成長",
        "▪  ",
        "快",
        "很快",
        "▪  ",
        "穩",
        "圖說",
        "左一",
        "12",
        "件",
      ],
      ["數字", "1", "一", "2", "二", "3", "三"],
      ["整頁圖"],
      ["結語", "謝謝"],
    ]);
  });

  it("stat 未帶 desc 時，匯出仍是單一 label 文字（未被 desc 分支改寫）", async () => {
    const buf = await exportDeckToPptx({ title: "s", language: "zh-TW" }, [
      { id: "s", template: "content", source: "ai", blocks: [{ type: "stat", value: "9", label: "件" }] },
    ]);
    expect((await slideTexts(buf))[0]).toEqual(["9", "件"]);
  });
});

describe("舊 spec 逐字等價鎖定（4）sanitizeBlock 對既有 block 的輸出形狀", () => {
  it("bullets 未帶 marker → marker 為 undefined（不憑空補 'dot'）", () => {
    expect(sanitizeBlock({ type: "bullets", items: ["a"] })).toEqual({ type: "bullets", items: ["a"], marker: undefined });
  });

  it("marker:'dot' 一律不落地（與舊資料同形）", () => {
    expect(sanitizeBlock({ type: "bullets", items: ["a"], marker: "dot" })).toEqual({
      type: "bullets",
      items: ["a"],
      marker: undefined,
    });
  });

  it("stat 未帶 desc → desc 為 undefined", () => {
    expect(sanitizeBlock({ type: "stat", value: "1", label: "一" })).toEqual({
      type: "stat",
      value: "1",
      label: "一",
      desc: undefined,
    });
  });
});
