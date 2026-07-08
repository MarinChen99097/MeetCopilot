/**
 * Auth routes — API_CONTRACT §1 (exact shapes):
 *   POST /api/auth/register {email,password,displayName,orgName}
 *        → 201 {token, user:{id,email,displayName}, org:{id,name}}   (creates org + user + owner membership)
 *   POST /api/auth/login    {email,password}
 *        → 200 {token, user:{id,email,displayName}, org:{id,name}}
 *   POST /api/auth/google   {idToken}   (feature-flagged on GOOGLE_CLIENT_ID)
 *        → 200 {token, user:{id,email,displayName}, org:{id,name}}   (find-or-create by verified Google email)
 *        Same {token,user,org} shape as login/register; verify failure → 401; not configured → 501.
 *   GET  /api/auth/me       (Bearer) → {user, org, role}
 * Errors: 400 validation, 401 bad credentials/token, 409 duplicate email, 501 google not configured —
 * all `{error:string}`. JWT payload = {userId, orgId, role}. Passwords hashed with bcryptjs.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import type { CrmCore } from "@meetcopilot/crm";
import { authRequired, issueToken } from "./jwt.js";
import { createUserWithOrg, provisionUser } from "./provision.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;

type Json = Record<string, unknown>;

/** The subset of a Google ID-token payload we rely on (google-auth-library's TokenPayload superset). */
export interface GoogleTokenPayload {
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/** Verifies a Google ID token and returns its payload. Injected so tests can stub it (no network / real key). */
export type GoogleIdTokenVerifier = (idToken: string) => Promise<GoogleTokenPayload | undefined>;

export interface AuthRouterOptions {
  /** Google OAuth client id (token audience). Empty/undefined → /google returns 501 (feature off). */
  googleClientId?: string;
  /** Override the verifier (tests). Default verifies via google-auth-library OAuth2Client. */
  verifyGoogleIdToken?: GoogleIdTokenVerifier;
}

/** Default verifier: lazy-load google-auth-library and verify the token audience against our client id. */
function defaultVerifier(clientId: string): GoogleIdTokenVerifier {
  return async (idToken: string) => {
    const { OAuth2Client } = await import("google-auth-library");
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    return ticket.getPayload();
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function createAuthRouter(core: CrmCore, jwtSecret: string, opts: AuthRouterOptions = {}): Router {
  const router = Router();
  const googleClientId = (opts.googleClientId ?? "").trim();
  const verifyGoogleIdToken = opts.verifyGoogleIdToken ?? (googleClientId ? defaultVerifier(googleClientId) : null);

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
      // Shared org+user+owner tx (also used by the Google provision flow). Same behaviour as before.
      created = await createUserWithOrg(core, { email, passwordHash, displayName, orgName });
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

    // Resolve org+role via the repo (M1_CONTRACT §1 seam-gap fix): no direct SQL in the server.
    const membership = await core.memberships.findPrimaryOrgOf(user.id);
    if (!membership) {
      res.status(403).json({ error: "user has no organization membership" });
      return;
    }

    const org = await core.orgs.findById(membership.orgId);
    if (!org) {
      res.status(403).json({ error: "organization not found" });
      return;
    }

    const token = issueToken(jwtSecret, {
      userId: user.id,
      orgId: membership.orgId,
      role: membership.role,
    });
    res.json({
      token,
      user: { id: user.id, email: user.email, displayName: user.displayName },
      org: { id: org.id, name: org.name },
    });
  });

  /**
   * POST /google {idToken} — Google Sign-In. Verifies the Google ID token (audience = our client id, the
   * SAME one EZpage uses), requires a verified email, then find-or-creates a local user+org by that email
   * (provisionUser) and issues MeetCopilot's own {userId,orgId,role} JWT. Returns the SAME shape as login.
   */
  router.post("/google", async (req: Request, res: Response) => {
    if (!verifyGoogleIdToken) {
      res.status(501).json({ error: "Google sign-in is not configured on this server" });
      return;
    }
    const body = (req.body ?? {}) as Json;
    const idToken = str(body.idToken);
    if (!idToken) {
      res.status(400).json({ error: "idToken is required" });
      return;
    }

    let payload: GoogleTokenPayload | undefined;
    try {
      payload = await verifyGoogleIdToken(idToken);
    } catch {
      res.status(401).json({ error: "invalid Google credential" });
      return;
    }

    const email = str(payload?.email)?.toLowerCase() ?? null;
    if (!payload || payload.email_verified !== true || !email) {
      res.status(401).json({ error: "Google account email is not verified" });
      return;
    }

    const provisioned = await provisionUser(core, { email, displayName: payload.name ?? null });
    const token = issueToken(jwtSecret, {
      userId: provisioned.userId,
      orgId: provisioned.orgId,
      role: provisioned.role,
    });
    res.json({
      token,
      user: { id: provisioned.userId, email: provisioned.email, displayName: provisioned.displayName },
      org: { id: provisioned.orgId, name: provisioned.orgName },
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
