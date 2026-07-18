/**
 * crawl_jobs 開機 reaper（契約五）：server 重啟後把殘留 queued/running 的研究 job 一律標 failed
 * （其背景流程已隨舊進程消失、永不會再收尾）。in-memory SQLite：造 queued/running/done 三列 → failInterrupted
 * → 驗 queued/running 變 failed（帶固定 error 文案 + finished_at）、done 不動；跨 org；重跑冪等（回 0）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createCrawlJobStore, REAPER_INTERRUPTED_ERROR } from "./jobs.js";

let core: CrmCore;
const ORG = "org-reaper";

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
});
afterEach(() => core.close());

describe("crawl_jobs reaper (failInterrupted)", () => {
  it("marks queued+running failed, leaves done untouched, sets error+finished_at, idempotent", async () => {
    const store = createCrawlJobStore(core.db);

    // 造三列：queued（create 預設）/running（markRunning）/done（markDone）。
    const queued = await store.create(ORG, { targetType: "company", targetId: "c1", mode: "deep" });
    const running = await store.create(ORG, { targetType: "company", targetId: "c2", mode: "detailed" });
    await store.markRunning(ORG, running.id);
    const done = await store.create(ORG, { targetType: "company", targetId: "c3", mode: "quick" });
    await store.markDone(ORG, done.id, { fieldsFilled: 3, sources: ["https://example.com"] });

    const n = await store.failInterrupted();
    expect(n).toBe(2); // 只 queued + running

    const q = await store.findById(ORG, queued.id);
    const r = await store.findById(ORG, running.id);
    const d = await store.findById(ORG, done.id);

    expect(q?.status).toBe("failed");
    expect(r?.status).toBe("failed");
    expect(d?.status).toBe("done"); // done 不被動

    expect(q?.error).toBe(REAPER_INTERRUPTED_ERROR);
    expect(r?.error).toBe(REAPER_INTERRUPTED_ERROR);
    expect(q?.finishedAt).toBeGreaterThan(0);
    expect(r?.finishedAt).toBeGreaterThan(0);
    expect(d?.error).toBeUndefined(); // done 的 error 仍空

    // 重跑冪等：已無殘留 → 0，且不影響已終態的列。
    expect(await store.failInterrupted()).toBe(0);
    expect((await store.findById(ORG, done.id))?.status).toBe("done");
  });

  it("is cross-org (reaps interrupted jobs regardless of org)", async () => {
    const store = createCrawlJobStore(core.db);
    await store.create("orgA", { targetType: "company", targetId: "a1", mode: "deep" });
    const b = await store.create("orgB", { targetType: "company", targetId: "b1", mode: "deep" });
    await store.markRunning("orgB", b.id);

    expect(await store.failInterrupted()).toBe(2); // 兩個 org 的殘留都被清

    expect((await store.findById("orgA", "does-not-exist"))).toBeNull();
    const bAfter = await store.findById("orgB", b.id);
    expect(bAfter?.status).toBe("failed");
  });
});
