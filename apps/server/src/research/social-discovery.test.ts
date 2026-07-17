/**
 * WP 缺口 1（社群帳號發現）＋缺口 2（uncategorized 來源轉址還原）的單元/整合測試。
 *  - crawler.filterSocialHrefs：多頁 hrefs 合併去重、丟非四平台/非 http。
 *  - deep-extractor.toDeep：擷取器 socialLinks 機械保險（只 https＋四平台）。
 *  - orchestrator runDeep 合併優先序：官網爬到的贏、擷取器補缺（社群落庫）。
 *  - orchestrator resolveMerged：只出現在 uncategorized 的來源 URL 也進 redirect 解析集合（mock resolver）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createCrmCore } from "@meetcopilot/crm";
import type { CrmCore } from "@meetcopilot/crm";
import { filterSocialHrefs } from "./crawler.js";
import { createDeepExtractor } from "./deep-extractor.js";
import type { DeepExtraction, DeepExtractor } from "./deep-extractor.js";
import type { DeepResearchBundle } from "./deep-research.js";
import type { GeminiClient } from "../gemini.js";
import type { SafeFetcher } from "../import/extract.js";
import { createResearchOrchestrator } from "./orchestrator.js";
import { createCrawlJobStore } from "./jobs.js";
import type { CrawlProvider, RawCrawl } from "./crawler.js";
import type { CrawlExtractor } from "./extractor.js";
import type { DeepResearcher } from "./deep-research.js";

// ── (a) filterSocialHrefs：多頁 hrefs 合併去重 ─────────────────────────────
describe("filterSocialHrefs — multi-page social hrefs merge/dedup", () => {
  it("collects four-platform hrefs across pages, dedups, drops non-social/non-http", () => {
    // 首頁 hrefs（footer 社群 icon + 內部/外部雜訊）。
    const homeHrefs = [
      "https://www.facebook.com/connact",
      "https://www.youtube.com/@connact#subscribe", // #hash 去除
      "https://example.com/about", // 非四平台 → 丟
      "mailto:hi@connact.ai", // 非 http → 丟
    ];
    // 「聯絡」子頁 hrefs（含與首頁重複、以及一個新平台）。
    const contactHrefs = [
      "https://www.facebook.com/connact", // 跨頁重複 → 去重
      "https://www.instagram.com/connact",
      "https://twitter.com/connact", // 非四平台 → 丟
      "javascript:void(0)", // 非 http → 丟
      1234, // 非字串 → 丟
    ];

    // 產線行為＝逐頁 filterSocialHrefs → 併入同一 Set（跨頁去重）。
    const socialSet = new Set<string>();
    for (const s of filterSocialHrefs(homeHrefs)) socialSet.add(s);
    for (const s of filterSocialHrefs(contactHrefs)) socialSet.add(s);
    const merged = [...socialSet];

    expect(merged).toContain("https://www.facebook.com/connact");
    expect(merged).toContain("https://www.youtube.com/@connact"); // #hash 已去
    expect(merged).toContain("https://www.instagram.com/connact");
    // facebook 跨兩頁只出現一次。
    expect(merged.filter((u) => u.includes("facebook.com")).length).toBe(1);
    // 非四平台 / 非 http 全數丟棄。
    expect(merged.some((u) => u.includes("example.com"))).toBe(false);
    expect(merged.some((u) => u.includes("twitter"))).toBe(false);
    expect(merged).toHaveLength(3);
  });
});

// ── (b/c) deep-extractor socialLinks 機械保險 ────────────────────────────
function fakeGemini(extracted: Record<string, unknown>): GeminiClient {
  return {
    isConfigured: () => true,
    async generateJson<T>() {
      return extracted as unknown as T;
    },
    async generateJsonMetered<T>() {
      return { value: extracted as unknown as T, usage: { model: "fake" } };
    },
    async generateGrounded() {
      return { answer: "", citations: [] };
    },
    async embed() {
      return [];
    },
    async embedMetered() {
      return { value: [], usage: { model: "fake" } };
    },
  };
}

const bundleWithOneSource: DeepResearchBundle = {
  groundedFindings: [],
  sourceTexts: [{ url: "https://news.example/a", title: "T", text: "source body text long enough" }],
  citationUrls: ["https://news.example/a"],
};

describe("deep-extractor toDeep — socialLinks mechanical safeguard (https + four platforms only)", () => {
  it("keeps only https four-platform URLs; drops http / non-four-platform / malformed", async () => {
    const extracted = {
      company: {},
      socialLinks: {
        youtube: "https://www.youtube.com/@connact", // 保留
        facebook: "http://www.facebook.com/connact", // http → 丟
        instagram: "https://twitter.com/connact", // 非四平台 → 丟
        threads: "not a url", // 非法 → 丟
      },
    };
    const extractor = createDeepExtractor(fakeGemini(extracted));
    const out = await extractor.toDeep({ companyName: "Connact AI", bundle: bundleWithOneSource });
    expect(out.socialLinks).toEqual(["https://www.youtube.com/@connact"]);
  });

  it("returns [] when the model omits socialLinks", async () => {
    const extractor = createDeepExtractor(fakeGemini({ company: {} }));
    const out = await extractor.toDeep({ companyName: "Connact AI", bundle: bundleWithOneSource });
    expect(out.socialLinks).toEqual([]);
  });
});

// ── (b) + (2) orchestrator 整合 ─────────────────────────────────────────
let core: CrmCore;
const ORG = "org-sd";

const stubExtractor: CrawlExtractor = {
  async toCompany() {
    return { company: {}, contacts: [], products: [], news: [], provenance: [] };
  },
  async toContacts() {
    return [];
  },
};

const fakeResearcher: DeepResearcher = {
  async research(): Promise<DeepResearchBundle> {
    return {
      groundedFindings: [
        { angle: "overview", query: "q", answer: "ans", citations: [{ title: "T", url: "https://news.example/a" }] },
      ],
      sourceTexts: [{ url: "https://news.example/a", title: "T", text: "source body text long enough" }],
      citationUrls: ["https://news.example/a"],
    };
  },
};

/** 完整 DeepExtraction（可覆寫指定欄位）。 */
function deepExtraction(over: Partial<DeepExtraction>): DeepExtraction {
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
    narrativeZh: "這家公司是一間 B2B 廠商。",
    uncategorized: [],
    ...over,
  };
}

