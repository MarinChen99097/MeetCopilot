/**
 * 記債：runWithSemaphoreTimeout 的 semaphore 名額佔用到「底層 work 真正 settle」才釋放——
 * 即使 timeoutMs 逾時先回 null，名額仍佔位到 work 收尾，避免逾時提前釋放導致實際併發超過上限。
 */
import { describe, it, expect } from "vitest";
import { createSemaphore, runWithSemaphoreTimeout } from "./deep-research.js";

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("runWithSemaphoreTimeout — settle-based release", () => {
  it("逾時回 null 後名額仍佔位到底層 settle（不提前放行下一個）", async () => {
    const sem = createSemaphore(1);
    let resolveFirst!: (v: string) => void;
    const firstWork = (): Promise<string> => new Promise<string>((res) => (resolveFirst = res));
    let secondStarted = false;
    const secondWork = (): Promise<string> => {
      secondStarted = true;
      return Promise.resolve("second");
    };

    const p1 = runWithSemaphoreTimeout(sem, firstWork, 20); // 20ms 逾時
    const p2 = runWithSemaphoreTimeout(sem, secondWork, 1000);

    const r1 = await p1;
    expect(r1).toBeNull(); // 逾時 → null

    // 底層 firstWork 尚未 settle → 名額仍被佔用 → secondWork 不該被呼叫。
    await delay(40);
    expect(secondStarted).toBe(false);

    // settle 底層 → 釋放名額 → 第二個才 acquire 並執行。
    resolveFirst("first");
    const r2 = await p2;
    expect(r2).toBe("second");
    expect(secondStarted).toBe(true);
  });

  it("work 在逾時前 resolve → 回其結果", async () => {
    const sem = createSemaphore(2);
    const r = await runWithSemaphoreTimeout(sem, () => Promise.resolve("ok"), 1000);
    expect(r).toBe("ok");
  });

  it("work reject → 回 null，且名額已釋放（下一個能 acquire）", async () => {
    const sem = createSemaphore(1);
    const r = await runWithSemaphoreTimeout(sem, () => Promise.reject(new Error("boom")), 1000);
    expect(r).toBeNull();
    const r2 = await runWithSemaphoreTimeout(sem, () => Promise.resolve("next"), 1000);
    expect(r2).toBe("next");
  });

  it("work 同步 throw → 回 null 且釋放名額", async () => {
    const sem = createSemaphore(1);
    const r = await runWithSemaphoreTimeout(sem, () => {
      throw new Error("sync-boom");
    }, 1000);
    expect(r).toBeNull();
    const r2 = await runWithSemaphoreTimeout(sem, () => Promise.resolve("after"), 1000);
    expect(r2).toBe("after");
  });
});
