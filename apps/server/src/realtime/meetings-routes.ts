/**
 * Meetings HTTP routes (API_CONTRACT §5). All Bearer-authed; org from JWT (req.auth.orgId), never from body.
 *   POST /api/meetings           {title, companyId?, dealId?, deckId?} → {meeting, wsUrl, wsToken}
 *   GET  /api/meetings/:id        → {meeting, signals, transcript, actions}   (post-meeting review)
 *   POST /api/meetings/:id/end    → {summary?}
 *   GET  /api/meetings?page=&pageSize= → {items, total}
 *   POST /api/meetings/:meetingId/signals/:signalId/writeback
 *        {targetType,targetId,field,value} → {target}   (approval-gated meeting-signal → CRM writeback, §7)
 *
 * POST mints a short-lived, role-bindable wsToken (ws-token.ts) and registers the live meeting↔deck/company/deal
 * binding with the RealtimeHub so the WS runtime can be materialized on first connect. The creator is recorded as
 * the meeting's presenter (I2: presenter authority is later checked by identity at the WS layer).
 */
import { Router, type Request, type Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { authRequired } from "../auth/jwt.js";
import { mintWsToken } from "./ws-token.js";
import type { RealtimeHub } from "./hub.js";
import { MeetingWritebackService, type WritebackInput } from "./writeback-service.js";
import { SERVER_DEFAULT_PORT, WS_PATH } from "@meetcopilot/shared";
import { draftMeetingObjective, gatherChecklistContext } from "../generation/checklist-gen.js";

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** 會議目標自由文字上限（防 payload 灌爆；HUD/prompt 都只需一句話）。 */
const OBJECTIVE_INPUT_MAX = 200;

export function createMeetingsRouter(hub: RealtimeHub, core: CrmCore, jwtSecret: string, port: number): Router {
  const router = Router();
  router.use(authRequired(jwtSecret));

  // Rate limit（契約 §6.1）：`POST /`（LLM 建會＋背景清單生成）與 `POST /draft-objective` 兩條**都在
  // index.ts 的共用 exact-path 名單裡**（`app.post("/api/meetings", jwtGuard, limit)` ＋
  // `app.post("/api/meetings/draft-objective", jwtGuard, limit)`，掛在 body parser 之前）。本路由器**不得**
  // 自建 TokenBucketRateLimiter——那會讓同一 org 的額度變成兩桶相加，且被 429 的請求仍已 parse 完整 body。

  // Approval-gated meeting-signal → CRM writeback (CRM_SCHEMA §7). Reuses hub.store for signal ownership.
  const writeback = new MeetingWritebackService(core, hub.store);

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
    // 023：本場會議目標（可留空；守低門檻——全空時行為與加這功能之前完全一致）。
    const objective = str(body.objective)?.slice(0, OBJECTIVE_INPUT_MAX) ?? undefined;
    // M5 §A: ephemeral-by-default — transcript persists only when the presenter explicitly opts in.
    const persistTranscript = body.persistTranscript === true;
    const rd = Number(body.retentionDays);
    const retentionDays = Number.isFinite(rd) && rd > 0 ? Math.min(3650, Math.floor(rd)) : undefined;

    try {
      const created = await hub.store.create(orgId, {
        title,
        companyId,
        dealId,
        deckId,
        objective,
        presenterUserId: userId,
        persistTranscript,
        retentionDays,
      });
      hub.registerMeeting(created.id, { orgId, presenterUserId: userId, companyId, dealId, deckId, objective });
      const wsToken = mintWsToken(jwtSecret, {
        meetingId: created.id,
        orgId,
        userId,
        presenterUserId: created.presenterUserId,
      });
      // 023 §6.3：待講清單**背景 fire-and-forget** 生成（不阻塞回應；hub 內自帶「每場只生成一次」與
      // failed 廣播）。缺 deckId 且缺 companyId → hub 直接 return，不生成不廣播。
      // 同步呼叫、內部全程 try/catch → **絕不讓建會請求失敗**。
      hub.startChecklistGeneration(created.id);
      res.status(201).json({
        meeting: {
          id: created.id,
          title,
          companyId,
          dealId,
          deckId,
          objective,
          status: "scheduled",
          createdAt: created.createdAt,
        },
        wsUrl: `${wsBase}${WS_PATH}`,
        wsToken,
      });
    } catch (err) {
      console.error("[meetings] create failed:", err);
      res.status(500).json({ error: "could not create meeting" });
    }
  });

  // POST /api/meetings/draft-objective  (MEETING_CHECKLIST_CONTRACT §6.1)
  // 建會表單「會議目標」自動草擬。auth（router.use）＋org scope（orgId 只取自 JWT）＋既有 rate limit
  // （index.ts 共用桶，見上方註解——**不在這裡再掛一層**）。
  // 資料不足（無 deck 也無 company）或任何 LLM 失敗 → 回 {objective:""}，**不 throw**（表單留空即可）。
  // ⚠️ 必須註冊在 `/:id` 系列參數路由**之前**，否則會被 `POST /:id/...` 之類的形狀影響可讀性。
  router.post("/draft-objective", async (req: Request, res: Response) => {
    const { orgId, userId } = req.auth!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const deckId = str(body.deckId) ?? undefined;
    const companyId = str(body.companyId) ?? undefined;
    const title = str(body.title) ?? undefined;
    if (!deckId && !companyId) {
      res.json({ objective: "" }); // 資料完全不足
      return;
    }
    try {
      // org-scoped 讀（gatherChecklistContext 每一筆都帶 orgId；跨 org 一律讀不到 → 等於資料不足）。
      const ctx = await gatherChecklistContext(core, orgId, { deckId, companyId });
      // 記帳（ADMIN_CONTRACT §3）：orgId／userId 一律取自 JWT，交給 hub 包 metered client → 落 usage_events。
      const objective = await draftMeetingObjective(hub.checklistGenDeps(orgId, userId), {
        title,
        company: ctx.company ? { name: ctx.company.name, industry: ctx.company.industry } : undefined,
        deckOutline: ctx.deckOutline,
      });
      res.json({ objective });
    } catch (err) {
      // 草擬失敗不該擋住建會流程（守低門檻）：回空字串讓使用者自己填。
      console.warn("[meetings] draft-objective failed:", (err as Error).message);
      res.json({ objective: "" });
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

  // POST /api/meetings/:meetingId/signals/:signalId/writeback  (approval-gated meeting-signal → CRM writeback)
  // Auth+org from JWT (req.auth); the signal must belong to this org+meeting; field allowlist + provenance §7.
  router.post("/:meetingId/signals/:signalId/writeback", async (req: Request, res: Response) => {
    const { orgId, userId } = req.auth!;
    const meetingId = req.params.meetingId!;
    const signalId = req.params.signalId!;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const input: WritebackInput = {
      targetType: body.targetType as WritebackInput["targetType"],
      targetId: body.targetId as string,
      field: body.field as string,
      value: body.value,
    };
    try {
      const result = await writeback.apply({ orgId, userId }, meetingId, signalId, input);
      if (!result.ok) {
        res.status(result.status).json({ error: result.error });
        return;
      }
      res.json({ target: result.target });
    } catch (err) {
      console.error("[meetings] writeback failed:", err);
      res.status(500).json({ error: "could not write back signal" });
    }
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
