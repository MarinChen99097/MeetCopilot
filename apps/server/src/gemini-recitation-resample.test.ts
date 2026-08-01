/**
 * RECITATION 重取樣的**兩層**行為鎖（ROM 2026-08-01 17:54 決策 1）。
 *
 * 背景：17:15 的修法讓 RECITATION 可重試（prod 事故根修，正確），但把「升溫 +0.2/hit ＋『改寫、勿照抄』指示」
 * **無條件**套到每一個 generateJson 呼叫端——包括 CRM 抽取（research/extractor、research/deep-extractor），
 * 那些路徑的 SYSTEM 明令「逐字取值、嚴禁捏造」、temperature 0.3/0.4 是實測釘死的。一旦重取樣被觸發，
 * 抽出的值會被改寫，而 provenance 還指著原頁＝假的可稽核性。
 *
 * 本檔鎖三件事：
 *  (a) 全域：RECITATION 仍**不短路**（重試次數用滿）——事故根修不得回退；
 *  (b) 預設（未開 resampleOnRecitation，模擬抽取端）：重試時 temperature 與 systemInstruction **逐位元不變**；
 *  (c) opt-in（resampleOnRecitation:true，deck 生成／revise）：升溫與改寫 hint 才生效。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

/** 被 @google/genai mock 共用的錄音帶（vi.mock 工廠會被 hoist，故用 vi.hoisted 共享）。 */
const tape = vi.hoisted(() => ({
  /** 每次 models.generateContent 收到的 request（依序）。 */
  calls: [] as { config?: Record<string, unknown> }[],
  /** 依序要偽造的 finishReason；用完（undefined）→ 回正常 STOP + JSON。 */
  finishReasons: [] as string[],
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (req: { config?: Record<string, unknown> }) => {
        tape.calls.push(req);
        const fr = tape.finishReasons.shift();
        if (fr) return { candidates: [{ finishReason: fr }], usageMetadata: {} };
        return {
          candidates: [{ finishReason: "STOP" }],
          text: JSON.stringify({ ok: true }),
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        };
      },
    };
  },
}));

const { createGeminiClient } = await import("./gemini.js");

const cfg = {
  apiKey: "test-key",
  textModel: "gemini-test",
  extractModel: "gemini-test",
  embedModel: "embed-test",
  liveModel: "live-test",
};

/** 逐字抽取端的真實形狀（extractor.ts / deep-extractor.ts：低溫 + 「逐字取值」SYSTEM）。 */
const EXTRACTOR_SYSTEM =
  "你是資料抽取器。只能逐字取用頁面既有文字，嚴禁捏造或改寫；找不到就留空。";
const EXTRACTOR_TEMPERATURE = 0.3;

const SCHEMA = { type: "OBJECT", properties: { ok: { type: "BOOLEAN" } } } as Record<string, unknown>;

beforeEach(() => {
  tape.calls.length = 0;
  tape.finishReasons.length = 0;
});

describe("RECITATION 重取樣：全域可重試（事故根修回歸鎖）", () => {
  it("RECITATION 不短路——attempts 用滿並在最後一次成功", async () => {
    tape.finishReasons.push("RECITATION", "RECITATION");
    const client = createGeminiClient(cfg);
    const out = await client.generateJson<{ ok: boolean }>({
      system: EXTRACTOR_SYSTEM,
      prompt: "p",
      schema: SCHEMA,
      attempts: 3,
      temperature: EXTRACTOR_TEMPERATURE,
    });
    expect(out).toEqual({ ok: true });
    expect(tape.calls).toHaveLength(3); // 沒短路：兩次 RECITATION 後仍重抽
  }, 15_000);
});