function fakeDeepExtractor(extraction: DeepExtraction): DeepExtractor {
  return { async toDeep() { return extraction; } };
}

/** identity fetcher（除非指定），供不需真實網路的整合測試。 */
function identityFetcher(): SafeFetcher {
  return {
    async extractFromUrl(url) {
      return { text: "body", finalUrl: url };
    },
    async extractFromPdf() {
      return { text: "" };
    },
  };
}

beforeEach(async () => {
  core = await createCrmCore(":memory:");
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "SD Seller",
    "zh-TW",
    Date.now(),
  ]);
});
afterEach(() => core.close());

describe("runDeep — social_links merge priority (website crawl wins, extractor fills gaps)", () => {
  it("website-crawled link beats extractor for same platform; extractor fills a missing platform", async () => {
    const company = await core.companies.create(ORG, {
      name: "Connact AI",
      websiteUrl: "https://connact.ai",
    });

    // 官網爬取回：facebook officialsite（同平台應勝過擷取器）。
    const crawlerWithSocial: CrawlProvider = {
      async crawl(opts): Promise<RawCrawl> {
        return {
          url: opts.url,
          finalUrl: opts.url,
          title: "Home",
          pages: [{ url: opts.url, title: "Home", text: "home body text long enough to matter" }],
          sourcesVisited: [opts.url],
          socialLinks: ["https://www.facebook.com/officialsite"],
        };
      },
      async fetchRaw() {
        return null;
      },
    };

    const orch = createResearchOrchestrator({
      core,
      crawler: crawlerWithSocial,
      extractor: stubExtractor,
      jobs: createCrawlJobStore(core.db),
      deepResearcher: fakeResearcher,
      // 擷取器：facebook（會輸給官網）＋ instagram（官網沒有→補上）。
      deepExtractor: fakeDeepExtractor(
        deepExtraction({
          socialLinks: ["https://www.facebook.com/from-extractor", "https://www.instagram.com/from-extractor"],
        }),
      ),
      fetcher: identityFetcher(),
    });

    const created = await orch.createJob({ orgId: ORG, targetType: "company", targetId: company.id, mode: "deep" });
    await orch.runJob({
      orgId: ORG,
      jobId: created.jobId,
      targetType: "company",
      targetId: company.id,
      mode: "deep",
      url: created.url,
      domain: created.domain,
      companyName: created.companyName,
    });

    const row = await core.db.get<{ social_links: string | null }>(
      "SELECT social_links FROM companies WHERE org_id = ? AND id = ?",
      [ORG, company.id],
    );
    expect(row?.social_links).toBeTruthy();
    const links = JSON.parse(row!.social_links!) as Record<string, string>;
    expect(links.facebook).toBe("https://www.facebook.com/officialsite"); // 官網贏
    expect(links.instagram).toBe("https://www.instagram.com/from-extractor"); // 擷取器補缺
  });
});

