/**
 * W4 便宜彙總端點（server 側）——`GET /api/org/usage` 的 `budget` 欄 ＋ `GET /api/org/usage/by-meeting`。
 * 行為驗證，攻擊者視角（硬規則 7）：
 *  1. budget：env `ORG_MONTHLY_BUDGET_USD` 未設／非法 → **整個欄位不存在**（前端不渲染預算條）；設了才有，
 *     且 spent 只算**本 org 當月**（他 org 的 $9.99 不得混入）。
 *  2. by-meeting：無 token → 401、member → 403；owner 只看得到自己 org 的會議成本；
 *     `meeting_id IS NULL` 的會前用量不歸屬任何一場；**跨 org 的會議標題永不外洩**（join 帶 org_id）。
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "../auth/routes.js";
import { createOrgRouter } from "./index.js";
import { issueToken } from "../auth/jwt.js";
import { MeetingStore } from "../realtime/meeting-store.js";
import { utcMonthStart } from "./usage-queries.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";

let core: CrmCore;
let server: Server;
let base: string;
let ownerAToken: string;
let ownerBToken: string;
let memberToken: string;
let meetingA1: string;
let meetingA2: string;
let meetingB: string;

/** orgA 的種子成本（稅前）：兩場會議 + 一筆會前（無 meetingId）+ 一筆指向他 org 會議的列。 */
const A1_COST = 0.5 + 0.25;
const A2_COST = 0.1;
const A_PREMEETING_COST = 5;
const A_FOREIGN_MEETING_COST = 0.01;
const A_TOTAL_PRETAX = A1_COST + A2_COST + A_PREMEETING_COST + A_FOREIGN_MEETING_COST; // 5.86

async function req(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json, raw: JSON.stringify(json) };
}

async function register(email: string) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "password123", displayName: "N", orgName: `${email}-org` }),
  });
  return (await res.json()) as { token: string; user: { id: string }; org: { id: string } };
}

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();

  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter(core, SECRET, { platformAdminEmails: [] }));
  app.use("/api/org", createOrgRouter(core, SECRET));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const ownerA = await register("w4-owner-a@meet.co");
  const ownerB = await register("w4-owner-b@meet.co");
  const memberU = await register("w4-member@meet.co");
  ownerAToken = ownerA.token;
  ownerBToken = ownerB.token;
  await core.memberships.addMembership(ownerA.org.id, memberU.user.id, "member");
  memberToken = issueToken(SECRET, { userId: memberU.user.id, orgId: ownerA.org.id, role: "member" });

  // 會議（既有表，不開 migration）——A 兩場、B 一場（標題是機密，跨 org 不得外洩）。
  const meetings = new MeetingStore(core.db);
  meetingA1 = (await meetings.create(ownerA.org.id, { title: "A 大會", presenterUserId: ownerA.user.id })).id;
  meetingA2 = (await meetings.create(ownerA.org.id, { title: "A 小會", presenterUserId: ownerA.user.id })).id;
  meetingB = (await meetings.create(ownerB.org.id, { title: "B 機密會", presenterUserId: ownerB.user.id })).id;

  const seed = (orgId: string, key: string, estCostUsd: number, meetingId?: string) =>
    core.usage.record(orgId, {
      kind: "gemini_text",
      model: "m",
      inputTokens: 1,
      outputTokens: 1,
      estCostUsd,
      meetingId,
      idempotencyKey: key,
    });

  await seed(ownerA.org.id, "a-m1-1", 0.5, meetingA1);
  await seed(ownerA.org.id, "a-m1-2", 0.25, meetingA1);
  await seed(ownerA.org.id, "a-m2-1", A2_COST, meetingA2);
  await seed(ownerA.org.id, "a-pre", A_PREMEETING_COST); // 會前生成：無 meetingId，不歸屬任何一場
  // 攻擊佐證：A 的用量列硬指向 B 的會議 id → 成本仍算 A 的（org_id 決定），但**標題不得**從 B 的會議帶出來。
  await seed(ownerA.org.id, "a-foreign", A_FOREIGN_MEETING_COST, meetingB);
  await seed(ownerB.org.id, "b-m1", 9.99, meetingB);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  delete process.env.ORG_MONTHLY_BUDGET_USD;
});

