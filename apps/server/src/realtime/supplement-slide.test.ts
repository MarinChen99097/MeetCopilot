/**
 * DynamicSlide 補充頁橋接測試（此前生產缺失的一段：signals → 生成一張補充頁 → patch.suggest 批准佇列）。
 * 行為驗證，非自述：
 *  1. 合格訊號 → 生成一張補充頁 → onSuggestSlide 被呼叫（帶 slide + 對話理由）。
 *  2. 只有非合格訊號（person_mention）→ 不生成建議。
 *  3. 節流：同場在間隔內第二次合格訊號 → 不再生成（bounded spend）。
 *  4. 配額：達每場上限後 → 不再生成。
 *  5. 關閉（limit=0）或 Gemini 未設定 → 不生成。
 * I2 邊界：本橋接只「送建議」（onSuggestSlide/patch.suggest 入 HUD 批准佇列），從不 append——append 仍需報告者手動 ACCEPT。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { GeminiClient, Metered, TokenUsage } from "../gemini.js";
import type { SignalItem, SlideSpec } from "@meetcopilot/shared";
import { CrmCopilotOrchestrator, type OrchestratorDeps } from "./orchestrator.js";
import type { LiveSessionRuntime } from "./session-runtime.js";

const USAGE: TokenUsage = { model: "test" };

/** 固定回一張合法 slide 的 Gemini fake；configured 可切以測未設定分支。 */
function makeGemini(opts: { json?: unknown; configured?: boolean } = {}): GeminiClient {
  const json = opts.json ?? {
    template: "content",
    blocks: [
      { type: "heading", text: "補充：整合效益" },
      { type: "bullets", items: ["降低導入風險", "既有系統相容"] },
    ],
  };
  return {
    isConfigured: () => opts.configured ?? true,
    embed: async () => [],
    embedMetered: async (): Promise<Metered<number[]>> => ({ value: [], usage: USAGE }),
    generateJson: async <T>() => json as T,
    generateJsonMetered: async <T>(): Promise<Metered<T>> => ({ value: json as T, usage: USAGE }),
    generateGrounded: async () => ({ answer: "", citations: [] }),
  };
}

/** 建 orchestrator，回傳它與收到的建議清單（onSuggestSlide sink）。 */
async function makeOrch(
  overrides: Partial<OrchestratorDeps> = {},
): Promise<{
  orch: CrmCopilotOrchestrator;
  suggested: { slide: SlideSpec; reason: string }[];
  maybe: (sessionId: string, items: SignalItem[]) => Promise<void>;
}> {
  const core = await createCrmCore(":memory:");
  await core.migrate();
  // runtime 無 companyId → companyName 直接回 undefined，不打 core（測試專注橋接邏輯）。
  const runtime = { orgId: "o1", presenterUserId: "u1" } as unknown as LiveSessionRuntime;
  const deps: OrchestratorDeps = {
    core,
    gemini: makeGemini(),
    inferenceModel: "m",
    getRuntime: () => runtime,
    supplementAutoLimitPerMeeting: 8,
    supplementThrottleMs: 0, // 預設關節流，個別測試自行覆寫
    ...overrides,
  };
  const orch = new CrmCopilotOrchestrator(deps);
  const suggested: { slide: SlideSpec; reason: string }[] = [];
  orch.onSuggestSlide((_sid, slide, reason) => suggested.push({ slide, reason }));
  // maybeSuggestSlide 是內部接縫（hub 經 onSignals 觸發）；單測直接驅動以避免 fire-and-forget 競態。
  const maybe = (sessionId: string, items: SignalItem[]) =>
    (orch as unknown as { maybeSuggestSlide: (s: string, i: SignalItem[]) => Promise<void> }).maybeSuggestSlide(
      sessionId,
      items,
    );
  return { orch, suggested, maybe };
}

const objection: SignalItem[] = [{ id: "s1", kind: "objection", label: "擔心導入成本", confidence: 0.8 }];

describe("DynamicSlide 補充頁橋接（signals → 生成 → 送批准）", () => {
  it("合格訊號 → 生成一張補充頁 → onSuggestSlide 被呼叫（帶 slide + 對話理由）", async () => {
    const { suggested, maybe } = await makeOrch();
    await maybe("sess", objection);
    expect(suggested).toHaveLength(1);
    expect(suggested[0]!.slide.blocks.length).toBeGreaterThan(0);
    expect(suggested[0]!.slide.source).toBe("ai");
    expect(suggested[0]!.reason).toContain("擔心導入成本");
  });

  it("只有非合格訊號（person_mention）→ 不生成建議", async () => {
    const { suggested, maybe } = await makeOrch();
    await maybe("sess", [{ id: "p1", kind: "person_mention", label: "提到王經理", confidence: 0.9 }]);
    expect(suggested).toHaveLength(0);
  });

  it("節流：間隔內第二次合格訊號不再生成", async () => {
    const { suggested, maybe } = await makeOrch({ supplementThrottleMs: 60_000 });
    await maybe("sess", objection);
    await maybe("sess", objection);
    expect(suggested).toHaveLength(1);
  });

  it("配額：達每場上限後不再生成", async () => {
    const { suggested, maybe } = await makeOrch({ supplementAutoLimitPerMeeting: 1, supplementThrottleMs: 0 });
    await maybe("sess", objection);
    await maybe("sess", objection);
    expect(suggested).toHaveLength(1);
  });

  it("關閉（limit=0）→ 不生成", async () => {
    const { suggested, maybe } = await makeOrch({ supplementAutoLimitPerMeeting: 0 });
    await maybe("sess", objection);
    expect(suggested).toHaveLength(0);
  });

  it("Gemini 未設定 → 不生成", async () => {
    const { suggested, maybe } = await makeOrch({ gemini: makeGemini({ configured: false }) });
    await maybe("sess", objection);
    expect(suggested).toHaveLength(0);
  });

  it("生成失敗/空頁（sanitize 後 0 block）→ 不送建議、配額不計", async () => {
    const { suggested, maybe } = await makeOrch({
      gemini: makeGemini({ json: { template: "content", blocks: [{ type: "bogus" }] } }),
      supplementAutoLimitPerMeeting: 1,
      supplementThrottleMs: 0,
    });
    await maybe("sess", objection); // 空頁 → 不計配額
    await maybe("sess", objection); // 仍在配額內，但一樣空頁
    expect(suggested).toHaveLength(0);
  });
});
