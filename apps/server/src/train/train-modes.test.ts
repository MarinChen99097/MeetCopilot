/**
 * A3 對練情境模式測試（vitest）：
 *  - buildPersonaPrompt：各 mode 開頭 framing 子句／立場句正確；**sales 與改前等價**（開頭用 frozen sales.framing、
 *    立場句逐字＝改前寫死字串）＝回歸鎖定。
 *  - scoring：各 mode 回傳維度＝ TRAIN_MODES[mode].dimensions（label 對齊、順序照 dimensions、缺分補 0、
 *    模型亂序/多維不影響、越界 clamp）。
 *  - service 串接：startSession 落 session.mode；finish 用 session.mode 傳給 scorer。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { Contact, Company, TrainMode, TrainTurn } from "@meetcopilot/shared";
import { TRAIN_MODES, TRAIN_MODES_KEYS } from "@meetcopilot/shared";
import type { GeminiClient } from "../gemini.js";
import type { LiveTokenMinter } from "./live-token.js";
import type { TrainScorer } from "./scoring.js";
import { buildPersonaPrompt } from "./persona.js";
import { createTrainScorer } from "./scoring.js";
import { createTrainService, type TrainService, type TrainServiceDeps } from "./train-service.js";

// ── 測試替身 ────────────────────────────────────────────────
function mockGemini(response: Record<string, unknown> = {}, configured = true): GeminiClient {
  return {
    isConfigured: () => configured,
    generateJson: async <T>() => response as T,
    generateJsonMetered: async <T>() => ({ value: response as T, usage: { model: "mock" } }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
    embed: async () => [],
    embedMetered: async () => ({ value: [], usage: { model: "mock" } }),
  } as GeminiClient;
}

const mockMinter: LiveTokenMinter = {
  async mint(opts) {
    return { token: `tok-${opts.model}`, model: opts.model, expireTime: Date.now() + 60_000 };
  },
};

const contact = { fullName: "Jane Doe", title: "CIO" } as unknown as Contact;
const company = { name: "Acme" } as unknown as Company;

// ── buildPersonaPrompt：情境模式 framing／stance ─────────────
describe("buildPersonaPrompt — 情境模式 framing／立場句（A3）", () => {
  it("各 mode 開頭句用該模式的 framing（且互不相同）", () => {
    for (const mode of TRAIN_MODES_KEYS) {
      const out = buildPersonaPrompt(contact, company, "neutral", new Set(), { mode });
      const firstLine = out.split("\n")[0]!;
      const expected = `You are role-playing Jane Doe, CIO at Acme, ${TRAIN_MODES[mode].framing}. Stay fully in character as a real human for the entire conversation.`;
      expect(firstLine).toBe(expected);
    }
  });

  it("各 mode 有 objective 時，立場句用該模式的 stance", () => {
    for (const mode of TRAIN_MODES_KEYS) {
      const out = buildPersonaPrompt(contact, company, "neutral", new Set(), {
        mode,
        objective: { meetingPurpose: "釐清預算" },
      });
      expect(out).toContain(`本次對練情境（依此情境自然回應；${TRAIN_MODES[mode].stance}）：`);
    }
  });

  it("預設（省略 mode）＝ sales", () => {
    const withDefault = buildPersonaPrompt(contact, company, "neutral", new Set());
    const withSales = buildPersonaPrompt(contact, company, "neutral", new Set(), { mode: "sales" });
    expect(withDefault).toBe(withSales);
  });

  it("sales 回歸：開頭句＝frozen sales.framing 組出的字串；立場句逐字＝改前寫死字串", () => {
    const out = buildPersonaPrompt(contact, company, "neutral", new Set(), {
      mode: "sales",
      objective: { salesGoal: "進 POC" },
    });
    // 開頭句（frozen sales.framing 就是 sales 對練框架的單一真相）
    expect(out.split("\n")[0]).toBe(
      `You are role-playing Jane Doe, CIO at Acme, ${TRAIN_MODES.sales.framing}. Stay fully in character as a real human for the entire conversation.`,
    );
    // 立場句：frozen sales.stance 與改前寫死字串逐字相同 → 回歸鎖定
    expect(out).toContain(
      "本次對練情境（依此情境自然回應；你是買方，不必配合業務的目標，該質疑、該把關就照你的立場來）：",
    );
  });
});

// ── scoring：維度資料驅動＋以模式維度為準對齊 ──────────────────
const TURNS: TrainTurn[] = [
  { speaker: "rep", text: "您好，想介紹我們的方案。", t: 0 },
  { speaker: "ai", text: "先說重點，價格多少？", t: 1 },
];
const CTX = { personaName: "Jane", personaTitle: "CIO", companyName: "Acme" };

describe("scoring — 各 mode 回傳維度＝ dimensions（A3）", () => {
  it("每個 mode：回傳陣列 label／順序照 dimensions，且不受模型亂序影響", async () => {
    for (const mode of TRAIN_MODES_KEYS) {
      const dims = TRAIN_MODES[mode].dimensions;
      // 模型以「反序」回覆，分數＝維度序號*10（驗證回傳仍照 dimensions 正序對齊）
      const modelScores = dims.map((d, i) => ({ label: d.label, score: (i + 1) * 10 })).reverse();
      const scorer = createTrainScorer(mockGemini({ scores: modelScores, highlights: [], summary: "s" }));
      const res = await scorer.score(TURNS, CTX, undefined, mode);
      expect(res.scores).toEqual(dims.map((d, i) => ({ label: d.label, score: (i + 1) * 10 })));
    }
  });

  it("缺維補 0、模型多回的未知維度忽略、越界/小數 clamp 到 0–100 整數（sales）", async () => {
    const dims = TRAIN_MODES.sales.dimensions; // [異議處理, 需求挖掘, 清晰度, 收尾]
    const scorer = createTrainScorer(
      mockGemini({
        // 缺「異議處理」；順序打亂；含未知維度；含越界與小數
        scores: [
          { label: "清晰度", score: 150 }, // → 100
          { label: "收尾", score: -5 }, // → 0
          { label: "需求挖掘", score: 60.6 }, // → 61
          { label: "未知維度", score: 42 }, // 忽略
        ],
        highlights: [],
        summary: "s",
      }),
    );
    const res = await scorer.score(TURNS, CTX, undefined, "sales");
    expect(res.scores).toEqual([
      { label: dims[0]!.label, score: 0 }, // 異議處理（缺→0）
      { label: dims[1]!.label, score: 61 }, // 需求挖掘（60.6→61）
      { label: dims[2]!.label, score: 100 }, // 清晰度（150→100）
      { label: dims[3]!.label, score: 0 }, // 收尾（-5→0）
    ]);
  });

  it("省略 mode ＝ sales 維度", async () => {
    const dims = TRAIN_MODES.sales.dimensions;
    const modelScores = dims.map((d) => ({ label: d.label, score: 50 }));
    const scorer = createTrainScorer(mockGemini({ scores: modelScores, highlights: [], summary: "s" }));
    const res = await scorer.score(TURNS, CTX); // 不傳 mode
    expect(res.scores.map((s) => s.label)).toEqual(dims.map((d) => d.label));
  });
});

// ── service 串接：落 mode ＋ finish 用 session.mode ───────────
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

describe("train-service — mode 串接（A3）", () => {
  it("startSession 落 session.mode（server 權威，供 finish 讀）", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const c = await core.contacts.create("o1", co.id, { fullName: "Jane" });
    // 手動解鎖 → 過 canTrain 閘（不需 verified persona 欄）
    await core.contacts.update("o1", c.id, { trainingUnlocked: 1 }, { userId: "u1" });

    const svc = makeService(core);
    const started = await svc.startSession("o1", { contactId: c.id, mode: "government" }, "u1");
    const session = await core.training.findSession("o1", started.sessionId);
    expect(session?.mode).toBe("government");

    await core.close();
  });

  it("finish 用 session.mode（非 client）傳給 scorer.score", async () => {
    const core = await createCrmCore(":memory:");
    await core.migrate();
    const co = await core.companies.create("o1", { name: "Acme" });
    const c = await core.contacts.create("o1", co.id, { fullName: "Jane" });

    // 直接以 interview 模式建 session（繞過 startSession 閘）＋上傳逐字稿
    const session = await core.training.createSession("o1", { contactId: c.id, mode: "interview" });
    await core.training.saveTranscript("o1", session.id, TURNS);

    const captured: { mode?: TrainMode } = {};
    const recordingScorer: TrainScorer = {
      async score(_turns, _ctx, _client, mode) {
        captured.mode = mode;
        return { scores: [{ label: "表達溝通", score: 70 }], highlights: [], summary: "s" };
      },
    };

    const svc = makeService(core, { scorer: recordingScorer });
    const { reportId } = await svc.finish("o1", session.id, "u1");
    expect(captured.mode).toBe("interview"); // 用 session.mode，不信任 client
    expect(reportId).toBeTruthy();

    await core.close();
  });
});
