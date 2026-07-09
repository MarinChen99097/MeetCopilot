/**
 * ADMIN_CONTRACT §1 / invariant A1 — a platform-admin allowlist email is RESERVED at /api/auth/register.
 *
 * Threat fixed here: an operator sets PLATFORM_ADMIN_EMAILS=admin@acme.com, but that email has no local account
 * yet (e.g. a Google-only admin). platformAdmin is legitimately stamped on login/google (both prove ownership of
 * the email), so if an attacker could self-register that unclaimed email, set their own password, then login, they
 * would mint a platformAdmin token — every /api/admin/* route falls open (A1 bypass). Simply not stamping admin on
 * the register token was NOT enough (login still stamps it). The complete fix REJECTS register for allowlist
 * emails. This test pins:
 *   - register(allowlist email)    → 403 reserved, and no account is created (attack blocked);
 *   - register(non-allowlist email)→ 201 as normal (ordinary signup unaffected);
 *   - an admin account created out-of-band (operator/provision), then login → token IS platformAdmin
 *     (positive control that the allowlist itself still works via the ownership-proving path).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import bcrypt from "bcryptjs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createAuthRouter } from "./routes.js";
import { createUserWithOrg } from "./provision.js";
import { verifyToken } from "./jwt.js";

const SECRET = "test-secret-value-not-a-placeholder-1234567890";
const ADMIN_EMAIL = "admin@acme.com";

let core: CrmCore;
let server: Server;
let baseUrl: string;

async function post(path: string, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

beforeAll(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  const app = express();
  app.use(express.json());
  // Allowlist the email so payloadFor WOULD stamp admin — the fix must reject register outright for it.
  app.use("/api/auth", createAuthRouter(core, SECRET, { platformAdminEmails: [ADMIN_EMAIL] }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server?.close();
  core?.close();
});

describe("platform-admin email is reserved at register (invariant A1)", () => {
  it("register with an allowlisted email → 403 reserved, and no account is created", async () => {
    const res = await post("/api/auth/register", {
      email: ADMIN_EMAIL,
      password: "password123",
      displayName: "Claimed Admin",
      orgName: "Acme",
    });
    expect(res.status).toBe(403);
    expect(typeof res.json.error).toBe("string");
    // The blocked attack left nothing behind — no local account was minted for the reserved email.
    expect(await core.users.findByEmail(ADMIN_EMAIL)).toBeNull();
  });

  it("register with a NON-allowlisted email → 201 as normal (ordinary signup unaffected)", async () => {
    const res = await post("/api/auth/register", {
      email: "normal@user.co",
      password: "password123",
      displayName: "Normal User",
      orgName: "Normal Org",
    });
    expect(res.status).toBe(201);
    const decoded = verifyToken(SECRET, (res.json as { token: string }).token);
    expect(decoded.platformAdmin).not.toBe(true);
  });

  it("contrast: an admin account provisioned out-of-band, then login → token IS platformAdmin", async () => {
    // Legitimate admins are created via Google sign-in or operator pre-provisioning — never via register. Simulate
    // a pre-provisioned local account (owns the email + a known password), then prove ownership via login.
    await createUserWithOrg(core, {
      email: ADMIN_EMAIL,
      passwordHash: await bcrypt.hash("password123", 10),
      displayName: "Real Admin",
      orgName: "Acme",
    });
    const res = await post("/api/auth/login", { email: ADMIN_EMAIL, password: "password123" });
    expect(res.status).toBe(200);
    const decoded = verifyToken(SECRET, (res.json as { token: string }).token);
    expect(decoded.platformAdmin).toBe(true);
  });
});
