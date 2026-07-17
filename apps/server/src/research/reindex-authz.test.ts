/**
 * WP4.1 §4.1 / §5.3：POST /companies/:id/reindex 的 org 隔離。
 * L7「攻擊者憑證」：另一 org 的成員（跨 org token）打某公司的 reindex → 該公司在其 org 下不存在 → **403**。
 * 合法成員（同 org）→ 200（注入假 orchestrator，避免真的呼叫 Gemini）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "../auth/index.js";
import { createResearchRouter } from "./routes.js";
import type { AppConfig } from "../config.js";
import type { ResearchOrchestrator } from "./orchestrator.js";

const SECRET = "test-secret-reindex-0123456789";

let core: CrmCore;
let server: Server;
let base: string;
let victimToken: string;
let attackerToken: string;
let victimCompanyId: string;

function testConfig(): AppConfig {
  return {
    port: 0,
    jwtSecret: SECRET,
    dbPath: ":memory:",
    researchAutoLimitPerMeeting: 5,
    googleClientId: "",
    platformAdminEmails: [],
    adminOrigin: "",
    // gemini.apiKey 非空 → isConfigured() true（通過 reindex 的 502 gate）；不會真的呼叫（注入假 orchestrator）。
    gemini: {
      apiKey: "test-key",
      textModel: "t",
      extractModel: "e",
      embedModel: "gemini-embedding-001",
      liveModel: "l",
    },
    openai: { apiKey: "", imageModel: "gpt-image-2", imageSize: "1x1", imageQuality: "low" },
  };
}

// 假 orchestrator：reindex 回固定 chunks；createJob/runJob 不用於本測試。
const fakeOrch: ResearchOrchestrator = {
  async createJob() {
    return { jobId: "j" };
  },
  async runJob() {
    /* no-op */
  },
  async reindex() {
    return { chunks: 5 };
  },
};

async function req(method: string, path: string, token?: string, body?: unknown) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

async function register(email: string) {
  const r = await req("POST", "/api/auth/register", undefined, {
    email,
    password: "password123",
    displayName: "N",
    orgName: `${email}-org`,
  });
  return r.json as { token: string; user: { id: string }; org: { id: string } };
}

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();

  const app = express();
  app.use(express.json());
  const config = testConfig();
  app.use("/api/auth", createAuthRouter(core, SECRET, {}));
  app.use("/api/research", createResearchRouter(core, config, SECRET, { orchestrator: fakeOrch }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const victim = await register("victim@co.test");
  victimToken = victim.token;
  const attacker = await register("attacker@evil.test");
  attackerToken = attacker.token;

  const company = await core.companies.create(victim.org.id, { name: "Victim Co" });
  victimCompanyId = company.id;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  core.close();
});

describe("POST /research/companies/:id/reindex org isolation", () => {
  it("rejects a cross-org attacker with 403", async () => {
    const r = await req("POST", `/api/research/companies/${victimCompanyId}/reindex`, attackerToken);
    expect(r.status).toBe(403);
  });

  it("allows the owning-org member (200 + chunks)", async () => {
    const r = await req("POST", `/api/research/companies/${victimCompanyId}/reindex`, victimToken);
    expect(r.status).toBe(200);
    expect(r.json.chunks).toBe(5);
  });

  it("returns 403 for a company id that does not exist in the caller's org", async () => {
    const r = await req("POST", `/api/research/companies/does-not-exist/reindex`, victimToken);
    expect(r.status).toBe(403);
  });

  it("requires a bearer token (401 without)", async () => {
    const r = await req("POST", `/api/research/companies/${victimCompanyId}/reindex`);
    expect(r.status).toBe(401);
  });
});
