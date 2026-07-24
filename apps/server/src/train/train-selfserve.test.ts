/**
 * train 頁自助建對象整合測試（CRM_UPGRADE_PLAN Phase A2；真 in-memory core + mock gemini/minter）：
 *  - #1 draftPersona：LLM 九欄草稿以**未驗證**（filled_by='llm'、verified=0、source='ai_draft'）寫入 + 解鎖 trainingUnlocked=1，
 *    persona 欄位絕不 human/verified（守 CRM_SCHEMA §11）；contact 不存在→not_found、gemini 未設→not_configured。
 *  - #4 createSynthetic：建 is_synthetic=1 contact、persona 以 **human** provenance 寫入、可被 startSession；
 *    虛擬 contact 於 CRM 人物清單帶 isSynthetic（虛擬 badge 資料來源）。
 *  - authz：跨 org 憑證對兩端點皆被拒（org-scope findById → not_found），且不留副作用。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { GeminiClient } from "../gemini.js";
import type { LiveTokenMinter } from "./live-token.js";
import type { TrainScorer } from "./scoring.js";
import { createTrainService, type TrainService, type TrainServiceDeps } from "./train-service.js";
import { PERSONA_FIELDS } from "./persona.js";

/** mock GeminiClient：generateJson 回固定 response；isConfigured 可控（未設模擬 not_configured）。 */
function mockGemini(response: Record<string, unknown>, configured = true): GeminiClient {
  return {
    isConfigured: () => configured,
    generateJson: async <T>() => response as T,
    generateJsonMetered: async <T>() => ({ value: response as T, usage: { model: "mock" } }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
    embed: async () => [],
    embedMetered: async () => ({ value: [], usage: { model: "mock" } }),
  } as GeminiClient;
}

/** mock LiveTokenMinter：不外呼，直接回固定 token（startSession 可跑完）。 */
const mockMinter: LiveTokenMinter = {
  async mint(opts) {
    return { token: `tok-${opts.model}`, model: opts.model, expireTime: Date.now() + 60_000 };
  },
};

function makeService(core: TrainServiceDeps["core"], over: Partial<TrainServiceDeps> = {}): TrainService {
  return createTrainService({
    core,
    minter: mockMinter,
    scorer: {} as unknown as TrainScorer,
    gemini: mockGemini({}),
    liveModel: "live-model",
    ...over,
  });
}

const PERSONA_SET = new Set<string>(PERSONA_FIELDS);

describe("#1 draftPersona — AI 補齊真人 persona（未驗證草稿 + 解鎖）", () => {
  it("寫九欄未驗證草稿、解鎖 trainingUnlocked=1；persona provenance 恒 filled_by='llm' verified=0（絕不 human/verified）", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme 智慧製造", industry: "manufacturing" });
    const contact = await core.contacts.create("o1", co.id, { fullName: "Jane Doe", title: "CIO" });

    const svc = makeService(core, {
      gemini: mockGemini({ communicationStyle: "直接、重數據", decisionStyle: "資料驅動、需多方背書" }),
      textModel: "gemini-text",
    });

    const res = await svc.draftPersona("o1", contact.id, "u1");
    expect(res.fields.communicationStyle).toBe("直接、重數據");
    expect(res.fields.decisionStyle).toBe("資料驅動、需多方背書");

    // 欄位落庫 + 解鎖
    const after = await core.contacts.findById("o1", contact.id);
    expect(after?.communicationStyle).toBe("直接、重數據");
    expect(after?.decisionStyle).toBe("資料驅動、需多方背書");
    expect(after?.trainingUnlocked).toBe(1);

    // persona 欄位的 provenance：未驗證草稿（絕不把 AI 對真人的臆測升成人工真相，§11）
    const prov = await core.provenance.listForEntity("o1", "contact", contact.id);
    const personaProv = prov.filter((p) => PERSONA_SET.has(p.fieldName));
    expect(personaProv.length).toBeGreaterThan(0);
    expect(personaProv.every((p) => p.filledBy === "llm")).toBe(true);
    expect(personaProv.every((p) => p.verified === 0)).toBe(true);
    expect(personaProv.every((p) => p.sourceType === "ai_draft")).toBe(true);
    // persona 欄位絕無 human/verified（§11 底線）
    expect(personaProv.some((p) => p.filledBy === "human" || p.verified === 1)).toBe(false);

    // 修正 1：#1 只翻 trainingUnlocked、不升 verified —— AI 對真人的臆測不得抬高其可信徽章（rollup）。
    // 解鎖走 setTrainingUnlocked（純寫旗標），故 verified_status 與呼叫前相同（create 設 'none'），未被 bump 成 'partial'。
    expect(after?.verifiedStatus).toBe("none");
    // trainingUnlocked 純寫旗標，無任何 provenance（尤其無 human/verified）。
    expect(prov.some((p) => p.fieldName === "trainingUnlocked")).toBe(false);

    await core.close();
  });

  it("已受信任（human）的 persona 欄位不被 AI 草稿覆寫", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const contact = await core.contacts.create("o1", co.id, { fullName: "Jane" });
    // 人工細填 communicationStyle → human/verified=1（受信任）
    await core.contacts.update("o1", contact.id, { communicationStyle: "人工權威值" }, { userId: "u1" });

    const svc = makeService(core, { gemini: mockGemini({ communicationStyle: "AI 想覆寫", decisionStyle: "AI 新欄" }) });
    await svc.draftPersona("o1", contact.id, "u1");

    const after = await core.contacts.findById("o1", contact.id);
    expect(after?.communicationStyle).toBe("人工權威值"); // 不被覆寫
    expect(after?.decisionStyle).toBe("AI 新欄"); // 未受信任欄可補

    const prov = await core.provenance.listForEntity("o1", "contact", contact.id);
    const comm = prov.find((p) => p.fieldName === "communicationStyle");
    expect(comm?.filledBy).toBe("human"); // 最新一筆仍是 human（AI 草稿被跳過，未 supersede）
    expect(comm?.verified).toBe(1);

    await core.close();
  });

  it("contact 不存在→not_found；gemini 未設→not_configured", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const contact = await core.contacts.create("o1", co.id, { fullName: "Jane" });

    const svc = makeService(core, { gemini: mockGemini({ communicationStyle: "x" }) });
    await expect(svc.draftPersona("o1", "no-such-contact")).rejects.toMatchObject({ kind: "not_found" });

    const svcNoGemini = makeService(core, { gemini: mockGemini({}, false) });
    await expect(svcNoGemini.draftPersona("o1", contact.id)).rejects.toMatchObject({ kind: "not_configured" });

    await core.close();
  });
});

