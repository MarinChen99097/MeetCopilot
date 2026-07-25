/**
 * 對練語言功能測試（決策 2026-07-24）：
 *  - buildPersonaPrompt：Rules 內語言規則行依 opts.lang 切換（zh 全繁中／en 全英文／auto 跟隨對方＝原 mirror）；
 *    預設（省略 lang）＝zh；zh/auto 皆含「專有名詞保留原文、不硬翻」句。
 *  - scoring：reportLang 切 'en' 時 SYSTEM 用 English、'zh'／預設時用繁體中文；皆含專有名詞保留句。
 *    （維度 label 仍是 TRAIN_MODES 中文 label——由 score() 回傳陣列驗證不受 reportLang 影響。）
 */
import { describe, it, expect } from "vitest";
import type { Contact, Company, TrainTurn } from "@meetcopilot/shared";
import { TRAIN_MODES } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import { buildPersonaPrompt } from "./persona.js";
import { createTrainScorer } from "./scoring.js";

const contact = { fullName: "Jane Doe", title: "CIO" } as unknown as Contact;
const company = { name: "Acme" } as unknown as Company;

// 專有名詞保留句的關鍵片段（去掉首字，避開 persona「Keep」/評分「keep」大小寫差異）。
const PROPER_NOUN_FRAGMENT = "proper nouns, product names";

describe("buildPersonaPrompt — 對練語言規則行（決策 2026-07-24）", () => {
  it("lang='zh'：全程繁中、不論對方語言＋專有名詞保留", () => {
    const out = buildPersonaPrompt(contact, company, "neutral", new Set(), { lang: "zh" });
    expect(out).toContain(
      "- Always reply in Traditional Chinese (繁體中文), no matter what language the other person uses.",
    );
    expect(out).toContain(PROPER_NOUN_FRAGMENT);
    // 非 mirror：不得再帶「if the rep speaks English, mirror their language」
    expect(out).not.toContain("mirror their language");
  });

  it("lang='en'：全程英文、不論對方語言（不帶繁中規則）", () => {
    const out = buildPersonaPrompt(contact, company, "neutral", new Set(), { lang: "en" });
    expect(out).toContain("- Always reply in English, no matter what language the other person uses.");
    expect(out).not.toContain("繁體中文");
    expect(out).not.toContain("mirror their language");
  });

  it("lang='auto'：維持原 mirror（繁中預設＋對方英文則跟英文）＋專有名詞保留", () => {
    const out = buildPersonaPrompt(contact, company, "neutral", new Set(), { lang: "auto" });
    expect(out).toContain(
      "- Reply in Traditional Chinese (繁體中文) by default; if the rep speaks English, mirror their language.",
    );
    expect(out).toContain(PROPER_NOUN_FRAGMENT);
  });

  it("省略 lang ＝ 預設 zh（與 lang:'zh' 等價）", () => {
    const withDefault = buildPersonaPrompt(contact, company, "neutral", new Set());
    const withZh = buildPersonaPrompt(contact, company, "neutral", new Set(), { lang: "zh" });
    expect(withDefault).toBe(withZh);
    // 且落點確為 zh 全中文規則
    expect(withDefault).toContain(
      "- Always reply in Traditional Chinese (繁體中文), no matter what language the other person uses.",
    );
  });
});

// ── scoring：reportLang 切 SYSTEM 語言 ────────────────────────
/** 捕捉 generateJson 收到的 system（其餘回傳固定假資料）。 */
function capturingGemini(captured: { system?: string }): GeminiClient {
  return {
    isConfigured: () => true,
    generateJson: async <T>(args: { system?: string }) => {
      captured.system = args.system;
      return { scores: [], highlights: [], summary: "s" } as T;
    },
    generateJsonMetered: async <T>() => ({ value: {} as T, usage: { model: "mock" } }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
    embed: async () => [],
    embedMetered: async () => ({ value: [], usage: { model: "mock" } }),
  } as unknown as GeminiClient;
}

const TURNS: TrainTurn[] = [
  { speaker: "rep", text: "您好，想介紹我們的方案。", t: 0 },
  { speaker: "ai", text: "先說重點，價格多少？", t: 1 },
];
const CTX = { personaName: "Jane", personaTitle: "CIO", companyName: "Acme" };

describe("scoring — 報告語言 reportLang（決策 2026-07-24）", () => {
  it("reportLang='en'：SYSTEM 用 English 寫 comments/summary＋專有名詞保留", async () => {
    const captured: { system?: string } = {};
    const scorer = createTrainScorer(capturingGemini(captured));
    await scorer.score(TURNS, CTX, undefined, "sales", "en");
    expect(captured.system).toContain("Write comments and summary in English");
    expect(captured.system).toContain(PROPER_NOUN_FRAGMENT);
    expect(captured.system).not.toContain("Traditional Chinese (繁體中文)");
  });

  it("reportLang='zh'：SYSTEM 用繁體中文寫 comments/summary", async () => {
    const captured: { system?: string } = {};
    const scorer = createTrainScorer(capturingGemini(captured));
    await scorer.score(TURNS, CTX, undefined, "sales", "zh");
    expect(captured.system).toContain("Write comments and summary in Traditional Chinese (繁體中文)");
    expect(captured.system).toContain(PROPER_NOUN_FRAGMENT);
  });

  it("省略 reportLang ＝ 預設繁體中文", async () => {
    const captured: { system?: string } = {};
    const scorer = createTrainScorer(capturingGemini(captured));
    await scorer.score(TURNS, CTX, undefined, "sales"); // 不傳 reportLang
    expect(captured.system).toContain("Write comments and summary in Traditional Chinese (繁體中文)");
  });

  it("維度 label 不受 reportLang 影響（仍是 TRAIN_MODES 中文 label）", async () => {
    const dims = TRAIN_MODES.sales.dimensions;
    // 模型回中文 label + 分數；驗證回傳 label 照 dimensions（中文）不變
    const gemini = {
      isConfigured: () => true,
      generateJson: async <T>() =>
        ({ scores: dims.map((d) => ({ label: d.label, score: 55 })), highlights: [], summary: "s" }) as T,
      generateJsonMetered: async <T>() => ({ value: {} as T, usage: { model: "mock" } }),
      generateGrounded: async () => ({ answer: "", citations: [] }),
      embed: async () => [],
      embedMetered: async () => ({ value: [], usage: { model: "mock" } }),
    } as unknown as GeminiClient;
    const scorer = createTrainScorer(gemini);
    const res = await scorer.score(TURNS, CTX, undefined, "sales", "en"); // 英文報告
    expect(res.scores.map((s) => s.label)).toEqual(dims.map((d) => d.label)); // label 仍中文
  });
});
