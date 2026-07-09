/**
 * Account-suspension enforcement (ADMIN_CONTRACT §2).
 *
 * A suspended org OR a suspended user is denied at every enforcement point:
 *   - POST /api/auth/login / /google — checked before a token is issued (403 account suspended);
 *   - HTTP routers (crm/research/decks/train/meetings/org) — `activeAccountRequired` middleware, right after
 *     authRequired populates req.auth (per-request lookup of two tiny indexed tables; fine on SQLite & PG);
 *   - WS upgrade (realtime) — `isAccountActive` is re-used by the realtime seam via import (kept in this
 *     standalone file so wiring it into ws-server never conflicts with the realtime build).
 *
 * status lives on orgs.status / users.status (migration 012_admin, values 'active' | 'suspended'). We read it
 * with a raw org-scoped DbPort query rather than widening the frozen Org/User domain types (ADMIN_CONTRACT §2
 * ruling: product contract unchanged; status is read directly from the DB at the admin/auth seam).
 */
import type { NextFunction, Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";

/**
 * True unless the org OR the user is suspended (or missing). Both tables carry a NOT NULL DEFAULT 'active'
 * status column (012_admin), so a present row is 'active' unless explicitly suspended. A missing row (deleted
 * out from under a still-valid token) is treated as inactive.
 */
export async function isAccountActive(core: CrmCore, orgId: string, userId: string): Promise<boolean> {
  // Single round-trip (this is the per-request hot path in front of every product router). Two correlated
  // scalar subqueries — valid & `?`-parameterised on both SQLite and Postgres — return the org/user status, or
  // NULL when the row is missing. fail-closed semantics are byte-for-byte identical to the previous two reads:
  // a missing row (NULL) OR a 'suspended' status on EITHER denies.
  const row = await core.db.get<{ org_status: string | null; user_status: string | null }>(
    "SELECT (SELECT status FROM orgs WHERE id = ?) AS org_status, (SELECT status FROM users WHERE id = ?) AS user_status",
    [orgId, userId],
  );
  if (!row) return false;
  if (row.org_status == null || row.org_status === "suspended") return false;
  if (row.user_status == null || row.user_status === "suspended") return false;
  return true;
}

/**
 * Express middleware: 403 `{error:"account suspended"}` when the caller's org or user is suspended. MUST run
 * after authRequired (reads req.auth). A DB error is treated as fail-closed (403) — a suspended-account check
 * that cannot run should deny, not silently allow.
 */
export function activeAccountRequired(core: CrmCore) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = req.auth;
    if (!auth) {
      // Defensive: only reachable if mounted without authRequired ahead of it.
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    try {
      if (await isAccountActive(core, auth.orgId, auth.userId)) {
        next();
        return;
      }
      res.status(403).json({ error: "account suspended" });
    } catch (err) {
      console.error("[active-account] status check failed:", err);
      res.status(403).json({ error: "account suspended" });
    }
  };
}
