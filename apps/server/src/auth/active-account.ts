/**
 * Account-suspension enforcement (ADMIN_CONTRACT §2).
 *
 * A suspended org OR a suspended user is denied at every enforcement point:
 *   - POST /api/auth/login / /google — checked before a token is issued (403 account suspended);
 *   - HTTP routers (crm/research/decks/train/meetings/org) — `activeAccountRequired` middleware, right after
 *     authRequired populates req.auth (per-request lookup of two tiny indexed tables; fine on SQLite & PG);
 *   - WS upgrade (realtime) — `realtime/ws-handshake-gate.ts` re-uses the SQL fragment + predicate exported
 *     below and folds the meeting-status check into the SAME single round-trip (kept in this standalone file
 *     so wiring it into ws-server never conflicts with the realtime build).
 *
 * status lives on orgs.status / users.status (migration 012_admin, values 'active' | 'suspended'). We read it
 * with a raw org-scoped DbPort query rather than widening the frozen Org/User domain types (ADMIN_CONTRACT §2
 * ruling: product contract unchanged; status is read directly from the DB at the admin/auth seam).
 */
import type { NextFunction, Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";

/**
 * 帳號狀態的兩個相關子查詢欄（`?` 依序＝orgId, userId）。**單一來源**：HTTP 中介層（`isAccountActive`）
 * 與 WS 握手閘（`realtime/ws-handshake-gate.ts`，把 meeting status 併進同一次 round-trip）共用同一份 SQL
 * 與同一個 fail-closed 判定，這樣「兩處各抄一份帳號閘、之後只改到一邊」在結構上就不可能發生。
 * 匯出的是**片段**而不是整句：呼叫端可以在後面接自己的欄位，params 依序接在 `[orgId, userId]` 之後。
 */
export const ACCOUNT_STATUS_COLUMNS =
  "(SELECT status FROM orgs WHERE id = ?) AS org_status, (SELECT status FROM users WHERE id = ?) AS user_status";

/** `ACCOUNT_STATUS_COLUMNS` 讀回來的兩欄（missing row → NULL）。 */
export interface AccountStatusRow {
  org_status: string | null;
  user_status: string | null;
}

/**
 * fail-closed 判定：row 缺席、任一欄 NULL（row 被刪、或跨 org），或任一方 'suspended' → 非 active。
 * 兩個 orgs/users 表都有 NOT NULL DEFAULT 'active'（012_admin），所以存在的 row 除非被明確停權否則就是 active。
 */
export function accountActiveFromRow(row: AccountStatusRow | undefined | null): boolean {
  if (!row) return false;
  if (row.org_status == null || row.org_status === "suspended") return false;
  if (row.user_status == null || row.user_status === "suspended") return false;
  return true;
}

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
  const row = await core.db.get<AccountStatusRow>(`SELECT ${ACCOUNT_STATUS_COLUMNS}`, [orgId, userId]);
  return accountActiveFromRow(row);
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
