/**
 * 研究引擎 HTTP 路由（API_CONTRACT §3）。全部 Bearer 認證，org 由 JWT 推導（req.auth.orgId），前端永不傳 orgId。
 *   POST /api/research/enrich       {targetType,targetId,mode,url?} → 202 {jobId}（背景跑 crawl→extract→upsert）
 *   GET  /api/research/jobs/:id      → CrawlJob（org-scoped）
 *   GET  /api/research/jobs?targetId → CrawlJob[]（歷史）
 *   POST /api/research/ground        {query,companyId?,meetingId?} → {answer,citations}
 * Gemini 未設定 → 502。背景 job 失敗 → job.status=failed（GET 輪詢看得到）。
 */
import { Router } from "express";
import type { Request, Response } from "express";
import type { CrmCore } from "@meetcopilot/crm";
import type { CrawlTargetType, CrawlMode } from "@meetcopilot/shared";
import { authRequired } from "../auth/jwt.js";
import { createGeminiClient } from "../gemini.js";
import type { AppConfig } from "../config.js";
import type { Meter } from "../ops/meter.js";
import { createCrawlProvider, type CrawlProvider } from "./crawler.js";
import { createCrawlExtractor, type CrawlExtractor } from "./extractor.js";
import { createGroundingProvider, type GroundingProvider } from "./grounding.js";
import { createCrawlJobStore } from "./jobs.js";
import { createSocialFetchers } from "./social/index.js";
import {
  createResearchOrchestrator,
  createMeetingResearchQuota,
  type ResearchOrchestrator,
  type MeetingResearchQuota,
} from "./orchestrator.js";

type Json = Record<string, unknown>;

const TARGET_TYPES: CrawlTargetType[] = ["company", "contact"];
const MODES: CrawlMode[] = ["quick", "detailed", "deep", "more"];

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

/** 供測試/替換注入的可選相依（預設由 config 現場組裝）。 */
export interface ResearchRouterDeps {
  crawler?: CrawlProvider;
  extractor?: CrawlExtractor;
  grounding?: GroundingProvider;
  orchestrator?: ResearchOrchestrator;
  quota?: MeetingResearchQuota;
}

