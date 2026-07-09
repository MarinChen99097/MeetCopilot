/**
 * Meter.meter userId plumbing (ADMIN_CONTRACT §2): the optional 5th arg must reach UsageRepository.record
 * (→ usage_events.user_id), and omitting it must keep the existing behaviour (undefined userId).
 */
import { describe, it, expect } from "vitest";
import type { UsageRepository } from "@meetcopilot/crm";
import type { NewUsageEvent, UsageRollup } from "@meetcopilot/shared";
import { createMeter } from "./meter-impl.js";

function captureRepo(): { repo: UsageRepository; recorded: (NewUsageEvent & { orgId: string })[] } {
  const recorded: (NewUsageEvent & { orgId: string })[] = [];
  const repo: UsageRepository = {
    async record(orgId, event) {
      recorded.push({ orgId, ...event });
    },
    async rollup(): Promise<UsageRollup> {
      return { from: 0, to: 0, totalCostUsd: 0, byKind: [] };
    },
  };
  return { repo, recorded };
}

describe("Meter.meter userId", () => {
  it("forwards userId into the recorded usage event", async () => {
    const { repo, recorded } = captureRepo();
    const meter = createMeter(repo);
    const out = await meter.meter(
      "org-1",
      "gemini_text",
      async () => ({ result: "ok", model: "gemini-3.5-flash", inputTokens: 10, outputTokens: 5 }),
      "idem-1",
      "user-42",
    );
    expect(out).toBe("ok");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ orgId: "org-1", kind: "gemini_text", userId: "user-42", idempotencyKey: "idem-1" });
  });

  it("leaves userId undefined when the arg is omitted (back-compat)", async () => {
    const { repo, recorded } = captureRepo();
    const meter = createMeter(repo);
    await meter.meter("org-1", "asr", async () => ({ result: 1 }), "idem-2");
    expect(recorded[0]?.userId).toBeUndefined();
  });
});
