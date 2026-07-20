/**
 * Suspension end-to-end (ADMIN_CONTRACT §2 / §7 #4) — over a real in-memory CrmCore + an express app wired
 * like index.ts for the relevant seams: auth router, admin router (to flip status), and the CRM router behind
 * jwtGuard + activeGuard, plus unguarded /api/health & /api/ready.
 *
 * Asserts: suspend org → members' login 403 AND an already-issued token is blocked at the CRM router (403
 * account suspended) while health/ready keep working; restore → everything recovers. Also the per-user path
 * (suspend just the user).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import bcrypt from "bcryptjs";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "./routes.js";
import { createUserWithOrg } from "./provision.js";
import { authRequired } from "./jwt.js";
import { activeAccountRequired } from "./active-account.js";
import { createCrmRouter } from "../crm-routes/index.js";
import { createAdminRouter } from "../admin-routes/index.js";
import type { AppConfig } from "../config.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";
const ADMIN_EMAIL = "root@meet.co";

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
    gemini: { apiKey: "", textModel: "t", extractModel: "e", embedModel: "m", liveModel: "l" },
    openai: { apiKey: "", imageModel: "i", imageSize: "1x1", imageQuality: "low" },
  };
}

let core: CrmCore;
let server: Server;
let baseUrl: string;
let adminToken: string;
let userToken: string;
let orgId: string;
let userId: string;

async function req(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const setOrg = (status: "active" | "suspended") =>
  req("PATCH", `/api/admin/orgs/${orgId}/status`, { token: adminToken, body: { status } });
const setUser = (status: "active" | "suspended") =>
  req("PATCH", `/api/admin/users/${userId}/status`, { token: adminToken, body: { status } });
const login = () => req("POST", "/api/auth/login", { body: { email: "member@co.co", password: "password123" } });
const crm = (token: string) => req("GET", "/api/crm/companies", { token });

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();

  const app = express();
  app.use(express.json());
  const config = testConfig();
  const jwtGuard = authRequired(SECRET);
  const activeGuard = activeAccountRequired(core);
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/ready", async (_req, res) => {
    try {
      await core.db.get("SELECT 1 AS ok", []);
      res.json({ ready: true });
    } catch {
      res.status(503).json({ ready: false });
    }
  });
  app.use("/api/auth", createAuthRouter(core, SECRET, { platformAdminEmails: config.platformAdminEmails }));
  app.use("/api/admin", createAdminRouter(core, config));
  app.use("/api/crm", jwtGuard, activeGuard, createCrmRouter(core));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Admin authority requires proving email ownership. A platform-admin email is RESERVED at register (invariant
  // A1, see auth/routes.ts + register-admin.test.ts), so the allowlisted account is created out-of-band (as
  // operator pre-provisioning / Google sign-in would), and LOGIN then stamps platformAdmin.
  await createUserWithOrg(core, {
    email: ADMIN_EMAIL,
    passwordHash: await bcrypt.hash("password123", 10),
    displayName: "Root",
    orgName: "Root Org",
  });
  const adminLogin = await req("POST", "/api/auth/login", {
    body: { email: ADMIN_EMAIL, password: "password123" },
  });
  adminToken = (adminLogin.json as { token: string }).token;

  const member = await req("POST", "/api/auth/register", {
    body: { email: "member@co.co", password: "password123", displayName: "Member", orgName: "Member Org" },
  });
  userToken = (member.json as { token: string }).token;
  orgId = (member.json as { org: { id: string } }).org.id;
  userId = (member.json as { user: { id: string } }).user.id;
});

afterAll(() => {
  server?.close();
  core?.close();
});

describe("org suspension (ADMIN_CONTRACT §2)", () => {
  it("baseline: active member can login and call CRM", async () => {
    expect((await login()).status).toBe(200);
    expect((await crm(userToken)).status).toBe(200);
  });

  it("suspend org → login 403 AND existing token blocked at CRM 403; health/ready unaffected", async () => {
    expect((await setOrg("suspended")).status).toBe(200);

    const loginRes = await login();
    expect(loginRes.status).toBe(403);
    expect(loginRes.json.error).toBe("account suspended");

    const crmRes = await crm(userToken);
    expect(crmRes.status).toBe(403);
    expect(crmRes.json.error).toBe("account suspended");

    // Liveness/readiness never gated by suspension.
    expect((await req("GET", "/api/health")).status).toBe(200);
    expect((await req("GET", "/api/ready")).status).toBe(200);
  });

  it("restore org → login and CRM recover", async () => {
    expect((await setOrg("active")).status).toBe(200);
    expect((await login()).status).toBe(200);
    expect((await crm(userToken)).status).toBe(200);
  });
});

describe("user suspension (ADMIN_CONTRACT §2)", () => {
  it("suspend the user alone → blocked; restore recovers", async () => {
    expect((await setUser("suspended")).status).toBe(200);
    expect((await login()).status).toBe(403);
    expect((await crm(userToken)).status).toBe(403);

    expect((await setUser("active")).status).toBe(200);
    expect((await login()).status).toBe(200);
    expect((await crm(userToken)).status).toBe(200);
  });
});
