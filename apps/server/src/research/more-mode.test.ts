/**
 * more 模式純函式：buildMoreGapQueries（DB 空欄種子）＋ decideEvidenceBoost（佐證升信心判定）。
 */
import { describe, it, expect } from "vitest";
import { buildMoreGapQueries, decideEvidenceBoost, isEmptyValue, MORE_GAP_QUERY_CAP } from "./more-mode.js";

describe("buildMoreGapQueries — DB 空欄種子", () => {
  it("空公司 → 產公司欄 gap 查詢（bilingual zh 先），cap 12", () => {
    const qs = buildMoreGapQueries({ companyName: "台積電", bilingual: true, company: {} });
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(MORE_GAP_QUERY_CAP);
    // 8 個公司探針 × 雙語 = 16 → 被 cap 到 12。
    expect(qs.length).toBe(12);
    // bilingual：第一條為 zh（funding 探針 zh）。
    expect(qs[0]!.query).toContain("募資");
    expect(qs[0]!.angle).toBe("funding");
  });

  it("公司欄全填 → 無公司 gap；產品缺 model/specs、主管缺、社群缺平台 → 各自產查詢", () => {
    const qs = buildMoreGapQueries({
      companyName: "Acme",
      company: {
        fundingStage: "Series A",
        industry: "SaaS",
        tagline: "build fast",
        businessModel: "subscription",
        foundedYear: 2020,
        employeeCount: 50,
        annualRevenue: 1_000_000,
        hqCity: "Taipei",
      },
      products: [{ name: "Widget", pricing: "", specs: {}, model: "" }],
      contactsNeedingDetail: ["Jane Doe"],
      socialPlatformsPresent: ["youtube"],
    });
    const joined = qs.map((q) => q.query).join(" | ");
    expect(joined).toContain("Widget"); // 產品缺 pricing/specs/model
    expect(joined).toContain("Jane Doe"); // 主管缺背景/照片
    expect(joined).toContain("facebook"); // 社群缺 facebook
    expect(joined).toContain("instagram");
    expect(joined).toContain("threads");
    expect(joined).not.toContain("youtube"); // youtube 已存在 → 不補
    // 沒有任何公司探針查詢（industry/募資 等）。
    expect(joined).not.toContain("募資");
    expect(joined).not.toContain("產業別");
  });

  it("bilingual=false → 基礎查詢 en 先", () => {
    const qs = buildMoreGapQueries({ companyName: "Acme", bilingual: false, company: {} });
    expect(qs[0]!.query).toContain("funding");
  });

  it("填滿的產品不補（pricing/specs/model 皆有值）", () => {
    const qs = buildMoreGapQueries({
      companyName: "Acme",
      company: { industry: "x", tagline: "x", businessModel: "x", foundedYear: 2000, employeeCount: 1, annualRevenue: 1, hqCity: "x", fundingStage: "x" },
      products: [{ name: "Full", pricing: "$9/mo", specs: { cpu: "x" }, model: "F-100" }],
      socialPlatformsPresent: ["youtube", "facebook", "instagram", "threads"],
    });
    expect(qs).toEqual([]); // 全填滿 → 無缺口
  });
});

describe("decideEvidenceBoost — 佐證升信心判定", () => {
  it("既有非空、正規化相等、來源網域不同 → 升信心（+0.15、保留既有值、不動 verified）", () => {
    const b = decideEvidenceBoost({
      fieldName: "industry",
      existingValue: "SaaS",
      newValue: "saas", // 大小寫不敏感 → 正規化相等
      newSourceUrl: "https://news.example.com/a",
      newSourceType: "news",
      existing: { sourceUrl: "https://wikipedia.org/x", confidence: 0.6, verified: 0 },
    });
    expect(b).not.toBeNull();
    expect(b!.confidence).toBeCloseTo(0.75);
    expect(b!.valueSnapshot).toBe("SaaS"); // 保留既有值（被佐證）
    expect(b!.verified).toBe(0);
    expect(b!.sourceUrl).toBe("https://news.example.com/a");
    expect(b!.sourceType).toBe("news");
  });

  it("同網域（去 www.）佐證 → 不算獨立 → null", () => {
    const b = decideEvidenceBoost({
      fieldName: "industry",
      existingValue: "SaaS",
      newValue: "SaaS",
      newSourceUrl: "https://news.example.com/b",
      existing: { sourceUrl: "https://www.news.example.com/a", confidence: 0.6, verified: 0 },
    });
    expect(b).toBeNull();
  });

  it("既有為空 → fill-empty 路徑，不佐證 → null", () => {
    expect(
      decideEvidenceBoost({ fieldName: "industry", existingValue: "", newValue: "SaaS", newSourceUrl: "https://x.com" }),
    ).toBeNull();
  });

  it("值不相等 → null", () => {
    expect(
      decideEvidenceBoost({
        fieldName: "industry",
        existingValue: "SaaS",
        newValue: "Fintech",
        newSourceUrl: "https://x.com",
      }),
    ).toBeNull();
  });

  it("無新來源網域 → null（不憑空升信心）", () => {
    expect(decideEvidenceBoost({ fieldName: "x", existingValue: "v", newValue: "v" })).toBeNull();
  });

  it("信心上限夾 0.9", () => {
    const b = decideEvidenceBoost({
      fieldName: "x",
      existingValue: "v",
      newValue: "v",
      newSourceUrl: "https://a.com",
      existing: { sourceUrl: "https://b.com", confidence: 0.85, verified: 0 },
    });
    expect(b!.confidence).toBe(0.9); // min(0.9, 1.0)
  });

  it("無既有 provenance → 舊信心預設 0.5 → 升到 0.65，verified 0", () => {
    const b = decideEvidenceBoost({ fieldName: "x", existingValue: "v", newValue: "v", newSourceUrl: "https://a.com" });
    expect(b!.confidence).toBeCloseTo(0.65);
    expect(b!.verified).toBe(0);
  });
});

describe("isEmptyValue", () => {
  it("空判準：null/undefined/空字串/空陣列/空物件為空；數字 0、非空皆非空", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("  ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
    expect(isEmptyValue({})).toBe(true);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue("x")).toBe(false);
    expect(isEmptyValue([1])).toBe(false);
    expect(isEmptyValue({ a: 1 })).toBe(false);
  });
});
