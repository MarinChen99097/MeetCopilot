/**
 * 運行時「安全網補記」（019；對齊 ezpage SDK-boundary autolog）行為驗證。
 *  1. 計費脈絡內的 raw AI 呼叫（safetyNetRecord）→ 補記一筆（歸屬 orgId/kind/userId）。
 *  2. explicit metering（withSuppressedMetering，模擬 meter.meter 的 fn 執行期）內 → 安全網**不**補記（防雙記）。
 *  3. 無計費脈絡 → no-op（不記，維持既有行為）。
 *  4. embed 的 kindOverride 生效（一律 embedding，與外層 ctx.kind 無關）。
 */
import { describe, it, expect } from "vitest";
import type { UsageRepository } from "@meetcopilot/crm";
import type { NewUsageEvent } from "@meetcopilot/shared";
import type { Meter, MeterResult } from "./meter.js";
import { createMeter } from "./meter-impl.js";
import { runWithMetering, withSuppressedMetering, safetyNetRecord } from "./metering-context.js";

interface Recorded {
  orgId: string;
  kind: string;
  idemKey: string;
  userId?: string;
  meetingId?: string;
  model?: string;
}

/** 記下每次 meter() 的呼叫（同時執行 fn 以取得 usage 欄）。 */
function fakeMeter(sink: Recorded[]): Meter {
  return {
    async meter<T>(
      orgId: string,
      kind: string,
      fn: () => Promise<MeterResult<T>>,
      idemKey: string,
      userId?: string,
    ): Promise<T> {
      const out = await fn();
      sink.push({ orgId, kind: String(kind), idemKey, userId, meetingId: out.meetingId, model: out.model });
      return out.result;
    },
  } as Meter;
}

const CTX = (meter: Meter) => ({
  orgId: "o1",
  userId: "u1",
  meetingId: "m1",
  kind: "gemini_text" as const,
  meter,
  idemPrefix: "test",
});

describe("運行時安全網補記（019）", () => {
  it("計費脈絡內 raw 呼叫 → 補記一筆（orgId/kind/userId/meetingId 正確）", async () => {
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    runWithMetering(CTX(meter), () => {
      safetyNetRecord({ model: "gemini-3.5-flash", inputTokens: 100, outputTokens: 50 });
    });
    await Promise.resolve(); // flush fire-and-forget
    expect(sink).toHaveLength(1);
    expect(sink[0]).toMatchObject({ orgId: "o1", kind: "gemini_text", userId: "u1", meetingId: "m1", model: "gemini-3.5-flash" });
  });

  it("explicit metering 期間（suppressed）→ 安全網不補記（防雙記）", async () => {
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    await runWithMetering(CTX(meter), () =>
      withSuppressedMetering(async () => {
        // 模擬 meter.meter 的 fn 內部有一次 raw 呼叫（已被 explicit metering 涵蓋）。
        safetyNetRecord({ model: "gemini-3.5-flash", inputTokens: 100, outputTokens: 50 });
      }),
    );
    await Promise.resolve();
    expect(sink).toHaveLength(0);
  });

  it("suppressed 還原後，後續 raw 呼叫仍會補記（可重入）", async () => {
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    await runWithMetering(CTX(meter), async () => {
      await withSuppressedMetering(async () => safetyNetRecord({ inputTokens: 1 })); // 被抑制
      safetyNetRecord({ inputTokens: 2 }); // 還原後 → 補記
    });
    await Promise.resolve();
    expect(sink).toHaveLength(1);
  });

  it("併發 explicit metering：先完成者不得讓兄弟的安全網放行（計數器防雙記）", async () => {
    // deep research 的併發 grounding 情境：同脈絡內 2 個 explicit meter 同時在飛。
    // A 快、B 慢；A 先完成還原後，B 內的 raw 呼叫（safetyNetRecord）必須仍被抑制（depth>0）。
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    await runWithMetering(CTX(meter), async () => {
      const a = withSuppressedMetering(async () => {
        safetyNetRecord({ inputTokens: 1 }); // A 內：抑制
      });
      const b = withSuppressedMetering(async () => {
        await new Promise((r) => setTimeout(r, 5)); // B 慢，讓 A 先完成
        safetyNetRecord({ inputTokens: 2 }); // A 已還原，但 B 仍在飛 → depth>0 → 抑制
      });
      await Promise.all([a, b]);
    });
    await Promise.resolve();
    expect(sink).toHaveLength(0); // 兩者皆抑制，無雙記（布林版此處會漏放行 B → 長度 1）
  });

  it("無計費脈絡 → no-op（不記）", async () => {
    const sink: Recorded[] = [];
    // 直接呼叫（無 runWithMetering 包裹）
    safetyNetRecord({ inputTokens: 100 });
    await Promise.resolve();
    expect(sink).toHaveLength(0);
    void fakeMeter; // keep referenced
  });

  it("embed 的 kindOverride 生效（記 embedding，非外層 gemini_text）", async () => {
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    runWithMetering(CTX(meter), () => {
      safetyNetRecord({ model: "gemini-embedding-001", inputTokens: 10 }, "embedding");
    });
    await Promise.resolve();
    expect(sink).toHaveLength(1);
    expect(sink[0]!.kind).toBe("embedding");
  });

  it("安全網自身補記走出 ALS 脈絡 → 併發兄弟不自我抑制（真 meter-impl 路徑）", async () => {
    // 用真 createMeter（其 withSuppressedMetering 會抬 depth）。若安全網補記不 exit ALS，A 的 meter.meter 會短暫
    // 抬 depth → 同步緊接的 B 被誤抑制 → 只落 1 筆。exit 後 depth 不受影響 → 兩筆都落。
    const records: NewUsageEvent[] = [];
    const repo = {
      record: async (_orgId: string, e: NewUsageEvent) => {
        records.push(e);
      },
      rollup: async () => ({ from: 0, to: 0, totalCostUsd: 0, byKind: [] }),
    } as unknown as UsageRepository;
    const meter = createMeter(repo);
    runWithMetering(CTX(meter), () => {
      safetyNetRecord({ model: "gemini-3.5-flash", inputTokens: 1 }); // A
      safetyNetRecord({ model: "gemini-3.5-flash", inputTokens: 2 }); // B
    });
    await new Promise((r) => setTimeout(r, 10)); // flush fire-and-forget record
    expect(records).toHaveLength(2);
  });

  it("同一脈絡多筆 → idemKey 遞增不撞（不會被誤去重）", async () => {
    const sink: Recorded[] = [];
    const meter = fakeMeter(sink);
    runWithMetering(CTX(meter), () => {
      safetyNetRecord({ inputTokens: 1 });
      safetyNetRecord({ inputTokens: 2 });
    });
    await Promise.resolve();
    expect(sink).toHaveLength(2);
    expect(sink[0]!.idemKey).not.toBe(sink[1]!.idemKey);
  });
});
