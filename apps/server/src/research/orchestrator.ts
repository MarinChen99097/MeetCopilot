/**
 * 研究引擎編排（M1_CONTRACT §2 尾）：POST /api/research/enrich → 建 crawl_job(queued) → 背景跑
 *   crawl → extract → core.companies.upsertFromCrawl(值+provenance 同一 tx) → job(done, fieldsFilled/sources)。
 * 失敗 → job(failed, error)。整條在背景（fire-and-forget），route 立刻回 202。
 *
 * mode='deep'（全網深度研究）：對 company target，**並行**跑 DeepResearcher（Google-Search grounding 扇出 +
 *   深讀新聞/維基/公開檔）與官網 detailed 爬蟲（取產品），把「web 合成的公司側資料（每欄帶真實外部 source_url）
 *   + 官網產品」一起寫入 CRM——news→company_news、funding→company_funding_rounds、key people→contacts（各帶
 *   provenance）、competitors→research note。這是「不鎖官網」的關鍵：profile 欄位的 provenance 指向真實新聞/維基。
 *
 * ⚠️ 語意註記（seam 提醒）：upsertFromCrawl 以 **domain** 為 dedupe key，而 enrich 以 **targetId** 指名既有列。
 *   故背景流程用「既有列的 domain（缺則從 URL host 推）」呼叫 upsert，讓它命中同一列。
 */
import type { CrmCore } from "@meetcopilot/crm";
import type {
  CrawlMode,
  CrawlTargetType,
  CrawlPayload,
  ContactCrawlPayload,
  Company,
  CompanyProduct,
  NewCompanyNews,
  NewCompanyFunding,
  ProvenanceInput,
} from "@meetcopilot/shared";
import type { CrawlProvider, RawCrawl } from "./crawler.js";
import { createCrawlExtractor, type CrawlExtractor } from "./extractor.js";
import { createDeepExtractor, type DeepExtractor, type DeepExtraction } from "./deep-extractor.js";
import {
  createDeepResearcher,
  resolveRedirects,
  classifySourceType,
  type DeepResearcher,
  type DeepResearchBundle,
} from "./deep-research.js";
import type { GroundingProvider } from "./grounding.js";
import type { CrawlJobStore } from "./jobs.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { safeFetcher, type SafeFetcher } from "../import/extract.js";

/** deep 合成主管的 provenance 信心（對齊 deep-extractor 的 DEEP_CONFIDENCE）。 */
const DEEP_CONFIDENCE = 0.55;

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
  /** grounding 記帳用的 textModel（估價 key；缺則走 kind fallback 定價）。 */
  textModel?: string;
  // ── deep（全網研究）相依 ──
  /** Google-Search grounding provider（DeepResearcher 扇出用）。缺 → deep 無法跑（route 已於 gemini 未設時擋）。 */
  grounding?: GroundingProvider;
  /** SSRF 安全的單頁抽取器（深讀來源用）；預設 safeFetcher。 */
  fetcher?: SafeFetcher;
  /** 測試注入：整個 DeepResearcher（否則由 grounding+fetcher 現組）。 */
  deepResearcher?: DeepResearcher;
  /** 測試注入：DeepExtractor（否則由 metered gemini 現組）。 */
  deepExtractor?: DeepExtractor;
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

/** deep→crawler：crawler 只認 quick/detailed；deep 走 detailed 爬官網取產品。 */
function toCrawlMode(mode: CrawlMode): "quick" | "detailed" {
  return mode === "deep" ? "detailed" : mode;
}

/**
 * 整體 job 逾時（ms）：env RESEARCH_JOB_TIMEOUT_MS，預設 600000（10 分）。防背景流程掛死→永遠「研究中」。
 * 預設須寬鬆於 deep 最壞路徑：官網爬 300s 硬上限 ∥ grounding 150s（並行）→ 再序列 2 次 Gemini 抽取＋redirect 30s ≈ 450s。
 */
function jobTimeoutMs(): number {
  const raw = Number.parseInt(process.env.RESEARCH_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 600_000;
}

/** 以 Promise.race 對一項工作施加硬逾時；逾時→reject（呼叫端既有 catch 會 markFailed 記「研究逾時」）。 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`研究逾時（超過 ${Math.round(ms / 1000)} 秒）`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export interface RunResult {
  fieldsFilled: number;
  sources: string[];
}

export interface ResearchOrchestrator {
  /**
   * 建立 job（queued）並回 jobId + 解析出的爬取目標；不啟動背景流程。
   * url 可為 undefined：company 無官網時以 companyName 走全網深度研究（見 runJob 分派）。
   */
  createJob(
    req: EnrichRequest,
  ): Promise<{
    jobId: string;
    url?: string;
    domain?: string;
    companyIdForContact?: string;
    companyName?: string;
  }>;
  /** 背景執行一個 job（crawl→extract→upsert→更新 job 狀態）。呼叫端 fire-and-forget。 */
  runJob(args: {
    orgId: string;
    jobId: string;
    targetType: CrawlTargetType;
    targetId: string;
    mode: CrawlMode;
    url?: string;
    domain?: string;
    companyIdForContact?: string;
    companyName?: string;
  }): Promise<void>;
}