describe("#4 createSynthetic — AI 虛擬人物", () => {
  it("autoDesign 建 is_synthetic=1 contact、persona 以 human provenance 寫入、CRM 清單帶 isSynthetic、可被 startSession", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme 智慧製造", industry: "manufacturing" });

    const svc = makeService(core, {
      gemini: mockGemini({
        communicationStyle: "強勢、時間壓力大",
        objectionsRaised: "質疑遷移風險與價格",
        title: "採購副總",
      }),
    });

    const { contactId } = await svc.createSynthetic("o1", { companyId: co.id, autoDesign: true }, "u1");
    expect(contactId).toBeTruthy();

    const c = await core.contacts.findById("o1", contactId);
    expect(c?.isSynthetic).toBe(1);
    expect(c?.trainingUnlocked).toBe(1);
    expect(c?.communicationStyle).toBe("強勢、時間壓力大");
    expect(c?.title).toBe("採購副總"); // 未帶 title → 用 AI 設計的 title

    // persona 以 human provenance 寫入（虛擬角色由使用者創作，標人工合法）
    const prov = await core.provenance.listForEntity("o1", "contact", contactId);
    const comm = prov.find((p) => p.fieldName === "communicationStyle");
    expect(comm?.filledBy).toBe("human");
    expect(comm?.verified).toBe(1);

    // 虛擬人物顯示在 CRM 人物清單，且帶 isSynthetic（虛擬 badge 資料來源）
    const summaries = await core.contacts.list("o1", co.id);
    const s = summaries.find((x) => x.id === contactId);
    expect(s?.isSynthetic).toBe(1);

    // 可直接被 startSession（human persona → 過逐欄信任閘）
    const started = await svc.startSession("o1", { contactId }, "u1");
    expect(started.sessionId).toBeTruthy();
    expect(started.live.ephemeralToken).toBeTruthy();

    await core.close();
  });

  it("手動帶 persona（非 autoDesign）不需 gemini，仍建 is_synthetic=1", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });

    const svc = makeService(core, { gemini: mockGemini({}, false) }); // gemini 未設
    const { contactId } = await svc.createSynthetic(
      "o1",
      {
        companyId: co.id,
        fullName: "王採購",
        title: "採購經理",
        persona: { communicationStyle: "重成本", decisionStyle: "多方比價" },
      },
      "u1",
    );

    const c = await core.contacts.findById("o1", contactId);
    expect(c?.isSynthetic).toBe(1);
    expect(c?.fullName).toBe("王採購");
    expect(c?.title).toBe("採購經理");
    expect(c?.communicationStyle).toBe("重成本");
    expect(c?.decisionStyle).toBe("多方比價");

    await core.close();
  });

  it("company 不存在→not_found；autoDesign 但 gemini 未設→not_configured", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });

    const svc = makeService(core, { gemini: mockGemini({ communicationStyle: "x" }) });
    await expect(svc.createSynthetic("o1", { companyId: "no-such-company", autoDesign: true })).rejects.toMatchObject({
      kind: "not_found",
    });

    const svcNoGemini = makeService(core, { gemini: mockGemini({}, false) });
    await expect(svcNoGemini.createSynthetic("o1", { companyId: co.id, autoDesign: true })).rejects.toMatchObject({
      kind: "not_configured",
    });

    await core.close();
  });
});

describe("authz — 跨 org 憑證對自助建對象端點應被拒", () => {
  it("draftPersona/createSynthetic 以攻擊者 org（o2）呼叫 → not_found，且不留副作用", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const contact = await core.contacts.create("o1", co.id, { fullName: "Jane" });

    // gemini 已設定 → 唯一被拒原因是 org-scope（非 not_configured）
    const svc = makeService(core, { gemini: mockGemini({ communicationStyle: "x" }) });

    await expect(svc.draftPersona("o2", contact.id, "attacker")).rejects.toMatchObject({ kind: "not_found" });
    await expect(
      svc.createSynthetic("o2", { companyId: co.id, autoDesign: true }, "attacker"),
    ).rejects.toMatchObject({ kind: "not_found" });

    // 副作用檢查：o1 的 contact 未被解鎖／未被寫 persona；o2 沒有多出任何 contact
    const c = await core.contacts.findById("o1", contact.id);
    expect(c?.trainingUnlocked ?? 0).toBe(0);
    expect(c?.communicationStyle).toBeUndefined();
    const o2list = await core.contacts.list("o2", co.id);
    expect(o2list.length).toBe(0);

    await core.close();
  });
});