describe("預設（未開 resampleOnRecitation）：純重抽，零污染", () => {
  it("模擬抽取端：三次呼叫的 temperature 與 systemInstruction 逐位元不變", async () => {
    tape.finishReasons.push("RECITATION", "RECITATION");
    const client = createGeminiClient(cfg);
    await client.generateJson<{ ok: boolean }>({
      system: EXTRACTOR_SYSTEM,
      prompt: "p",
      schema: SCHEMA,
      attempts: 3,
      temperature: EXTRACTOR_TEMPERATURE,
    });
    expect(tape.calls).toHaveLength(3);
    for (const [i, call] of tape.calls.entries()) {
      // 逐位元：溫度必須是呼叫端釘死的 0.3（不是 0.5／0.7），系統指示必須是原字串（不含任何追加）。
      expect(call.config?.temperature, `call ${i + 1} temperature`).toBe(EXTRACTOR_TEMPERATURE);
      expect(call.config?.systemInstruction, `call ${i + 1} systemInstruction`).toBe(EXTRACTOR_SYSTEM);
      // hint 的獨有字串（注意：抽取端自己的 SYSTEM 就含「改寫」二字，不能拿它當判準）。
      expect(String(call.config?.systemInstruction)).not.toContain("重新組織內容");
      expect(String(call.config?.systemInstruction)).not.toContain("不要照抄或近似複述");
    }
    // 重試的 request 與首次 request 的 config 完全等值（連鍵的有無都一樣）。
    expect(tape.calls[1]?.config).toEqual(tape.calls[0]?.config);
    expect(tape.calls[2]?.config).toEqual(tape.calls[0]?.config);
  }, 15_000);

  it("未指定 temperature 時，重試也不得憑空塞入 temperature 鍵", async () => {
    tape.finishReasons.push("RECITATION");
    const client = createGeminiClient(cfg);
    await client.generateJson<{ ok: boolean }>({
      system: EXTRACTOR_SYSTEM,
      prompt: "p",
      schema: SCHEMA,
      attempts: 2,
    });
    expect(tape.calls).toHaveLength(2);
    for (const call of tape.calls) {
      expect(Object.prototype.hasOwnProperty.call(call.config ?? {}, "temperature")).toBe(false);
      expect(call.config?.systemInstruction).toBe(EXTRACTOR_SYSTEM);
    }
  }, 15_000);
});

describe("opt-in（resampleOnRecitation:true）：升溫＋改寫 hint 生效", () => {
  it("每撞一次 RECITATION 就升溫 +0.2，並追加改寫指示", async () => {
    tape.finishReasons.push("RECITATION", "RECITATION");
    const client = createGeminiClient(cfg);
    await client.generateJson<{ ok: boolean }>({
      system: "你是簡報生成器。",
      prompt: "p",
      schema: SCHEMA,
      attempts: 3,
      temperature: EXTRACTOR_TEMPERATURE,
      resampleOnRecitation: true,
    });
    expect(tape.calls).toHaveLength(3);
    // 首次不受影響（happy path 不變）
    expect(tape.calls[0]?.config?.temperature).toBe(EXTRACTOR_TEMPERATURE);
    expect(tape.calls[0]?.config?.systemInstruction).toBe("你是簡報生成器。");
    // 重試逐次升溫 + 注入 hint
    expect(tape.calls[1]?.config?.temperature as number).toBeCloseTo(0.5, 10);
    expect(tape.calls[2]?.config?.temperature as number).toBeCloseTo(0.7, 10);
    for (const call of tape.calls.slice(1)) {
      expect(String(call.config?.systemInstruction)).toContain("你是簡報生成器。");
      expect(String(call.config?.systemInstruction)).toContain("重新組織內容");
    }
  }, 15_000);

  it("溫度夾在 1.4（未指定 temperature → 基準 1.0）", async () => {
    tape.finishReasons.push("RECITATION", "RECITATION", "RECITATION");
    const client = createGeminiClient(cfg);
    await client.generateJson<{ ok: boolean }>({
      prompt: "p",
      schema: SCHEMA,
      attempts: 4,
      resampleOnRecitation: true,
    });
    expect(tape.calls).toHaveLength(4);
    expect(tape.calls[0]?.config?.temperature).toBeUndefined(); // 首次仍走模型預設
    expect(tape.calls[1]?.config?.temperature as number).toBeCloseTo(1.2, 10);
    expect(tape.calls[2]?.config?.temperature as number).toBeCloseTo(1.4, 10);
    expect(tape.calls[3]?.config?.temperature as number).toBeCloseTo(1.4, 10); // 夾住，不再往上
  }, 20_000);
});
