/**
 * persona-gen 純函式測試（CRM_UPGRADE_PLAN Phase A2）：
 *  - draftPersonaForContact（#1）／designSyntheticPersona（#4）以 mock gemini 產九欄（只收非空字串）。
 *  - personaDraftToContactPatch：九欄字串 → Partial<Contact>（陣列欄單元素、objectionsRaised→[{objection}]）。
 *  - buildPersonaPrompt：unlocked=true→用「非空欄」、unlocked=false→trusted-only；objective 注入斷言。
 */
import { describe, it, expect } from "vitest";
import type { Company, Contact, PersonaFieldDraft } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import { draftPersonaForContact, designSyntheticPersona, personaDraftToContactPatch } from "./persona-gen.js";
import { buildPersonaPrompt } from "./persona.js";

/** mock GeminiClient：generateJson 直接回固定 response（忽略 schema/prompt）。 */
function mockGemini(response: Record<string, unknown>): GeminiClient {
  return {
    isConfigured: () => true,
    generateJson: async <T>() => response as T,
    generateJsonMetered: async <T>() => ({ value: response as T, usage: { model: "mock" } }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
    embed: async () => [],
    embedMetered: async () => ({ value: [], usage: { model: "mock" } }),
  } as GeminiClient;
}

const company: Company = {
  id: "co1",
  orgId: "o1",
  name: "Acme 智慧製造",
  industry: "manufacturing",
  description: "工業自動化解決方案供應商",
  verifiedStatus: "none",
  createdAt: 0,
  updatedAt: 0,
};

function makeContact(over: Partial<Contact> = {}): Contact {
  return {
    id: "c1",
    orgId: "o1",
    companyId: "co1",
    fullName: "Jane Doe",
    verifiedStatus: "none",
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("persona-gen — LLM 產九欄（mock gemini）", () => {
  it("#1 draftPersonaForContact 產出非空九欄，忽略 null/空字串", async () => {
    const gemini = mockGemini({
      communicationStyle: "直接、重數據",
      decisionStyle: "資料驅動、需多方背書",
      knownPriorities: "降本與導入速度",
      painPoints: "  ", // 空白 → 忽略
      hotButtons: null, // null → 忽略
      goalsKpis: "年度營收成長 15%",
    });
    const fields = await draftPersonaForContact(gemini, { company, contact: makeContact({ title: "CIO" }) });
    expect(fields.communicationStyle).toBe("直接、重數據");
    expect(fields.decisionStyle).toBe("資料驅動、需多方背書");
    expect(fields.knownPriorities).toBe("降本與導入速度");
    expect(fields.goalsKpis).toBe("年度營收成長 15%");
    // 空白/null 欄不落入
    expect(fields.painPoints).toBeUndefined();
    expect(fields.hotButtons).toBeUndefined();
  });

  it("#4 designSyntheticPersona 回 { fields, title }（title 從模型輸出取）", async () => {
    const gemini = mockGemini({
      communicationStyle: "強勢、時間壓力大",
      objectionsRaised: "質疑遷移風險與價格",
      title: "採購副總",
    });
    const { fields, title } = await designSyntheticPersona(gemini, {
      company,
      hints: { objective: { salesGoal: "讓對方同意 POC" } },
    });
    expect(fields.communicationStyle).toBe("強勢、時間壓力大");
    expect(fields.objectionsRaised).toBe("質疑遷移風險與價格");
    expect(title).toBe("採購副總");
  });
});

describe("persona-gen — personaDraftToContactPatch 映射", () => {
  it("scalar 欄直存字串；陣列 _json 欄存單元素；objectionsRaised→[{objection}]", () => {
    const draft: PersonaFieldDraft = {
      communicationStyle: "直接",
      knownPriorities: "降本",
      goalsKpis: "營收成長",
      hotButtons: "ROI",
      painPoints: "維運成本高",
      objectionsRaised: "擔心遷移風險",
      decisionStyle: "  ", // 空白 → 不寫
    };
    const patch = personaDraftToContactPatch(draft);
    expect(patch.communicationStyle).toBe("直接");
    expect(patch.knownPriorities).toEqual(["降本"]);
    expect(patch.goalsKpis).toEqual(["營收成長"]);
    expect(patch.hotButtons).toEqual(["ROI"]);
    expect(patch.painPoints).toEqual(["維運成本高"]);
    expect(patch.objectionsRaised).toEqual([{ objection: "擔心遷移風險" }]);
    expect("decisionStyle" in patch).toBe(false); // 空白欄不寫
  });
});

describe("buildPersonaPrompt — 用欄語意（unlocked）＋objective 注入", () => {
  it("unlocked=false（trusted-only）：非空但未驗證的 persona 欄不進 prompt", () => {
    const contact = makeContact({ communicationStyle: "直接、重數據", knownPriorities: ["降本"] });
    const prompt = buildPersonaPrompt(contact, company, "neutral", new Set(), { unlocked: false });
    expect(prompt).not.toContain("直接、重數據");
    expect(prompt).not.toContain("降本");
  });

  it("unlocked=true：所有非空 persona 欄進 prompt（trusted ∪ 未驗證有值）", () => {
    const contact = makeContact({ communicationStyle: "直接、重數據", knownPriorities: ["降本"] });
    const prompt = buildPersonaPrompt(contact, company, "neutral", new Set(), { unlocked: true });
    expect(prompt).toContain("直接、重數據");
    expect(prompt).toContain("降本");
  });

  it("unlocked=false 但欄在 trusted 集合：仍納入（既有 trusted-only 路徑不破壞）", () => {
    const contact = makeContact({ communicationStyle: "直接、重數據" });
    const prompt = buildPersonaPrompt(contact, company, "neutral", new Set(["communicationStyle"]), {
      unlocked: false,
    });
    expect(prompt).toContain("直接、重數據");
  });

  it("objective 有值 → 注入「本次對練情境」段（含銷售目標／面談目的文字）", () => {
    const contact = makeContact();
    const prompt = buildPersonaPrompt(contact, company, "neutral", new Set(), {
      objective: { salesGoal: "讓對方同意進 POC", meetingPurpose: "釐清預算與決策流程" },
    });
    expect(prompt).toContain("本次對練情境");
    expect(prompt).toContain("讓對方同意進 POC");
    expect(prompt).toContain("釐清預算與決策流程");
  });

  it("objective 未填 → 不注入情境段", () => {
    const contact = makeContact();
    const prompt = buildPersonaPrompt(contact, company, "neutral", new Set());
    expect(prompt).not.toContain("本次對練情境");
  });
});