describe("GET /api/org/usage — budget 欄（env 驅動）", () => {
  it("env 未設 → 回應完全沒有 budget 欄（前端不渲染預算條）", async () => {
    const r = await req("/api/org/usage?groupBy=kind", ownerAToken);
    expect(r.status).toBe(200);
    expect(r.json.budget).toBeUndefined();
    expect("budget" in r.json).toBe(false);
  });

  it.each(["", "abc", "0", "-5"])("env 非法值 %p → 仍然沒有 budget 欄（不編造上限）", async (raw) => {
    process.env.ORG_MONTHLY_BUDGET_USD = raw;
    const r = await req("/api/org/usage?groupBy=kind", ownerAToken);
    expect(r.status).toBe(200);
    expect(r.json.budget).toBeUndefined();
  });

  it("env 設 100 → budget 帶月上限＋本月至今花費；他 org 的 $9.99 不得混入", async () => {
    process.env.ORG_MONTHLY_BUDGET_USD = "100";
    const r = await req("/api/org/usage?groupBy=kind", ownerAToken);
    expect(r.status).toBe(200);
    const budget = r.json.budget as {
      monthlyUsd: number;
      monthStart: number;
      spentUsd: number;
      spentUsdPosttax: number;
    };
    expect(budget.monthlyUsd).toBe(100);
    expect(budget.monthStart).toBe(utcMonthStart(Date.now()));
    // 本 org 全部種子（含會前那筆）＝ 5.86 稅前；含稅 ×1.25。B 的 9.99 不在內。
    expect(budget.spentUsd).toBeCloseTo(A_TOTAL_PRETAX, 6);
    expect(budget.spentUsdPosttax).toBeCloseTo(A_TOTAL_PRETAX * 1.25, 6);
    expect(budget.spentUsd).toBeLessThan(9.99);
  });

  it("budget 的窗恆為本月，與 from/to 查詢窗無關（查一段古早窗仍回本月花費）", async () => {
    process.env.ORG_MONTHLY_BUDGET_USD = "100";
    const from = 1_000_000;
    const to = 2_000_000; // 1970 年的窗：rows 應為空，但 budget 仍是本月
    const r = await req(`/api/org/usage?groupBy=kind&from=${from}&to=${to}`, ownerAToken);
    expect(r.status).toBe(200);
    expect(r.json.totalCostUsd).toBe(0);
    expect((r.json.budget as { spentUsd: number }).spentUsd).toBeCloseTo(A_TOTAL_PRETAX, 6);
  });
});

describe("GET /api/org/usage/by-meeting — 單場成本", () => {
  it("無 token → 401；member → 403（與其餘 usage 路由同閘）", async () => {
    expect((await req("/api/org/usage/by-meeting")).status).toBe(401);
    expect((await req("/api/org/usage/by-meeting", memberToken)).status).toBe(403);
  });

  it("owner → 依成本由高到低；會前（無 meetingId）用量不歸屬任何一場", async () => {
    const r = await req("/api/org/usage/by-meeting", ownerAToken);
    expect(r.status).toBe(200);
    const items = r.json.items as { meetingId: string; title?: string; events: number; costUsd: number }[];
    // A 有三個不同 meeting_id（A1、A2、以及硬指 B 的那筆）；$5 的會前用量不產生任何列。
    expect(items).toHaveLength(3);
    expect(items.some((i) => i.costUsd === A_PREMEETING_COST)).toBe(false);
    expect(items.map((i) => i.costUsd)).toEqual([...items.map((i) => i.costUsd)].sort((a, b) => b - a));

    const a1 = items.find((i) => i.meetingId === meetingA1)!;
    expect(a1.title).toBe("A 大會");
    expect(a1.events).toBe(2);
    expect(a1.costUsd).toBeCloseTo(A1_COST, 6);
    expect(items.find((i) => i.meetingId === meetingA2)!.title).toBe("A 小會");
  });

  it("跨 org 隔離：B 的 $9.99 不混入 A，且 B 的會議標題永不外洩給 A", async () => {
    const r = await req("/api/org/usage/by-meeting", ownerAToken);
    const items = r.json.items as { meetingId: string; title?: string; costUsd: number }[];
    expect(items.some((i) => i.costUsd === 9.99)).toBe(false);
    expect(r.raw.includes("B 機密會")).toBe(false);
    // A 那筆硬指 B 會議 id 的用量：成本記在 A（合法，org_id 決定），但標題查不到（join 帶 org_id）。
    const foreign = items.find((i) => i.meetingId === meetingB)!;
    expect(foreign.costUsd).toBeCloseTo(A_FOREIGN_MEETING_COST, 6);
    expect(foreign.title).toBeUndefined();

    // 反向：B 看自己的會議，成本＝9.99、標題正常。
    const rb = await req("/api/org/usage/by-meeting", ownerBToken);
    const bItems = rb.json.items as { meetingId: string; title?: string; costUsd: number }[];
    expect(bItems).toHaveLength(1);
    expect(bItems[0]!.title).toBe("B 機密會");
    expect(bItems[0]!.costUsd).toBeCloseTo(9.99, 6);
  });

  it("limit 生效；非法查詢窗 → 400", async () => {
    const one = await req("/api/org/usage/by-meeting?limit=1", ownerAToken);
    expect((one.json.items as unknown[]).length).toBe(1);
    const bad = await req("/api/org/usage/by-meeting?from=abc", ownerAToken);
    expect(bad.status).toBe(400);
    const inverted = await req("/api/org/usage/by-meeting?from=200&to=100", ownerAToken);
    expect(inverted.status).toBe(400);
  });
});
