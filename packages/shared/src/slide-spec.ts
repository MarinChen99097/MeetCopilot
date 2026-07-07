/**
 * Slide spec：全系統唯一的簡報內部格式。
 * 三條匯入管線（pptx/pdf/ai）與會中生成都輸出這個結構；渲染器只認這個結構。
 *
 * v2 變更（相對 v1）：改造引擎改為 **append-only**（I1）——PatchOp 只剩 APPEND / REORDER，
 * 移除 v1 的 INSERT_AFTER / REPLACE 中段操作（見 ARCHITECTURE_PLAN §3、CLAUDE.md I1）。
 */

export type SlideSource = "pptx" | "pdf" | "ai";
export type DeckLanguage = "zh-TW" | "en";

/**
 * 單張投影片的視覺主題 token（色系＋字體）。全部 optional——缺的欄位由渲染器退回 app 預設。
 * 匯入時從原簡報抽出、附在每張頁上；**會中生成的新頁一律繼承「插入點前一張（anchor）」的 theme**，
 * 使新頁與其鄰頁視覺連續（見 ARCHITECTURE_PLAN §3 的風格一致要求，anchor-based 而非全域）。
 */
export interface SlideTheme {
  bg?: string; // 背景色（CSS 色值）
  text?: string; // 主文字色
  accent?: string; // 強調色（標題／重點）
  headingFont?: string; // 標題字體家族
  bodyFont?: string; // 內文字體家族
  /** 品牌 logo（dataUri）：由渲染器以 CSS 放在每頁角落當品牌標。使用者上傳的圖，非 AI 生成。 */
  logo?: string;
}

/**
 * 圖示關鍵字白名單：生成器只能從這裡選，渲染器把它對映成內建的 inline SVG（Lucide 風格，MIT）。
 * 未知關鍵字由渲染器退回一個中性預設圖示——所以新增值是安全的，但生成 prompt 只列這些。
 */
export const SLIDE_ICONS = [
  "globe", "trending-up", "zap", "shield", "target", "check", "users", "bar-chart",
  "lock", "rocket", "lightbulb", "layers", "cpu", "dollar", "clock", "arrow-right",
  "alert", "leaf", "network", "briefcase", "sparkles", "chart-pie",
] as const;
export type SlideIcon = (typeof SLIDE_ICONS)[number];

/** features 的單一項目：圖示（可選）＋標題＋說明（可選）。 */
export interface FeatureItem {
  icon?: SlideIcon;
  title: string;
  desc?: string;
}

/** 圖表的單一資料點：標籤＋數值。圖表一律用 CSS/SVG 畫，不生圖。 */
export interface ChartPoint {
  label: string;
  value: number;
}

/** 圖表類型＝型別的唯一真相來源；server 的 Gemini enum 與 pptx 匯出的 typeMap 一律 import 此常數，不各自硬列。 */
export const CHART_TYPES = ["bar", "donut", "line"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

/** deck 頁數上下限（共用給 server zod 與 wizard 輸入，避免兩邊硬列不一致）。 */
export const MIN_DECK_PAGES = 1;
export const MAX_DECK_PAGES = 40;

/**
 * 圖表多序列的固定互補色（hex，無 #）：與 globals.css 的 --slide-accent-2/-3 同色，
 * 讓「畫面預覽」與「匯出的 .pptx」圖表配色一致。第一色一律用每頁 accent，之後接這些。
 */
export const CHART_ACCENT_HUES = ["7c6cff", "ff5d9e"] as const;

/**
 * 是否為「安全的光柵圖片 dataUri」（png/jpeg/gif/webp＋合法 base64）。單一真相來源，供 logo/參考圖驗證與 pptx addImage 前置檢查共用。
 * 擋掉：外部 http(s) URL（觀眾端追蹤信標）、svg（無法點陣化＋可含腳本）、壞掉的 base64（會在 pptx 匯出時炸整份）。
 */
export function isRasterImageDataUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = /^data:image\/(png|jpe?g|gif|webp);base64,([\s\S]+)$/i.exec(value);
  if (!m) return false;
  const b64 = m[2]!.replace(/\s+/g, "");
  return b64.length > 0 && b64.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(b64);
}

export type SlideBlock =
  | { type: "heading"; text: string }
  | { type: "subheading"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "paragraph"; text: string }
  | { type: "quote"; text: string; attribution?: string }
  | { type: "stat"; value: string; label: string }
  // 圖示要點卡：content 頁用來填滿版面的主力區塊（每項 icon+title+desc），比純 bullets 更有設計感。
  // 欄位名用 features（非 items）以免與 bullets 的 items 在 Gemini 扁平超集 schema 中撞名。
  | { type: "features"; features: FeatureItem[] }
  // 圖表：純 CSS/SVG 畫（長條/圓環/折線），Gemini 只吐數據（series）不生圖。
  | { type: "chart"; chartType: ChartType; series: ChartPoint[]; caption?: string }
  | { type: "image"; dataUri: string; alt?: string }
  | { type: "two-col"; left: SlideBlock[]; right: SlideBlock[] };

