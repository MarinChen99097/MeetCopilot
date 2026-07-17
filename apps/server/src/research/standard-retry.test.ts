/**
 * standard 路徑 MAX_TOKENS 韌性（orchestrator runStandard）：
 * 大站（MAX_CRAWL_PAGES 已放寬到 150）擷取輸出可能被 MAX_TOKENS 截斷 → toCompany throw。
 * 修法：擷取失敗時**減半頁面重試一次**；重試成功 → job done；兩次都失敗 → job failed 帶可行動訊息（指明內容過大）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createResearchOrchestrator } from "./orchestrator.js";
import { createCrawlJobStore } from "./jobs.js";
import type { CrawlJobStore } from "./jobs.js";
import type { CrawlProvider, RawCrawl } from "./crawler.js";
import type { CrawlExtractor, CompanyExtraction } from "./extractor.js";

let core: CrmCore;
const ORG = "org-sr";

/** 回固定多頁 RawCrawl 的 stub crawler（頁數足以觀察「減半」）。 */
const stubCrawler: CrawlProvider = {
  async crawl(opts): Promise<RawCrawl> {
    const pages = Array.from({ length: 8 }, (_, i) => ({
      url: `${opts.url}/p${i}`,
      title: `P${i}`,
      text: `page ${i} body text long enough to matter`,
    }));
    return { url: opts.url, finalUrl: opts.url, title: "Home", pages, sourcesVisited: pages.map((p) => p.url) };
  },
  async fetchRaw() {
    return null;
  },
};

function goodExtraction(): CompanyExtraction {
  return {
    company: { name: "Acme", description: "做 B2B 東西的公司", industry: "軟體" },
    contacts: [],
    products: [],
    news: [],
    provenance: [
      { fieldName: "description", value: "做 B2B 東西的公司", confidence: 0.6 },
      { fieldName: "industry", value: "軟體", confidence: 0.6 },
    ],
  };
}

/** MAX_TOKENS 截斷模擬：前 failTimes 次 toCompany throw，之後成功。記錄呼叫次數與各次頁數。 */
function flakyExtractor(failTimes: number): CrawlExtractor & { calls: number; pageCounts: number[] } {
  const state = {
    calls: 0,
    pageCounts: [] as number[],
    async toCompany(raw: RawCrawl): Promise<CompanyExtraction> {
      state.calls++;
      state.pageCounts.push(raw.pages.length);
      if (state.calls <= failTimes) {
        throw new Error("Gemini 生成未正常結束（finishReason=MAX_TOKENS）：輸出過長被截斷，請減少頁數或精簡輸入後再試。");
      }
      return goodExtraction();
    },
    async toContacts() {
      return [];
    },
  };
  return state;
}

function makeOrchestrator(extractor: CrawlExtractor, jobs: CrawlJobStore) {
  return createResearchOrchestrator({ core, crawler: stubCrawler, extractor, jobs });
}

async function runStandardOnce(extractor: CrawlExtractor, jobs: CrawlJobStore, companyId: string): Promise<string> {
  const orch = makeOrchestrator(extractor, jobs);
  const created = await orch.createJob({ orgId: ORG, targetType: "company", targetId: companyId, mode: "detailed" });
  await orch.runJob({
    orgId: ORG,
    jobId: created.jobId,
    targetType: "company",
    targetId: companyId,
    mode: "detailed",
    url: created.url,
    domain: created.domain,
  });
  return created.jobId;
}

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "SR Seller",
    "zh-TW",
    Date.now(),
  ]);
});

afterEach(() => core.close());

describe("standard extract MAX_TOKENS resilience (runStandard)", () => {
  it("first extract throws, halved-input retry succeeds → job done", async () => {
    const company = await core.companies.create(ORG, { name: "Acme", websiteUrl: "https://acme.example" });
    const jobs = createCrawlJobStore(core.db);
    const extractor = flakyExtractor(1); // 第一次 throw、第二次成功
    const jobId = await runStandardOnce(extractor, jobs, company.id);

    const job = await jobs.findById(ORG, jobId);
    expect(job?.status).toBe("done");
    // 兩次呼叫：第一次全量（8 頁）、第二次減半（ceil(8/2)=4 頁）。
    expect(extractor.calls).toBe(2);
    expect(extractor.pageCounts).toEqual([8, 4]);
  });

  it("both extracts throw → job failed with an actionable (content-too-large) message", async () => {
    const company = await core.companies.create(ORG, { name: "Beta", websiteUrl: "https://beta.example" });
    const jobs = createCrawlJobStore(core.db);
    const extractor = flakyExtractor(2); // 兩次都 throw
    const jobId = await runStandardOnce(extractor, jobs, company.id);

    const job = await jobs.findById(ORG, jobId);
    expect(job?.status).toBe("failed");
    expect(extractor.calls).toBe(2); // 只重試一次（不無限重試）
    expect(job?.error).toContain("內容過大");
  });
});
