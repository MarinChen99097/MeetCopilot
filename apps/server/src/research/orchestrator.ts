/**
 * 研究引擎編排（M1_CONTRACT §2 尾）：POST /api/research/enrich → 建 crawl_job(queued) → 背景跑
 *   crawl → extract → core.companies.upsertFromCrawl(值+provenance 同一 tx) → job(done, fieldsFilled/sources)。
 * 失敗 → job(failed, error)。整條在背景（fire-and-forget），route 立刻回 202。
 *
 * ⚠️ 語意註記（seam 提醒）：upsertFromCrawl 以 **domain** 為 dedupe key，而 enrich 以 **targetId** 指名既有列。
 *   故背景流程用「既有列的 domain（缺則從 URL host 推）」呼叫 upsert，讓它命中同一列。若既有列無 domain 且
 *   URL host 也無法對上，B1 的 upsert 可能新建列——此 id↔domain 落差列為風險，交 Verify 以真實站點確認。
 */
import type { CrmCore } from "@meetcopilot/crm";
import type { CrawlMode, CrawlTargetType, CrawlPayload, ContactCrawlPayload } from "@meetcopilot/shared";
import type { CrawlProvider } from "./crawler.js";
import { createCrawlExtractor, type CrawlExtractor } from "./extractor.js";
import type { CrawlJobStore } from "./jobs.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";

export interface EnrichRequest {
  orgId: string;
  targetType: CrawlTargetType;
  targetId: string;
  mode: CrawlMode;
  url?: string;
  requestedBy?: string;
}

export interface ResearchDeps {
  core: CrmCore;
  crawler: CrawlProvider;
  extractor: CrawlExtractor;
  jobs: CrawlJobStore;
  /** 計費（M5 §B，可選）：提供 meter + 基底 gemini + extractModel 時，runJob 會用 per-job metered 抽取器記 gemini_extract。 */
  meter?: Meter;
  gemini?: GeminiClient;
  extractModel?: string;
}

/** 從 URL 推 domain（去 www.）。無法解析回 undefined。 */
function domainFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
}

export interface ResearchOrchestrator {
  /** 建立 job（queued）並回 jobId + 解析出的爬取目標；不啟動背景流程。 */
  createJob(
    req: EnrichRequest,
  ): Promise<{ jobId: string; url: string; domain?: string; companyIdForContact?: string }>;
  /** 背景執行一個 job（crawl→extract→upsert→更新 job 狀態）。呼叫端 fire-and-forget。 */
  runJob(args: {
    orgId: string;
    jobId: string;
    targetType: CrawlTargetType;
    targetId: string;
    mode: CrawlMode;
    url: string;
    domain?: string;
    companyIdForContact?: string;
  }): Promise<void>;
}

