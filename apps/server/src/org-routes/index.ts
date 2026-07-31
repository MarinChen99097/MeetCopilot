/**
 * 邀請制成員管理路由（M5_CONTRACT §D；決策 20：無計費、邀請制）。掛在 /api/org，router 內先 authRequired，
 * 故每個 handler 都有 req.auth，租戶由 req.auth.orgId 推導（前端永不傳 orgId）。
 *
 *   POST   /org/invites          {email, role}  → 201 {invite, acceptUrl}   (owner/admin)
 *   GET    /org/invites                         → Invite[]                  (owner/admin)
 *   DELETE /org/invites/:id                     → 204                       (owner/admin)
 *   POST   /org/invites/accept   {token}        → 200 {org, role}           (任何登入者)
 *   GET    /org/members                         → OrgMember[]               (owner/admin)
 *   PATCH  /org/members/:userId  {role}         → 200 {ok:true}             (owner/admin)
 *   DELETE /org/members/:userId                 → 204                       (owner/admin)
 *
 * 授權：除 accept 外，皆限 owner/admin（現場向 memberships 重新查權威角色，不盲信 JWT 內快照）。
 * owner 角色的授予/移除/降級再收斂為「僅 owner 可為之」（避免 admin 越權碰 owner）。
 * last-owner 守則由 MemberRepository 在 tx 內強制（LastOwnerError → 409）；此層只做對映。
 */
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { CrmCore, Role } from "@meetcopilot/crm";
import { LastOwnerError, MemberNotFoundError } from "@meetcopilot/crm";
import { INVITE_ROLES, type InviteRole } from "@meetcopilot/shared";
import { authRequired } from "../auth/jwt.js";
import {
  orgUsage,
  orgUsageEvents,
  orgUsageByMeeting,
  orgMonthToDateSpend,
  readMonthlyBudgetUsd,
  ORG_USAGE_GROUP_BY,
  type OrgUsageGroupBy,
} from "./usage-queries.js";

type Json = Record<string, unknown>;

const MEMBER_ROLES = ["owner", "admin", "member"] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** invite 連結指向的 web 站台來源（與 index.ts 的 CORS 白名單同源）。 */
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const DAY_MS = 24 * 60 * 60 * 1000;
const USAGE_DEFAULT_WINDOW_MS = 30 * DAY_MS;
/** 用量查詢窗上限（from/to 使用者可控；day 分組逐列拉回 → 上限防記憶體爆量）。 */
const USAGE_MAX_WINDOW_MS = 400 * DAY_MS;

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function isOneOf<T extends string>(v: unknown, allowed: readonly T[]): v is T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v);
}
/** epoch-ms 查詢參數；缺省回 fallback，非法（NaN/負）回 null（→ 400）。 */
function parseEpoch(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}
function intParam(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * `?from&to` 查詢窗解析（三條 /usage* 路由共用；規則完全相同——原本各抄一份，W4 加第三條時抽出）。
 * 合法 → {from,to}；不合法 → **已送出 400**，呼叫端直接 return（回 null 代表「別再往下做」）。
 */
function parseUsageWindow(req: Request, res: Response): { from: number; to: number } | null {
  const now = Date.now();
  const to = parseEpoch(req.query.to, now);
  const from = parseEpoch(req.query.from, now - USAGE_DEFAULT_WINDOW_MS);
  if (from === null || to === null) {
    res.status(400).json({ error: "from/to must be epoch-ms numbers" });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: "from must be <= to" });
    return null;
  }
  if (to - from > USAGE_MAX_WINDOW_MS) {
    res.status(400).json({ error: "date range too large (max ~400 days)" });
    return null;
  }
  return { from, to };
}

