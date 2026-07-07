/**
 * 成本記帳 HTTP 路由（M5_CONTRACT §B）。Bearer 認證，org 由 JWT 推導（req.auth.orgId），前端永不傳 orgId。
 *   GET /api/usage?from=&to=  → per-org rollup { from, to, totalCostUsd, byKind:[{kind,events,inputTokens,outputTokens,costUsd}] }
 *
 * from/to 為 epoch ms（含端點）。省略時預設 [now-30d, now]。非法數字回 400 {error}。
 * org-scoped：rollup 只掃 WHERE org_id = req.auth.orgId，跨租戶不可見。
 */
import { Router } from "express";
import type { Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { authRequired } from "../auth/jwt.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * DAY_MS;

/** 解析 epoch-ms 查詢參數；缺省回 fallback，非法（NaN/負）回 null（→ 400）。 */
function parseEpoch(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

export function createUsageRouter(core: CrmCore, jwtSecret: string): Router {
  const router = Router();
  router.use(authRequired(jwtSecret));

  // GET /api/usage?from=&to=
  router.get("/", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const now = Date.now();
    const to = parseEpoch(req.query.to, now);
    const from = parseEpoch(req.query.from, now - DEFAULT_WINDOW_MS);
    if (from === null || to === null) {
      res.status(400).json({ error: "from/to must be epoch-ms numbers" });
      return;
    }
    if (from > to) {
      res.status(400).json({ error: "from must be <= to" });
      return;
    }
    try {
      const rollup = await core.usage.rollup(orgId, from, to);
      res.json(rollup);
    } catch (err) {
      console.error("[usage] rollup failed:", err);
      res.status(500).json({ error: "usage rollup failed" });
    }
  });

  return router;
}
