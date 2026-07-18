/**
 * S2 產品包純函式單測：
 *  - computePerPageChars（B1）——每頁截斷動態化：放得下就 12000、否則按頁數等分、下限 6000、上限 12000。
 *  - matchProductsToPages（B4）——產品↔爬取專頁對齊：productUrl 完全命中優先、正規化名稱含式匹配 fallback、
 *    短名不誤配、cap、nearby 收鄰近同名頁。
 */
import { describe, it, expect } from "vitest";
import { computePerPageChars, matchProductsToPages } from "./extractor.js";
import type { CrawledPage } from "./crawler.js";

const PER_PAGE_MAX = 12_000;
const PER_PAGE_MIN = 6_000;

function page(url: string, title = "", text = "x"): CrawledPage {
  return { url, title, text };
}

describe("S2-B1 computePerPageChars — 每頁截斷動態化", () => {
  it("無頁 → 回上限 12000", () => {
    expect(computePerPageChars([], 100)).toBe(PER_PAGE_MAX);
  });

  it("總量放得進 180K → 每頁給足 12000", () => {
    expect(computePerPageChars([12_000, 8_000], 5_000)).toBe(PER_PAGE_MAX);
  });

  it("單頁文字超過 12000 時以 min 夾住估算，仍回 12000（該頁由呼叫端 slice 到 12000）", () => {
    expect(computePerPageChars([50_000], 0)).toBe(PER_PAGE_MAX);
  });

  it("放不下 → 按頁數等分剩餘預算（介於下限與上限之間）", () => {
    // 20 頁 × 12000 = 240000 > 180000 → textBudget 180000 / 20 = 9000
    expect(computePerPageChars(Array(20).fill(12_000), 0)).toBe(9_000);
  });

  it("雜項開銷會從預算扣除", () => {
    // 18 頁 × 12000 = 216000 > 180000；(180000 − 18000) / 18 = 9000
    expect(computePerPageChars(Array(18).fill(12_000), 18_000)).toBe(9_000);
  });

  it("頁數極多 → 夾到下限 6000（不再更低）", () => {
    // 40 頁 × 12000 → 180000 / 40 = 4500 < 6000 → 夾到 6000
    expect(computePerPageChars(Array(40).fill(12_000), 0)).toBe(PER_PAGE_MIN);
  });

  it("回傳一律落在 [6000, 12000]", () => {
    for (const n of [1, 5, 15, 25, 50, 100]) {
      const v = computePerPageChars(Array(n).fill(12_000), 0);
      expect(v).toBeGreaterThanOrEqual(PER_PAGE_MIN);
      expect(v).toBeLessThanOrEqual(PER_PAGE_MAX);
    }
  });
});

describe("S2-B4 matchProductsToPages — 產品↔爬取專頁對齊", () => {
  it("productUrl 完全命中爬取頁（含尾斜線正規化）", () => {
    const pages = [
      page("https://cyberpower.com"),
      page("https://cyberpower.com/product/sku/cp1500pfclcd", "CP1500PFCLCD 規格"),
    ];
    const products = [{ name: "CP1500PFCLCD", productUrl: "https://cyberpower.com/product/sku/cp1500pfclcd/" }];
    const m = matchProductsToPages(products, pages);
    expect(m).toHaveLength(1);
    expect(m[0]!.productIndex).toBe(0);
    expect(m[0]!.page.url).toBe("https://cyberpower.com/product/sku/cp1500pfclcd");
  });

  it("無 productUrl → 正規化名稱含式匹配頁 url/title", () => {
    const pages = [
      page("https://ghost.org"),
      page("https://ghost.org/pricing/ghost-pro", "Ghost Pro Plan"),
    ];
    const products = [{ name: "Ghost Pro" }];
    const m = matchProductsToPages(products, pages);
    expect(m).toHaveLength(1);
    expect(m[0]!.page.url).toBe("https://ghost.org/pricing/ghost-pro");
  });

  it("配不到任何頁 → 不納入", () => {
    const pages = [page("https://acme.com"), page("https://acme.com/about", "About Acme")];
    const products = [{ name: "Nonexistent Widget" }];
    expect(matchProductsToPages(products, pages)).toHaveLength(0);
  });

  it("過短名稱（正規化 < 4）不做名稱匹配，避免誤配全站", () => {
    const pages = [page("https://x.com/pro-tips", "Pro Tips")];
    const products = [{ name: "Pro" }]; // 正規化 "pro" 長度 3
    expect(matchProductsToPages(products, pages)).toHaveLength(0);
  });

  it("cap：命中數超過 max 時只取前 max", () => {
    const pages = [
      page("https://x.com/products/alpha", "Alpha"),
      page("https://x.com/products/bravo", "Bravo"),
      page("https://x.com/products/charlie", "Charlie"),
    ];
    const products = [{ name: "Alpha" }, { name: "Bravo" }, { name: "Charlie" }];
    expect(matchProductsToPages(products, pages, 2)).toHaveLength(2);
  });

  it("nearby：收其餘同名（含式匹配）頁，最多 2", () => {
    const pages = [
      page("https://x.com"),
      page("https://x.com/products/widget", "Widget"),
      page("https://x.com/products/widget/specs", "Widget Specs"),
      page("https://x.com/products/widget/pricing", "Widget Pricing"),
    ];
    const products = [{ name: "Widget" }];
    const m = matchProductsToPages(products, pages);
    expect(m).toHaveLength(1);
    expect(m[0]!.page.url).toBe("https://x.com/products/widget"); // 首個命中為 primary
    expect(m[0]!.nearby.map((p) => p.url)).toEqual([
      "https://x.com/products/widget/specs",
      "https://x.com/products/widget/pricing",
    ]);
  });

  it("空名/空產品清單 → 空結果", () => {
    expect(matchProductsToPages([], [page("https://x.com")])).toHaveLength(0);
    expect(matchProductsToPages([{ name: "  " }], [page("https://x.com")])).toHaveLength(0);
  });
});
