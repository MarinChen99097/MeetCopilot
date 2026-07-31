/**
 * Deck → .pptx 匯出（供離線分享）。借 v1 apps/server/src/export/pptx.ts，重寫對齊 v2 SlideSpec。
 *
 * 用 pptxgenjs 把 SlideSpec[] 逐頁映射成一頁「有設計」的投影片——每個 template 有專屬版型
 * （title/section/content/stats/closing/image-full），blocks 依型別各自渲染成對應設計元件
 * （features 走 2 欄卡片格、chart 走原生 pptx 圖表而非文字列表）。
 *
 * 顏色：pptxgenjs 一律吃「不含 #」的 6 碼 hex；slide.theme 有值就蓋預設值，否則退回 DEFAULT_THEME。
 * 螢幕↔匯出配色一致：bg / chart 色對齊 web 端投影片預設（見 CHART_ACCENT_HUES）。
 * 穩健性：單一 block/slide 絕不使整份匯出失敗——有風險的呼叫都包 try/catch，壞了略過該元件。
 */
import PptxGenJS from "pptxgenjs";
import type { ChartType, SlideBlock, SlideSpec, SlideTheme, FeatureItem } from "@meetcopilot/shared";
import { CHART_ACCENT_HUES, SLIDE_DEFAULT_THEME, isRasterImageDataUri } from "@meetcopilot/shared";

const HEX_RE = /^[0-9a-fA-F]{6}$/;

/** bullets.marker → .pptx 文字前綴（鏡射 studio-present.css 的 li::before 內容）；"dot"／未帶＝空字串。 */
const BULLET_PREFIX: Record<string, string> = { check: "✓ ", cross: "✕ ", dash: "— " };

/**
 * 匯出專用（EXPORT-ONLY）：webp 在螢幕渲染沒問題，但舊版 PowerPoint 無法解碼 image/webp，
 * 塞進去會整頁破圖。故在 .pptx 匯出的所有 addImage 出口，額外排除 webp data URI；
 * 螢幕端仍走 shared 的 isRasterImageDataUri（接受 webp，不改）。
 */
const WEBP_DATA_URI_RE = /^data:image\/webp[;,]/i;
function isPptxExportableImage(data: unknown): data is string {
  return isRasterImageDataUri(data) && !WEBP_DATA_URI_RE.test(data);
}

/**
 * 沒有 per-deck theme 時的預設外觀。2026-07-31 裁決：由舊的深藍夜色改為**淺紙**，逐值對齊螢幕端
 * `apps/web/app/studio-present.css` 的 `--slide-bg/--slide-text/--slide-accent` 預設，
 * 讓「螢幕看到的無主題頁 ＝ 匯出的 .pptx」。三色不在此硬寫，一律取 shared 的 SLIDE_DEFAULT_THEME
 * （唯一真相來源）。per-deck theme 路徑（resolveTheme 讀 theme.*）不受影響。
 */
const DEFAULT_THEME = {
  bg: SLIDE_DEFAULT_THEME.bg,
  text: SLIDE_DEFAULT_THEME.text,
  accent: SLIDE_DEFAULT_THEME.accent,
  /** 淺紙底上的次要文字（≈ --mc-text-2 #5C564C）；只在該頁**沒有**顯式 text 色時採用。 */
  muted: "5C564C",
  headingFont: "Arial",
  bodyFont: "Arial",
} as const;

/** 顯式 theme（深底居多）沿用的次要文字色——per-deck 路徑逐字不變。 */
const MUTED = "96A2C2";

function normalizeHex(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  let hex = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return HEX_RE.test(hex) ? hex.toUpperCase() : fallback;
}

interface ResolvedTheme {
  bg: string;
  text: string;
  accent: string;
  /** 頁面帶了合法的顯式主色（對齊 SlideRenderer 的 `if (theme.accent)`）→ 圖表多序列色由主色衍生而非固定紫粉。 */
  accentIsExplicit: boolean;
  muted: string;
  headingFont: string;
  bodyFont: string;
  logo?: string;
}

function resolveTheme(theme: SlideTheme | undefined): ResolvedTheme {
  return {
    bg: normalizeHex(theme?.bg, DEFAULT_THEME.bg),
    text: normalizeHex(theme?.text, DEFAULT_THEME.text),
    accent: normalizeHex(theme?.accent, DEFAULT_THEME.accent),
    accentIsExplicit: normalizeHex(theme?.accent, "") !== "",
    // 沒有顯式 text 色＝落回淺紙預設底 → 次要文字必須跟著換淺紙用的深灰，
    // 否則 #96A2C2 藍灰壓在 #F7F5F1 上只有 2.4:1（副標/圖說幾乎看不見）。
    muted: normalizeHex(theme?.text, "") !== "" ? MUTED : DEFAULT_THEME.muted,
    headingFont: theme?.headingFont || DEFAULT_THEME.headingFont,
    bodyFont: theme?.bodyFont || DEFAULT_THEME.bodyFont,
    logo: theme?.logo,
  };
}

