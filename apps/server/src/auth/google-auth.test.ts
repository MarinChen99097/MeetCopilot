/**
 * Google Sign-In route (POST /api/auth/google) — behavioural, over a real in-memory CrmCore + a stubbed
 * Google verifier (no network, no real client secret). Asserts:
 *  1. a verified token provisions a local user + personal org + owner membership and returns a MeetCopilot JWT
 *     in the same {token,user,org} shape as login/register;
 *  2. a second sign-in with the SAME email reuses the same user+org (no duplicate — org count stays 1);
 *  3. email_verified:false → 401 and provisions nothing;
 *  4. the feature flag: with GOOGLE_CLIENT_ID unset, /google is 501 while local register/login keep working.
 */
import { describe, it, expect, afterEach } from "vitest";
import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter, type GoogleIdTokenVerifier } from "./routes.js";
import { verifyToken } from "./jwt.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";
const CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

const openServers: Server[] = [];
afterEach(() => {
  for (const s of openServers.splice(0)) s.close();
});

async function newCore(): Promise<CrmCore> {
  const core = await createCrmCore(":memory:");
  await core.migrate();
  return core;
}

async function makeBase(
  core: CrmCore,
  opts: { googleClientId?: string; verify?: GoogleIdTokenVerifier },
): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter(core, SECRET, {
      googleClientId: opts.googleClientId,
      verifyGoogleIdToken: opts.verify,
    }),
  );
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  openServers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

async function count(core: CrmCore, table: "orgs" | "users" | "memberships"): Promise<number> {
  const row = await core.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`, []);
  return Number(row?.n ?? 0);
}

async function postJson(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

const verified: GoogleIdTokenVerifier = async () => ({ email: "a@b.com", email_verified: true, name: "A" });
const unverified: GoogleIdTokenVerifier = async () => ({ email: "a@b.com", email_verified: false, name: "A" });

describe("POST /api/auth/google", () => {
  it("provisions a local user+org+owner and returns a MeetCopilot token (login/register shape)", async () => {
    const core = await newCore();
    const base = await makeBase(core, { googleClientId: CLIENT_ID, verify: verified });

    const { status, json } = await postJson(base, "/api/auth/google", { idToken: "x" });

    expect(status).toBe(200);
    // Same shape as login/register.
    expect(json).toMatchObject({
      user: { email: "a@b.com", displayName: "A" },
      org: { name: "A" },
    });
    expect(typeof json.token).toBe("string");
    // The token is MeetCopilot's own JWT ({userId,orgId,role}) — verifiable with our secret.
    const claims = verifyToken(SECRET, json.token as string);
    expect(claims.role).toBe("owner");
    expect(claims.userId).toBe((json.user as { id: string }).id);
    expect(claims.orgId).toBe((json.org as { id: string }).id);

    // Provisioned exactly one user + one org + one owner membership.
    expect(await count(core, "users")).toBe(1);
    expect(await count(core, "orgs")).toBe(1);
    expect(await count(core, "memberships")).toBe(1);
  });

  it("is idempotent: a second sign-in with the same email reuses the same user+org (no duplicate)", async () => {
    const core = await newCore();
    const base = await makeBase(core, { googleClientId: CLIENT_ID, verify: verified });

    const first = await postJson(base, "/api/auth/google", { idToken: "x" });
    const second = await postJson(base, "/api/auth/google", { idToken: "x" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((second.json.user as { id: string }).id).toBe((first.json.user as { id: string }).id);
    expect((second.json.org as { id: string }).id).toBe((first.json.org as { id: string }).id);

    // No dup: still exactly one org (and one user).
    expect(await count(core, "orgs")).toBe(1);
    expect(await count(core, "users")).toBe(1);
  });

  it("rejects an unverified email with 401 and provisions nothing", async () => {
    const core = await newCore();
    const base = await makeBase(core, { googleClientId: CLIENT_ID, verify: unverified });

    const { status, json } = await postJson(base, "/api/auth/google", { idToken: "x" });

    expect(status).toBe(401);
    expect(typeof json.error).toBe("string");
    expect(await count(core, "users")).toBe(0);
    expect(await count(core, "orgs")).toBe(0);
  });

  it("returns 501 when Google is not configured, but local register/login still work", async () => {
    const core = await newCore();
    const base = await makeBase(core, {}); // no googleClientId, no verifier → feature off

    const google = await postJson(base, "/api/auth/google", { idToken: "x" });
    expect(google.status).toBe(501);

    // Local email/password auth is unchanged and fully functional.
    const reg = await postJson(base, "/api/auth/register", {
      email: "local@b.com",
      password: "password123",
      displayName: "Local User",
      orgName: "Local Org",
    });
    expect(reg.status).toBe(201);
    expect(reg.json).toMatchObject({ user: { email: "local@b.com" }, org: { name: "Local Org" } });

    const login = await postJson(base, "/api/auth/login", { email: "local@b.com", password: "password123" });
    expect(login.status).toBe(200);
    expect((login.json.user as { email: string }).email).toBe("local@b.com");
  });
});
