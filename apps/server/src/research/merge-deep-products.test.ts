/**
 * S1-A8 mergeDeepProducts：外部視角產品觀點對齊官網既有產品。
 * 回歸重點——base/variant 誤配：官網同時有基礎名與變體名（Ghost / Ghost Pro）時，外部 "Ghost Pro" 觀點
 * 必須歸到 "Ghost Pro"，不可被較短、排序在前的 "Ghost" 以 first-match 貪婪吃掉（含式匹配下的常見碰撞）。
 * 合併規則＝fill-empty/union（不覆寫既有非空值）、notableCustomers 併入 notes、配不到→unmatched（不建新列）。
 */
import { describe, it, expect } from "vitest";
import type { CompanyProduct } from "@meetcopilot/shared";
import { mergeDeepProducts } from "./orchestrator.js";
import type { DeepProduct } from "./deep-extractor.js";

describe("S1-A8 mergeDeepProducts", () => {
  it("精確正規化配對優先：外部 'Ghost Pro' 歸到 'Ghost Pro'，不被 'Ghost' 貪婪吃掉", () => {
    const site: Partial<CompanyProduct>[] = [{ name: "Ghost" }, { name: "Ghost Pro" }];
    const deep: DeepProduct[] = [
      { name: "Ghost Pro", competitors: ["WordPress VIP"], differentiators: ["託管代管"], notableCustomers: ["OpenAI"] },
    ];
    const { products, unmatched } = mergeDeepProducts(site, deep);
    expect(unmatched).toHaveLength(0);
    const base = products.find((p) => p.name === "Ghost");
    const variant = products.find((p) => p.name === "Ghost Pro");
    // 外部觀點只進變體、不進基礎名
    expect(variant?.competitors).toEqual(["WordPress VIP"]);
    expect(variant?.differentiators).toEqual(["託管代管"]);
    expect(variant?.notes).toContain("OpenAI");
    expect(base?.competitors).toBeUndefined();
    expect(base?.differentiators).toBeUndefined();
    expect(base?.notes).toBeUndefined();
  });

  it("較長變體優先於較短基礎名（順序顛倒也成立：官網 ['Pro','ProMax'] + 外部 'ProMax' → 'ProMax'）", () => {
    const site: Partial<CompanyProduct>[] = [{ name: "Pro" }, { name: "ProMax" }];
    const deep: DeepProduct[] = [{ name: "ProMax", competitors: ["Rival"] }];
    const { products } = mergeDeepProducts(site, deep);
    expect(products.find((p) => p.name === "Pro")?.competitors).toBeUndefined();
    expect(products.find((p) => p.name === "ProMax")?.competitors).toEqual(["Rival"]);
  });

  it("無精確命中時退回含式匹配（契約 A8 允許）：外部 'Acme Cloud Pro' → 官網 'Acme Cloud'", () => {
    const site: Partial<CompanyProduct>[] = [{ name: "Acme Cloud" }];
    const deep: DeepProduct[] = [{ name: "Acme Cloud Pro", differentiators: ["SLA 99.99%"] }];
    const { products, unmatched } = mergeDeepProducts(site, deep);
    expect(unmatched).toHaveLength(0);
    expect(products[0]?.differentiators).toEqual(["SLA 99.99%"]);
  });

  it("fill-empty/union：不覆寫既有非空值，陣列去重聯集", () => {
    const site: Partial<CompanyProduct>[] = [
      { name: "Widget", competitors: ["A"], differentiators: ["既有差異化"] },
    ];
    const deep: DeepProduct[] = [
      { name: "Widget", competitors: ["A", "B"], differentiators: ["新差異化"] },
    ];
    const { products } = mergeDeepProducts(site, deep);
    expect(products[0]?.competitors).toEqual(["A", "B"]); // union 去重
    expect(products[0]?.differentiators).toEqual(["既有差異化", "新差異化"]); // union，既有值保留
  });

  it("配不到 → unmatched（不建新產品列）；空名跳過", () => {
    const site: Partial<CompanyProduct>[] = [{ name: "Widget" }];
    const deep: DeepProduct[] = [
      { name: "Gadget", competitors: ["X"] },
      { name: "   " },
    ];
    const { products, unmatched } = mergeDeepProducts(site, deep);
    expect(products).toHaveLength(1); // 未新增列
    expect(unmatched.map((u) => u.name)).toEqual(["Gadget"]); // 空名不入 unmatched
  });

  it("純函式：不變異入參 siteProducts", () => {
    const site: Partial<CompanyProduct>[] = [{ name: "Ghost" }];
    const deep: DeepProduct[] = [{ name: "Ghost", competitors: ["Y"] }];
    mergeDeepProducts(site, deep);
    expect(site[0]).toEqual({ name: "Ghost" }); // 原物件未被寫入 competitors
  });
});