/** 預設畫布尺寸（吋）＝ 16:9 的 10×5.625；native（AI 生成/無原檔）路徑沿用。 */
const DEFAULT_SLIDE_W = 10;
const DEFAULT_SLIDE_H = 5.625;
const MARGIN_X = 0.6;
const MARGIN_Y = 0.5;
const BLOCK_GAP = 0.2;
const COL_GAP = 0.4;

/**
 * 版面幾何（吋）：依實際畫布尺寸算出。補充頁匯出時以**原檔畫布尺寸**產出（不再寫死 10×5.625），
 * 合併回原檔（原檔常為 13.333×7.5＝寬螢幕預設）才不會只佔左上一角而破版。
 */
export interface SlideGeom {
  W: number;
  H: number;
  CONTENT_W: number;
  CONTENT_BOTTOM: number;
}
function makeGeom(w: number, h: number): SlideGeom {
  return { W: w, H: h, CONTENT_W: w - MARGIN_X * 2, CONTENT_BOTTOM: h - MARGIN_Y };
}

function findBlock<K extends SlideBlock["type"]>(
  blocks: SlideBlock[],
  type: K,
): Extract<SlideBlock, { type: K }> | undefined {
  return blocks.find((b): b is Extract<SlideBlock, { type: K }> => b.type === type);
}

function addRule(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, color: string): void {
  try {
    slide.addShape("rect", { x, y, w, h, fill: { color }, line: { type: "none" } });
  } catch {
    /* shape 失敗不影響其餘元件 */
  }
}

function addPanel(slide: PptxGenJS.Slide, x: number, y: number, w: number, h: number, accent: string): void {
  try {
    slide.addShape("roundRect", {
      x,
      y,
      w,
      h,
      rectRadius: 0.06,
      fill: { color: accent, transparency: 90 },
      line: { color: accent, width: 1, transparency: 35 },
    });
  } catch {
    /* 純裝飾，失敗略過 */
  }
}

function safeImage(slide: PptxGenJS.Slide, opts: PptxGenJS.ImageProps): void {
  if (!isPptxExportableImage(opts.data)) return;
  try {
    slide.addImage(opts);
  } catch {
    /* 壞圖略過 */
  }
}

function addEyebrow(slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): number {
  if (!spec.eyebrow) return MARGIN_Y;
  slide.addText(spec.eyebrow.toUpperCase(), {
    x: MARGIN_X,
    y: MARGIN_Y,
    w: geom.CONTENT_W,
    h: 0.3,
    fontFace: theme.bodyFont,
    fontSize: 11,
    bold: true,
    color: theme.accent,
    charSpacing: 2,
    align: "left",
    valign: "top",
    fit: "shrink",
  });
  return MARGIN_Y + 0.3 + 0.14;
}

function addLogo(slide: PptxGenJS.Slide, logo: string | undefined, geom: SlideGeom): void {
  if (!logo) return;
  const w = 0.9;
  const h = 0.5;
  try {
    slide.addImage({
      data: logo,
      x: geom.W - MARGIN_X - w,
      y: geom.H - 0.2 - h,
      w,
      h,
      sizing: { type: "contain", w, h },
    });
  } catch {
    /* 壞圖略過 */
  }
}

/** color-mix(in srgb, hex ratio%, white)＝mixHex 對白的特例（逐通道、逐捨入等價）。 */
function mixWithWhite(hex: string, ratio: number): string {
  return mixHex(hex, "FFFFFF", ratio);
}

/** color-mix(in srgb, hex ratio%, black)＝各通道 ×ratio。鏡射螢幕 --slide-accent-3 的 color-mix(accent 66%, black)。 */
function mixWithBlack(hex: string, ratio: number): string {
  return mixHex(hex, "000000", ratio);
}

