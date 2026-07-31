/**
 * 全站重設計新增版式的契約測試（DESIGN_APPLY_CONTRACT §2 W2）：
 *  1. 新 block（table / timeline / steps）與新選填欄位的 sanitize 往返 ＋ 版面上限守門。
 *  2. `extractSlideText` 涵蓋新 block（會中待講清單／deck 大綱靠它，漏掉＝新頁在檢索面隱形）。
 *  3. supplement 生成：mock LLM 回新 template/新 block → 過 sanitize 後仍是可用的一頁。
 *  4. **pptx 匯出對新版式實測產檔**——匯不出的版式不得進 enum，故此處實際產出 buffer、解壓、
 *     確認新頁確實有內容部件（table/圖形/文字），而非只檢查「沒有 throw」。
 */
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import type { SlideBlock, SlideSpec } from "@meetcopilot/shared";
import {
  AI_GENERATION_TEMPLATES,
  MAX_STEPS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_TIMELINE_TRACKS,
  SLIDE_TEMPLATES,
  extractSlideText,
} from "@meetcopilot/shared";
import type { GeminiClient, Metered, TokenUsage } from "../gemini.js";
import { exportDeckToPptx } from "./pptx-render.js";
import { generateSupplementSlide, sanitizeBlock, sanitizeSlide, slideQaIssues } from "./slide-gen.js";

