import type { ChartPoint } from "@meetcopilot/shared";

/**
 * chart block 的資料形狀守衛（純函式，無 React／無 JSX——所以能被 vitest 直接 import 做真正的 probe）。
 *
 * **為什麼非有不可**：`SlideChart` 內部對 `series` / `series2` 呼叫 `.filter(...)`。若 LLM 亂回或舊資料缺欄位，
 * 這兩個欄位可能是 `null`／字串／物件，`.filter` 直接 throw。而這個 throw **不會**被 `renderSlideBlock`
 * 的 try/catch 接到——`renderSlideBlock` 只是「建立 `<SlideChart/>` 這個 element 物件」就回傳了，
 * 真正執行 `SlideChart` 函式是 React 稍後 render 的事，早已離開那層 try/catch → 整頁（整場會議畫面）白掉。
 * 故守衛必須擋在**建立 element 之前**。
 *
 * `series2` 為 `undefined` / `null` 視同「沒有第二序列」（合格）；只有「存在但不是陣列」才判不合格。
 */
export function chartSeriesOk(series: unknown, series2: unknown): series is ChartPoint[] {
  if (!Array.isArray(series)) return false;
  if (series2 !== undefined && series2 !== null && !Array.isArray(series2)) return false;
  return true;
}

/** 給 console.warn 用的簡短形狀描述（`null` / `array(3)` / `string` …），不印出內容以免把敏感逐字稿倒進 console。 */
export function describeShape(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array(${v.length})`;
  return typeof v;
}
