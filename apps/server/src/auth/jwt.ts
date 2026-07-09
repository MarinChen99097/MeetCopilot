/**
 * JWT issue/verify + Bearer middleware.
 * Payload = { userId, orgId, role } (API_CONTRACT §1). Downstream routes read req.auth.orgId for tenant
 * isolation and NEVER trust an orgId from body/query (org隔離 by server, 前端永不傳 orgId).
 * jwtSecret is injected (not imported from config) so this module is unit-testable without env/fail-fast.
 */
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";
import type { MembershipRole } from "@meetcopilot/shared";

export interface AuthPayload {
  userId: string;
  orgId: string;
  role: MembershipRole;
  /**
   * Platform-admin flag (ADMIN_CONTRACT §1). Set at token issuance when the login email ∈
   * PLATFORM_ADMIN_EMAILS. Optional so existing (non-admin) tokens omit it entirely. `platformAdminRequired`
   * gates every /api/admin/* route on `platformAdmin === true`.
   */
  platformAdmin?: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

const TOKEN_TTL = "7d";

export function issueToken(secret: string, payload: AuthPayload): string {
  return jwt.sign(payload, secret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(secret: string, token: string): AuthPayload {
  const decoded = jwt.verify(token, secret) as Partial<AuthPayload>;
  if (!decoded.userId || !decoded.orgId || !decoded.role) {
    throw new Error("invalid token payload");
  }
  const payload: AuthPayload = { userId: decoded.userId, orgId: decoded.orgId, role: decoded.role };
  // Preserve the platform-admin flag when present (only ever true; absence ⇒ not an admin).
  if (decoded.platformAdmin === true) payload.platformAdmin = true;
  return payload;
}

/** Express middleware: require a valid Bearer token; sets req.auth or responds 401. */
export function authRequired(secret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    try {
      req.auth = verifyToken(secret, token);
      next();
    } catch {
      res.status(401).json({ error: "invalid or expired token" });
    }
  };
}

/**
 * Express middleware for /api/admin/* (ADMIN_CONTRACT §1.3, invariant A1): require a valid Bearer token AND
 * `platformAdmin === true`. A missing/invalid token → 401; a valid NON-admin token (any normal logged-in
 * user) → **403 `{error:"admin only"}`** (deliberately 403, not 404 — the contract wants an explicit deny).
 * Composes authRequired's verification so it can guard the admin router on its own.
 */
export function platformAdminRequired(secret: string) {
  const requireAuth = authRequired(secret);
  return (req: Request, res: Response, next: NextFunction): void => {
    requireAuth(req, res, () => {
      if (req.auth?.platformAdmin === true) {
        next();
        return;
      }
      res.status(403).json({ error: "admin only" });
    });
  };
}