export function createResearchRouter(
  core: CrmCore,
  config: AppConfig,
  jwtSecret: string,
  deps: ResearchRouterDeps = {},
  meter?: Meter,
): Router {
  const gemini = createGeminiClient(config.gemini);
  const crawler = deps.crawler ?? createCrawlProvider();
  const extractor = deps.extractor ?? createCrawlExtractor(gemini, config.gemini.extractModel);
  const grounding = deps.grounding ?? createGroundingProvider(gemini);
  const jobs = createCrawlJobStore(core.db);
  const orchestrator =
    deps.orchestrator ??
    createResearchOrchestrator({
      core,
      crawler,
      extractor,
      jobs,
      meter,
      gemini,
      extractModel: config.gemini.extractModel,
      textModel: config.gemini.textModel,
      embedModel: config.gemini.embedModel, // WP4.1 indexer
      grounding, // deep（全網研究）的 grounding 扇出
      // WP1 社群來源層：youtube（Data API v3）＋ threads（無登入 Playwright，走 crawler.fetchRaw）。
      socialFetchers: createSocialFetchers({ youtubeApiKey: config.youtubeApiKey ?? "", crawler }),
    });
  const quota = deps.quota ?? createMeetingResearchQuota(config.researchAutoLimitPerMeeting);

  const router = Router();
  router.use(authRequired(jwtSecret));

  // POST /api/research/enrich
  router.post("/enrich", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const body = (req.body ?? {}) as Json;
    const targetType = str(body.targetType) as CrawlTargetType | null;
    const targetId = str(body.targetId);
    const mode = (str(body.mode) ?? "quick") as CrawlMode;
    const url = str(body.url) ?? undefined;

    if (!targetType || !TARGET_TYPES.includes(targetType)) {
      res.status(400).json({ error: "targetType must be 'company' or 'contact'" });
      return;
    }
    if (!targetId) {
      res.status(400).json({ error: "targetId is required" });
      return;
    }
    if (!MODES.includes(mode)) {
      res.status(400).json({ error: "mode must be 'quick', 'detailed', 'deep', or 'more'" });
      return;
    }
    // deep/more（全網研究/補缺變體）靠 grounding + LLM 合成；Gemini 未設就無法跑 → 直接擋（與 /ground 的 502 一致）。
    if ((mode === "deep" || mode === "more") && !gemini.isConfigured()) {
      res.status(502).json({ error: `${mode} research unavailable: GEMINI_API_KEY not configured` });
      return;
    }

    let created: {
      jobId: string;
      url?: string;
      domain?: string;
      companyIdForContact?: string;
      companyName?: string;
    };
    try {
      created = await orchestrator.createJob({
        orgId,
        targetType,
        targetId,
        mode,
        url,
        requestedBy: req.auth!.userId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "could not start enrichment";
      const status = /not found/i.test(msg) ? 404 : 400;
      res.status(status).json({ error: msg });
      return;
    }

    // 背景執行（fire-and-forget）；失敗寫進 job.status=failed，不拖垮進程（index.ts 有 unhandledRejection 守衛）。
    void orchestrator
      .runJob({
        orgId,
        jobId: created.jobId,
        targetType,
        targetId,
        mode,
        url: created.url,
        domain: created.domain,
        companyIdForContact: created.companyIdForContact,
        companyName: created.companyName,
        requestedBy: req.auth!.userId,
      })
      .catch((e) => console.error("[research] runJob crashed:", e));

    res.status(202).json({ jobId: created.jobId });
  });

  // POST /api/research/companies/:id/reindex — 建/更新一家公司的嵌入索引（WP4.1）。
  // 授權同 enrich：Bearer + org 隔離。非成員（跨 org 憑證）→ 該公司在其 org 下不存在 → 403（L7 攻擊者憑證驗被拒）。
  router.post("/companies/:id/reindex", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const companyId = req.params.id ?? "";
    const company = await core.companies.findById(orgId, companyId);
    if (!company) {
      res.status(403).json({ error: "forbidden: not a member of this company's organization" });
      return;
    }
    if (!gemini.isConfigured()) {
      res.status(502).json({ error: "index unavailable: GEMINI_API_KEY not configured" });
      return;
    }
    try {
      const result = await orchestrator.reindex(orgId, companyId, req.auth!.userId);
      res.json({ ok: true, chunks: result.chunks });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "reindex failed" });
    }
  });

  // GET /api/research/jobs?targetId=...  (放在 /:id 之前避免被吃掉)
  router.get("/jobs", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const targetId = str(req.query.targetId);
    if (!targetId) {
      res.status(400).json({ error: "targetId query param is required" });
      return;
    }
    const list = await jobs.listByTarget(orgId, targetId);
    res.json({ items: list, total: list.length });
  });

  // GET /api/research/jobs/:id
  router.get("/jobs/:id", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const id = req.params.id ?? "";
    const job = await jobs.findById(orgId, id);
    if (!job) {
      res.status(404).json({ error: "job not found" });
      return;
    }
    res.json(job);
  });

  // POST /api/research/ground
  router.post("/ground", async (req: Request, res: Response) => {
    const orgId = req.auth!.orgId;
    const body = (req.body ?? {}) as Json;
    const query = str(body.query);
    const companyId = str(body.companyId) ?? undefined;
    const meetingId = str(body.meetingId) ?? undefined;

    if (!query) {
      res.status(400).json({ error: "query is required" });
      return;
    }
    if (!gemini.isConfigured()) {
      res.status(502).json({ error: "grounding unavailable: GEMINI_API_KEY not configured" });
      return;
    }

    // 會中觸發（帶 meetingId）受每場上限（RESEARCH_AUTO_LIMIT_PER_MEETING）。
    if (meetingId) {
      const q = quota.tryConsume(meetingId);
      if (!q.ok) {
        res.status(429).json({ error: "per-meeting research quota exhausted" });
        return;
      }
    }

    // 可選：把 companyId 解析成公司名，讓 grounding 錨定（org-scoped，防跨租戶）。
    let companyName: string | undefined;
    if (companyId) {
      const company = await core.companies.findById(orgId, companyId);
      companyName = company?.name;
    }

    try {
      const result = await grounding.answer(query, { companyId, companyName });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : "grounding failed" });
    }
  });

  return router;
}