const USAGE: TokenUsage = { model: "test" };
function fakeGemini(json: unknown, configured = true): GeminiClient {
  return {
    isConfigured: () => configured,
    embed: async () => [],
    embedMetered: async (): Promise<Metered<number[]>> => ({ value: [], usage: USAGE }),
    generateJson: async <T>() => json as T,
    generateJsonMetered: async <T>(): Promise<Metered<T>> => ({ value: json as T, usage: USAGE }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
  };
}

describe("契約：新版式進 enum 且可被 AI 選用", () => {
  it("SLIDE_TEMPLATES 含 timeline-gantt / comparison-matrix", () => {
    expect(SLIDE_TEMPLATES).toContain("timeline-gantt");
    expect(SLIDE_TEMPLATES).toContain("comparison-matrix");
  });

  it("AI 生成子集也含新版式（只排除 image-full）", () => {
    expect(AI_GENERATION_TEMPLATES).toContain("timeline-gantt");
    expect(AI_GENERATION_TEMPLATES).toContain("comparison-matrix");
    expect(AI_GENERATION_TEMPLATES).not.toContain("image-full");
  });
});

describe("sanitizeBlock：table（方案比較表）", () => {
  it("LLM 形狀 {cells:[]} → string[][] 往返", () => {
    expect(
      sanitizeBlock({
        type: "table",
        headers: ["", "我們", "Oracle"],
        rows: [{ cells: ["多久能上線", "6 週", "5–7 個月"] }],
        highlightColumn: 1,
      }),
    ).toEqual({
      type: "table",
      headers: ["", "我們", "Oracle"],
      rows: [["多久能上線", "6 週", "5–7 個月"]],
      highlightColumn: 1,
    });
  });

  it("手工/匯入形狀 string[][] 也收", () => {
    const b = sanitizeBlock({ type: "table", headers: ["", "A"], rows: [["列", "值"]] }) as Extract<SlideBlock, { type: "table" }>;
    expect(b.rows).toEqual([["列", "值"]]);
  });

  it("列長不等於欄數 → 補/裁到等長（渲染器與 pptx 都假設列長 === 欄數）", () => {
    const b = sanitizeBlock({ type: "table", headers: ["", "A", "B"], rows: [{ cells: ["只有一格"] }] }) as Extract<
      SlideBlock,
      { type: "table" }
    >;
    expect(b.rows[0]).toEqual(["只有一格", "", ""]);
  });

  it("欄/列數超過上限 → 截斷到契約上限", () => {
    const headers = Array.from({ length: MAX_TABLE_COLUMNS + 3 }, (_, i) => `h${i}`);
    const rows = Array.from({ length: MAX_TABLE_ROWS + 4 }, (_, i) => ({ cells: headers.map(() => `r${i}`) }));
    const b = sanitizeBlock({ type: "table", headers, rows }) as Extract<SlideBlock, { type: "table" }>;
    expect(b.headers).toHaveLength(MAX_TABLE_COLUMNS);
    expect(b.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(b.rows.every((r) => r.length === MAX_TABLE_COLUMNS)).toBe(true);
  });

  it("只有 1 欄（＝純清單）或全空列 → 濾除", () => {
    expect(sanitizeBlock({ type: "table", headers: ["只有一欄"], rows: [{ cells: ["x"] }] })).toBeNull();
    expect(sanitizeBlock({ type: "table", headers: ["", "A"], rows: [{ cells: ["", " "] }] })).toBeNull();
  });

  it("highlightColumn 超出範圍或指向列標題欄 → 丟棄（不會亮錯欄）", () => {
    const out = (hc: unknown) =>
      (sanitizeBlock({ type: "table", headers: ["", "A", "B"], rows: [{ cells: ["r", "1", "2"] }], highlightColumn: hc }) as
        | Extract<SlideBlock, { type: "table" }>
        | null)?.highlightColumn;
    expect(out(0)).toBeUndefined();
    expect(out(9)).toBeUndefined();
    expect(out(2)).toBe(2);
  });
});

describe("sanitizeBlock：timeline（時間表）", () => {
  it("ticks + tracks 往返，emphasis 白名單外的值被丟掉", () => {
    expect(
      sanitizeBlock({
        type: "timeline",
        ticks: [{ name: "第 1–2 週", title: "盤點現況", emphasis: "on" }, { name: "第 3–4 週", emphasis: "紫色" }],
        tracks: [{ label: "系統整合", startPct: 10, widthPct: 40, emphasis: "warn" }],
      }),
    ).toEqual({
      type: "timeline",
      ticks: [
        { name: "第 1–2 週", title: "盤點現況", emphasis: "on" },
        { name: "第 3–4 週", title: undefined, emphasis: undefined },
      ],
      tracks: [{ label: "系統整合", startPct: 10, widthPct: 40, emphasis: "warn" }],
    });
  });

  it("startPct + widthPct 超過 100 → 夾回版面內（條不會溢出軌道槽）", () => {
    const b = sanitizeBlock({
      type: "timeline",
      ticks: [],
      tracks: [{ label: "爆表", startPct: 80, widthPct: 90 }],
    }) as Extract<SlideBlock, { type: "timeline" }>;
    expect(b.tracks[0]).toMatchObject({ startPct: 80, widthPct: 20 });
  });

  it("負值/字串百分比可救則救，救不了就丟該軌道；軌道全滅 → 整個 block 濾除", () => {
    const b = sanitizeBlock({
      type: "timeline",
      ticks: [{ name: "W1" }],
      tracks: [{ label: "壞的", startPct: "abc", widthPct: 10 }, { label: "負的", startPct: -20, widthPct: "30" }],
    }) as Extract<SlideBlock, { type: "timeline" }>;
    expect(b.tracks).toEqual([{ label: "負的", startPct: 0, widthPct: 30, emphasis: undefined }]);
    expect(sanitizeBlock({ type: "timeline", ticks: [{ name: "W1" }], tracks: [] })).toBeNull();
  });

  it("軌道數超過上限 → 截斷", () => {
    const tracks = Array.from({ length: MAX_TIMELINE_TRACKS + 3 }, (_, i) => ({ label: `t${i}`, startPct: 0, widthPct: 10 }));
    const b = sanitizeBlock({ type: "timeline", ticks: [], tracks }) as Extract<SlideBlock, { type: "timeline" }>;
    expect(b.tracks).toHaveLength(MAX_TIMELINE_TRACKS);
  });
});

describe("sanitizeBlock：steps（流程步驟）＋ 既有 block 的新選填欄位", () => {
  it("steps 往返；無標題的步驟被濾除、超過上限被截斷", () => {
    const steps = [{ title: "簽約", desc: "兩週內", owner: "業務" }, { title: "" }, ...Array.from({ length: MAX_STEPS + 2 }, () => ({ title: "x" }))];
    const b = sanitizeBlock({ type: "steps", steps }) as Extract<SlideBlock, { type: "steps" }>;
    expect(b.steps[0]).toEqual({ title: "簽約", desc: "兩週內", owner: "業務" });
    expect(b.steps).toHaveLength(MAX_STEPS);
    expect(sanitizeBlock({ type: "steps", steps: [{ title: "  " }] })).toBeNull();
  });

  it("bullets.marker 白名單；stat.desc 空白字串不落地", () => {
    expect(sanitizeBlock({ type: "bullets", items: ["a"], marker: "cross" })).toMatchObject({ marker: "cross" });
    expect(sanitizeBlock({ type: "bullets", items: ["a"], marker: "star" })).toMatchObject({ marker: undefined });
    expect(sanitizeBlock({ type: "stat", value: "1", label: "件", desc: "   " })).toMatchObject({ desc: undefined });
  });

  it("chart：series2 長度與 series 不同 → 退回單序列（寧可不畫也不畫錯）", () => {
    const ok = sanitizeBlock({
      type: "chart",
      chartType: "bar",
      series: [{ label: "A", value: 1 }, { label: "B", value: 2 }],
      series2: [{ label: "A", value: 3 }, { label: "B", value: 4 }],
      seriesNames: ["換之前", "換之後", "多餘的"],
    }) as Extract<SlideBlock, { type: "chart" }>;
    expect(ok.series2).toHaveLength(2);
    expect(ok.seriesNames).toEqual(["換之前", "換之後"]);

    const bad = sanitizeBlock({
      type: "chart",
      chartType: "bar",
      series: [{ label: "A", value: 1 }, { label: "B", value: 2 }],
      series2: [{ label: "A", value: 3 }],
    }) as Extract<SlideBlock, { type: "chart" }>;
    expect(bad.series2).toBeUndefined();
  });

  it("chart：centerValue 只對 donut 生效；沒有 centerValue 時 centerLabel 不單獨存在", () => {
    expect(
      (sanitizeBlock({ type: "chart", chartType: "bar", series: [{ label: "A", value: 1 }], centerValue: "240 萬" }) as
        Extract<SlideBlock, { type: "chart" }>).centerValue,
    ).toBeUndefined();
    const d = sanitizeBlock({
      type: "chart",
      chartType: "donut",
      series: [{ label: "A", value: 1 }],
      centerLabel: "一年可省",
    }) as Extract<SlideBlock, { type: "chart" }>;
    expect(d.centerValue).toBeUndefined();
    expect(d.centerLabel).toBeUndefined();
  });
});

describe("extractSlideText 涵蓋新 block（checklist／deck 大綱靠它）", () => {
  it("table / timeline / steps 的文字都被攤平（不會在檢索面隱形）", () => {
    const spec: SlideSpec = {
      id: "n1",
      template: "content",
      source: "ai",
      blocks: [
        { type: "table", headers: ["", "我們", "Oracle"], rows: [["多久能上線", "6 週", "5–7 個月"]], highlightColumn: 1 },
        { type: "timeline", ticks: [{ name: "第 1–2 週", title: "盤點現況" }], tracks: [{ label: "系統整合", startPct: 0, widthPct: 40 }] },
        { type: "steps", steps: [{ title: "簽約", desc: "兩週內", owner: "業務" }] },
      ],
    };
    expect(extractSlideText(spec)).toBe(
      ["我們 / Oracle", "多久能上線 / 6 週 / 5–7 個月", "第 1–2 週: 盤點現況", "系統整合", "簽約: 兩週內", "業務"].join("\n"),
    );
  });

  it("chart 的新欄位也被攤平（成對序列名稱、donut 圓心）", () => {
    const spec: SlideSpec = {
      id: "n2",
      template: "content",
      source: "ai",
      blocks: [
        {
          type: "chart",
          chartType: "donut",
          series: [{ label: "人力", value: 100 }],
          centerValue: "240 萬",
          centerLabel: "一年可省",
        },
      ],
    };
    expect(extractSlideText(spec)).toBe(["人力: 100", "240 萬", "一年可省"].join("\n"));
  });
});

describe("slideQaIssues：新版式的空殼頁會被標記重做", () => {
  it("timeline-gantt 沒有 timeline block、comparison-matrix 沒有 table block → 各自標記", () => {
    const shell = (template: SlideSpec["template"]): SlideSpec => ({
      id: "x",
      template,
      source: "ai",
      blocks: [{ type: "heading", text: "只有標題的空殼頁而已沒有主角區塊" }],
    });
    expect(slideQaIssues(shell("timeline-gantt"))).toContain("timeline-missing");
    expect(slideQaIssues(shell("comparison-matrix"))).toContain("matrix-missing");
    expect(
      slideQaIssues({
        ...shell("comparison-matrix"),
        blocks: [{ type: "heading", text: "比一比" }, { type: "table", headers: ["", "A"], rows: [["r", "1"]] }],
      }),
    ).not.toContain("matrix-missing");
  });
});

describe("supplement 生成：LLM 回新版式 → 過 sanitize 仍是可用的一頁", () => {
  const input = { transcriptContext: "對方問什麼時候能上線", signalSummary: "timeline_question" };

  it("timeline-gantt（時程訊號）", async () => {
    const gemini = fakeGemini({
      template: "timeline-gantt",
      blocks: [
        { type: "heading", text: "六週可以上線" },
        {
          type: "timeline",
          ticks: [{ name: "第 1–2 週", title: "盤點現況" }, { name: "第 3–4 週", title: "串接" }],
          tracks: [
            { label: "系統整合", startPct: 0, widthPct: 60 },
            { label: "教育訓練", startPct: 60, widthPct: 60 },
          ],
        },
      ],
    });
    const slide = await generateSupplementSlide(gemini, "m", "zh-TW", input);
    expect(slide).not.toBeNull();
    expect(slide!.template).toBe("timeline-gantt");
    const tl = slide!.blocks.find((b) => b.type === "timeline") as Extract<SlideBlock, { type: "timeline" }>;
    expect(tl.tracks).toHaveLength(2);
    // 第二條原本會溢出（60+60）→ 被夾回版面內。
    expect(tl.tracks[1]).toMatchObject({ startPct: 60, widthPct: 40 });
  });

  it("comparison-matrix（競品比較訊號）", async () => {
    const gemini = fakeGemini({
      template: "comparison-matrix",
      blocks: [
        { type: "heading", text: "跟 Oracle 比" },
        {
          type: "table",
          headers: ["", "我們", "Oracle"],
          rows: [{ cells: ["多久能上線", "6 週", "5–7 個月"] }, { cells: ["第一年費用", "168 萬", "約 400 萬"] }],
          highlightColumn: 1,
        },
      ],
    });
    const slide = await generateSupplementSlide(gemini, "m", "zh-TW", input);
    expect(slide!.template).toBe("comparison-matrix");
    expect(slide!.blocks.find((b) => b.type === "table")).toBeDefined();
  });

  it("steps（下一步訊號）掛在 content 頁", async () => {
    const gemini = fakeGemini({
      template: "content",
      blocks: [
        { type: "heading", text: "接下來四步" },
        { type: "steps", steps: [{ title: "簽約" }, { title: "串接", owner: "IT" }, { title: "上線" }] },
      ],
    });
    const slide = await generateSupplementSlide(gemini, "m", "zh-TW", input);
    const st = slide!.blocks.find((b) => b.type === "steps") as Extract<SlideBlock, { type: "steps" }>;
    expect(st.steps.map((s) => s.title)).toEqual(["簽約", "串接", "上線"]);
  });

  it("空殼守門：timeline-gantt 但 timeline block 被 sanitize 濾光 → 不 suggest（回 null）", async () => {
    // tracks 全壞（label 空、百分比非數字）→ sanitize 後 timeline 整塊消失，只剩一個 heading。
    const gemini = fakeGemini({
      template: "timeline-gantt",
      blocks: [
        { type: "heading", text: "六週可以上線" },
        { type: "timeline", ticks: [], tracks: [{ label: "", startPct: "x", widthPct: null }] },
      ],
    });
    expect(await generateSupplementSlide(gemini, "m", "zh-TW", input)).toBeNull();
  });

  it("空殼守門：comparison-matrix 但沒有 table block → 不 suggest（回 null）", async () => {
    const gemini = fakeGemini({
      template: "comparison-matrix",
      blocks: [{ type: "heading", text: "跟 Oracle 比" }, { type: "paragraph", text: "我們比較快" }],
    });
    expect(await generateSupplementSlide(gemini, "m", "zh-TW", input)).toBeNull();
  });

  it("空殼守門只針對那兩個版式：content 頁沒有 table/timeline 仍照常 suggest", async () => {
    const gemini = fakeGemini({
      template: "content",
      blocks: [{ type: "heading", text: "一句話回應" }, { type: "paragraph", text: "我們六週能上線，含教育訓練。" }],
    });
    expect(await generateSupplementSlide(gemini, "m", "zh-TW", input)).not.toBeNull();
  });

  it("LLM 亂回的 template → 退回 content（enum 之外的值不落地）", () => {
    expect(sanitizeSlide({ template: "gantt-chart-3d", blocks: [{ type: "heading", text: "x" }] }).template).toBe("content");
  });
});

describe("pptx 匯出：新 block／新 template 實測產檔", () => {
  const NEW_DECK: SlideSpec[] = [
    {
      id: "n1",
      template: "timeline-gantt",
      source: "ai",
      eyebrow: "導入時程",
      blocks: [
        { type: "heading", text: "六週可以上線" },
        {
          type: "timeline",
          ticks: [
            { name: "第 1–2 週", title: "盤點現況", emphasis: "on" },
            { name: "第 3–4 週", title: "串接", emphasis: "warn" },
            { name: "第 5–6 週", title: "上線", emphasis: "off" },
          ],
          tracks: [
            { label: "系統整合", startPct: 0, widthPct: 60 },
            { label: "教育訓練", startPct: 55, widthPct: 45, emphasis: "warn" },
          ],
        },
      ],
    },
    {
      id: "n2",
      template: "comparison-matrix",
      source: "ai",
      blocks: [
        { type: "heading", text: "方案比一比" },
        {
          type: "table",
          headers: ["", "我們", "Oracle", "自己開發"],
          rows: [
            ["多久能上線", "6 週", "5–7 個月", "看人力"],
            ["第一年費用", "168 萬", "約 400 萬", "難估"],
          ],
          highlightColumn: 1,
        },
      ],
    },
    {
      id: "n3",
      template: "content",
      source: "ai",
      blocks: [
        { type: "heading", text: "接下來四步" },
        {
          type: "steps",
          steps: [
            { title: "簽約", desc: "兩週內完成", owner: "業務" },
            { title: "串接", desc: "接現有 ERP", owner: "IT" },
            { title: "試跑", owner: "產線" },
            { title: "全面上線" },
          ],
        },
      ],
    },
    {
      id: "n4",
      template: "content",
      source: "ai",
      blocks: [
        { type: "heading", text: "換之前 → 換之後" },
        {
          type: "chart",
          chartType: "bar",
          series: [{ label: "人力", value: 120 }, { label: "庫存", value: 90 }],
          series2: [{ label: "人力", value: 80 }, { label: "庫存", value: 62 }],
          seriesNames: ["換之前", "換之後"],
          caption: "百萬 / 年",
        },
      ],
    },
    {
      id: "n5",
      template: "content",
      source: "ai",
      blocks: [
        { type: "heading", text: "省下來的錢從哪來" },
        {
          type: "chart",
          chartType: "donut",
          series: [{ label: "人力", value: 42 }, { label: "庫存", value: 26 }],
          centerValue: "240 萬",
          centerLabel: "一年可省",
        },
      ],
    },
    {
      id: "n6",
      template: "stats",
      source: "ai",
      blocks: [
        { type: "heading", text: "導入後的三個數字" },
        { type: "stat", value: "6 週", label: "上線時間", desc: "含教育訓練" },
        { type: "stat", value: "38%", label: "人力節省" },
      ],
    },
    {
      id: "n7",
      template: "content",
      source: "ai",
      blocks: [
        { type: "heading", text: "現在 → 之後" },
        {
          type: "two-col",
          left: [{ type: "bullets", items: ["對帳靠人工"], marker: "cross" }],
          right: [{ type: "bullets", items: ["15 分鐘一次自動同步"], marker: "check" }],
        },
      ],
    },
  ];

  it("含全部新 block／新 template 的 deck 匯得出檔（>0 bytes、可解壓、頁數正確）", async () => {
    const buf = await exportDeckToPptx({ title: "new-layouts", language: "zh-TW" }, NEW_DECK);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slides).toHaveLength(NEW_DECK.length);
  });

  it("timeline 頁有軌道圖形、matrix 頁有原生表格、steps 頁有四欄文字", async () => {
    const buf = await exportDeckToPptx({ title: "new-layouts", language: "zh-TW" }, NEW_DECK);
    const zip = await JSZip.loadAsync(buf);
    const xml = async (i: number) => zip.file(`ppt/slides/slide${i}.xml`)!.async("string");

    const timeline = await xml(1);
    // 3 個刻度色條 + 2 條軌道各（槽 + 條）= 7 個矩形；文字含刻度名與軌道名。
    expect((timeline.match(/<p:sp>/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(timeline).toContain("系統整合");
    expect(timeline).toContain("第 1–2 週");

    const matrix = await xml(2);
    expect(matrix).toContain("<a:tbl>"); // 原生 pptx 表格（可在 PowerPoint 內續編）
    expect(matrix).toContain("Oracle");
    expect(matrix).toContain("168 萬");

    const steps = await xml(3);
    for (const t of ["01", "02", "03", "04", "簽約", "接現有 ERP", "業務"]) expect(steps).toContain(t);
  });

  it("成對雙序列匯成兩個 data set；donut 圓心數字有落到頁面上", async () => {
    const buf = await exportDeckToPptx({ title: "new-layouts", language: "zh-TW" }, NEW_DECK);
    const zip = await JSZip.loadAsync(buf);
    const charts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(charts.length).toBeGreaterThanOrEqual(2);
    const barChart = (await Promise.all(charts.map((n) => zip.file(n)!.async("string")))).find((x) => x.includes("換之前"));
    expect(barChart).toBeDefined();
    expect(barChart).toContain("換之後"); // 第二序列的名稱
    expect(await zip.file("ppt/slides/slide5.xml")!.async("string")).toContain("240 萬");
  });

  it("stat.desc 與 bullets.marker 的文字都有進匯出（不會只在螢幕看得到）", async () => {
    const buf = await exportDeckToPptx({ title: "new-layouts", language: "zh-TW" }, NEW_DECK);
    const zip = await JSZip.loadAsync(buf);
    expect(await zip.file("ppt/slides/slide6.xml")!.async("string")).toContain("含教育訓練");
    const two = await zip.file("ppt/slides/slide7.xml")!.async("string");
    expect(two).toContain("對帳靠人工");
    expect(two).toContain("15 分鐘一次自動同步");
  });

  it("bullets.marker 的記號本身也進匯出（✕/✓ 前綴，且不再疊原生圓點）", async () => {
    const buf = await exportDeckToPptx({ title: "new-layouts", language: "zh-TW" }, NEW_DECK);
    const zip = await JSZip.loadAsync(buf);
    const two = await zip.file("ppt/slides/slide7.xml")!.async("string");
    // 沒有記號的話「現況 vs 導入後」兩欄在 .pptx 裡長得一模一樣，語意整個消失。
    expect(two).toContain("✕ 對帳靠人工");
    expect(two).toContain("✓ 15 分鐘一次自動同步");
  });

  it("marker 的清單關掉原生圓點；無 marker 的清單維持圓點（buChar/buNone 二選一）", async () => {
    const zipOf = async (blocks: SlideBlock[]) =>
      JSZip.loadAsync(
        await exportDeckToPptx({ title: "b", language: "zh-TW" }, [{ id: "b", template: "content", source: "ai", blocks }]),
      );
    const marked = await (await zipOf([{ type: "bullets", items: ["有記號"], marker: "check" }]))
      .file("ppt/slides/slide1.xml")!
      .async("string");
    const plain = await (await zipOf([{ type: "bullets", items: ["沒記號"] }]))
      .file("ppt/slides/slide1.xml")!
      .async("string");
    expect(marked).toContain("<a:buNone/>");
    expect(plain).not.toContain("<a:buNone/>");
    expect(plain).toContain("<a:buChar");
  });

  it("成對比較的兩序列配色＝螢幕的（近底灰, accent），不是兩個彩色", async () => {
    const buf = await exportDeckToPptx({ title: "paired", language: "zh-TW" }, [NEW_DECK[3]!]);
    const zip = await JSZip.loadAsync(buf);
    const chartName = Object.keys(zip.files).find((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))!;
    const chart = await zip.file(chartName)!.async("string");
    // 預設淺紙主題：sunk = color-mix(#15130F 7%, #F7F5F1) = E7E5E1；accent = 12708C。
    expect(chart).toContain("E7E5E1");
    expect(chart).toContain("12708C");
  });
});

describe("pptx 預設主題＝淺紙（2026-07-31 裁決，對齊螢幕 studio-present.css 預設）", () => {
  it("無 per-deck theme 的頁：底色 F7F5F1、文字 15130F、主色 12708C（不再是深藍夜色）", async () => {
    const buf = await exportDeckToPptx({ title: "d", language: "zh-TW" }, [
      { id: "d", template: "content", source: "ai", eyebrow: "重點", blocks: [{ type: "heading", text: "標題" }] },
    ]);
    const xml = await (await JSZip.loadAsync(buf)).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("F7F5F1"); // 頁底
    expect(xml).toContain("15130F"); // 標題字
    expect(xml).toContain("12708C"); // eyebrow / 主色
    for (const old of ["18233B", "E6EBF5", "22D3EE", "96A2C2"]) expect(xml).not.toContain(old);
  });

  it("per-deck theme 路徑不動：顯式 theme 仍逐值採用，muted 仍是既有的 96A2C2", async () => {
    const buf = await exportDeckToPptx({ title: "d", language: "zh-TW" }, [
      {
        id: "d",
        template: "content",
        source: "ai",
        theme: { bg: "#101820", text: "#EEF2F7", accent: "#FF8800" },
        blocks: [{ type: "heading", text: "標題" }, { type: "subheading", text: "副標" }],
      },
    ]);
    const xml = await (await JSZip.loadAsync(buf)).file("ppt/slides/slide1.xml")!.async("string");
    expect(xml).toContain("101820");
    expect(xml).toContain("EEF2F7");
    expect(xml).toContain("96A2C2"); // subheading 走 theme.muted，顯式主題維持原值
  });
});