/** color-mix(in srgb, a ratio%, b)：各通道線性混合（本檔所有混色的唯一實作）。 */
function mixHex(a: string, b: string, ratio: number): string {
  const pa = parseInt(a, 16);
  const pb = parseInt(b, 16);
  const ch = (n: number, shift: number) => (n >> shift) & 0xff;
  return [16, 8, 0]
    .map((s) => Math.round(ch(pa, s) * ratio + ch(pb, s) * (1 - ratio)))
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * 成對比較（series2）的兩色。螢幕端 `.chart__bars--paired`（studio-present.css:245-246）是
 * s1=`--slide-sunk`（＝color-mix(text 7%, bg) 的近底灰）、s2=`--slide-accent`——
 * 走一般 chartPalette 會變成 accent/accent-2 兩個彩色，跟畫面對不起來。故 paired 專用一組。
 */
function pairedChartColors(theme: ResolvedTheme): string[] {
  return [mixHex(theme.text, theme.bg, 0.07), theme.accent];
}

/**
 * 圖表多序列色。**與螢幕（slide-chart.tsx 的 PALETTE ＋ SlideRenderer 的 --slide-accent-2/-3）逐格對齊**，
 * 確保「畫面預覽 ＝ 匯出 .pptx」（slide-spec.ts CHART_ACCENT_HUES 註解宣稱的 WYSIWYG 不變量）：
 * - 有顯式主色時，series 2/3 由主色 color-mix 衍生（＝SlideRenderer 對 accent-2/-3 的衍生）；
 * - 無顯式主色時，series 2/3 用固定 CHART_ACCENT_HUES（＝CSS 預設的 --slide-accent-2/-3）。
 * series 4-6 皆為前三色的 55%/55%/60% 混白（＝slide-chart PALETTE 後三格），兩分支一致。
 */
function chartPalette(accent: string, accentIsExplicit: boolean): string[] {
  const [c2, c3] = accentIsExplicit
    ? [mixWithWhite(accent, 0.58), mixWithBlack(accent, 0.66)] // = color-mix(accent 58% white) / (accent 66% black)
    : [CHART_ACCENT_HUES[0].toUpperCase(), CHART_ACCENT_HUES[1].toUpperCase()];
  return [accent, c2, c3, mixWithWhite(accent, 0.55), mixWithWhite(c2, 0.55), mixWithWhite(c3, 0.6)];
}

function charsPerLine(width: number, fontSize: number): number {
  return Math.max(1, (width * 144) / fontSize);
}

function wrappedLineCount(text: string, width: number, fontSize: number): number {
  return Math.max(1, Math.ceil(text.length / charsPerLine(width, fontSize)));
}

function estimateHeight(block: SlideBlock, width: number): number {
  switch (block.type) {
    case "heading":
      return 0.7;
    case "subheading":
      return 0.5;
    case "paragraph":
      return 0.25 + wrappedLineCount(block.text, width, 14) * 0.3;
    case "bullets":
      return 0.2 + block.items.reduce((sum, item) => sum + wrappedLineCount(item, width, 14), 0) * 0.4;
    case "quote":
      return 1.1;
    case "stat":
      return 1.1;
    case "image":
      return 2.6;
    case "features": {
      const rows = Math.ceil(block.features.length / 2);
      return rows * 0.85 + 0.1;
    }
    case "chart":
      return 3.0;
    case "table":
      // 表頭 + N 列，每列 0.52 吋（與 addTableBlock 的實際列高一致）。
      return 0.52 * (block.rows.length + 1) + 0.1;
    case "timeline":
      // 刻度列（有才算）＋ 每條軌道 0.42 吋。
      return (block.ticks.length ? 0.95 : 0) + block.tracks.length * 0.42 + 0.2;
    case "steps":
      return 1.9;
    case "two-col": {
      const colW = (width - COL_GAP) / 2;
      const leftH = block.left.reduce((sum, b) => sum + estimateHeight(b, colW) + BLOCK_GAP, 0);
      const rightH = block.right.reduce((sum, b) => sum + estimateHeight(b, colW) + BLOCK_GAP, 0);
      return Math.max(leftH, rightH, 1);
    }
  }
}

function addFeaturesGrid(
  slide: PptxGenJS.Slide,
  features: FeatureItem[],
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ResolvedTheme,
): void {
  const cols = 2;
  const colGap = 0.3;
  const rowGap = 0.15;
  const rows = Math.max(1, Math.ceil(features.length / cols));
  const colW = (w - colGap * (cols - 1)) / cols;
  const rowH = (h - rowGap * (rows - 1)) / rows;
  features.forEach((f, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    // 落單在最後一列的卡片（奇數張的最後一張，含單張）→ 置中，避免右下留空（對齊螢幕 .feat-count-3 三角排版）。
    const isLoneLast = i === features.length - 1 && c === 0 && r === rows - 1;
    const cx = isLoneLast ? x + (w - colW) / 2 : x + c * (colW + colGap);
    const cy = y + r * (rowH + rowGap);
    const runs: PptxGenJS.TextProps[] = [
      { text: "▪  ", options: { color: theme.accent, bold: true } },
      { text: f.title, options: { color: theme.text, bold: true, breakLine: Boolean(f.desc) } },
    ];
    if (f.desc) {
      runs.push({ text: f.desc, options: { color: theme.muted, fontSize: 12, bold: false } });
    }
    slide.addText(runs, {
      x: cx,
      y: cy,
      w: colW,
      h: rowH,
      fontFace: theme.bodyFont,
      fontSize: 14,
      align: "left",
      valign: "top",
      fit: "shrink",
    });
  });
}

/**
 * 比較矩陣 → 原生 pptx table（可在 PowerPoint 內續編，比畫圖形好用）。
 * 首欄為列標題欄（較寬），highlightColumn 吃 accent 淡底＋accent 字色——鏡射螢幕的 `.table__cell--hl`。
 */
function addTableBlock(
  slide: PptxGenJS.Slide,
  block: Extract<SlideBlock, { type: "table" }>,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ResolvedTheme,
): void {
  const cols = Math.max(1, block.headers.length);
  const headBg = mixWithBlack(theme.bg, 0.94); // 表頭比頁底略沉（鏡射螢幕的 --slide-sunk）
  const hlBg = mixWithWhite(theme.accent, 0.22);
  const firstW = cols > 1 ? (w * 1.6) / (1.6 + (cols - 1)) : w;
  const restW = cols > 1 ? (w - firstW) / (cols - 1) : 0;
  const colW = Array.from({ length: cols }, (_, i) => (i === 0 ? firstW : restW));
  const rowH = Math.max(0.28, Math.min(0.52, h / (block.rows.length + 1)));
  const cell = (text: string, opts: PptxGenJS.TableCellProps): PptxGenJS.TableCell => ({ text, options: opts });
  const rows: PptxGenJS.TableRow[] = [
    block.headers.map((hdr, c) =>
      cell(hdr, { bold: true, color: theme.muted, fill: { color: headBg }, fontSize: 11, align: c === 0 ? "left" : "center" }),
    ),
    ...block.rows.map((row) =>
      row
        .slice(0, cols)
        .map((text, c) =>
          cell(text, {
            color: c === block.highlightColumn ? theme.accent : c === 0 ? theme.muted : theme.text,
            bold: c === block.highlightColumn,
            fill: c === block.highlightColumn ? { color: hlBg } : { color: theme.bg },
            fontSize: 12,
            align: c === 0 ? "left" : "center",
          }),
        ),
    ),
  ];
  try {
    slide.addTable(rows, {
      x,
      y,
      w,
      colW,
      rowH,
      fontFace: theme.bodyFont,
      border: { type: "solid", pt: 0.5, color: theme.muted },
      valign: "middle",
      autoPage: false,
    });
  } catch {
    /* 表格失敗不可拖垮整份匯出 */
  }
}

/** 時間表 → 刻度標籤列 ＋ 每條軌道一個圓角矩形（幾何鏡射螢幕的 `.timeline__bar` 百分比定位）。 */
function addTimelineBlock(
  slide: PptxGenJS.Slide,
  block: Extract<SlideBlock, { type: "timeline" }>,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ResolvedTheme,
): void {
  const emphasisColor = (e: string | undefined): string =>
    e === "warn" ? mixWithWhite(theme.accent, 0.62) : e === "off" ? theme.muted : theme.accent;
  let top = y;
  if (block.ticks.length) {
    const tickW = w / block.ticks.length;
    block.ticks.forEach((t, i) => {
      const tx = x + i * tickW;
      addRule(slide, tx, top, Math.max(0.05, tickW - 0.08), 0.07, emphasisColor(t.emphasis));
      slide.addText(t.title ? `${t.name}\n${t.title}` : t.name, {
        x: tx,
        y: top + 0.12,
        w: Math.max(0.2, tickW - 0.08),
        h: 0.62,
        fontFace: theme.bodyFont,
        fontSize: 10,
        color: theme.muted,
        align: "left",
        valign: "top",
        fit: "shrink",
      });
    });
    top += 0.95;
  }
  const labelW = Math.min(1.9, w * 0.26);
  const slotX = x + labelW + 0.12;
  const slotW = Math.max(0.4, w - labelW - 0.12);
  const rowH = Math.max(0.22, Math.min(0.42, (h - (top - y)) / Math.max(1, block.tracks.length)));
  block.tracks.forEach((t, i) => {
    const ty = top + i * rowH;
    slide.addText(t.label, {
      x,
      y: ty,
      w: labelW,
      h: rowH,
      fontFace: theme.bodyFont,
      fontSize: 11,
      color: theme.muted,
      align: "left",
      valign: "middle",
      fit: "shrink",
    });
    const barH = Math.max(0.12, rowH * 0.55);
    addRule(slide, slotX, ty + (rowH - barH) / 2, slotW, barH, mixWithBlack(theme.bg, 0.85));
    const left = Math.min(100, Math.max(0, t.startPct)) / 100;
    const width = Math.min(1 - left, Math.max(0.02, t.widthPct / 100));
    addRule(slide, slotX + slotW * left, ty + (rowH - barH) / 2, slotW * width, barH, emphasisColor(t.emphasis));
  });
}

/** 流程步驟 → 橫排等分欄，每欄一條頂色條＋序號/標題/說明/負責人（鏡射螢幕 `.step`）。 */
function addStepsBlock(
  slide: PptxGenJS.Slide,
  block: Extract<SlideBlock, { type: "steps" }>,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ResolvedTheme,
): void {
  const n = Math.max(1, block.steps.length);
  const gap = 0.16;
  const colW = (w - gap * (n - 1)) / n;
  const tone = [theme.accent, mixWithWhite(theme.accent, 0.62), mixWithWhite(theme.accent, 0.35)];
  block.steps.forEach((s, i) => {
    const cx = x + i * (colW + gap);
    const color = tone[i % tone.length]!;
    addRule(slide, cx, y, colW, 0.05, color);
    const runs: PptxGenJS.TextProps[] = [
      { text: String(i + 1).padStart(2, "0"), options: { color, bold: true, fontSize: 16, breakLine: true } },
      { text: s.title, options: { color: theme.text, bold: true, fontSize: 13, breakLine: Boolean(s.desc || s.owner) } },
    ];
    if (s.desc) runs.push({ text: s.desc, options: { color: theme.muted, fontSize: 11, breakLine: Boolean(s.owner) } });
    if (s.owner) runs.push({ text: s.owner, options: { color: theme.muted, fontSize: 10, italic: true } });
    slide.addText(runs, {
      x: cx,
      y: y + 0.12,
      w: colW,
      h: Math.max(0.4, h - 0.12),
      fontFace: theme.bodyFont,
      align: "left",
      valign: "top",
      fit: "shrink",
    });
  });
}

function addChartBlock(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  block: Extract<SlideBlock, { type: "chart" }>,
  x: number,
  y: number,
  w: number,
  h: number,
  theme: ResolvedTheme,
): void {
  const captionH = block.caption ? 0.34 : 0;
  const chartH = Math.max(1.0, h - captionH);
  const typeMap: Record<ChartType, PptxGenJS.CHART_NAME> = {
    bar: pptx.ChartType.bar,
    donut: pptx.ChartType.doughnut,
    line: pptx.ChartType.line,
  };
  const chartType = typeMap[block.chartType];
  const isDonut = block.chartType === "donut";
  // 成對比較（series2）＝第二個 data set；螢幕端同樣只在兩序列等長時成立，兩邊條件一致。
  const paired = block.series2 && block.series2.length === block.series.length ? block.series2 : undefined;
  const data = [
    {
      name: block.seriesNames?.[0] || block.caption || "Series",
      labels: block.series.map((s) => s.label),
      values: block.series.map((s) => s.value),
    },
  ];
  if (paired) {
    data.push({
      name: block.seriesNames?.[1] || "Series 2",
      labels: block.series.map((s) => s.label),
      values: paired.map((s) => s.value),
    });
  }
  try {
    slide.addChart(chartType, data, {
      x,
      y,
      w,
      h: chartH,
      chartColors: paired ? pairedChartColors(theme) : chartPalette(theme.accent, theme.accentIsExplicit),
      showTitle: false,
      showLegend: isDonut || Boolean(paired),
      legendPos: "b",
      legendColor: theme.muted,
      legendFontSize: 10,
      showValue: !isDonut,
      showPercent: isDonut,
      dataLabelColor: isDonut ? "FFFFFF" : theme.text,
      dataLabelFontSize: 10,
      catAxisLabelColor: theme.muted,
      valAxisLabelColor: theme.muted,
      catAxisLineShow: false,
      valAxisLineShow: false,
      lineDataSymbol: "circle",
    });
  } catch {
    /* addChart 失敗（資料/類型問題）不可拖垮整份匯出 */
  }
  // donut 圓心大數字：pptx 沒有原生「環心標籤」，故疊一個置中文字框（鏡射螢幕 `.chart__donut-center`）。
  if (isDonut && block.centerValue) {
    const boxH = 0.7;
    slide.addText(
      [
        { text: block.centerValue, options: { bold: true, fontSize: 20, color: theme.text, breakLine: Boolean(block.centerLabel) } },
        ...(block.centerLabel ? [{ text: block.centerLabel, options: { fontSize: 11, color: theme.muted } }] : []),
      ],
      {
        x,
        y: y + chartH / 2 - boxH / 2,
        w,
        h: boxH,
        fontFace: theme.bodyFont,
        align: "center",
        valign: "middle",
        fit: "shrink",
      },
    );
  }
  if (block.caption) {
    slide.addText(block.caption, {
      x,
      y: y + chartH,
      w,
      h: captionH,
      fontFace: theme.bodyFont,
      fontSize: 11,
      italic: true,
      color: theme.muted,
      align: "center",
      valign: "top",
      fit: "shrink",
    });
  }
}

function layoutBlocks(
  pptx: PptxGenJS,
  slide: PptxGenJS.Slide,
  blocks: SlideBlock[],
  x: number,
  yStart: number,
  w: number,
  theme: ResolvedTheme,
  geom: SlideGeom,
  inheritedScale?: number,
): number {
  let scale: number;
  if (inheritedScale !== undefined) {
    scale = inheritedScale;
  } else {
    const available = Math.max(0.001, geom.CONTENT_BOTTOM - yStart);
    const needed =
      blocks.reduce((sum, b) => sum + estimateHeight(b, w), 0) + Math.max(0, blocks.length - 1) * BLOCK_GAP;
    scale = needed > available ? available / needed : 1;
  }
  const gap = BLOCK_GAP * scale;

  let y = yStart;
  for (const block of blocks) {
    const h = Math.max(0.05, estimateHeight(block, w) * scale);

    switch (block.type) {
      case "heading":
        slide.addText(block.text, {
          x,
          y,
          w,
          h,
          fontFace: theme.headingFont,
          fontSize: 22,
          bold: true,
          color: theme.text,
          align: "left",
          valign: "top",
          fit: "shrink",
        });
        break;
      case "subheading":
        slide.addText(block.text, {
          x,
          y,
          w,
          h,
          fontFace: theme.bodyFont,
          fontSize: 18,
          color: theme.muted,
          align: "left",
          valign: "top",
          fit: "shrink",
        });
        break;
      case "paragraph":
        slide.addText(block.text, {
          x,
          y,
          w,
          h,
          fontFace: theme.bodyFont,
          fontSize: 14,
          color: theme.text,
          align: "left",
          valign: "top",
          fit: "shrink",
        });
        break;
      case "bullets": {
        // marker（check/cross/dash）在螢幕上是用 li::before 取代圓點（studio-present.css:149-151）。
        // pptx 沒有自訂 bullet 字元的穩定路徑，故改成文字前綴＋關掉原生圓點，記號才不會被吃掉
        // （對比頁「現況 ✕ / 導入後 ✓」的語意全靠這個記號）。無 marker（或 dot）→ 逐字維持原本的圓點清單。
        const marker = BULLET_PREFIX[block.marker ?? ""] ?? "";
        slide.addText(
          block.items.map((item) => ({
            text: `${marker}${item}`,
            options: { bullet: marker ? false : { indent: 14 }, breakLine: true },
          })),
          {
            x,
            y,
            w,
            h,
            fontFace: theme.bodyFont,
            fontSize: 14,
            color: theme.text,
            align: "left",
            valign: "top",
            fit: "shrink",
          },
        );
        break;
      }
      case "quote": {
        const runs: PptxGenJS.TextProps[] = [
          { text: `“${block.text}”`, options: { italic: true, breakLine: Boolean(block.attribution) } },
        ];
        if (block.attribution) {
          runs.push({ text: `— ${block.attribution}`, options: { italic: false, fontSize: 12, color: theme.muted } });
        }
        slide.addText(runs, {
          x,
          y,
          w,
          h,
          fontFace: theme.bodyFont,
          fontSize: 16,
          color: theme.text,
          align: "left",
          valign: "top",
          fit: "shrink",
        });
        break;
      }
      case "stat": {
        const valueH = block.desc ? h * 0.5 : h * 0.62;
        slide.addText(block.value, {
          x,
          y,
          w,
          h: valueH,
          fontFace: theme.headingFont,
          fontSize: 36,
          bold: true,
          color: theme.accent,
          align: "left",
          valign: "bottom",
          fit: "shrink",
        });
        slide.addText(
          block.desc
            ? [
                { text: block.label, options: { color: theme.muted, fontSize: 13, breakLine: true } },
                { text: block.desc, options: { color: theme.muted, fontSize: 11 } },
              ]
            : block.label,
          {
            x,
            y: y + valueH,
            w,
            h: h - valueH,
            fontFace: theme.bodyFont,
            fontSize: 13,
            color: theme.muted,
            align: "left",
            valign: "top",
            fit: "shrink",
          },
        );
        break;
      }
      case "image":
        safeImage(slide, { data: block.dataUri, x, y, w, h, sizing: { type: "contain", w, h } });
        break;
      case "features":
        addFeaturesGrid(slide, block.features, x, y, w, h, theme);
        break;
      case "chart":
        addChartBlock(pptx, slide, block, x, y, w, h, theme);
        break;
      case "table":
        addTableBlock(slide, block, x, y, w, h, theme);
        break;
      case "timeline":
        addTimelineBlock(slide, block, x, y, w, h, theme);
        break;
      case "steps":
        addStepsBlock(slide, block, x, y, w, h, theme);
        break;
      case "two-col": {
        const colW = (w - COL_GAP) / 2;
        layoutBlocks(pptx, slide, block.left, x, y, colW, theme, geom, scale);
        layoutBlocks(pptx, slide, block.right, x + colW + COL_GAP, y, colW, theme, geom, scale);
        break;
      }
    }

    y += h + gap;
  }
  return y;
}

function renderTitle(pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  addEyebrow(slide, spec, theme, geom);
  const heading = findBlock(spec.blocks, "heading");
  const sub = findBlock(spec.blocks, "subheading");
  const heroY = 1.7;
  const heroH = 1.4;
  slide.addText(heading?.text ?? spec.eyebrow ?? "", {
    x: MARGIN_X,
    y: heroY,
    w: geom.CONTENT_W,
    h: heroH,
    fontFace: theme.headingFont,
    fontSize: 40,
    bold: true,
    color: theme.text,
    align: "left",
    valign: "middle",
    fit: "shrink",
  });
  const underlineY = heroY + heroH + 0.06;
  addRule(slide, MARGIN_X, underlineY, 2.2, 0.06, theme.accent);
  if (sub) {
    slide.addText(sub.text, {
      x: MARGIN_X,
      y: underlineY + 0.2,
      w: geom.CONTENT_W,
      h: 0.8,
      fontFace: theme.bodyFont,
      fontSize: 18,
      color: theme.muted,
      align: "left",
      valign: "top",
      fit: "shrink",
    });
  }
  const rest = spec.blocks.filter((b) => b !== heading && b !== sub);
  if (rest.length) layoutBlocks(pptx, slide, rest, MARGIN_X, underlineY + 1.05, geom.CONTENT_W, theme, geom);
}

function renderSection(_pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  addEyebrow(slide, spec, theme, geom);
  const heading = findBlock(spec.blocks, "heading");
  const sub = findBlock(spec.blocks, "subheading");
  const barX = MARGIN_X;
  const barY = 1.95;
  const barW = 0.14;
  const barH = 1.5;
  addRule(slide, barX, barY, barW, barH, theme.accent);
  const textX = barX + barW + 0.35;
  const textW = geom.W - textX - MARGIN_X;
  slide.addText(heading?.text ?? "", {
    x: textX,
    y: barY,
    w: textW,
    h: 0.95,
    fontFace: theme.headingFont,
    fontSize: 32,
    bold: true,
    color: theme.text,
    align: "left",
    valign: "top",
    fit: "shrink",
  });
  if (sub) {
    slide.addText(sub.text, {
      x: textX,
      y: barY + 1.0,
      w: textW,
      h: 0.55,
      fontFace: theme.bodyFont,
      fontSize: 18,
      color: theme.muted,
      align: "left",
      valign: "top",
      fit: "shrink",
    });
  }
}

function addHeadingChrome(slide: PptxGenJS.Slide, text: string, y: number, theme: ResolvedTheme, geom: SlideGeom): number {
  slide.addText(text, {
    x: MARGIN_X,
    y,
    w: geom.CONTENT_W,
    h: 0.7,
    fontFace: theme.headingFont,
    fontSize: 26,
    bold: true,
    color: theme.text,
    align: "left",
    valign: "top",
    fit: "shrink",
  });
  const ruleY = y + 0.68;
  addRule(slide, MARGIN_X, ruleY, 1.6, 0.045, theme.accent);
  return ruleY + 0.24;
}

function renderContent(pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  const top = addEyebrow(slide, spec, theme, geom);
  const heading = findBlock(spec.blocks, "heading");
  let y = top;
  if (heading) y = addHeadingChrome(slide, heading.text, top, theme, geom);
  const rest = spec.blocks.filter((b) => b !== heading);
  layoutBlocks(pptx, slide, rest, MARGIN_X, y, geom.CONTENT_W, theme, geom);
}

function renderStats(pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  const top = addEyebrow(slide, spec, theme, geom);
  const heading = findBlock(spec.blocks, "heading");
  let y = top;
  if (heading) y = addHeadingChrome(slide, heading.text, top, theme, geom);

  const stats = spec.blocks.filter((b): b is Extract<SlideBlock, { type: "stat" }> => b.type === "stat");
  const others = spec.blocks.filter((b) => b !== heading && b.type !== "stat");

  if (stats.length) {
    const cols = stats.length === 4 ? 2 : Math.min(3, stats.length);
    const rows = Math.ceil(stats.length / cols);
    const gap = 0.3;
    const rowGap = 0.25;
    const cardW = (geom.CONTENT_W - gap * (cols - 1)) / cols;
    const availH = geom.CONTENT_BOTTOM - y;
    const cardH = Math.min(1.5, (availH - rowGap * (rows - 1)) / rows);
    stats.forEach((s, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const cx = MARGIN_X + c * (cardW + gap);
      const cy = y + r * (cardH + rowGap);
      addPanel(slide, cx, cy, cardW, cardH, theme.accent);
      slide.addText(s.value, {
        x: cx + 0.18,
        y: cy + 0.12,
        w: cardW - 0.36,
        h: cardH * 0.56,
        fontFace: theme.headingFont,
        fontSize: 36,
        bold: true,
        color: theme.accent,
        align: "left",
        valign: "bottom",
        fit: "shrink",
      });
      // desc（設計稿 KPI 卡的第三行說明）接在 label 之下；未帶時呼叫與擴充前逐字相同。
      slide.addText(
        s.desc
          ? [
              { text: s.label, options: { fontSize: 13, color: theme.muted, breakLine: true } },
              { text: s.desc, options: { fontSize: 11, color: theme.muted } },
            ]
          : s.label,
        {
          x: cx + 0.18,
          y: cy + cardH * 0.62,
          w: cardW - 0.36,
          h: cardH * 0.3,
          fontFace: theme.bodyFont,
          fontSize: 13,
          color: theme.muted,
          align: "left",
          valign: "top",
          fit: "shrink",
        },
      );
    });
    y += rows * cardH + (rows - 1) * rowGap + 0.25;
  }

  if (others.length) layoutBlocks(pptx, slide, others, MARGIN_X, y, geom.CONTENT_W, theme, geom);
}

function renderClosing(_pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  addEyebrow(slide, spec, theme, geom);
  const heading = findBlock(spec.blocks, "heading");
  const para = findBlock(spec.blocks, "paragraph");
  const sub = findBlock(spec.blocks, "subheading");
  const headY = 1.85;
  slide.addText(heading?.text ?? "", {
    x: MARGIN_X,
    y: headY,
    w: geom.CONTENT_W,
    h: 1.2,
    fontFace: theme.headingFont,
    fontSize: 36,
    bold: true,
    color: theme.text,
    align: "center",
    valign: "middle",
    fit: "shrink",
  });
  const ruleY = headY + 1.3;
  addRule(slide, geom.W / 2 - 1.1, ruleY, 2.2, 0.06, theme.accent);
  const bodyText = para?.text ?? sub?.text;
  if (bodyText) {
    slide.addText(bodyText, {
      x: geom.W * 0.15,
      y: ruleY + 0.22,
      w: geom.W * 0.7,
      h: 1.0,
      fontFace: theme.bodyFont,
      fontSize: 16,
      color: theme.muted,
      align: "center",
      valign: "top",
      fit: "shrink",
    });
  }
}

function renderImageFull(_pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  const img = findBlock(spec.blocks, "image");
  if (img) {
    safeImage(slide, {
      data: img.dataUri,
      x: 0,
      y: 0,
      w: geom.W,
      h: geom.H,
      sizing: { type: "cover", w: geom.W, h: geom.H },
    });
  }
  const heading = findBlock(spec.blocks, "heading");
  if (heading) {
    try {
      slide.addShape("rect", {
        x: 0,
        y: geom.H - 1.25,
        w: geom.W,
        h: 1.25,
        fill: { color: "000000", transparency: 35 },
        line: { type: "none" },
      });
    } catch {
      /* 裝飾帶，失敗略過 */
    }
    slide.addText(heading.text, {
      x: MARGIN_X,
      y: geom.H - 1.15,
      w: geom.CONTENT_W,
      h: 0.95,
      fontFace: theme.headingFont,
      fontSize: 28,
      bold: true,
      color: "FFFFFF",
      align: "left",
      valign: "middle",
      fit: "shrink",
    });
  }
  addEyebrow(slide, spec, theme, geom);
}

function renderSlide(pptx: PptxGenJS, slide: PptxGenJS.Slide, spec: SlideSpec, theme: ResolvedTheme, geom: SlideGeom): void {
  switch (spec.template) {
    case "title":
      renderTitle(pptx, slide, spec, theme, geom);
      break;
    case "section":
      renderSection(pptx, slide, spec, theme, geom);
      break;
    case "stats":
      renderStats(pptx, slide, spec, theme, geom);
      break;
    case "closing":
      renderClosing(pptx, slide, spec, theme, geom);
      break;
    case "image-full":
      renderImageFull(pptx, slide, spec, theme, geom);
      break;
    // 時間表／比較矩陣：版面同為「eyebrow＋標題＋一個主 block 吃滿剩餘高度」，
    // 與 content 一致（差異在 block 自身的畫法，已由 layoutBlocks 的 timeline/table 分支處理）。
    case "timeline-gantt":
    case "comparison-matrix":
      renderContent(pptx, slide, spec, theme, geom);
      break;
    case "content":
    default:
      renderContent(pptx, slide, spec, theme, geom);
      break;
  }
}

/**
 * 產生一份 .pptx 並回傳 Node Buffer；每個 SlideSpec 對應一頁 PptxGenJS slide，依序輸出。
 * `size`（吋）可選——匯入路徑（補充頁）以**原檔畫布尺寸**產出，合併回原檔才不破版；
 * 省略＝預設 10×5.625（16:9），native/AI 生成路徑沿用。
 */
export async function exportDeckToPptx(
  deck: { title: string; language: string },
  slides: SlideSpec[],
  size?: { widthInches: number; heightInches: number },
): Promise<Buffer> {
  // 防呆：非正數尺寸退回預設，避免 defineLayout 收到 0/NaN。
  const w = size && size.widthInches > 0 ? size.widthInches : DEFAULT_SLIDE_W;
  const h = size && size.heightInches > 0 ? size.heightInches : DEFAULT_SLIDE_H;
  const geom = makeGeom(w, h);

  const pptx = new PptxGenJS();
  // 版面名帶尺寸避免不同尺寸間名稱衝突；pptxgenjs 以此 layout 的寬高決定 sldSz。
  const layoutName = `MC_${w.toFixed(3)}x${h.toFixed(3)}`;
  pptx.defineLayout({ name: layoutName, width: w, height: h });
  pptx.layout = layoutName;
  pptx.title = deck.title;

  const logoCache = new Map<string, string | undefined>();
  function resolveLogo(logo: string | undefined): string | undefined {
    if (!logo) return undefined;
    if (!logoCache.has(logo)) logoCache.set(logo, isPptxExportableImage(logo) ? logo : undefined);
    return logoCache.get(logo);
  }

  for (const spec of slides) {
    const theme = resolveTheme(spec.theme);
    const slide = pptx.addSlide();
    slide.background = { color: theme.bg };
    try {
      renderSlide(pptx, slide, spec, theme, geom);
    } catch {
      /* 該頁渲染失敗，保留空白（帶背景）頁 */
    }
    addLogo(slide, resolveLogo(theme.logo), geom);
  }

  const data = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}