export function createOrgRouter(core: CrmCore, jwtSecret: string): Router {
  const router = Router();
  router.use(authRequired(jwtSecret));

  /**
   * owner/admin 授權中介：向 memberships 現查權威角色（避免 JWT 內過期快照造成越權）。
   * 通過則把權威角色掛到 res.locals.role 供後續細粒度判斷（如 owner-only 動作）。
   */
  const requireManager = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const role = await core.memberships.roleOf(req.auth!.orgId, req.auth!.userId);
    if (role !== "owner" && role !== "admin") {
      res.status(403).json({ error: "owner or admin role required" });
      return;
    }
    res.locals.role = role;
    next();
  };
  /** 包裝 async 中介，讓 rejection 進 error middleware。 */
  const mw =
    (fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      fn(req, res, next).catch(next);
    };

  // ── POST /org/invites（owner/admin 發邀請） ──
  router.post(
    "/invites",
    mw(requireManager),
    mw(async (req, res) => {
      const body = (req.body ?? {}) as Json;
      const email = str(body.email)?.toLowerCase() ?? null;
      if (!email || !EMAIL_RE.test(email)) {
        res.status(400).json({ error: "valid email is required" });
        return;
      }
      if (!isOneOf<InviteRole>(body.role, INVITE_ROLES)) {
        res.status(400).json({ error: "role must be 'admin' or 'member'" });
        return;
      }
      const expiresAt = typeof body.expiresAt === "number" ? body.expiresAt : undefined;
      const invite = await core.invites.create(req.auth!.orgId, {
        email,
        role: body.role,
        invitedBy: req.auth!.userId,
        expiresAt,
      });
      // 指向實際存在的 web 路由 [locale]/invite（localePrefix:"always"→必帶 locale，預設 zh-TW）。P0-1。
      const acceptUrl = `${WEB_ORIGIN}/zh-TW/invite?token=${encodeURIComponent(invite.token)}`;
      res.status(201).json({ invite, acceptUrl });
    }),
  );

  // ── GET /org/usage?from&to&groupBy=kind|model|day（owner/admin：本 org AI 花費明細） ──
  // W4：回應併入 `budget`（月上限 env ORG_MONTHLY_BUDGET_USD ＋當月至今花費）——env 未設則整個欄位不存在，
  // 前端不渲染預算條。budget 的窗恆為「本月」，與 from/to 無關（見 usage-queries.OrgBudget）。
  router.get(
    "/usage",
    mw(requireManager),
    mw(async (req, res) => {
      const orgId = req.auth!.orgId;
      const win = parseUsageWindow(req, res);
      if (!win) return;
      const groupByRaw = str(req.query.groupBy) ?? "day";
      if (!isOneOf<OrgUsageGroupBy>(groupByRaw, ORG_USAGE_GROUP_BY)) {
        res.status(400).json({ error: "groupBy must be one of kind|model|day" });
        return;
      }
      const usage = await orgUsage(core.db, orgId, { ...win, groupBy: groupByRaw });
      const monthlyUsd = readMonthlyBudgetUsd();
      if (monthlyUsd === null) {
        res.json(usage);
        return;
      }
      const mtd = await orgMonthToDateSpend(core.db, orgId, Date.now());
      res.json({ ...usage, budget: { monthlyUsd, ...mtd } });
    }),
  );

  // ── GET /org/usage/events?from&to&kind&limit&offset（本 org 用量明細，分頁） ──
  router.get(
    "/usage/events",
    mw(requireManager),
    mw(async (req, res) => {
      const orgId = req.auth!.orgId;
      const win = parseUsageWindow(req, res);
      if (!win) return;
      const kind = str(req.query.kind) ?? undefined;
      const limit = Math.min(200, Math.max(1, intParam(req.query.limit, 50)));
      const offset = Math.max(0, intParam(req.query.offset, 0));
      res.json(await orgUsageEvents(core.db, orgId, { ...win, kind, limit, offset }));
    }),
  );

  // ── GET /org/usage/by-meeting?from&to&limit（W4：花費最高的 N 場會議＝「單場成本」） ──
  // 只涵蓋帶 meeting_id 的會中用量；會前生成/研究不歸屬任何一場（見 usage-queries.orgUsageByMeeting）。
  router.get(
    "/usage/by-meeting",
    mw(requireManager),
    mw(async (req, res) => {
      const orgId = req.auth!.orgId;
      const win = parseUsageWindow(req, res);
      if (!win) return;
      const limit = Math.min(50, Math.max(1, intParam(req.query.limit, 10)));
      res.json(await orgUsageByMeeting(core.db, orgId, { ...win, limit }));
    }),
  );

  // ── GET /org/invites（列） ──
  router.get(
    "/invites",
    mw(requireManager),
    mw(async (req, res) => {
      res.json(await core.invites.list(req.auth!.orgId));
    }),
  );

  // ── DELETE /org/invites/:id（撤） ──
  router.delete(
    "/invites/:id",
    mw(requireManager),
    mw(async (req, res) => {
      await core.invites.delete(req.auth!.orgId, req.params.id ?? "");
      res.status(204).end();
    }),
  );

  // ── POST /org/invites/accept（任何登入者接受） ──
  // 授權僅「已登入」（authRequired）；歸屬 org 取自 invite.orgId（絕不取 req.auth.orgId），故跨 org 天然隔離。
  router.post(
    "/invites/accept",
    mw(async (req, res) => {
      const body = (req.body ?? {}) as Json;
      const token = str(body.token);
      if (!token) {
        res.status(400).json({ error: "token is required" });
        return;
      }
      const invite = await core.invites.findByToken(token);
      if (!invite) {
        res.status(404).json({ error: "invite not found" });
        return;
      }
      if (invite.acceptedAt) {
        res.status(409).json({ error: "invite already accepted" });
        return;
      }
      if (invite.expiresAt && invite.expiresAt < Date.now()) {
        res.status(400).json({ error: "invite has expired" });
        return;
      }
      const user = await core.users.findById(req.auth!.userId);
      if (!user) {
        res.status(401).json({ error: "account no longer exists" });
        return;
      }
      // email 綁定：受邀信箱必須等於接受者帳號信箱（case-insensitive）。
      if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
        res.status(403).json({ error: "invite email does not match your account" });
        return;
      }
      // 已是該 org 成員 → 不重複加入（保留邀請 pending，讓管理員可自行撤銷）。
      const existing = await core.memberships.roleOf(invite.orgId, user.id);
      if (existing) {
        res.status(409).json({ error: "you are already a member of this organization" });
        return;
      }
      const org = await core.orgs.findById(invite.orgId);
      if (!org) {
        res.status(404).json({ error: "organization no longer exists" });
        return;
      }
      // 建 membership + 標記 accepted_at 同一 tx（避免半套狀態）。
      await core.db.tx(async () => {
        await core.memberships.addMembership(invite.orgId, user.id, invite.role);
        await core.invites.accept(invite.orgId, invite.id, Date.now());
      });
      res.json({ org: { id: org.id, name: org.name }, role: invite.role });
    }),
  );

  // ── GET /org/members（列成員） ──
  router.get(
    "/members",
    mw(requireManager),
    mw(async (req, res) => {
      res.json(await core.members.list(req.auth!.orgId));
    }),
  );

  // ── PATCH /org/members/:userId（改角色） ──
  router.patch(
    "/members/:userId",
    mw(requireManager),
    mw(async (req, res) => {
      const body = (req.body ?? {}) as Json;
      if (!isOneOf<Role>(body.role, MEMBER_ROLES)) {
        res.status(400).json({ error: "role must be 'owner', 'admin', or 'member'" });
        return;
      }
      const targetUserId = req.params.userId ?? "";
      const actingRole = res.locals.role as Role;
      // owner 角色的授予/降級收斂為僅 owner 可為（admin 不得碰 owner）。
      const target = await core.members.list(req.auth!.orgId);
      const targetRole = target.find((m) => m.userId === targetUserId)?.role;
      const touchesOwner = body.role === "owner" || targetRole === "owner";
      if (touchesOwner && actingRole !== "owner") {
        res.status(403).json({ error: "only an owner can grant or change the owner role" });
        return;
      }
      try {
        await core.members.updateRole(req.auth!.orgId, targetUserId, body.role);
        res.json({ ok: true });
      } catch (err) {
        mapMemberError(res, err);
      }
    }),
  );

  // ── DELETE /org/members/:userId（移除成員） ──
  router.delete(
    "/members/:userId",
    mw(requireManager),
    mw(async (req, res) => {
      const targetUserId = req.params.userId ?? "";
      const actingRole = res.locals.role as Role;
      const members = await core.members.list(req.auth!.orgId);
      const targetRole = members.find((m) => m.userId === targetUserId)?.role;
      if (targetRole === "owner" && actingRole !== "owner") {
        res.status(403).json({ error: "only an owner can remove an owner" });
        return;
      }
      try {
        await core.members.remove(req.auth!.orgId, targetUserId);
        res.status(204).end();
      } catch (err) {
        mapMemberError(res, err);
      }
    }),
  );

  return router;
}

/** MemberRepository 例外 → HTTP：last-owner → 409、找不到 → 404、其餘 re-throw 進 error middleware。 */
function mapMemberError(res: Response, err: unknown): void {
  if (err instanceof LastOwnerError) {
    res.status(409).json({ error: err.message });
    return;
  }
  if (err instanceof MemberNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  throw err;
}
