/**
 * chart block 防炸 probe（ROM 2026-07-31 13:05 裁決 2）。
 *
 * 壞掉的 chart 資料（`series: null`、`series2: "x"`）曾經**會炸掉整頁**：`renderSlideBlock` 的 try/catch
 * 只包住「建立 `<SlideChart/>` element」這一步，`SlideChart` 函式本體是 React 稍後才執行的，那時的
 * `series.filter is not a function` 已經在 try/catch 之外 → 整個 /present、/hud 預覽、/sim 面板一起白掉。
 *
 * 本檔驗兩層守衛：
 *  (1) **真跑守衛函式**——`apps/web/components/slide/chart-guard.ts` 是純 TS（無 React／無 JSX），
 *      可以直接 import 進來執行，所以這不是「照抄邏輯再測一次」，而是測到正牌那份程式碼。
 *  (2) **原始碼片段**鎖住兩個呼叫點確實有接上守衛（沿用 slide-legacy-lock.test.ts 的手法——
 *      apps/web 沒有測試 runner，跨包 render 需要新增 web 端建置相依，成本大於收益）。
 *
 * 正常路徑逐字等價由 slide-legacy-lock.test.ts 繼續把關（chart 的 DOM 一個字都沒動）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { chartSeriesOk, describeShape } from "../../../../apps/web/components/slide/chart-guard.js";

const webSrc = (rel: string) => readFileSync(fileURLToPath(new URL(`../../../../apps/web/${rel}`, import.meta.url)), "utf8");

const GOOD = [
  { label: "A", value: 1 },
  { label: "B", value: 2 },
];

describe("chart 防炸（1）守衛函式本體", () => {
  it("正常單序列（series 陣列、series2 未帶）→ 合格", () => {
    expect(chartSeriesOk(GOOD, undefined)).toBe(true);
  });

  it("正常雙序列（series＋series2 都是陣列）→ 合格", () => {
    expect(chartSeriesOk(GOOD, GOOD)).toBe(true);
  });

  it("空陣列仍算合格（形狀對；點數不足由 SlideChart 自己回 null，不是形狀問題）", () => {
    expect(chartSeriesOk([], undefined)).toBe(true);
  });

  it("series: null → 不合格（就是這顆會讓 .filter throw、炸掉整頁）", () => {
    expect(chartSeriesOk(null, undefined)).toBe(false);
  });

  it("series 是字串／物件／undefined → 一律不合格", () => {
    expect(chartSeriesOk("x", undefined)).toBe(false);
    expect(chartSeriesOk({ label: "A", value: 1 }, undefined)).toBe(false);
    expect(chartSeriesOk(undefined, undefined)).toBe(false);
  });

  it('series2: "x"（存在但不是陣列）→ 不合格，即使 series 本身是好的', () => {
    expect(chartSeriesOk(GOOD, "x")).toBe(false);
    expect(chartSeriesOk(GOOD, { a: 1 })).toBe(false);
  });

  it("series2: null 視同沒帶第二序列 → 合格（舊資料常見寫法，不該被誤殺）", () => {
    expect(chartSeriesOk(GOOD, null)).toBe(true);
  });

  it("describeShape 只回形狀、不回內容（逐字稿／客戶數字不進 console）", () => {
    expect(describeShape(null)).toBe("null");
    expect(describeShape(GOOD)).toBe("array(2)");
    expect(describeShape("敏感字串")).toBe("string");
    expect(describeShape(undefined)).toBe("undefined");
  });
});

describe("chart 防炸（2）兩個呼叫點確實接上守衛", () => {
  it("SlideRenderer 在建立 <SlideChart/> 之前先驗形狀，不合格 return null", () => {
    const src = webSrc("components/slide/SlideRenderer.tsx");
    const guardAt = src.indexOf("if (!chartSeriesOk(block.series, block.series2))");
    const elementAt = src.indexOf("<SlideChart");
    expect(guardAt).toBeGreaterThan(-1);
    expect(elementAt).toBeGreaterThan(-1);
    // 順序就是本修的重點：守衛必須在 element 建立「之前」。
    expect(guardAt).toBeLessThan(elementAt);
    expect(src).toContain("return null;");
    expect(src).toContain("console.warn(");
  });

  it("SlideChart 內部 filter 前自己再守一層（series / series2 都是）", () => {
    const src = webSrc("components/slide/slide-chart.tsx");
    expect(src).toContain("const pts = (Array.isArray(series) ? series : []).filter(");
    expect(src).toContain("const pts2 = (Array.isArray(series2) ? series2 : []).filter(");
    // 舊寫法（會炸）不得復活。
    expect(src).not.toContain("const pts = series.filter(");
    expect(src).not.toContain("(series2 ?? []).filter(");
  });
});
