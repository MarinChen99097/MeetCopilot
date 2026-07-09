/**
 * Admin API router (ADMIN_CONTRACT §4) — mounted at /api/admin, **every route** behind
 * `platformAdminRequired` (invariant A1: a normal logged-in token → 403; no token → 401; admin token → 200).
 *
 * A2 (read-mostly): only the two PATCH /status routes write; everything else is read-only cross-org reporting
 * via admin-queries (raw DbPort). A3 (no secrets): responses never carry password_hash / invite token / keys.
 *
 * Field names & shapes are frozen by §4's table + v1.2 ruling: all timestamps epoch-ms numbers;
 * usage30d.byKind = {kind,costUsd}; pagination out of range → 400 {error}.
 */
import { Router } from "express";
import type { Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import { USAGE_KINDS } from "@meetcopilot/shared";
import type { UsageKind } from "@meetcopilot/shared";
import type { AppConfig } from "../config.js";
import { platformAdminRequired } from "../auth/jwt.js";
import { pricingRows, PRICING_DISCLAIMER } from "../ops/pricing.js";
import {
  adminOverview,
  adminUsage,
  adminUsageEvents,
  adminOrgs,
  adminOrgDetail,
  adminJobs,
  adminJobStats,
  dbReady,
  liveMeetingsCount,
  orgExists,
  orgMemberEmails,
  setOrgStatus,
  setUserStatus,
  userEmailById,
  type UsageGroupBy,
} from "./admin-queries.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * DAY_MS;

const USAGE_GROUP_BY: readonly UsageGroupBy[] = ["org", "kind", "model", "day"];
const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
const JOB_MODES = ["quick", "detailed", "deep"] as const;
const ACCOUNT_STATUSES = ["active", "suspended"] as const;

/** epoch-ms query param → number；缺省回 fallback；非法（NaN/負）回 null（→ 400）。 */
function parseEpoch(raw: unknown, fallback: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/** 整數分頁參數（limit/offset/days）→ number；缺省回 fallback；非法回 null（→ 400）。min/max 夾限。 */
function parseInt0(raw: unknown, fallback: number, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

export function createAdminRouter(core: CrmCore, config: AppConfig): Router {
  const router = Router();
  const db = core.db;
  const adminEmails = new Set(config.platformAdminEmails.map((e) => e.trim().toLowerCase()));

  router.use(platformAdminRequired(config.jwtSecret));

  // async handler wrapper：把 rejection 交給全域 error middleware（{error} 契約），避免 unhandledRejection。
  const h =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: (err?: unknown) => void): void => {
      fn(req, res).catch(next);
    };

  // ── #1 GET /overview ──
  router.get(
    "/overview",
    h(async (_req, res) => {
      res.json(await adminOverview(db, Date.now()));
    }),
  );

  // ── #2 GET /usage?from&to&groupBy ──
  router.get(
    "/usage",
    h(async (req, res) => {
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
      const groupByRaw = str(req.query.groupBy) ?? "day";
      if (!USAGE_GROUP_BY.includes(groupByRaw as UsageGroupBy)) {
        res.status(400).json({ error: "groupBy must be one of org|kind|model|day" });
        return;
      }
      res.json(await adminUsage(db, { from, to, groupBy: groupByRaw as UsageGroupBy }));
    }),
  );

  // ── #3 GET /usage/events ──
  router.get(
    "/usage/events",
    h(async (req, res) => {
      const now = Date.now();
      const to = parseEpoch(req.query.to, now);
      const from = parseEpoch(req.query.from, now - DEFAULT_WINDOW_MS);
      if (from === null || to === null) {
        res.status(400).json({ error: "from/to must be epoch-ms numbers" });
        return;
      }
      const limit = parseInt0(req.query.limit, 50, 1, 200);
      const offset = parseInt0(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      if (limit === null || offset === null) {
        res.status(400).json({ error: "limit (1..200) / offset (>=0) invalid" });
        return;
      }
      const kind = str(req.query.kind);
      if (kind && !(USAGE_KINDS as readonly string[]).includes(kind)) {
        res.status(400).json({ error: "kind is not a valid usage kind" });
        return;
      }
      res.json(
        await adminUsageEvents(db, { from, to, orgId: str(req.query.orgId), kind, limit, offset }),
      );
    }),
  );

  // ── #4 GET /orgs ──
  router.get(
    "/orgs",
    h(async (req, res) => {
      const status = str(req.query.status);
      if (status && !(ACCOUNT_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: "status must be active|suspended" });
        return;
      }
      res.json(await adminOrgs(db, { query: str(req.query.query), status, now: Date.now() }));
    }),
  );

  // ── #5 GET /orgs/:id ──
  router.get(
    "/orgs/:id",
    h(async (req, res) => {
      const detail = await adminOrgDetail(core, req.params.id ?? "", Date.now());
      if (!detail) {
        res.status(404).json({ error: "org not found" });
        return;
      }
      res.json(detail);
    }),
  );

  // ── #6 PATCH /orgs/:id/status ──
  router.patch(
    "/orgs/:id/status",
    h(async (req, res) => {
      const status = parseStatusBody(req);
      if (!status) {
        res.status(400).json({ error: "status must be 'active' or 'suspended'" });
        return;
      }
      const id = req.params.id ?? "";
      if (!(await orgExists(db, id))) {
        res.status(404).json({ error: "org not found" });
        return;
      }
      // 自鎖守門（§4 #6）：不得停權「含平台管理員的 org」。
      if (status === "suspended") {
        const emails = await orgMemberEmails(core, id);
        if (emails.some((e) => adminEmails.has(e.trim().toLowerCase()))) {
          res.status(400).json({ error: "cannot suspend an org containing a platform admin" });
          return;
        }
      }
      await setOrgStatus(db, id, status);
      res.json({ id, status });
    }),
  );

  // ── #6 PATCH /users/:id/status ──
  router.patch(
    "/users/:id/status",
    h(async (req, res) => {
      const status = parseStatusBody(req);
      if (!status) {
        res.status(400).json({ error: "status must be 'active' or 'suspended'" });
        return;
      }
      const id = req.params.id ?? "";
      const email = await userEmailById(core, id);
      if (email === null) {
        res.status(404).json({ error: "user not found" });
        return;
      }
      // 自鎖守門（§4 #6）：不得停權平台管理員本人。
      if (status === "suspended" && adminEmails.has(email.trim().toLowerCase())) {
        res.status(400).json({ error: "cannot suspend a platform admin" });
        return;
      }
      await setUserStatus(db, id, status);
      res.json({ id, status });
    }),
  );

  // ── #7 GET /jobs ──
  router.get(
    "/jobs",
    h(async (req, res) => {
      const now = Date.now();
      const to = parseEpoch(req.query.to, now);
      const from = parseEpoch(req.query.from, now - DEFAULT_WINDOW_MS);
      if (from === null || to === null) {
        res.status(400).json({ error: "from/to must be epoch-ms numbers" });
        return;
      }
      const limit = parseInt0(req.query.limit, 50, 1, 200);
      const offset = parseInt0(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
      if (limit === null || offset === null) {
        res.status(400).json({ error: "limit (1..200) / offset (>=0) invalid" });
        return;
      }
      const status = str(req.query.status);
      if (status && !(JOB_STATUSES as readonly string[]).includes(status)) {
        res.status(400).json({ error: "status must be queued|running|done|failed" });
        return;
      }
      const mode = str(req.query.mode);
      if (mode && !(JOB_MODES as readonly string[]).includes(mode)) {
        res.status(400).json({ error: "mode must be quick|detailed|deep" });
        return;
      }
      res.json(await adminJobs(db, { status, mode, orgId: str(req.query.orgId), from, to, limit, offset }));
    }),
  );

  // ── #8 GET /jobs/stats?days=14 ──
  router.get(
    "/jobs/stats",
    h(async (req, res) => {
      const days = parseInt0(req.query.days, 14, 1, 90);
      if (days === null) {
        res.status(400).json({ error: "days must be an integer 1..90" });
        return;
      }
      res.json(await adminJobStats(db, { days, now: Date.now() }));
    }),
  );

  // ── #9 GET /health ──
  router.get(
    "/health",
    h(async (_req, res) => {
      const driver = process.env.DB_DRIVER === "pg" ? "pg" : "sqlite";
      const ok = await dbReady(db);
      res.json({
        ready: ok,
        db: { driver, ok },
        providers: { gemini: !!config.gemini.apiKey, openai: !!config.openai.apiKey },
        liveMeetings: await liveMeetingsCount(db),
        uptimeSec: Math.round(process.uptime()),
        version: process.env.K_REVISION ?? process.env.GIT_SHA ?? "dev",
      });
    }),
  );

  // ── #10 GET /pricing ──
  router.get(
    "/pricing",
    h(async (_req, res) => {
      const pairs: { kind: UsageKind; model?: string }[] = [
        { kind: "gemini_text", model: config.gemini.textModel },
        { kind: "gemini_extract", model: config.gemini.extractModel },
        { kind: "gemini_live", model: config.gemini.liveModel },
        { kind: "embedding", model: config.gemini.embedModel },
        { kind: "openai_image", model: config.openai.imageModel },
        { kind: "asr" },
      ];
      res.json({ rows: pricingRows(pairs), disclaimer: PRICING_DISCLAIMER });
    }),
  );

  return router;
}

/** 解析 PATCH status body：{status:'active'|'suspended'}；非法回 null。 */
function parseStatusBody(req: Request): "active" | "suspended" | null {
  const raw = (req.body ?? {}) as Record<string, unknown>;
  const status = typeof raw.status === "string" ? raw.status.trim() : "";
  return status === "active" || status === "suspended" ? status : null;
}
