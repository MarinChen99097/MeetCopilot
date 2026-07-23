/**
 * A1 訓練閘測試：手動解鎖對練（training_unlocked）與逐欄 verified 閘的 OR 關係。
 * personas() 只用 core（不碰 minter/gemini/scorer），故以真 in-memory core + 空 stub 驗「解鎖放行」行為。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { GeminiClient } from "../gemini.js";
import { createTrainService, type TrainServiceDeps } from "./train-service.js";

function makeService(core: TrainServiceDeps["core"]) {
  return createTrainService({
    core,
    minter: {} as unknown as TrainServiceDeps["minter"],
    scorer: {} as unknown as TrainServiceDeps["scorer"],
    gemini: {} as unknown as GeminiClient,
    liveModel: "m",
  });
}

describe("train gate — 手動解鎖對練（A1）", () => {
  it("0 個 verified persona 欄的 contact 預設不可對練；手動解鎖後可對練、再鎖回又不可", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const c = await core.contacts.create("o1", co.id, { fullName: "Jane Doe" });
    const svc = makeService(core);

    // 預設：無 verified persona 欄 + trainingUnlocked=0 → 不列出
    let list = await svc.personas("o1");
    expect(list.some((p) => p.contactId === c.id)).toBe(false);

    // 手動解鎖（與欄位內容脫鉤）→ 列出可對練
    await core.contacts.update("o1", c.id, { trainingUnlocked: 1 }, { userId: "u1" });
    list = await svc.personas("o1");
    expect(list.some((p) => p.contactId === c.id)).toBe(true);

    // 再鎖回 → 又不可對練
    await core.contacts.update("o1", c.id, { trainingUnlocked: 0 }, { userId: "u1" });
    list = await svc.personas("o1");
    expect(list.some((p) => p.contactId === c.id)).toBe(false);

    await core.close();
  });
});
