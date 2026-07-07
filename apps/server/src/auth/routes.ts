/**
 * Auth routes — API_CONTRACT §1 (exact shapes):
 *   POST /api/auth/register {email,password,displayName,orgName}
 *        → 201 {token, user:{id,email,displayName}, org:{id,name}}   (creates org + user + owner membership)
 *   POST /api/auth/login    {email,password}
 *        → 200 {token, user:{id,email,displayName}, org:{id,name}}
 *   GET  /api/auth/me       (Bearer) → {user, org, role}
 * Errors: 400 validation, 401 bad credentials/token, 409 duplicate email — all `{error:string}`.
 * JWT payload = {userId, orgId, role}. Passwords hashed with bcryptjs.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import type { CrmCore, Role } from "@meetcopilot/crm";
import { authRequired, issueToken } from "./jwt.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

type Json = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** Minimal membership row shape for the login user→org shim (see note below). */
interface MembershipRow {
  org_id: string;
  role: Role;
}

/**
 * SEAM GAP (flag for A2/commander): login must resolve a user's org+role from userId alone, but the
 * frozen MembershipRepository (packages/crm/src/ports.ts) only exposes addMembership + roleOf(orgId,userId)
 * — there is no findByUser / primaryOrg lookup. As a temporary M0 shim we read via the exposed DbPort.
 * This is the ONLY spot in the server that touches SQL directly; it should be promoted to
 * `MembershipRepository.findPrimaryOrgOf(userId): Promise<{orgId, role} | null>` so the "nothing bypasses
 * the repo layer" CRM invariant (CRM_SCHEMA §11) holds. Ordering by rowid picks the first (owner) row.
 */
async function findPrimaryMembership(core: CrmCore, userId: string): Promise<MembershipRow | null> {
  const row = await core.db.get<MembershipRow>(
    "SELECT org_id, role FROM memberships WHERE user_id = ? ORDER BY rowid ASC LIMIT 1",
    [userId],
  );
  return row ?? null;
}

export function createAuthRouter(core: CrmCore, jwtSecret: string): Router {
  const router = Router();

  router.post("/register", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Json;
    const email = str(body.email)?.toLowerCase() ?? null;
    const password = typeof body.password === "string" ? body.password : "";
    const displayName = str(body.displayName);
    const orgName = str(body.orgName);

    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "valid email is required" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password must be at least 8 characters" });
      return;
    }
    if (!displayName) {
      res.status(400).json({ error: "displayName is required" });
      return;
    }
    if (!orgName) {
      res.status(400).json({ error: "orgName is required" });
      return;
    }

    const existing = await core.users.findByEmail(email);
    if (existing) {
      res.status(409).json({ error: "email already registered" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    let created: { userId: string; orgId: string; orgName: string };
    try {
      created = await core.db.tx(async () => {
        const org = await core.orgs.create({ name: orgName });
        const user = await core.users.create({ email, passwordHash, displayName });
        await core.memberships.addMembership(org.id, user.id, "owner");
        return { userId: user.id, orgId: org.id, orgName: org.name };
      });
    } catch (err) {
      // Unique-email race (concurrent register): map to 409, else rethrow to error middleware.
      if (String((err as Error)?.message ?? "").toUpperCase().includes("UNIQUE")) {
        res.status(409).json({ error: "email already registered" });
        return;
      }
      throw err;
    }

    const token = issueToken(jwtSecret, { userId: created.userId, orgId: created.orgId, role: "owner" });
    res.status(201).json({
      token,
      user: { id: created.userId, email, displayName },
      org: { id: created.orgId, name: created.orgName },
    });
  });

  router.post("/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Json;
    const email = str(body.email)?.toLowerCase() ?? null;
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" });
      return;
    }

    const user = await core.users.findByEmail(email);
    // Always run a compare (even on miss) to avoid trivial user-enumeration timing; use a throwaway hash.
    const ok = user
      ? await bcrypt.compare(password, user.passwordHash)
      : await bcrypt.compare(password, "$2a$10$0000000000000000000000000000000000000000000000000000");
    if (!user || !ok) {
      res.status(401).json({ error: "invalid credentials" });
      return;
    }

    const membership = await findPrimaryMembership(core, user.id);
    if (!membership) {
      res.status(403).json({ error: "user has no organization membership" });
      return;
    }

    const org = await core.orgs.findById(membership.org_id);
    if (!org) {
      res.status(403).json({ error: "organization not found" });
      return;
    }

    const token = issueToken(jwtSecret, {
      userId: user.id,
      orgId: membership.org_id,
      role: membership.role,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      org: { id: org.id, name: org.name },
    });
  });

  router.get("/me", authRequired(jwtSecret), async (req: Request, res: Response) => {
    const auth = req.auth!;
    const user = await core.users.findById(auth.userId);
    const org = await core.orgs.findById(auth.orgId);
    if (!user || !org) {
      res.status(401).json({ error: "account no longer exists" });
      return;
    }
    // Re-derive role from the membership (authoritative now) rather than trusting the token blindly.
    const role = (await core.memberships.roleOf(auth.orgId, auth.userId)) ?? auth.role;
    res.json({
      user: { id: user.id, email: user.email, displayName: user.displayName },
      org: { id: org.id, name: org.name },
      role,
    });
  });

  return router;
}
