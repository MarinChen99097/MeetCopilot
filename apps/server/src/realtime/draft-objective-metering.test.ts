/**
 * `POST /api/meetings/draft-objective` 必須記帳（ADMIN_CONTRACT §3「記帳補洞——讓 token 花費真實可見」；
 * CHANGE_TRACKER 的「LLM 呼叫必記帳」約定）。
 *
 * 這是**使用者可反覆觸發**的 LLM 端點（建會表單選了簡報／公司就自動打一次）。修正前 `hub.checklistGenDeps()`
 * 回傳未包 meter 的 raw GeminiClient → 這條路徑的 token 完全不進 usage_events：admin 後台 usage/overview
 * 的 costUsd 少計、且無法歸屬 org。同一檔案的清單生成路徑（hub.runChecklistGeneration）本來就有包
 * `meteredGeminiClient({kind:'gemini_text', ...})`，所以那是**漏包**而不是設計取捨。
 *
 * 本檔走**真** express router ＋真 authRequired ＋真 hub（只有 GeminiClient 與 Meter 是假的），斷言：
 *   1. 每次呼叫都落一筆 kind='gemini_text' 的計費事件，orgId＝JWT 的 org（不是 body）、userId＝JWT 的 user。
 *   2. 兩次呼叫的 idempotency key 不同——否則 Meter 的冪等去重會讓第 2 次以後完全不計費（少計）。
 *   3. 跨 org 呼叫記在**自己**的 org 上（歸屬不會錯到別人頭上）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import type { UsageKind } from "@meetcopilot/shared";
import { RealtimeHub } from "./hub.js";
import { createMeetingsRouter } from "./meetings-routes.js";
import { issueToken } from "../auth/jwt.js";
import type { AppConfig } from "../config.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter, MeterResult } from "../ops/meter.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";
const DRAFTED = "讓對方同意進入 POC 並排定時程";

function testConfig(): AppConfig {
  return {
    port: 0,
    jwtSecret: SECRET,
    dbPath: ":memory:",
    researchAutoLimitPerMeeting: 5,
    supplementAutoLimitPerMeeting: 8,
    googleClientId: "",
    platformAdminEmails: [],
    adminOrigin: "",
    gemini: { apiKey: "k", textModel: "t", extractModel: "extract-model", embedModel: "m", liveModel: "l" },
    openai: { apiKey: "", imageModel: "i", imageSize: "1x1", imageQuality: "low" },
  };
}

/** 假 GeminiClient：只有 generateJsonMetered 有內容（metered client 走的是這條），並回報 token 用量。 */
function fakeGemini(): GeminiClient & { calls: number } {
  const g = {
    calls: 0,
    isConfigured: () => true,
    async generateJsonMetered<T>(): Promise<{ value: T; usage: { model: string; inputTokens?: number; outputTokens?: number } }> {
      g.calls++;
      return { value: { objective: DRAFTED } as unknown as T, usage: { model: "extract-model", inputTokens: 321, outputTokens: 12 } };
    },
    async generateJson<T>(): Promise<T> {
      // raw（未包 meter）路徑會走這裡——本檔斷言它**不該**被走到（走到就代表沒記帳）。
      g.calls++;
      return { objective: DRAFTED } as unknown as T;
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
  model?: string;
  inputTokens?: number;
}

/** 假 Meter（＝usage sink）：照實執行 fn，把記帳參數收下來。 */
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
      recorded.push({ orgId, kind, idemKey, userId, model: r.model, inputTokens: r.inputTokens });
      return r.result;
    },
  };
  return { meter, recorded };
}

let core: CrmCore;
let server: Server;
let base: string;
let gemini: GeminiClient & { calls: number };
let recorded: Recorded[];
const ctx = { orgA: "", userA: "", companyA: "", tokenA: "", orgB: "", companyB: "", tokenB: "" };

async function draft(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/meetings/draft-objective`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  const orgA = await core.orgs.create({ name: "Org A" });
  const orgB = await core.orgs.create({ name: "Org B" });
  ctx.orgA = orgA.id;
  ctx.orgB = orgB.id;
  ctx.userA = "user-a";
  // gatherChecklistContext 要真的讀到 company，否則 draftMeetingObjective 會在資料不足時直接回 ""（不打 LLM）。
  ctx.companyA = (await core.companies.create(orgA.id, { name: "Acme A", industry: "SaaS" })).id;
  ctx.companyB = (await core.companies.create(orgB.id, { name: "Acme B", industry: "SaaS" })).id;
  ctx.tokenA = issueToken(SECRET, { userId: ctx.userA, orgId: orgA.id, role: "owner" });
  ctx.tokenB = issueToken(SECRET, { userId: "user-b", orgId: orgB.id, role: "owner" });

  gemini = fakeGemini();
  const m = fakeMeter();
  recorded = m.recorded;
  const hub = new RealtimeHub(core, testConfig(), gemini, m.meter);

  const app = express();
  app.use(express.json());
  app.use("/api/meetings", createMeetingsRouter(hub, core, SECRET, 0));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  core.close();
});

describe("POST /api/meetings/draft-objective 計費歸屬", () => {
  it("每次呼叫都落一筆 gemini_text，orgId/userId 取自 JWT；重複呼叫的 idemKey 不同（不會被去重少計）", async () => {
    const first = await draft(ctx.tokenA, { companyId: ctx.companyA, title: "第一次" });
    expect(first.status).toBe(200);
    expect(first.json.objective).toBe(DRAFTED); // 業務行為不變

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      orgId: ctx.orgA,
      kind: "gemini_text",
      userId: ctx.userA,
      model: "extract-model",
      inputTokens: 321, // 真的把 provider 回報的 token 帶進計費（不是記個 0）
    });

    // 使用者在表單上改了公司再打一次 → 必須再記一筆，且 idemKey 不同
    const second = await draft(ctx.tokenA, { companyId: ctx.companyA, title: "第二次" });
    expect(second.status).toBe(200);
    expect(recorded).toHaveLength(2);
    expect(recorded[1]!.idemKey).not.toBe(recorded[0]!.idemKey);
    expect(recorded.every((r) => r.kind === "gemini_text")).toBe(true);

    // 每次都真的打了 LLM（不是被 cache 掉才剛好只記到 1 筆）
    expect(gemini.calls).toBe(2);
  });

  it("跨 org 呼叫記在自己 org（歸屬不會錯到別人頭上）", async () => {
    const before = recorded.length;
    const r = await draft(ctx.tokenB, { companyId: ctx.companyB });
    expect(r.status).toBe(200);
    expect(recorded).toHaveLength(before + 1);
    expect(recorded[before]).toMatchObject({ orgId: ctx.orgB, kind: "gemini_text", userId: "user-b" });
    // A 的 org 沒有被多記
    expect(recorded.filter((x) => x.orgId === ctx.orgA)).toHaveLength(before);
  });

  it("資料不足（無 deck 也無 company）→ 不打 LLM、不記帳、回空字串", async () => {
    const before = recorded.length;
    const callsBefore = gemini.calls;
    const r = await draft(ctx.tokenA, { title: "只有標題" });
    expect(r.status).toBe(200);
    expect(r.json.objective).toBe("");
    expect(recorded).toHaveLength(before);
    expect(gemini.calls).toBe(callsBefore);
  });
});