describe("resolveMerged — uncategorized-only source URLs enter the redirect-resolution set (Gap 2)", () => {
  it("resolves a grounding-redirect that appears ONLY in uncategorized, and rewrites the observations link", async () => {
    const REDIRECT = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AXYZ123";
    const REAL = "https://real-news.example/connact-launch";
    const company = await core.companies.create(ORG, { name: "無官網公司" }); // name-based deep

    const calls: string[] = [];
    const mockFetcher: SafeFetcher = {
      async extractFromUrl(url) {
        calls.push(url);
        return { text: "resolved body", finalUrl: url === REDIRECT ? REAL : url };
      },
      async extractFromPdf() {
        return { text: "" };
      },
    };

    const stubCrawler: CrawlProvider = {
      async crawl(): Promise<RawCrawl> {
        return { url: "", pages: [], sourcesVisited: [] };
      },
      async fetchRaw() {
        return null;
      },
    };

    const orch = createResearchOrchestrator({
      core,
      crawler: stubCrawler,
      extractor: stubExtractor,
      jobs: createCrawlJobStore(core.db),
      deepResearcher: fakeResearcher,
      deepExtractor: fakeDeepExtractor(
        deepExtraction({
          // redirect 只出現在 uncategorized（不在 provenance/news/…）。
          uncategorized: [{ text: "Connact 推出新產品", sourceUrl: REDIRECT }],
        }),
      ),
      fetcher: mockFetcher,
    });

    const created = await orch.createJob({ orgId: ORG, targetType: "company", targetId: company.id, mode: "deep" });
    await orch.runJob({
      orgId: ORG,
      jobId: created.jobId,
      targetType: "company",
      targetId: company.id,
      mode: "deep",
      url: created.url,
      companyName: created.companyName,
    });

    // 核心：uncategorized 的 redirect 被納入解析集合 → mock resolver 被以該 redirect 呼叫。
    expect(calls).toContain(REDIRECT);

    // observations 筆記的 [來源] 已還原成真實 URL（非中介 redirect）。
    const notes = await core.notes.list(ORG, "company", company.id);
    const obs = notes.find((n) => (n.noteType as string) === "observations");
    expect(obs).toBeDefined();
    expect(obs!.body).toContain(`[來源](${REAL})`);
    expect(obs!.body).not.toContain("grounding-api-redirect");
  });
});
