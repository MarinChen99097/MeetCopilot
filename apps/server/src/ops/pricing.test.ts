/**
 * Pricing (ops/pricing.ts): cost estimation, env overrides (ADMIN_CONTRACT §3.4), and the admin pricing view
 * (§4 #10). loadPricingOverrides mutates the shared PRICING map, so keep this file's assertions self-contained
 * (a unique model key that no other test touches).
 */
import { describe, it, expect } from "vitest";
import { estimateCostUsd, loadPricingOverrides, pricingRows, PRICING_DISCLAIMER } from "./pricing.js";

describe("estimateCostUsd", () => {
  it("token cost = in/out × per-M; missing tokens → 0; never NaN/negative", () => {
    // gemini-3.5-flash: 0.3 in / 2.5 out per 1M.
    const c = estimateCostUsd("gemini_extract", "gemini-3.5-flash", 1_000_000, 1_000_000);
    expect(c).toBeCloseTo(0.3 + 2.5, 6);
    expect(estimateCostUsd("gemini_text", undefined, undefined, undefined)).toBe(0);
    expect(estimateCostUsd("openai_image", "gpt-image-2", undefined, undefined)).toBeCloseTo(0.04, 6);
  });
});

describe("loadPricingOverrides (§3.4)", () => {
  it("overrides an existing model's per-M rates from PRICING__<MODEL>__* and marks source=env", () => {
    const env = {
      // gemini-3.1-flash-lite → GEMINI_3_1_FLASH_LITE
      PRICING__GEMINI_3_1_FLASH_LITE__INPUT_PER_M: "9.99",
      PRICING__GEMINI_3_1_FLASH_LITE__OUTPUT_PER_M: "19.98",
    } as unknown as NodeJS.ProcessEnv;
    const changed = loadPricingOverrides(env);
    expect(changed).toContain("gemini-3.1-flash-lite");

    // estimateCostUsd now reflects the override.
    const c = estimateCostUsd("gemini_text", "gemini-3.1-flash-lite", 1_000_000, 0);
    expect(c).toBeCloseTo(9.99, 6);

    // pricingRows tags the overridden model as source:'env', others stay 'default'.
    const rows = pricingRows([
      { kind: "gemini_text", model: "gemini-3.1-flash-lite" },
      { kind: "openai_image", model: "gpt-image-2" },
    ]);
    expect(rows.find((r) => r.model === "gemini-3.1-flash-lite")?.source).toBe("env");
    expect(rows.find((r) => r.model === "gpt-image-2")?.source).toBe("default");
  });

  it("ignores invalid/absent override values", () => {
    const changed = loadPricingOverrides({ PRICING__GPT_IMAGE_2__PER_IMAGE: "not-a-number" } as unknown as NodeJS.ProcessEnv);
    expect(changed).not.toContain("gpt-image-2");
  });
});

describe("pricingRows (§4 #10)", () => {
  it("emits a row per kind/model pair with a disclaimer available", () => {
    const rows = pricingRows([{ kind: "asr" }, { kind: "embedding", model: "gemini-embedding-001" }]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: "asr", source: "default" });
    expect(rows[1]).toMatchObject({ kind: "embedding", model: "gemini-embedding-001", inputPerM: 0.15 });
    expect(PRICING_DISCLAIMER.length).toBeGreaterThan(20);
  });
});