export function createResearchOrchestrator(deps: ResearchDeps): ResearchOrchestrator {
  const { core, crawler, extractor, jobs } = deps;

  /** 選抽取器：有 meter + gemini 就現包 per-job metered 抽取器（記 gemini_extract）；否則用預設抽取器。 */
  const extractorFor = (orgId: string, jobId: string): CrawlExtractor => {
    if (deps.meter && deps.gemini) {
      const mg = meteredGeminiClient(deps.gemini, deps.meter, {
        orgId,
        kind: "gemini_extract",
        idemPrefix: `extract:${jobId}`,
      });
      return createCrawlExtractor(mg, deps.extractModel);
    }
    return extractor;
  };

  return {
    async createJob(req) {
      // 解析目標的 URL 與 domain：url 參數優先，否則從既有列取 websiteUrl/domain。
      let url = req.url;
      let domain = domainFromUrl(req.url);
      let companyIdForContact: string | undefined;

      if (req.targetType === "company") {
        const company = await core.companies.findById(req.orgId, req.targetId);
        if (!company) throw new Error("company not found");
        url = url ?? company.websiteUrl ?? (company.domain ? `https://${company.domain}` : undefined);
        domain = company.domain ?? domain ?? domainFromUrl(url);
      } else {
        const contact = await core.contacts.findById(req.orgId, req.targetId);
        if (!contact) throw new Error("contact not found");
        companyIdForContact = contact.companyId;
        if (!url) {
          const company = await core.companies.findById(req.orgId, contact.companyId);
          url = contact.linkedinUrl ?? company?.websiteUrl ?? (company?.domain ? `https://${company.domain}` : undefined);
          domain = company?.domain ?? domainFromUrl(url);
        }
      }

      if (!url) throw new Error("no URL to crawl (provide url, or set the target's website)");

      const job = await jobs.create(req.orgId, {
        targetType: req.targetType,
        targetId: req.targetId,
        targetDomain: domain,
        mode: req.mode,
        requestedBy: req.requestedBy,
      });

      return { jobId: job.id, url, domain, companyIdForContact };
    },

    async runJob(args) {
      const { orgId, jobId, targetType, mode, url, domain } = args;
      const jobExtractor = extractorFor(orgId, jobId);
      try {
        await jobs.markRunning(orgId, jobId);
        const raw = await crawler.crawl({ url, mode, screenshots: false });

        let fieldsFilled = 0;
        if (targetType === "company") {
          const payload: CrawlPayload = await jobExtractor.toCompany(raw);
          const upsertDomain = domain ?? payload.company.domain ?? domainFromUrl(raw.finalUrl ?? url) ?? "";
          // 指名 targetId：upsert 以 id 命中 enrich 的目標列（缺 domain 就回填），保證更新既有列、不新建重複列。
          await core.companies.upsertFromCrawl(orgId, upsertDomain, payload, { targetId: args.targetId });
          fieldsFilled = payload.provenance.length;
        } else {
          // 主管 target：抽出的第一位（best-effort，M1）寫回其公司下。
          const contacts = await jobExtractor.toContacts(raw);
          const companyId = args.companyIdForContact;
          const first = contacts[0];
          if (companyId && first) {
            const payload: ContactCrawlPayload = {
              contact: first,
              provenance: Object.entries(first)
                .filter(([, v]) => v !== undefined && v !== null && v !== "")
                .map(([fieldName, v]) => ({
                  fieldName,
                  value: typeof v === "string" ? v : JSON.stringify(v),
                  sourceUrl: raw.finalUrl ?? url,
                  confidence: 0.6,
                })),
            };
            await core.contacts.upsertFromCrawl(orgId, companyId, payload);
            fieldsFilled = payload.provenance.length;
          }
        }

        await jobs.markDone(orgId, jobId, { fieldsFilled, sources: raw.sourcesVisited });
      } catch (err) {
        await jobs
          .markFailed(orgId, jobId, err instanceof Error ? err.message : String(err))
          .catch((e) => console.error("[research] markFailed error:", e));
      }
    },
  };
}

/**
 * 會中 quick 研究的每場上限（RESEARCH_AUTO_LIMIT_PER_MEETING）。in-memory 計數，key=meetingId。
 * M1 由 /ground 端點（帶 meetingId 時）消耗；會中 quick enrich 的 meeting 觸發於 M3 接上 meetings/WS 時再串。
 */
export interface MeetingResearchQuota {
  tryConsume(meetingId: string): { ok: boolean; remaining: number };
  remaining(meetingId: string): number;
}

export function createMeetingResearchQuota(limit: number): MeetingResearchQuota {
  const used = new Map<string, number>();
  return {
    tryConsume(meetingId) {
      const n = used.get(meetingId) ?? 0;
      if (n >= limit) return { ok: false, remaining: 0 };
      used.set(meetingId, n + 1);
      return { ok: true, remaining: Math.max(0, limit - (n + 1)) };
    },
    remaining(meetingId) {
      return Math.max(0, limit - (used.get(meetingId) ?? 0));
    },
  };
}