/** 模板 runtime 清單＝型別的唯一真相來源；server 端的 zod/Gemini enum 一律 import 此常數，不再各自硬列。 */
export const SLIDE_TEMPLATES = ["title", "content", "section", "stats", "image-full", "closing"] as const;
export type SlideTemplate = (typeof SLIDE_TEMPLATES)[number];

/**
 * AI 生成專用的模板子集：排除 "image-full"。
 * AI 生成流程明文禁止 image block（見 generation prompt），image-full 沒有可填的內容也沒有對應版面，
 * 讓模型選到只會產出空頁——故 AI 的 Gemini enum 與 prompt 一律用此子集；image-full 僅保留給「匯入時原簡報確實有整頁圖」的路徑。
 */
export const AI_GENERATION_TEMPLATES = SLIDE_TEMPLATES.filter((t) => t !== "image-full");

export interface SlideSpec {
  id: string;
  template: SlideTemplate;
  blocks: SlideBlock[];
  /** 小標籤（kicker，如「GEOPOLITICS BRIEF」或分節編號「01」）：顯示在封面/分節/結語頁標題上方。可選。 */
  eyebrow?: string;
  notes?: string;
  source: SlideSource;
  /** 視覺主題（匯入時抽取／生成時繼承 anchor）。缺省時渲染器用 app 預設。 */
  theme?: SlideTheme;
  /** 會前預分析結果（內容地圖） */
  analysis?: {
    summary: string;
    topics: string[];
    expansionHints: string[];
  };
}

/**
 * Deck patch 操作（改造引擎；index 一律指 slides 陣列位置）。
 * **v2 append-only（I1）**：
 *  - APPEND：新頁一律加到 deck 尾端（天然作用於 index = slides.length，恆 > committedIndex，恆滿足 I1）。
 *  - REORDER：僅供 pending 區重排；fromIndex/toIndex 皆須 > committedIndex（guard 在 realtime 層）。
 * 移除 v1 的 INSERT_AFTER / REPLACE（中段插入/覆寫會動到已播頁，違反 I1）。
 */
export type PatchOp =
  | { kind: "APPEND"; slide: SlideSpec }
  | { kind: "REORDER"; fromIndex: number; toIndex: number };

/**
 * patch 涉及的最小 index（guard 用：必須 > committedIndex）。
 *
 * **簽名變更（v2）**：新增 `deckLength` 參數。因為 APPEND 不自帶 index——它作用的位置恆為 deck 尾端
 * （新頁落在 index = slides.length），所以必須把當前 deck 長度傳進來才能算出正確的 guard 值。
 *  - APPEND  → deckLength（新頁位置；只要 committedIndex ≤ deckLength-1 即 > committedIndex，恆過閘）
 *  - REORDER → min(fromIndex, toIndex)
 */
export function patchMinIndex(op: PatchOp, deckLength: number): number {
  switch (op.kind) {
    case "APPEND":
      return deckLength;
    case "REORDER":
      return Math.min(op.fromIndex, op.toIndex);
  }
}

/** 把一張投影片的所有文字攤平成單一字串（供 embedding 與生成 grounding）。純函式、無 server 依賴，故放 shared 供多處共用。 */
export function extractSlideText(spec: SlideSpec): string {
  const parts: string[] = [];
  const walk = (blocks: SlideBlock[]) => {
    for (const b of blocks) {
      switch (b.type) {
        case "heading":
        case "subheading":
        case "paragraph":
          parts.push(b.text);
          break;
        case "quote":
          parts.push(b.text);
          if (b.attribution) parts.push(b.attribution);
          break;
        case "bullets":
          parts.push(...b.items);
          break;
        case "stat":
          parts.push(`${b.label}: ${b.value}`);
          break;
        case "features":
          for (const f of b.features) {
            parts.push(f.desc ? `${f.title}: ${f.desc}` : f.title);
          }
          break;
        case "chart":
          if (b.caption) parts.push(b.caption);
          for (const p of b.series) parts.push(`${p.label}: ${p.value}`);
          break;
        case "two-col":
          walk(b.left);
          walk(b.right);
          break;
        case "image":
          if (b.alt) parts.push(b.alt);
          break;
      }
    }
  };
  if (spec.eyebrow) parts.push(spec.eyebrow);
  walk(spec.blocks);
  return parts.join("\n");
}

/**
 * 純函式套用 patch（回傳新陣列，不 mutate）。
 *  - APPEND：push 到尾端。
 *  - REORDER：把 fromIndex 的頁移到 toIndex。
 * I1 的 index guard 不在此（此為純資料轉換）；guard 由 realtime 層用 patchMinIndex(op, deck.length) > committedIndex 執行。
 */
export function applyPatchToSlides(slides: SlideSpec[], op: PatchOp): SlideSpec[] {
  const next = slides.slice();
  switch (op.kind) {
    case "APPEND":
      next.push(op.slide);
      return next;
    case "REORDER": {
      const [moved] = next.splice(op.fromIndex, 1);
      if (moved !== undefined) next.splice(op.toIndex, 0, moved);
      return next;
    }
  }
}
