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
  return { userId: decoded.userId, orgId: decoded.orgId, role: decoded.role };
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
