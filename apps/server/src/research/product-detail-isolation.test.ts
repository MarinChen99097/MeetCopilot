/**
 * S2-B4 二段式聚焦補抽的「失敗隔離」單測（MAX_TOKENS 韌性，對齊症狀 2）：
 * gemini-3.5-flash 的 thinking token 偶爾把單一產品的 rich JSON 抽取吃到 MAX_TOKENS。此測驗證
 * enrichProductDetails 的並行迴圈**單品失敗只略過該品、不影響其餘與整體**（不上拋、其他產品照常補抽）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { enrichProductDetails } from "./extractor.js";
import type { GeminiClient } from "../gemini.js";
import type { RawCrawl } from "./crawler.js";

/** 只實作 enrichProductDetails 用到的 isConfigured/generateJson；其餘方法呼叫即測試失敗（確認未被誤用）。 */
function fakeGemini(generateJson: GeminiClient["generateJson"]): GeminiClient {
  const unused = (name: string) => () => Promise.reject(new Error(`${name} should not be called`));
  return {
    isConfigured: () => true,
    generateJson,
    generateJsonMetered: unused("generateJsonMetered") as GeminiClient["generateJsonMetered"],
    generateGrounded: unused("generateGrounded") as GeminiClient["generateGrounded"],
    embed: unused("embed") as GeminiClient["embed"],
    embedMetered: unused("embedMetered") as GeminiClient["embedMetered"],
  };
}

const raw: RawCrawl = {
  url: "https://x.com",
  finalUrl: "https://x.com",
  title: "Home",
  pages: [
    { url: "https://x.com/products/alpha", title: "Alpha", text: "Alpha product page body text." },
    { url: "https://x.com/products/bravo", title: "Bravo", text: "Bravo product page body text." },
  ],
  sourcesVisited: [],
};

afterEach(() => vi.restoreAllMocks());

describe("enrichProductDetails — 單品 MAX_TOKENS 失敗隔離", () => {
  it("一品拋 MAX_TOKENS、另一品成功 → 不上拋；失敗品保原樣、成功品被補抽", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // 靜音預期中的 non-fatal 錯誤 log

    // Alpha 的聚焦抽取被 MAX_TOKENS 截斷（拋錯）；Bravo 正常回 rich detail。
    const gemini = fakeGemini((async (opts: { prompt: string }) => {
      if (opts.prompt.includes("PRODUCT NAME: Alpha")) {
        throw new Error("Gemini 生成未正常結束（finishReason=MAX_TOKENS）：輸出過長被截斷，請減少頁數或精簡輸入後再試。");
      }
      if (opts.prompt.includes("PRODUCT NAME: Bravo")) {
        return { name: "Bravo", targetMarket: "SMB 伺服器機房", keyFeatures: [{ name: "F1", detail: "d1" }] };
      }
      throw new Error(`unexpected product prompt: ${opts.prompt.slice(0, 40)}`);
    }) as unknown as GeminiClient["generateJson"]);

    const products = [
      { name: "Alpha", productUrl: "https://x.com/products/alpha", oneLiner: "alpha base" },
      { name: "Bravo", productUrl: "https://x.com/products/bravo", oneLiner: "bravo base" },
    ];

    // 不應上拋（單品失敗被 worker 內 try/catch 吞掉）。
    const out = await enrichProductDetails(gemini, undefined, products, raw);
    expect(out).toHaveLength(2);

    // 失敗品 Alpha：保原樣（無新增 targetMarket），既有 oneLiner 不受影響。
    const alpha = out.find((p) => p.name === "Alpha");
    expect(alpha?.targetMarket).toBeUndefined();
    expect(alpha?.oneLiner).toBe("alpha base");

    // 成功品 Bravo：補抽的 targetMarket/keyFeatures 併入，既有 oneLiner（非空）不被覆寫（fill-empty）。
    const bravo = out.find((p) => p.name === "Bravo");
    expect(bravo?.targetMarket).toBe("SMB 伺服器機房");
    expect(bravo?.keyFeatures?.map((f) => f.name)).toEqual(["F1"]);
    expect(bravo?.oneLiner).toBe("bravo base");
  });
});
