/**
 * WP2 §2 端到端（orchestrator，注入假 deepResearcher/deepExtractor）：
 *  - 未歸類情報（uncategorized）落 `observations` 單例筆記，且每條句尾附 `[來源](url)`。
 *  - narrative 單例 pinned。
 *  - 同公司跑兩次研究 → 筆記不重複建（單例冪等）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { createResearchOrchestrator } from "./orchestrator.js";
import { createCrawlJobStore } from "./jobs.js";
import type { CrawlProvider } from "./crawler.js";
import type { CrawlExtractor } from "./extractor.js";
import type { DeepResearcher } from "./deep-research.js";
import type { DeepExtractor, DeepExtraction } from "./deep-extractor.js";

let core: CrmCore;
const ORG = "org-dn";

const stubCrawler: CrawlProvider = {
  async crawl() {
    return { url: "", pages: [], sourcesVisited: [] };
  },
  async fetchRaw() {
    return null;
  },
};
const stubExtractor: CrawlExtractor = {
  async toCompany() {
    return { company: {}, contacts: [], products: [], news: [], provenance: [] };
  },
  async toContacts() {
    return [];
  },
};

const fakeResearcher: DeepResearcher = {
  async research() {
    return {
      groundedFindings: [
        { angle: "overview", query: "q", answer: "ans", citations: [{ title: "T", url: "https://news.example/a" }] },
      ],
      sourceTexts: [{ url: "https://news.example/a", title: "T", text: "source body text long enough" }],
      citationUrls: ["https://news.example/a"],
    };
  },
};

function fakeDeepExtractor(): DeepExtractor {
  return {
    async toDeep(): Promise<DeepExtraction> {
      return {
        company: {},
        companyProvenance: [],
        news: [],
        funding: [],
        people: [],
        competitors: [],
        techStack: [],
        departments: [],
        socialLinks: [],
        narrativeZh: "這家公司是一間專注於企業服務的 B2B 廠商，近期擴大團隊並拓展海外市場。",
        uncategorized: [
          { text: "公司獲得 2025 年度創新獎", sourceUrl: "https://news.example/award" },
          { text: "與大型通路商達成策略合作", sourceUrl: "https://news.example/partner" },
        ],
      };
    },
  };
}

function makeOrchestrator() {
  return createResearchOrchestrator({
    core,
    crawler: stubCrawler,
    extractor: stubExtractor,
    jobs: createCrawlJobStore(core.db),
    deepResearcher: fakeResearcher,
    deepExtractor: fakeDeepExtractor(),
  });
}

async function runDeepOnce(companyId: string): Promise<void> {
  const orch = makeOrchestrator();
  const created = await orch.createJob({ orgId: ORG, targetType: "company", targetId: companyId, mode: "deep" });
  await orch.runJob({
    orgId: ORG,
    jobId: created.jobId,
    targetType: "company",
    targetId: companyId,
    mode: "deep",
    url: created.url,
    companyName: created.companyName,
  });
}

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "DN Seller",
    "zh-TW",
    Date.now(),
  ]);
});

afterEach(() => core.close());

describe("deep research → singleton notes (WP2)", () => {
  it("writes an observations note where every item carries a source link", async () => {
    const company = await core.companies.create(ORG, { name: "無官網公司" }); // 無 website → name-based deep
    await runDeepOnce(company.id);

    const notes = await core.notes.list(ORG, "company", company.id);
    const obs = notes.find((n) => (n.noteType as string) === "observations");
    expect(obs).toBeDefined();
    expect(obs!.body).toContain("公司獲得 2025 年度創新獎");
    expect(obs!.body).toContain("[來源](https://news.example/award)");
    expect(obs!.body).toContain("[來源](https://news.example/partner)");

    const narrative = notes.find((n) => (n.noteType as string) === "narrative");
    expect(narrative).toBeDefined();
    expect(narrative!.pinned).toBe(1);
    expect(narrative!.body).toContain("B2B");
  });

  it("is idempotent across two research runs (no duplicate singleton notes)", async () => {
    const company = await core.companies.create(ORG, { name: "重跑公司" });
    await runDeepOnce(company.id);
    await runDeepOnce(company.id);

    const notes = await core.notes.list(ORG, "company", company.id);
    expect(notes.filter((n) => (n.noteType as string) === "narrative")).toHaveLength(1);
    expect(notes.filter((n) => (n.noteType as string) === "observations")).toHaveLength(1);
  });
});
