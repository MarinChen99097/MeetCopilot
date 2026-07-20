/**
 * GET /api/org/usage(+events) — 授權 + 租戶隔離（行為驗證，攻擊者視角，硬規則 7）。
 *  1. 無 token → 401。
 *  2. member 角色 token → 403（僅 owner/admin 可看 org 花費）。
 *  3. owner → 200，且**只**看得到自己 org 的用量——他 org 的 usage_events 不得混入（org_id 硬隔離）。
 *  4. 明細事件同樣 org-scoped；groupBy=model 正常；非法 groupBy → 400。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "../auth/routes.js";
import { createOrgRouter } from "./index.js";
import { issueToken } from "../auth/jwt.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";

let core: CrmCore;
let server: Server;
let base: string;
let ownerAToken: string;
let memberToken: string;

async function req(path: string, token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, { headers });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
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

  const ownerA = await register("owner-a@meet.co");
  const ownerB = await register("owner-b@meet.co");
  const memberU = await register("member-u@meet.co"); // 自己 org 的 owner，但下面把他加成 orgA 的 member
  ownerAToken = ownerA.token;

  await core.memberships.addMembership(ownerA.org.id, memberU.user.id, "member");
  memberToken = issueToken(SECRET, { userId: memberU.user.id, orgId: ownerA.org.id, role: "member" });

  // 種 usage：orgA 兩筆（合計 $0.12），orgB 一筆（$9.99，攻擊佐證——不得混入 A）。
  await core.usage.record(ownerA.org.id, {
    kind: "gemini_text",
    model: "model-A1",
    inputTokens: 100,
    outputTokens: 50,
    estCostUsd: 0.1,
    idempotencyKey: "a1",
  });
  await core.usage.record(ownerA.org.id, {
    kind: "embedding",
    model: "model-A2",
    inputTokens: 10,
    outputTokens: 0,
    estCostUsd: 0.02,
    idempotencyKey: "a2",
  });
  await core.usage.record(ownerB.org.id, {
    kind: "gemini_text",
    model: "model-B",
    inputTokens: 999,
    outputTokens: 999,
    estCostUsd: 9.99,
    idempotencyKey: "b1",
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("GET /api/org/usage 授權 + 租戶隔離", () => {
  it("無 token → 401", async () => {
    const r = await req("/api/org/usage");
    expect(r.status).toBe(401);
  });

  it("member 角色 → 403（只有 owner/admin 可看）", async () => {
    const r = await req("/api/org/usage", memberToken);
    expect(r.status).toBe(403);
    const e = await req("/api/org/usage/events", memberToken);
    expect(e.status).toBe(403);
  });

  it("owner → 200，且只看得到自己 org 的用量（他 org $9.99 不得混入）", async () => {
    const r = await req("/api/org/usage?groupBy=kind", ownerAToken);
    expect(r.status).toBe(200);
    // 合計＝A 的 0.10+0.02，不含 B 的 9.99。
    expect(r.json.totalCostUsd).toBeCloseTo(0.12, 6);
    // 含稅（019）＝稅前 × 每列稅率（種子未帶 → repo 落預設 1.25）→ 0.12 × 1.25 = 0.15。
    expect(r.json.totalCostUsdPosttax).toBeCloseTo(0.15, 6);
    expect(r.json.totalInputTokens).toBe(110);
    const rows = r.json.rows as { key: string; costUsd: number }[];
    expect(rows.some((row) => row.costUsd === 9.99)).toBe(false);
    // A 的兩個 kind 都在。
    const kinds = rows.map((row) => row.key).sort();
    expect(kinds).toEqual(["embedding", "gemini_text"]);
  });

  it("明細事件 org-scoped（只 2 筆、無他 org 的列）", async () => {
    const r = await req("/api/org/usage/events", ownerAToken);
    expect(r.status).toBe(200);
    expect(r.json.total).toBe(2);
    const items = r.json.items as { estCostUsd: number; model: string | null; costTaxMultiplier: number }[];
    expect(items).toHaveLength(2);
    expect(items.some((i) => i.estCostUsd === 9.99)).toBe(false);
    expect(items.every((i) => (i.model ?? "").startsWith("model-A"))).toBe(true);
    // 019：每列自帶稅率快照（種子未帶 → 預設 1.25）。
    expect(items.every((i) => i.costTaxMultiplier === 1.25)).toBe(true);
  });

  it("groupBy=model 正常；非法 groupBy → 400", async () => {
    const byModel = await req("/api/org/usage?groupBy=model", ownerAToken);
    expect(byModel.status).toBe(200);
    const rows = byModel.json.rows as { key: string }[];
    expect(rows.map((r) => r.key).sort()).toEqual(["model-A1", "model-A2"]);

    const bad = await req("/api/org/usage?groupBy=org", ownerAToken); // org 是 admin 專用，org-scoped 不接受
    expect(bad.status).toBe(400);
  });
});
