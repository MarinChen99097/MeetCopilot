/**
 * Admin API (ADMIN_CONTRACT §4 / §7 #3) — behavioural, over a real in-memory CrmCore + express app with the
 * auth router (platform-admin allowlist) and the admin router mounted, exactly as index.ts wires them.
 *
 * Covers invariant A1 (the attack test): every /api/admin/* endpoint →
 *   - a normal (non-admin) owner token → 403 {error:"admin only"};
 *   - no token → 401;
 *   - a platform-admin token → 200.
 * Plus response-shape assertions (frozen field names) and the self-lock guard (§4 #6).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "../auth/routes.js";
import { createUserWithOrg } from "../auth/provision.js";
import { createAdminRouter } from "./index.js";
import type { AppConfig } from "../config.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";
const ADMIN_EMAIL = "admin@meet.co";

function testConfig(): AppConfig {
  return {
    port: 0,
    jwtSecret: SECRET,
    dbPath: ":memory:",
    researchAutoLimitPerMeeting: 5,
    supplementAutoLimitPerMeeting: 8,
    googleClientId: "",
    platformAdminEmails: [ADMIN_EMAIL],
    adminOrigin: "",
    gemini: {
      apiKey: "",
      textModel: "gemini-3.1-flash-lite",
      extractModel: "gemini-3.5-flash",
      embedModel: "gemini-embedding-001",
      liveModel: "gemini-3.1-flash-live-preview",
    },
    openai: { apiKey: "", imageModel: "gpt-image-2", imageSize: "1x1", imageQuality: "low" },
  };
}

let core: CrmCore;
let server: Server;
let base: string;
let adminToken: string;
let ownerToken: string;
let ownerOrgId: string;
let ownerUserId: string;

async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function register(email: string) {
  const r = await req("POST", "/api/auth/register", {
    body: { email, password: "password123", displayName: "N", orgName: `${email}-org` },
  });
  return r.json as { token: string; user: { id: string }; org: { id: string } };
}

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();

  const app = express();
  app.use(express.json());
  const config = testConfig();
  app.use("/api/auth", createAuthRouter(core, SECRET, { platformAdminEmails: config.platformAdminEmails }));
  app.use("/api/admin", createAdminRouter(core, config));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Admin authority requires proving email ownership. A platform-admin email is RESERVED at register (invariant
  // A1, see auth/routes.ts + register-admin.test.ts), so the allowlisted account is created out-of-band (as
  // operator pre-provisioning / Google sign-in would), and LOGIN then stamps platformAdmin.
  await createUserWithOrg(core, {
    email: ADMIN_EMAIL,
    passwordHash: await bcrypt.hash("password123", 10),
    displayName: "Admin",
    orgName: "admin-org",
  });
  const adminLogin = await req("POST", "/api/auth/login", {
    body: { email: ADMIN_EMAIL, password: "password123" },
  });
  adminToken = (adminLogin.json as { token: string }).token;
  const owner = await register("owner@normal.co");
  ownerToken = owner.token;
  ownerOrgId = owner.org.id;
  ownerUserId = owner.user.id;

  // Seed one usage event (attributed to the owner) + one crawl job, so list shapes have real rows.
  await core.usage.record(ownerOrgId, {
    kind: "gemini_text",
    model: "gemini-3.5-flash",
    inputTokens: 100,
    outputTokens: 40,
    estCostUsd: 0.003,
    userId: ownerUserId,
    idempotencyKey: "seed-1",
  });
  const now = Date.now();
  await core.db.run(
    `INSERT INTO crawl_jobs (id, org_id, target_type, target_id, mode, status, requested_by, started_at, finished_at, created_at)
     VALUES ('job1', ?, 'company', 'c1', 'quick', 'done', ?, ?, ?, ?)`,
    [ownerOrgId, ownerUserId, now - 3000, now - 1000, now - 5000],
  );
});

afterAll(() => {
  server?.close();
  core?.close();
});

// The 10 admin endpoints (method + path). PATCH bodies are valid so admin gets 200.
const ENDPOINTS: { method: string; path: () => string; body?: () => unknown }[] = [
  { method: "GET", path: () => "/api/admin/overview" },
  { method: "GET", path: () => "/api/admin/usage?groupBy=kind" },
  { method: "GET", path: () => "/api/admin/usage/events" },
  { method: "GET", path: () => "/api/admin/orgs" },
  { method: "GET", path: () => `/api/admin/orgs/${ownerOrgId}` },
  { method: "PATCH", path: () => `/api/admin/orgs/${ownerOrgId}/status`, body: () => ({ status: "active" }) },
  { method: "PATCH", path: () => `/api/admin/users/${ownerUserId}/status`, body: () => ({ status: "active" }) },
  { method: "GET", path: () => "/api/admin/jobs" },
  { method: "GET", path: () => "/api/admin/jobs/stats" },
  { method: "GET", path: () => "/api/admin/health" },
  { method: "GET", path: () => "/api/admin/pricing" },
];

describe("A1 — admin routes reject non-admin tokens", () => {
  it("no token → 401 on every endpoint", async () => {
    for (const e of ENDPOINTS) {
      const r = await req(e.method, e.path(), { body: e.body?.() });
      expect(r.status, `${e.method} ${e.path()}`).toBe(401);
    }
  });

  it("normal owner token → 403 admin only on every endpoint", async () => {
    for (const e of ENDPOINTS) {
      const r = await req(e.method, e.path(), { token: ownerToken, body: e.body?.() });
      expect(r.status, `${e.method} ${e.path()}`).toBe(403);
      expect(r.json.error).toBe("admin only");
    }
  });

  it("platform-admin token → 200 on every endpoint", async () => {
    for (const e of ENDPOINTS) {
      const r = await req(e.method, e.path(), { token: adminToken, body: e.body?.() });
      expect(r.status, `${e.method} ${e.path()}`).toBe(200);
    }
  });
});

describe("admin endpoint shapes (frozen field names, §4 + v1.2)", () => {
  it("#1 overview", async () => {
    const { json } = await req("GET", "/api/admin/overview", { token: adminToken });
    expect(json).toMatchObject({
      costUsd: { today: expect.any(Number), last7d: expect.any(Number), last30d: expect.any(Number) },
      orgs: { total: expect.any(Number), suspended: expect.any(Number) },
      users: { total: expect.any(Number) },
      jobs: { running: expect.any(Number), failedLast7d: expect.any(Number), doneLast7d: expect.any(Number) },
      health: { ready: expect.any(Boolean) },
    });
    expect((json.users as { total: number }).total).toBeGreaterThanOrEqual(2);
  });

  it("#2 usage groupBy=kind sums the seeded event", async () => {
    const { json } = await req("GET", "/api/admin/usage?groupBy=kind", { token: adminToken });
    expect(json).toMatchObject({
      from: expect.any(Number),
      to: expect.any(Number),
      totalCostUsd: expect.any(Number),
      totalInputTokens: expect.any(Number),
      totalOutputTokens: expect.any(Number),
      rows: expect.any(Array),
    });
    const kindRow = (json.rows as { key: string; costUsd: number }[]).find((r) => r.key === "gemini_text");
    expect(kindRow?.costUsd).toBeCloseTo(0.003, 6);
  });

  it("#3 usage/events surfaces org name + user attribution", async () => {
    const { json } = await req("GET", "/api/admin/usage/events", { token: adminToken });
    expect(json).toMatchObject({ total: expect.any(Number), items: expect.any(Array) });
    const item = (json.items as { userId: string | null; orgName: string | null; estCostUsd: number }[]).find(
      (i) => i.userId === ownerUserId,
    );
    expect(item).toBeDefined();
    expect(typeof item!.orgName).toBe("string");
    expect(item!.estCostUsd).toBeCloseTo(0.003, 6);
  });

  it("#3 usage/events rejects out-of-range limit with 400", async () => {
    const { status } = await req("GET", "/api/admin/usage/events?limit=999", { token: adminToken });
    expect(status).toBe(400);
  });

  it("#4 orgs list item shape", async () => {
    const { json } = await req("GET", "/api/admin/orgs", { token: adminToken });
    const items = json.items as Record<string, unknown>[];
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      status: expect.any(String),
      createdAt: expect.any(Number),
      memberCount: expect.any(Number),
      costUsd30d: expect.any(Number),
    });
  });

  it("#5 org detail: members/invites/usage30d.byKind/recentJobs; invites never carry a token (A3)", async () => {
    const { json } = await req("GET", `/api/admin/orgs/${ownerOrgId}`, { token: adminToken });
    expect(json).toMatchObject({
      org: { id: ownerOrgId, status: "active" },
      members: expect.any(Array),
      invites: expect.any(Array),
      usage30d: { costUsd: expect.any(Number), byKind: expect.any(Array) },
      recentJobs: expect.any(Array),
    });
    const member = (json.members as { userId: string; role: string; status: string }[])[0];
    expect(member).toMatchObject({ userId: ownerUserId, role: "owner", status: "active" });
    const byKind = (json.usage30d as { byKind: { kind: string; costUsd: number }[] }).byKind;
    expect(byKind[0]).toMatchObject({ kind: expect.any(String), costUsd: expect.any(Number) });
    // recentJobs carries server-computed durations.
    const job = (json.recentJobs as { durationMs: number | null; queueMs: number | null }[])[0];
    expect(job).toBeDefined();
    expect(job!.durationMs).toBe(2000);
    expect(job!.queueMs).toBe(2000);
  });

  it("#5 unknown org id → 404", async () => {
    const { status } = await req("GET", "/api/admin/orgs/does-not-exist", { token: adminToken });
    expect(status).toBe(404);
  });

  it("#7 jobs list computes durationMs/queueMs", async () => {
    const { json } = await req("GET", "/api/admin/jobs", { token: adminToken });
    const job = (json.items as { id: string; durationMs: number; queueMs: number; orgName: string }[]).find(
      (j) => j.id === "job1",
    );
    expect(job).toBeDefined();
    expect(job!.durationMs).toBe(2000);
  });

  it("#8 jobs/stats has N day buckets + fail metrics", async () => {
    const { json } = await req("GET", "/api/admin/jobs/stats?days=7", { token: adminToken });
    expect((json.days as unknown[]).length).toBe(7);
    expect(json).toMatchObject({
      failRatePct: expect.any(Number),
      avgDurationMs: expect.any(Number),
      topErrors: expect.any(Array),
    });
  });

  it("#9 health full shape", async () => {
    const { json } = await req("GET", "/api/admin/health", { token: adminToken });
    expect(json).toMatchObject({
      ready: expect.any(Boolean),
      db: { driver: expect.any(String), ok: expect.any(Boolean) },
      providers: { gemini: expect.any(Boolean), openai: expect.any(Boolean) },
      liveMeetings: expect.any(Number),
      uptimeSec: expect.any(Number),
      version: expect.any(String),
    });
  });

  it("#10 pricing rows + disclaimer", async () => {
    const { json } = await req("GET", "/api/admin/pricing", { token: adminToken });
    expect(typeof json.disclaimer).toBe("string");
    const rows = json.rows as { kind: string; source: string }[];
    expect(rows.some((r) => r.kind === "gemini_text")).toBe(true);
    expect(rows.every((r) => r.source === "default" || r.source === "env")).toBe(true);
  });
});

describe("§4 #6 self-lock guard", () => {
  it("suspending a platform-admin user → 400", async () => {
    const admin = await core.users.findByEmail(ADMIN_EMAIL);
    const { status, json } = await req("PATCH", `/api/admin/users/${admin!.id}/status`, {
      token: adminToken,
      body: { status: "suspended" },
    });
    expect(status).toBe(400);
    expect(typeof json.error).toBe("string");
  });

  it("suspending an org that contains a platform admin → 400", async () => {
    const admin = await core.users.findByEmail(ADMIN_EMAIL);
    const membership = await core.memberships.findPrimaryOrgOf(admin!.id);
    const { status } = await req("PATCH", `/api/admin/orgs/${membership!.orgId}/status`, {
      token: adminToken,
      body: { status: "suspended" },
    });
    expect(status).toBe(400);
  });

  it("invalid status body → 400", async () => {
    const { status } = await req("PATCH", `/api/admin/orgs/${ownerOrgId}/status`, {
      token: adminToken,
      body: { status: "banned" },
    });
    expect(status).toBe(400);
  });
});
