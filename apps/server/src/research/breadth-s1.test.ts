/**
 * S1 廣度包純函式單測（A10）：
 *  - buildQueries 一律雙語（A1）——連非 CJK 公司名也同時出 zh 查詢；isBilingual 只影響排序。
 *  - 產品名稱對齊 matcher（A8）——正規化＋含式匹配。
 *  - assembleSources（A9）——去重、官網頁優先、cap 60、排除仍是 grounding-redirect 的中介 URL。
 */
import { describe, it, expect } from "vitest";
import { buildQueries, assembleSources, type DeepResearchInput } from "./deep-research.js";
import { normalizeProductName, productNameMatches } from "./deep-extractor.js";

const hasCjk = (s: string): boolean => /[㐀-鿿豈-﫿]/.test(s);

describe("S1-A1 buildQueries — 基礎查詢一律雙語（全部角度 zh+en）", () => {
  it("非 CJK 公司名也含 zh 查詢（雙語不排除中文）", () => {
    const input: DeepResearchInput = { companyName: "Stripe" };
    const qs = buildQueries(input, 100).map((q) => q.query);
    expect(qs.some((q) => hasCjk(q))).toBe(true); // 有中文查詢
    expect(qs.some((q) => !hasCjk(q) && /Stripe/.test(q))).toBe(true); // 也有英文查詢
  });

  it("CJK 公司名同時含 en 查詢", () => {
    const input: DeepResearchInput = { companyName: "台積電" };
    const qs = buildQueries(input, 100).map((q) => q.query);
    expect(qs.some((q) => /company|overview|news|competitors|products/i.test(q))).toBe(true); // 英文查詢在
    expect(qs.some((q) => hasCjk(q))).toBe(true);
  });

  it("涵蓋全部角度（含 A2 新增五角度）且每角度雙語（11 角度 × 2 = 22）", () => {
    const qs = buildQueries({ companyName: "Acme" }, 100);
    const angles = new Set(qs.map((q) => q.angle));
    for (const a of ["overview", "news", "funding", "leadership", "competitors", "products", "hiring", "caseStudies", "reviews", "registry", "awards"]) {
      expect(angles.has(a)).toBe(true);
    }
    expect(qs.length).toBe(22);
    // 每個角度都出現兩次（zh + en）
    for (const a of angles) {
      expect(qs.filter((q) => q.angle === a)).toHaveLength(2);
    }
  });

  it("maxQueries 上限截斷後，優先語言仍雙語交錯（非 CJK：en 先、zh 緊隨）", () => {
    const qs = buildQueries({ companyName: "Globex" }, 4).map((q) => q.query);
    expect(qs).toHaveLength(4);
    expect(qs.some((q) => hasCjk(q))).toBe(true); // 交錯 → 前 4 條就含中文
  });
});

describe("S1-A8 產品名稱對齊 matcher", () => {
  it("normalizeProductName：lowercase＋去空白/標點/符號", () => {
    expect(normalizeProductName("CP1500 PFCLCD")).toBe("cp1500pfclcd");
    expect(normalizeProductName("Foo-Bar 2.0")).toBe("foobar20");
    expect(normalizeProductName("  Acme® Cloud™ ")).toBe("acmecloud");
  });

  it("正規化後相等 → 對齊", () => {
    expect(productNameMatches("CP1500 PFCLCD", "cp1500pfclcd")).toBe(true);
  });

  it("含式匹配（任一含另一）可接受", () => {
    expect(productNameMatches("Acme Cloud", "AcmeCloud Pro")).toBe(true);
    expect(productNameMatches("Widget X Enterprise", "widget-x")).toBe(true);
  });

  it("不相關名稱不對齊；空字串不對齊", () => {
    expect(productNameMatches("Widget", "Gadget")).toBe(false);
    expect(productNameMatches("", "anything")).toBe(false);
    expect(productNameMatches("   ", "x")).toBe(false);
  });
});

describe("S1-A9 assembleSources — 去重、官網優先、cap 60", () => {
  it("cap 60、官網頁優先序不變", () => {
    const siteVisited = Array.from({ length: 5 }, (_, i) => `https://acme.com/p${i}`);
    const citationUrls = Array.from({ length: 100 }, (_, i) => `https://news${i}.example/a`);
    const out = assembleSources({ siteVisited, citationUrls });
    expect(out).toHaveLength(60); // cap
    expect(out.slice(0, 5)).toEqual(siteVisited); // 官網頁優先
  });

  it("去重（跨來源集合）", () => {
    const shared = "https://news.example/x";
    const out = assembleSources({
      siteVisited: [shared],
      deepReadUrls: [shared, "https://news.example/y"],
      citationUrls: [shared],
    });
    expect(out).toEqual([shared, "https://news.example/y"]);
  });

  it("納入已引用但未深讀的 citation（resolve 後真實 URL），排除仍是 grounding-redirect 的中介 URL", () => {
    const redirect = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc";
    const real = "https://reuters.com/story";
    const plainReal = "https://techcrunch.com/post";
    const resolved = new Map<string, string>([[redirect, real]]);
    const out = assembleSources({
      citationUrls: [redirect, plainReal, "https://vertexaisearch.cloud.google.com/grounding-api-redirect/unresolved"],
      resolved,
    });
    expect(out).toContain(real); // redirect 解析成真實 URL 後納入
    expect(out).toContain(plainReal); // 本就是真實 URL → 納入
    expect(out.some((u) => u.includes("vertexaisearch"))).toBe(false); // 未解析的中介 redirect 不入
  });
});
