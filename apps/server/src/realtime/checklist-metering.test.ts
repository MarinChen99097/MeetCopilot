/**
 * 待講清單**生成**的計費歸屬（ADMIN_CONTRACT §2/§3）。
 *
 * 為什麼需要：`POST /api/meetings` 背景觸發的 `generateChecklist` 是這一輪兩個 LLM 呼叫中**貴得多**的那個
 * （12,000 字 deck outline 輸入、maxOutputTokens 4096、attempts 2、MAX_TOKENS 還會再打一次），
 * 但 `hub.runChecklistGeneration` 原本沒把 `userId` 傳進 metered client → `usage_events.user_id` 落 NULL。
 * 結果是 admin 後台 usage/events 明細裡，**同一次建會動作**的成本一半掛在人頭上、一半掛在「未知」。
 * `meter.meter` 的 userId 只在「背景 job 無 request 脈絡」時才可省略，而這裡脈絡就在 binding 裡
 * （`MeetingBinding.presenterUserId`，由 meetings-routes 從 JWT 帶入）。
 */
import { describe, it, expect } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { UsageKind } from "@meetcopilot/shared";
import { RealtimeHub } from "./hub.js";
import { TEST_JWT_SECRET as SECRET, testConfig as baseConfig } from "./test-support.js";
import type { AppConfig } from "../config.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter, MeterResult } from "../ops/meter.js";

const PRESENTER = "user-presenter-1";

/**
 * 與 realtime 共用設定的差異只有 gemini 那一包：`apiKey` 非空 → `isConfigured()` 為 true（本檔要走真的
 * 生成路徑），`extractModel` 具名以便斷言計費事件記的 model。其餘欄位逐字沿用 `test-support.testConfig()`。
 */
function testConfig(): AppConfig {
  return baseConfig({
    gemini: { apiKey: "k", textModel: "t", extractModel: "extract-model", embedModel: "m", liveModel: "l" },
  });
}

/** 假 GeminiClient：metered client 走 generateJsonMetered，回一份合法的清單＋token 用量。 */
function fakeGemini(): GeminiClient & { calls: number } {
  const g = {
    calls: 0,
    isConfigured: () => true,
    async generateJsonMetered<T>(): Promise<{
      value: T;
      usage: { model: string; inputTokens?: number; outputTokens?: number };
    }> {
      g.calls++;
      return {
        value: {
          items: [
            { category: "talk", title: "說明導入時程", keywords: ["時程", "上線"], priority: "must" },
            { category: "ask", title: "問預算區間", keywords: ["預算"], priority: "must" },
            { category: "address", title: "回應資安疑慮", keywords: ["資安"], priority: "must" },
          ],
        } as unknown as T,
        usage: { model: "extract-model", inputTokens: 4_321, outputTokens: 210 },
      };
    },
    async generateJson<T>(): Promise<T> {
      // 未包 meter 的 raw 路徑——走到就代表沒記帳（本檔斷言不會走到）。
      g.calls++;
      return { items: [] } as unknown as T;
    },
    async generateGrounded() {
      return { text: "", sources: [] };
    },
    async embed() {
      return [];
    },
    async embedMetered() {
      return { value: [] as number[], usage: { model: "m" } };
    },
  };
  return g as unknown as GeminiClient & { calls: number };
}

interface Recorded {
  orgId: string;
  kind: UsageKind;
  idemKey: string;
  userId?: string;
  meetingId?: string;
  model?: string;
  inputTokens?: number;
}

function fakeMeter(): { meter: Meter; recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  const meter: Meter = {
    async meter<T>(
      orgId: string,
      kind: UsageKind,
      fn: () => Promise<MeterResult<T>>,
      idemKey: string,
      userId?: string,
    ): Promise<T> {
      const r: MeterResult<T> = await fn();
      recorded.push({
        orgId,
        kind,
        idemKey,
        userId,
        meetingId: r.meetingId,
        model: r.model,
        inputTokens: r.inputTokens,
      });
      return r.result;
    },
  };
  return { meter, recorded };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("清單生成的計費歸屬（修正 C）", () => {
  it("generateChecklist 的 usage 事件帶 userId＝建會者（不再落 NULL），且 org/meeting/token 都對", async () => {
    const core = await createCrmCore(":memory:");
    try {
      await core.migrate();
      const org = await core.orgs.create({ name: "Org A" });
      const company = await core.companies.create(org.id, { name: "Acme", industry: "SaaS" });
      const gemini = fakeGemini();
      const m = fakeMeter();
      const hub = new RealtimeHub(core, testConfig(), gemini, m.meter);
      const meeting = await hub.store.create(org.id, { title: "M", presenterUserId: PRESENTER });
      hub.registerMeeting(meeting.id, {
        orgId: org.id,
        presenterUserId: PRESENTER,
        companyId: company.id,
        objective: "讓對方同意進入 POC",
      });

      hub.startChecklistGeneration(meeting.id);
      await sleep(120);

      expect(gemini.calls).toBe(1);
      expect(m.recorded).toHaveLength(1);
      expect(m.recorded[0]).toMatchObject({
        orgId: org.id,
        kind: "gemini_text",
        userId: PRESENTER, // ← 修正 C：request 脈絡在手上就必須帶
        meetingId: meeting.id,
        model: "extract-model",
        inputTokens: 4_321,
      });
      expect(m.recorded[0]!.idemKey.startsWith(`checklist:${meeting.id}:`)).toBe(true);

      // 業務行為不變：清單真的落庫。
      const items = await core.checklist.list(org.id, meeting.id);
      expect(items).toHaveLength(3);
      expect(items.map((i) => i.category)).toEqual(["talk", "ask", "address"]);

      hub.disposeAll();
    } finally {
      core.close();
    }
  });
});
