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
import { CHART_ACCENT_HUES, isRasterImageDataUri } from "@meetcopilot/shared";

const HEX_RE = /^[0-9a-fA-F]{6}$/;

/**
 * 匯出專用（EXPORT-ONLY）：webp 在螢幕渲染沒問題，但舊版 PowerPoint 無法解碼 image/webp，
 * 塞進去會整頁破圖。故在 .pptx 匯出的所有 addImage 出口，額外排除 webp data URI；
 * 螢幕端仍走 shared 的 isRasterImageDataUri（接受 webp，不改）。
 */
const WEBP_DATA_URI_RE = /^data:image\/webp[;,]/i;
function isPptxExportableImage(data: unknown): data is string {
  return isRasterImageDataUri(data) && !WEBP_DATA_URI_RE.test(data);
}

const DEFAULT_THEME = {
  bg: "18233B",
  text: "E6EBF5",
  accent: "22D3EE",
  headingFont: "Arial",
  bodyFont: "Arial",
} as const;

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
    muted: MUTED,
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

function mixWithWhite(hex: string, ratio: number): string {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c * ratio + 255 * (1 - ratio));
  return [mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/** color-mix(in srgb, hex ratio%, black)＝各通道 ×ratio。鏡射螢幕 --slide-accent-3 的 color-mix(accent 66%, black)。 */
function mixWithBlack(hex: string, ratio: number): string {
  const n = parseInt(hex, 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c * ratio);
  return [mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
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
    const cx = x + c * (colW + colGap);
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
  const data = [
    {
      name: block.caption || "Series",
      labels: block.series.map((s) => s.label),
      values: block.series.map((s) => s.value),
    },
  ];
  try {
    slide.addChart(chartType, data, {
      x,
      y,
      w,
      h: chartH,
      chartColors: chartPalette(theme.accent, theme.accentIsExplicit),
      showTitle: false,
      showLegend: isDonut,
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
      case "bullets":
        slide.addText(
          block.items.map((item) => ({ text: item, options: { bullet: { indent: 14 }, breakLine: true } })),
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
        const valueH = h * 0.62;
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
        slide.addText(block.label, {
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
        });
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
      slide.addText(s.label, {
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
      });
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
