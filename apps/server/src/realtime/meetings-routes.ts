/**
 * Meetings HTTP routes (API_CONTRACT §5). All Bearer-authed; org from JWT (req.auth.orgId), never from body.
 *   POST /api/meetings           {title, companyId?, dealId?, deckId?} → {meeting, wsUrl, wsToken}
 *   GET  /api/meetings/:id        → {meeting, signals, transcript, actions}   (post-meeting review)
 *   POST /api/meetings/:id/end    → {summary?}
 *   GET  /api/meetings?page=&pageSize= → {items, total}
 *
 * POST mints a short-lived, role-bindable wsToken (ws-token.ts) and registers the live meeting↔deck/company/deal
 * binding with the RealtimeHub so the WS runtime can be materialized on first connect. The creator is recorded as
 * the meeting's presenter (I2: presenter authority is later checked by identity at the WS layer).
 */
import { Router, type Request, type Response } from "express";
import { authRequired } from "../auth/jwt.js";
import { mintWsToken } from "./ws-token.js";
import type { RealtimeHub } from "./hub.js";
import { SERVER_DEFAULT_PORT, WS_PATH } from "@meetcopilot/shared";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function createMeetingsRouter(hub: RealtimeHub, jwtSecret: string, port: number): Router {
  const router = Router();
  router.use(authRequired(jwtSecret));

  const wsBase = (process.env.WS_PUBLIC_BASE ?? `ws://localhost:${port || SERVER_DEFAULT_PORT}`).replace(/\/$/, "");

  // POST /api/meetings
  router.post("/", async (req: Request, res: Response) => {
    const { orgId, userId } = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = str(body.title);
    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }
    const companyId = str(body.companyId) ?? undefined;
    const dealId = str(body.dealId) ?? undefined;
    const deckId = str(body.deckId) ?? undefined;

    try {
      const created = await hub.store.create(orgId, { title, companyId, dealId, presenterUserId: userId });
      hub.registerMeeting(created.id, { orgId, presenterUserId: userId, companyId, dealId, deckId });
      const wsToken = mintWsToken(jwtSecret, {
        meetingId: created.id,
        orgId,
        userId,
        presenterUserId: created.presenterUserId,
      });
      res.status(201).json({
        meeting: { id: created.id, title, companyId, dealId, deckId, status: "scheduled", createdAt: created.createdAt },
        wsUrl: `${wsBase}${WS_PATH}`,
        wsToken,
      });
    } catch (err) {
      console.error("[meetings] create failed:", err);
      res.status(500).json({ error: "could not create meeting" });
    }
  });

  // GET /api/meetings  (history list)
  router.get("/", async (req: Request, res: Response) => {
    const { orgId } = req.auth!;
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 20) || 20));
    const result = await hub.store.list(orgId, page, pageSize);
    res.json(result);
  });

  // GET /api/meetings/:id  (post-meeting review)
  router.get("/:id", async (req: Request, res: Response) => {
    const { orgId } = req.auth!;
    const id = req.params.id!;
    const meeting = await hub.store.findRef(orgId, id);
    if (!meeting) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }
    const [signals, transcript] = await Promise.all([
      hub.store.signals(orgId, id),
      hub.store.transcript(orgId, id),
    ]);
    res.json({ meeting, signals, transcript, actions: [] });
  });

  // POST /api/meetings/:id/end
  router.post("/:id/end", async (req: Request, res: Response) => {
    const { orgId } = req.auth!;
    const id = req.params.id!;
    const ok = await hub.endMeeting(orgId, id);
    if (!ok) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }
    res.json({});
  });

  return router;
}
