/**
 * UsageRepository 測試（M5 §B）。驗收接縫行為（009_ops.sql: usage_events）：
 *  - record 冪等：同 (org_id, idempotency_key) 記兩次只留一筆（INSERT OR IGNORE）
 *  - rollup：[from,to] 窗內依 kind 分組加總 events/token/cost + 總成本；org-scoped（跨 org 不外洩）
 *  - 窗界：created_at 在窗外的事件不計入
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "./core.js";
import type { CrmCore } from "./ports.js";
import type { NewUsageEvent } from "@meetcopilot/shared";

let core: CrmCore;
const ORG = "org-A";
const OTHER = "org-B";

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
});

afterEach(() => core.close());

function ev(over: Partial<NewUsageEvent> = {}): NewUsageEvent {
  return {
    kind: "gemini_text",
    model: "gemini-3.1-flash-lite",
    inputTokens: 100,
    outputTokens: 50,
    estCostUsd: 0.001,
    idempotencyKey: "k1",
    ...over,
  };
}

describe("UsageRepository.record idempotency", () => {
  it("dedupes on (org_id, idempotency_key) — same key recorded twice keeps one row", async () => {
    await core.usage.record(ORG, ev({ idempotencyKey: "dup" }));
    await core.usage.record(ORG, ev({ idempotencyKey: "dup", estCostUsd: 999 })); // 應被忽略
    const rows = await core.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM usage_events WHERE org_id = ? AND idempotency_key = ?",
      [ORG, "dup"],
    );
    expect(rows[0]?.n).toBe(1);
    // 首筆成本保留（第二筆整列被 IGNORE，不是 UPSERT）。
    const roll = await core.usage.rollup(ORG, 0, Date.now() + 1000);
    expect(roll.totalCostUsd).toBeCloseTo(0.001, 6);
  });

  it("same idempotency_key is allowed across different orgs (scope is per-org)", async () => {
    await core.usage.record(ORG, ev({ idempotencyKey: "shared" }));
    await core.usage.record(OTHER, ev({ idempotencyKey: "shared" }));
    const a = await core.usage.rollup(ORG, 0, Date.now() + 1000);
    const b = await core.usage.rollup(OTHER, 0, Date.now() + 1000);
    expect(a.byKind.reduce((s, r) => s + r.events, 0)).toBe(1);
    expect(b.byKind.reduce((s, r) => s + r.events, 0)).toBe(1);
  });
});

describe("UsageRepository.rollup", () => {
  it("groups by kind, sums tokens + cost, and totals", async () => {
    await core.usage.record(ORG, ev({ idempotencyKey: "t1", kind: "gemini_text", inputTokens: 100, outputTokens: 40, estCostUsd: 0.002 }));
    await core.usage.record(ORG, ev({ idempotencyKey: "t2", kind: "gemini_text", inputTokens: 200, outputTokens: 60, estCostUsd: 0.003 }));
    await core.usage.record(ORG, ev({ idempotencyKey: "i1", kind: "openai_image", inputTokens: undefined, outputTokens: undefined, estCostUsd: 0.04, model: "gpt-image-2" }));

    const roll = await core.usage.rollup(ORG, 0, Date.now() + 1000);
    expect(roll.totalCostUsd).toBeCloseTo(0.045, 6);

    const text = roll.byKind.find((r) => r.kind === "gemini_text");
    expect(text).toBeDefined();
    expect(text!.events).toBe(2);
    expect(text!.inputTokens).toBe(300);
    expect(text!.outputTokens).toBe(100);
    expect(text!.costUsd).toBeCloseTo(0.005, 6);

    const image = roll.byKind.find((r) => r.kind === "openai_image");
    expect(image!.events).toBe(1);
    expect(image!.inputTokens).toBe(0); // NULL tokens → COALESCE 0
    expect(image!.costUsd).toBeCloseTo(0.04, 6);
  });

  it("excludes events outside the [from,to] window", async () => {
    await core.usage.record(ORG, ev({ idempotencyKey: "old" }));
    // 立刻查一個未來窗 → 剛記的事件（created_at≈now）落在窗外，不計入。
    const future = Date.now() + 60_000;
    const roll = await core.usage.rollup(ORG, future, future + 1000);
    expect(roll.byKind).toHaveLength(0);
    expect(roll.totalCostUsd).toBe(0);
  });

  it("is org-scoped — another org's events never appear", async () => {
    await core.usage.record(OTHER, ev({ idempotencyKey: "x", estCostUsd: 5 }));
    const roll = await core.usage.rollup(ORG, 0, Date.now() + 1000);
    expect(roll.byKind).toHaveLength(0);
    expect(roll.totalCostUsd).toBe(0);
  });
});