export function createResearchOrchestrator(deps: ResearchDeps): ResearchOrchestrator {
  const { core, crawler, extractor, jobs } = deps;

  /** 現包一個 per-job metered gemini（記 kind），idemPrefix 帶 jobId 保跨請求唯一、跨呼叫不誤去重。 */
  const meteredGeminiFor = (orgId: string, idemPrefix: string, kind: "gemini_extract") => {
    return meteredGeminiClient(deps.gemini!, deps.meter!, { orgId, kind, idemPrefix });
  };

  /** 選（site）抽取器：有 meter+gemini 就現包 metered（記 gemini_extract）；否則用預設。 */
  const extractorFor = (orgId: string, jobId: string): CrawlExtractor => {
    if (deps.meter && deps.gemini) {
      return createCrawlExtractor(meteredGeminiFor(orgId, `extract:${jobId}`, "gemini_extract"), deps.extractModel);
    }
    return extractor;
  };

  /** 選 deep 抽取器（獨立 idemPrefix，避與 site 抽取撞鍵而被誤去重）。 */
  const deepExtractorFor = (orgId: string, jobId: string): DeepExtractor => {
    if (deps.deepExtractor) return deps.deepExtractor;
    if (deps.meter && deps.gemini) {
      return createDeepExtractor(meteredGeminiFor(orgId, `deep-extract:${jobId}`, "gemini_extract"), deps.extractModel);
    }
    if (deps.gemini) return createDeepExtractor(deps.gemini, deps.extractModel);
    throw new Error("deep research unavailable: GEMINI not configured");
  };

  /** grounding 記帳包裝（best-effort：generateGrounded 無 token 回報 → 以字元數粗估，與 embedding「無則估」一致）。 */
  const meteredGrounding = (base: GroundingProvider, orgId: string, jobId: string): GroundingProvider => {
    if (!deps.meter) return base;
    const meter = deps.meter;
    let seq = 0;
    return {
      answer: (query, ctx) =>
        meter.meter(
          orgId,
          "gemini_text",
          async () => {
            const res = await base.answer(query, ctx);
            return {
              result: res,
              model: deps.textModel,
              inputTokens: Math.max(1, Math.ceil(query.length / 4)),
              outputTokens: Math.max(1, Math.ceil((res.answer?.length ?? 0) / 4)),
            };
          },
          `deep-ground:${jobId}:${seq++}`,
        ),
    };
  };

  /** 現組 DeepResearcher（grounding 加記帳包裝 + SSRF 安全 fetcher）。 */
  const deepResearcherFor = (orgId: string, jobId: string): DeepResearcher => {
    if (deps.deepResearcher) return deps.deepResearcher;
    if (!deps.grounding) throw new Error("deep research unavailable: no grounding provider");
    const grounding = meteredGrounding(deps.grounding, orgId, jobId);
    return createDeepResearcher(grounding, deps.fetcher ?? safeFetcher);
  };

  return {
    async createJob(req) {
      // 解析目標的 URL 與 domain：url 參數優先，否則從既有列取 websiteUrl/domain。
      let url = req.url;
      let domain = domainFromUrl(req.url);
      let companyIdForContact: string | undefined;
      let companyName: string | undefined;

      if (req.targetType === "company") {
        const company = await core.companies.findById(req.orgId, req.targetId);
        if (!company) throw new Error("company not found");
        url = url ?? company.websiteUrl ?? (company.domain ? `https://${company.domain}` : undefined);
        domain = company.domain ?? domain ?? domainFromUrl(url);
        companyName = company.name;
        // company 情境：無官網不 throw——改帶 companyName 往下走，以公司名稱做全網深度研究（見 runJob）。
        // 只有連公司名稱都沒有（理論上不會發生）才無從研究。
        if (!url && !companyName) {
          throw new Error("company has no website and no name to research");
        }
      } else {
        const contact = await core.contacts.findById(req.orgId, req.targetId);
        if (!contact) throw new Error("contact not found");
        companyIdForContact = contact.companyId;
        if (!url) {
          const company = await core.companies.findById(req.orgId, contact.companyId);
          url = contact.linkedinUrl ?? company?.websiteUrl ?? (company?.domain ? `https://${company.domain}` : undefined);
          domain = company?.domain ?? domainFromUrl(url);
        }
        // contact 需要一個可爬的 url（LinkedIn 或所屬公司官網）；缺則清楚報錯（本次重點是 company，contact 維持原樣）。
        if (!url) {
          throw new Error("no URL to crawl (provide url, or set the contact's LinkedIn or the company's website)");
        }
      }

      const job = await jobs.create(req.orgId, {
        targetType: req.targetType,
        targetId: req.targetId,
        targetDomain: domain,
        mode: req.mode,
        requestedBy: req.requestedBy,
      });

      return { jobId: job.id, url, domain, companyIdForContact, companyName };
    },

    async runJob(args) {
      const { orgId, jobId, targetType, mode } = args;
      try {
        await jobs.markRunning(orgId, jobId);
        // 分派：company 只要「無可爬 url」或「mode==='deep'」→ 一律走 name-based / grounding 全網深度研究（runDeep）；
        // 其餘（company quick/detailed 有 url、或 contact）→ runStandard（需 url）。
        const nameBased = targetType === "company" && !args.url; // 純以公司名稱研究（無官網）
        const useDeep = targetType === "company" && (mode === "deep" || nameBased);
        // name-based（無 url）必須有 grounding + LLM 合成才能以公司名稱研究；正式環境已設，故實際會跑。
        if (nameBased) {
          const hasResearcher = Boolean(deps.deepResearcher || deps.grounding);
          const hasExtractor = Boolean(deps.deepExtractor || deps.gemini);
          if (!hasResearcher || !hasExtractor) {
            throw new Error("此公司無網址，需啟用深度研究（GEMINI/grounding）才能以公司名稱研究");
          }
        }
        const work = useDeep ? runDeep(args) : runStandard(args);
        const result = await withTimeout(work, jobTimeoutMs());
        await jobs.markDone(orgId, jobId, result);
      } catch (err) {
        await jobs
          .markFailed(orgId, jobId, err instanceof Error ? err.message : String(err))
          .catch((e) => console.error("[research] markFailed error:", e));
      }
    },
  };

  /** 既有 quick/detailed 路徑：crawl → extract → upsert。回 {fieldsFilled, sources}。 */
  async function runStandard(args: {
    orgId: string;
    jobId: string;
    targetType: CrawlTargetType;
    targetId: string;
    mode: CrawlMode;
    url?: string;
    domain?: string;
    companyIdForContact?: string;
  }): Promise<RunResult> {
    const { orgId, jobId, targetType, mode, url, domain } = args;
    // standard 路徑必須有可爬的 url（分派已保證：只有 company 有 url 或 contact 才會進來；此為型別收斂＋防呆）。
    if (!url) throw new Error("no URL to crawl");
    const jobExtractor = extractorFor(orgId, jobId);
    const raw = await crawler.crawl({ url, mode: toCrawlMode(mode), screenshots: false });

    let fieldsFilled = 0;
    if (targetType === "company") {
      const payload: CrawlPayload = await jobExtractor.toCompany(raw);
      const upsertDomain = domain ?? payload.company.domain ?? domainFromUrl(raw.finalUrl ?? url) ?? "";
      const saved = await core.companies.upsertFromCrawl(orgId, upsertDomain, payload, { targetId: args.targetId });
      fieldsFilled = payload.provenance.length;
      // techStack / departments 子表（upsertFromCrawl 只寫 contacts/products/news，不涵蓋此二者 → 顯式寫入）。
      if (payload.techStack && payload.techStack.length > 0) {
        await core.companyChildren.bulkUpsertTech(orgId, saved.id, payload.techStack);
        fieldsFilled += payload.techStack.length;
      }
      if (payload.departments && payload.departments.length > 0) {
        await core.companyChildren.bulkUpsertDepartments(orgId, saved.id, payload.departments);
        fieldsFilled += payload.departments.length;
      }
    } else {
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
    return { fieldsFilled, sources: raw.sourcesVisited };
  }

  /**
   * deep（全網研究）路徑：DeepResearcher（web）並行官網 detailed 爬蟲（產品）→ 合成 → 寫 CRM。
   * 兩者失敗容忍（partial 可接受）。company 側欄位的 provenance 帶真實外部 source_url（不鎖官網）。
   */
  async function runDeep(args: {
    orgId: string;
    jobId: string;
    targetId: string;
    url?: string;
    domain?: string;
  }): Promise<RunResult> {
    const { orgId, jobId, targetId, url } = args;
    const company = await core.companies.findById(orgId, targetId);
    if (!company) throw new Error("company not found");
    const companyName = company.name;
    const dom = args.domain ?? company.domain ?? domainFromUrl(url);

    const deepResearcher = deepResearcherFor(orgId, jobId);
    const deepExtractor = deepExtractorFor(orgId, jobId);
    const siteExtractor = extractorFor(orgId, jobId);

    // 並行：web 研究（純靠 companyName 就能扇出，startUrl 可選）＋（若有 url）官網 detailed 爬蟲取產品。
    // 無 url → 跳過官網 crawl（siteRaw=undefined），只跑 DeepResearcher by name。各自有界、個別失敗容忍。
    const sitePromise: Promise<RawCrawl | undefined> = url
      ? crawler.crawl({ url, mode: "detailed", screenshots: false })
      : Promise.resolve(undefined);
    const [webRes, siteRes] = await Promise.allSettled([
      deepResearcher.research({ companyName, domain: dom, startUrl: url }),
      sitePromise,
    ]);
    const bundle =
      webRes.status === "fulfilled" ? webRes.value : { groundedFindings: [], sourceTexts: [], citationUrls: [] };
    const siteRaw = siteRes.status === "fulfilled" ? siteRes.value : undefined;

    // 官網產品（沿用既有 detailed 抽取，路徑不變）。
    let siteExtract: CrawlPayload | undefined;
    if (siteRaw && siteRaw.pages.length > 0) {
      try {
        siteExtract = await siteExtractor.toCompany(siteRaw);
      } catch (e) {
        console.error("[research:deep] site extract failed:", e);
      }
    }

    // web 合成（公司側欄位 + news + funding + people + competitors，各帶真實 source_url）。
    let deep: Awaited<ReturnType<DeepExtractor["toDeep"]>> | undefined;
    if (bundle.groundedFindings.length > 0 || bundle.sourceTexts.length > 0) {
      try {
        deep = await deepExtractor.toDeep({ companyName, domain: dom, bundle });
      } catch (e) {
        console.error("[research:deep] deep extract failed:", e);
      }
    }

    // provenance 的 grounding-redirect URL → 真實出處 URL（有界、可容錯）：讓徽章顯示真正的新聞/維基網域，
    // 而非中介 redirect。深讀已解析的（citationUrl→resolved）先套用免重抓；其餘實抓。並依真實 URL 重新分類 sourceType。
    let resolvedMap = new Map<string, string>();
    if (deep) {
      resolvedMap = await resolveMerged(deep, bundle);
    }

    // 合併公司欄位：web 覆蓋官網（profile 以外部來源為準）；provenance 官網在前、web 在後 → 覆蓋欄 web 勝（真實外部來源）。
    const mergedCompany: Partial<Company> = { ...(siteExtract?.company ?? {}), ...(deep?.company ?? {}) };
    const provenance: ProvenanceInput[] = [
      ...(siteExtract?.provenance ?? []),
      ...(deep?.companyProvenance ?? []),
    ];
    const products: Partial<CompanyProduct>[] = siteExtract?.products ?? [];

    const upsertDomain = dom ?? domainFromUrl(siteRaw?.finalUrl ?? url) ?? "";
    const payload: CrawlPayload = { company: mergedCompany, contacts: [], products, news: [], provenance };
    const saved = await core.companies.upsertFromCrawl(orgId, upsertDomain, payload, { targetId });
    const companyId = saved.id;

    let fieldsFilled = provenance.length;

    if (deep && deep.news.length > 0) {
      await core.companyChildren.bulkUpsertNews(orgId, companyId, deep.news as NewCompanyNews[]);
      fieldsFilled += deep.news.length;
    }
    if (deep && deep.funding.length > 0) {
      await core.companyChildren.bulkUpsertFunding(orgId, companyId, deep.funding as NewCompanyFunding[]);
      fieldsFilled += deep.funding.length;
    }
    if (deep) {
      for (const person of deep.people) {
        const fullName = person.contact.fullName;
        if (!fullName) continue;
        const prov: ProvenanceInput[] = Object.entries(person.contact)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([fieldName, v]) => ({
            fieldName,
            value: typeof v === "string" ? v : JSON.stringify(v),
            sourceUrl: person.sourceUrl,
            sourceType: person.sourceType,
            confidence: DEEP_CONFIDENCE,
          }));
        await core.contacts.upsertFromCrawl(orgId, companyId, { contact: person.contact, provenance: prov });
        fieldsFilled += prov.length;
      }
      if (deep.competitors.length > 0) {
        await writeCompetitorsNote(orgId, companyId, deep.competitors);
        fieldsFilled += 1;
      }
    }

    // techStack / departments：官網（siteExtract）＋ web（deep）合併寫入（upsertFromCrawl 不涵蓋此二子表 → 顯式寫）。
    const techStack = [...(siteExtract?.techStack ?? []), ...(deep?.techStack ?? [])];
    if (techStack.length > 0) {
      await core.companyChildren.bulkUpsertTech(orgId, companyId, techStack);
      fieldsFilled += techStack.length;
    }
    const departments = [...(siteExtract?.departments ?? []), ...(deep?.departments ?? [])];
    if (departments.length > 0) {
      await core.companyChildren.bulkUpsertDepartments(orgId, companyId, departments);
      fieldsFilled += departments.length;
    }

    // job.sources＝真正「取材自」的網址：官網爬過的頁 + 深讀的真實來源 + 解析後的真實出處（不含中介 redirect 雜訊）。
    const sources = [
      ...new Set([
        ...(siteRaw?.sourcesVisited ?? []),
        ...bundle.sourceTexts.map((s) => s.url),
        ...resolvedMap.values(),
      ]),
    ];
    return { fieldsFilled, sources };
  }

  /**
   * 把 deep 產出的 provenance/新聞/募資/主管/競品的 grounding-redirect URL 對成真實出處 URL，並依真實 URL 重分類
   * sourceType。回 redirect→real 映射（供 job.sources 收攏真實網址）。有界、可容錯（解不出就留原 URL）。
   */
  async function resolveMerged(deep: DeepExtraction, bundle: DeepResearchBundle): Promise<Map<string, string>> {
    const fetcher = deps.fetcher ?? safeFetcher;
    const used = new Set<string>();
    const add = (u?: string): void => {
      if (u) used.add(u);
    };
    deep.companyProvenance.forEach((p) => add(p.sourceUrl));
    deep.people.forEach((pr) => add(pr.sourceUrl));
    deep.competitors.forEach((c) => add(c.sourceUrl));
    deep.news.forEach((n) => add(n.url));
    deep.funding.forEach((f) => add(f.sourceUrl));

    const known = new Map<string, string>();
    for (const st of bundle.sourceTexts) if (st.citationUrl) known.set(st.citationUrl, st.url);

    const resolved = await resolveRedirects(fetcher, [...used], { known, budgetMs: 30_000 });
    const remap = (u?: string): string | undefined => (u ? resolved.get(u) ?? u : undefined);

    for (const p of deep.companyProvenance) {
      const nu = remap(p.sourceUrl);
      if (nu && nu !== p.sourceUrl) {
        p.sourceUrl = nu;
        p.sourceType = classifySourceType(nu);
      }
    }
    for (const pr of deep.people) {
      const nu = remap(pr.sourceUrl);
      if (nu && nu !== pr.sourceUrl) {
        pr.sourceUrl = nu;
        pr.sourceType = classifySourceType(nu);
      }
    }
    for (const c of deep.competitors) {
      const nu = remap(c.sourceUrl);
      if (nu && nu !== c.sourceUrl) {
        c.sourceUrl = nu;
        c.sourceType = classifySourceType(nu);
      }
    }
    for (const n of deep.news) {
      const nu = remap(n.url);
      if (nu) n.url = nu;
    }
    for (const f of deep.funding) {
      const nu = remap(f.sourceUrl);
      if (nu) f.sourceUrl = nu;
    }
    return resolved;
  }

  /** 競爭對手 → 一則 research note（列名＋來源）。以 header 去重：已存在則更新，避免重跑堆疊重複 note。 */
  async function writeCompetitorsNote(
    orgId: string,
    companyId: string,
    competitors: { name: string; sourceUrl?: string }[],
  ): Promise<void> {
    const header = "主要競爭對手（深度研究）：";
    const body =
      header +
      "\n" +
      competitors
        .map((c) => `- ${c.name}${c.sourceUrl ? `（來源：${c.sourceUrl}）` : ""}`)
        .join("\n");
    const existing = await core.notes.list(orgId, "company", companyId);
    const prior = existing.find((n) => n.body.startsWith(header));
    if (prior) await core.notes.update(orgId, prior.id, { body });
    else await core.notes.create(orgId, { entityType: "company", entityId: companyId, body, noteType: "research" });
  }
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
