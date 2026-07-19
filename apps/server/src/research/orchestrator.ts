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
import { dedupeCompanyContacts, type CrmCore } from "@meetcopilot/crm";
import type {
  CrawlMode,
  CrawlTargetType,
  CrawlPayload,
  ContactCrawlPayload,
  Company,
  CompanyProduct,
  Contact,
  NewCompanyNews,
  NewCompanyFunding,
  NewSocialPost,
  NewProvenance,
  ProvenanceInput,
} from "@meetcopilot/shared";
import type { CrawlProvider, RawCrawl } from "./crawler.js";
import { createCrawlExtractor, enrichProductDetails, type CrawlExtractor, type CompanyExtraction } from "./extractor.js";
import { cleanStr, cleanUrl, type UncategorizedIntel } from "./extract-shared.js";
import {
  createDeepExtractor,
  productNameMatches,
  normalizeProductName,
  extractPersonBackground,
  type DeepExtractor,
  type DeepExtraction,
  type DeepOpportunity,
  type DeepProduct,
} from "./deep-extractor.js";
import {
  createDeepResearcher,
  resolveRedirects,
  classifySourceType,
  deepResearchRounds,
  assembleSources,
  hasCjk,
  isGroundingRedirect,
  type DeepResearcher,
  type DeepResearchBundle,
  type SourceText,
} from "./deep-research.js";
import { runDeepRounds, buildFollowUpQueries } from "./deep-rounds.js";
import { buildMoreGapQueries, decideEvidenceBoost, isEmptyValue, SOCIAL_PLATFORMS } from "./more-mode.js";
import { findPersonPhotoInHtml } from "./photo-hunt.js";
import { searchPersonPhotoCse, type CseConfig } from "./photo-cse.js";
import {
  runSocialFetch,
  socialFetchBudgetMs,
  discoverHandles,
  socialLinksJson,
  parseSocialLinksColumn,
  type SocialFetcher,
  type SocialHandles,
} from "./social/index.js";
import { buildCompanyIndex } from "./indexer.js";
import type { GroundingProvider } from "./grounding.js";
import type { CrawlJobStore } from "./jobs.js";
import type { GeminiClient } from "../gemini.js";
import type { Meter } from "../ops/meter.js";
import { meteredGeminiClient } from "../ops/metered-gemini.js";
import { safeFetcher, type SafeFetcher } from "../import/extract.js";

/** deep 合成主管的 provenance 信心（對齊 deep-extractor 的 DEEP_CONFIDENCE）。 */
const DEEP_CONFIDENCE = 0.55;

/** S1-A6：per-contact 背景補查的主管上限（背景欄空缺者，取前 N）。 */
const PERSON_ENRICH_MAX = 5;

/** 照片 v3b：每個 job 的 Google CSE 圖片查詢上限（每人至多 1 次；總量再設硬上限保護配額）。 */
const PHOTO_CSE_MAX_PER_JOB = 5;

/** S1-A7：商機訊號類型 → zh-TW 標籤（筆記顯示用）。 */
const OPPORTUNITY_SIGNAL_LABEL: Record<string, string> = {
  hiring: "徵才擴編",
  expansion: "擴張",
  funding: "募資",
  project: "專案／標案",
  partnership: "合作結盟",
  procurement: "採購",
  other: "其他",
};

/**
 * S1：筆記來源後綴（provenance）——真實出處掛 markdown 連結 `（[來源](url)）`；grounding-redirect（vertexaisearch
 * 等中介 302，非真實出處）**不掛連結、降級為純文字**「（來源待解析）」，避免把中介 redirect URL 洩漏進筆記
 * （react-markdown 渲染時更會變成可點的假來源連結）。無 URL → 空字串。純函式，供 orchestrator 與單測。
 */
export function noteSourceSuffix(sourceUrl: string | undefined): string {
  const u = cleanStr(sourceUrl);
  if (!u) return "";
  if (isGroundingRedirect(u)) return "（來源待解析）";
  return `（[來源](${u})）`;
}

/** 陣列聯集去重（case-insensitive key，保留首見原文；供 S1-A8 產品 fill-empty/union）。 */
function unionArr(a: string[] | undefined, b: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    const t = typeof x === "string" ? x.trim() : "";
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * S1-A8：外部視角產品觀點對齊官網既有產品（正規化名稱含式匹配）。命中者 **fill-empty/union** 進
 * differentiators/competitors（不覆寫既有非空值）、notableCustomers 併入 notes；**配不到→unmatched**（不建新產品列）。
 * 純函式（就地複製 siteProducts，不變異入參），供 orchestrator 與單測。
 */
export function mergeDeepProducts(
  siteProducts: Partial<CompanyProduct>[],
  deepProducts: DeepProduct[],
): { products: Partial<CompanyProduct>[]; unmatched: DeepProduct[] } {
  const products = siteProducts.map((p) => ({ ...p }));
  const unmatched: DeepProduct[] = [];
  const named = (p: Partial<CompanyProduct>): p is Partial<CompanyProduct> & { name: string } =>
    typeof p.name === "string" && p.name.trim().length > 0;
  for (const dp of deepProducts) {
    const name = typeof dp.name === "string" ? dp.name.trim() : "";
    if (!name) continue;
    const nName = normalizeProductName(name);
    // 兩段配對：先「正規化後精確相等」，避免較短的基礎名（如 "Ghost"）在 first-match 貪婪吃掉本應歸於
    // 更具體變體（"Ghost Pro"）的外部觀點；無精確命中才退回含式匹配（契約 A8 允許含式匹配）。
    const target =
      products.find((p) => named(p) && normalizeProductName(p.name) === nName) ??
      products.find((p) => named(p) && productNameMatches(p.name, name));
    if (!target) {
      unmatched.push(dp);
      continue;
    }
    if (dp.differentiators && dp.differentiators.length > 0) {
      target.differentiators = unionArr(target.differentiators, dp.differentiators);
    }
    if (dp.competitors && dp.competitors.length > 0) {
      target.competitors = unionArr(target.competitors, dp.competitors);
    }
    if (dp.notableCustomers && dp.notableCustomers.length > 0) {
      const line = `知名客戶：${dp.notableCustomers.join("、")}`;
      target.notes = target.notes && target.notes.trim() ? `${target.notes}\n${line}` : line;
    }
  }
  return { products, unmatched };
}

/** S1-A6：驗 LinkedIn URL（只接受 https + linkedin.com 網域）；否則 undefined（不回填臆造連結）。 */
function validLinkedinUrl(u: string | undefined): string | undefined {
  const t = cleanStr(u);
  if (!t) return undefined;
  try {
    const url = new URL(t);
    if (url.protocol !== "https:") return undefined;
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/** S1-A6：取第一個「非 grounding-redirect」的真實 citation URL 作 provenance 來源；全是 redirect → 退回第一個。 */
function firstCitationUrl(citations: { url: string }[]): string | undefined {
  for (const c of citations) if (c.url && !isGroundingRedirect(c.url)) return c.url;
  return citations[0]?.url;
}

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
  /** 嵌入模型 id（WP4.1 indexer 寫 embeddings.model；缺→用 gemini 預設 embed model 前先讀 config 帶入）。 */
  embedModel?: string;
  /** 社群來源 fetcher（youtube/threads；WP1）。缺→deep 不跑社群 fetch（FB/IG 仍走 grounding）。 */
  socialFetchers?: SocialFetcher[];
  /** Google CSE 圖片搜尋憑證（照片獵取 v3b 備援）；缺（或 apiKey/cx 任一空）→ CSE 途徑優雅 skip。 */
  googleCse?: CseConfig;
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

/** deep/more→crawler：crawler 只認 quick/detailed；deep/more 走 detailed 爬官網取產品。 */
function toCrawlMode(mode: CrawlMode): "quick" | "detailed" {
  return mode === "deep" || mode === "more" ? "detailed" : mode;
}

/**
 * 減半頁面（保前半、至少 1 頁）：大站（MAX_CRAWL_PAGES 已放寬到 150）standard 擷取的輸出 JSON 可能被
 * MAX_TOKENS 截斷 → toCompany throw。砍一半頁面內容再擷取，縮小待列舉的產品/欄位量以繞過截斷。
 */
function halveCrawlPages(raw: RawCrawl): RawCrawl {
  const keep = Math.max(1, Math.ceil(raw.pages.length / 2));
  return { ...raw, pages: raw.pages.slice(0, keep) };
}

/**
 * Provenance 守則（P2-8）：人工建立/確認的 company.name 不被爬蟲研究結果覆寫。
 * 判準對齊 crm/provenance-write 的 isTrusted（filled_by='human' 或 verified=1），並補上 company.create 不寫
 * provenance 的缺口——「既有 name 非空 且 無 name provenance」＝建檔時人工輸入的名稱，視為 human。
 * 只有既有 name 明確來自爬蟲（filled_by='crawler' 且未人驗）才允許重爬更新。
 * 命中保護時：從落庫 payload 移除 company.name 與其 name provenance，讓 upsertFromCrawl 保留原名（就地變異）。
 */
export function guardHumanCompanyName(
  payload: CrawlPayload,
  existingName: string | undefined,
  nameProvenance: { filledBy: string; verified: number } | undefined,
): void {
  const hasHumanName = typeof existingName === "string" && existingName.trim().length > 0;
  if (!hasHumanName) return; // 新公司（無既有名）→ 讓爬蟲填名
  const nameFromCrawler =
    nameProvenance !== undefined && nameProvenance.filledBy === "crawler" && nameProvenance.verified !== 1;
  if (nameFromCrawler) return; // 既有名本就來自爬蟲、未人驗 → 允許更新
  if ("name" in payload.company) delete payload.company.name; // human 來源 → 不覆寫
  payload.provenance = payload.provenance.filter((p) => p.fieldName !== "name");
}

/**
 * 整體 job 逾時（ms）：env RESEARCH_JOB_TIMEOUT_MS，預設 5400000（90 分）。防背景流程掛死→永遠「研究中」。
 * WP3「深與廣（30–60 分鐘級）」：官網爬 ≤30min 硬上限 ∥ 多輪 grounding ≤60min ∥ 社群 fetch ≤10min（並行）
 * → 再序列多輪 Gemini 抽取＋redirect 解析＋主管背景/照片補查。記債：預設 60→90 分，與 prod env 已設同值對齊、
 * 且須寬鬆於「grounding 整場 60 分＋序列後處理」最壞路徑。
 */
function jobTimeoutMs(): number {
  const raw = Number.parseInt(process.env.RESEARCH_JOB_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_400_000;
}

/**
 * 逐項補查用的「軟 deadline」預算（ms）：比硬 job 逾時（jobTimeoutMs）提早一段緩衝。
 * 補查（enrichProductDetails / enrichKeyPeople / 照片獵取）逐項前檢查此 deadline——
 * 若逕以 jobTimeoutMs 當軟 deadline，因外層 withTimeout(work, jobTimeoutMs()) 幾乎同時（甚至更早）啟動計時，
 * 軟 deadline 永遠追不上硬 kill → graceful 收斂形同虛設、job 直接 markFailed，已增量落庫的資料也不會被 reindex。
 * 故緩衝＝job 逾時的 1/6，鉗在 [60s, 600s]；讓補查在硬 kill 前先停止剩餘項，留時間落庫＋markDone＋reindex。
 */
function softDeadlineMs(): number {
  const hard = jobTimeoutMs();
  const buffer = Math.min(600_000, Math.max(60_000, Math.floor(hard / 6)));
  return Math.max(1, hard - buffer);
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
    /** 發起使用者歸屬（ADMIN_CONTRACT §2，可選）：回填背景抽取/grounding 記帳的 usage_events.user_id。 */
    requestedBy?: string;
  }): Promise<void>;
  /**
   * 建立/更新一家公司的嵌入索引（WP4.1）。POST /reindex 端點用；Gemini 未設 → throw（route 對映 502）。
   * org 隔離由呼叫端（route）先以 companyId 在該 org 下 findById 驗證（非成員 → company 不存在 → 403）。
   */
  reindex(orgId: string, companyId: string, requestedBy?: string): Promise<{ chunks: number }>;
}

export function createResearchOrchestrator(deps: ResearchDeps): ResearchOrchestrator {
  const { core, crawler, extractor, jobs } = deps;

  /** 現包一個 per-job metered gemini（記 kind），idemPrefix 帶 jobId 保跨請求唯一、跨呼叫不誤去重。 */
  const meteredGeminiFor = (orgId: string, idemPrefix: string, kind: "gemini_extract", userId?: string) => {
    return meteredGeminiClient(deps.gemini!, deps.meter!, { orgId, kind, idemPrefix, userId });
  };

  /** 選（site）抽取器：有 meter+gemini 就現包 metered（記 gemini_extract）；否則用預設。 */
  const extractorFor = (orgId: string, jobId: string, userId?: string): CrawlExtractor => {
    if (deps.meter && deps.gemini) {
      return createCrawlExtractor(meteredGeminiFor(orgId, `extract:${jobId}`, "gemini_extract", userId), deps.extractModel);
    }
    return extractor;
  };

  /**
   * B4：選 gemini client（per-product 二段式聚焦補抽用）。有 meter+gemini → 現包 metered（記 gemini_extract，
   * 獨立 idemPrefix `product-detail:` 避與 site/deep 抽取撞鍵）；否則裸 deps.gemini；皆無 → undefined（跳過補抽）。
   */
  const geminiFor = (orgId: string, jobId: string, userId?: string): GeminiClient | undefined => {
    if (deps.meter && deps.gemini) return meteredGeminiFor(orgId, `product-detail:${jobId}`, "gemini_extract", userId);
    return deps.gemini;
  };

  /** 選 deep 抽取器（獨立 idemPrefix，避與 site 抽取撞鍵而被誤去重）。 */
  const deepExtractorFor = (orgId: string, jobId: string, userId?: string): DeepExtractor => {
    if (deps.deepExtractor) return deps.deepExtractor;
    if (deps.meter && deps.gemini) {
      return createDeepExtractor(meteredGeminiFor(orgId, `deep-extract:${jobId}`, "gemini_extract", userId), deps.extractModel);
    }
    if (deps.gemini) return createDeepExtractor(deps.gemini, deps.extractModel);
    throw new Error("deep research unavailable: GEMINI not configured");
  };

  /** grounding 記帳包裝（best-effort：generateGrounded 無 token 回報 → 以字元數粗估，與 embedding「無則估」一致）。 */
  const meteredGrounding = (base: GroundingProvider, orgId: string, jobId: string, userId?: string): GroundingProvider => {
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
              // S1-A3：deep grounding 已升模到 extractModel → 估價 key 對齊 extractModel（缺→textModel）。
              result: res,
              model: deps.extractModel ?? deps.textModel,
              inputTokens: Math.max(1, Math.ceil(query.length / 4)),
              outputTokens: Math.max(1, Math.ceil((res.answer?.length ?? 0) / 4)),
            };
          },
          `deep-ground:${jobId}:${seq++}`,
          userId,
        ),
    };
  };

  /** 現組 DeepResearcher（grounding 加記帳包裝 + SSRF 安全 fetcher）。 */
  const deepResearcherFor = (orgId: string, jobId: string, userId?: string): DeepResearcher => {
    if (deps.deepResearcher) return deps.deepResearcher;
    if (!deps.grounding) throw new Error("deep research unavailable: no grounding provider");
    const grounding = meteredGrounding(deps.grounding, orgId, jobId, userId);
    // S1-A5：JS 渲染 fallback＝crawler.fetchRaw（SSRF 安全：host-resolver pin + page.route 逐請求攔截；見 crawler.ts）。
    // deep-research 端另加「每 job ≤8 次、並行 ≤2、單 URL 20s」限制。fetchRaw 回 null（失敗/逾時）→ 該來源丟棄照舊。
    const renderFallback = async (url: string): Promise<{ text: string; finalUrl?: string } | null> => {
      const r = await crawler.fetchRaw(url);
      return r ? { text: r.text, finalUrl: r.finalUrl } : null;
    };
    return createDeepResearcher(grounding, deps.fetcher ?? safeFetcher, {
      groundingModel: deps.extractModel, // S1-A3：deep grounding 升模
      renderFallback,
    });
  };

  /** 落庫前套「人工名稱不被爬蟲覆寫」守則：查 name 欄 provenance → guardHumanCompanyName（就地變異 payload）。 */
  async function protectHumanCompanyName(
    orgId: string,
    targetId: string,
    existingName: string | undefined,
    payload: CrawlPayload,
  ): Promise<void> {
    let nameProv: { filledBy: string; verified: number } | undefined;
    try {
      const provList = await core.provenance.listForEntity(orgId, "company", targetId);
      const p = provList.find((r) => r.fieldName === "name");
      if (p) nameProv = { filledBy: p.filledBy, verified: p.verified };
    } catch (e) {
      // provenance 查詢失敗 → 保守：視為 human（nameProv=undefined），寧可不覆寫既有名。
      console.error("[research] name-guard provenance lookup failed:", e);
    }
    guardHumanCompanyName(payload, existingName, nameProv);
  }

  /**
   * 寫兩個單例 AI 筆記（WP2 §2）：narrative（pinned，公司型態與狀況敘事）＋ observations（未歸類情報，每條附來源連結）。
   * 冪等（upsertSingletonNote：同公司同 note_type 只更新不重建）。回寫入筆數。
   */
  async function writeSingletonNotes(
    orgId: string,
    companyId: string,
    data: { narrativeZh?: string; uncategorized?: UncategorizedIntel[]; opportunities?: DeepOpportunity[] },
  ): Promise<number> {
    let written = 0;
    const narrative = cleanStr(data.narrativeZh);
    if (narrative) {
      await core.notes.upsertSingletonNote(orgId, {
        entityType: "company",
        entityId: companyId,
        noteType: "narrative",
        body: `## AI 敘事：公司型態與狀況\n\n${narrative}`,
        pinned: true,
      });
      written++;
    }
    // observations 單例筆記（冪等鍵＝note_type）：未歸類情報 ＋ S1-A7 研究商機線索**同一則**（避免兩個 observations
    // 單例互相覆寫）。每條皆句尾附 [來源](url) 作 provenance。
    const uncat = data.uncategorized ?? []; // 上游 dedupUncat 已 trim／去重／cap ≤25
    const opps = data.opportunities ?? [];
    const sections: string[] = [];
    if (uncat.length > 0) {
      const bullets = uncat
        .map((u) => `- ${u.text}${noteSourceSuffix(u.sourceUrl)}`)
        .join("\n");
      sections.push(`## 未歸類情報\n\n${bullets}`);
    }
    if (opps.length > 0) {
      const bullets = opps
        .map((o) => {
          const sig = OPPORTUNITY_SIGNAL_LABEL[o.signalType] ?? o.signalType;
          const detail = o.detail ? `：${o.detail}` : "";
          return `- **${o.title}**${detail}（訊號：${sig}）${noteSourceSuffix(o.sourceUrl)}`;
        })
        .join("\n");
      sections.push(`## 研究商機線索\n\n${bullets}`);
    }
    if (sections.length > 0) {
      await core.notes.upsertSingletonNote(orgId, {
        entityType: "company",
        entityId: companyId,
        noteType: "observations",
        body: sections.join("\n\n"),
      });
      written++;
    }
    return written;
  }

  /** 建/更新一家公司的嵌入索引（WP4.1）。Gemini 未設 → throw。idem 前綴保跨呼叫唯一。 */
  async function doReindex(orgId: string, companyId: string, idemPrefix: string, userId?: string): Promise<{ chunks: number }> {
    if (!deps.gemini || !deps.gemini.isConfigured()) {
      throw new Error("index unavailable: GEMINI_API_KEY not configured");
    }
    // 單一 metered client（記 embedding）：seq 遞增保 idem key 不撞；per-job/請求 prefix 保跨呼叫唯一。
    const client =
      deps.meter !== undefined
        ? meteredGeminiClient(deps.gemini, deps.meter, { orgId, kind: "embedding", idemPrefix, userId })
        : deps.gemini;
    const embedModel = deps.embedModel ?? "gemini-embedding-001";
    return buildCompanyIndex({ core, embed: (t) => client.embed(t), embedModel }, orgId, companyId);
  }

  /** runJob 收尾的索引（best-effort，不拋——索引失敗不該讓已完成的研究 job 變 failed）。 */
  async function reindexAfterJob(orgId: string, companyId: string, jobId: string, userId?: string): Promise<void> {
    if (!deps.gemini || !deps.gemini.isConfigured()) return; // 無 gemini → 靜默 skip
    try {
      const res = await doReindex(orgId, companyId, `index:${jobId}`, userId);
      console.log(`[research:index] company=${companyId} chunks=${res.chunks}`);
    } catch (e) {
      console.error("[research:index] post-job index failed (non-fatal):", e);
    }
  }

  return {
    async reindex(orgId, companyId, requestedBy) {
      return doReindex(orgId, companyId, `reindex:${companyId}:${Date.now()}`, requestedBy);
    },

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
        // 分派：company 只要「無可爬 url」或「mode∈{deep,more}」→ 一律走 name-based / grounding 全網深度研究（runDeep）；
        // 其餘（company quick/detailed 有 url、或 contact）→ runStandard（需 url）。more＝runDeep 補缺變體（見 runDeep）。
        const nameBased = targetType === "company" && !args.url; // 純以公司名稱研究（無官網）
        const useDeep = targetType === "company" && (mode === "deep" || mode === "more" || nameBased);
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
        // WP4.1：成功收尾後建/更新該公司嵌入索引（會中檢索消費）。best-effort，不影響 job 終態。
        const companyToIndex = targetType === "company" ? args.targetId : args.companyIdForContact;
        if (companyToIndex) await reindexAfterJob(orgId, companyToIndex, jobId, args.requestedBy);
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
    requestedBy?: string;
  }): Promise<RunResult> {
    const { orgId, jobId, targetType, mode, url, domain } = args;
    // standard 路徑必須有可爬的 url（分派已保證：只有 company 有 url 或 contact 才會進來；此為型別收斂＋防呆）。
    if (!url) throw new Error("no URL to crawl");
    const runDeadlineAt = Date.now() + softDeadlineMs(); // 記債：產品補抽逐項前檢查用（軟 deadline，早於硬 withTimeout）
    const jobExtractor = extractorFor(orgId, jobId, args.requestedBy);
    const raw = await crawler.crawl({ url, mode: toCrawlMode(mode), screenshots: false });

    let fieldsFilled = 0;
    if (targetType === "company") {
      // 容錯（對齊 deep 路徑 runDeep 的 try/catch）：大站擷取輸出可能被 MAX_TOKENS 截斷 → toCompany throw。
      // 先試全量；失敗則**減半頁面重試一次**（縮小輸出繞過截斷）；仍失敗才上拋可行動錯誤（指明內容過大），
      // 由 runJob 的 catch → markFailed。避免單一大站截斷讓整個 enrich job 失敗。
      let payload: CompanyExtraction; // 含 narrativeZh/uncategorized
      try {
        payload = await jobExtractor.toCompany(raw);
      } catch (err) {
        console.error("[research] standard extract failed, retrying with halved pages:", err);
        try {
          payload = await jobExtractor.toCompany(halveCrawlPages(raw));
        } catch (err2) {
          const detail = err2 instanceof Error ? err2.message : String(err2);
          throw new Error(
            `擷取失敗：來源內容過大，減半頁面重試後輸出仍被截斷（可能產品/頁數過多）。請改用更精簡的來源頁，或調低 MAX_CRAWL_PAGES 後再試。原因：${detail}`,
          );
        }
      }
      // B4：二段式 per-product 聚焦補抽（對有對應爬取專頁的產品，≤10；並行 ≤3；失敗容忍——不讓補抽失敗拖垮研究）。
      const gm = geminiFor(orgId, jobId, args.requestedBy);
      if (gm && payload.products && payload.products.length > 0) {
        try {
          payload.products = await enrichProductDetails(gm, deps.extractModel, payload.products, raw, runDeadlineAt);
        } catch (e) {
          console.error("[research] product-detail enrich (standard) failed:", e);
        }
      }
      // provenance 守則：人工建立/確認的公司名不被爬蟲覆寫（P2-8）。
      const existing = await core.companies.findById(orgId, args.targetId);
      await protectHumanCompanyName(orgId, args.targetId, existing?.name, payload);
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
      // WP2：單例筆記（narrative + observations）。best-effort，不因筆記失敗而讓研究失敗。
      try {
        await writeSingletonNotes(orgId, saved.id, { narrativeZh: payload.narrativeZh, uncategorized: payload.uncategorized });
      } catch (e) {
        console.error("[research] singleton notes (standard) failed:", e);
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
   * more：讀「目前 DB 值」找空欄（公司欄/產品/主管/社群平台）→ buildMoreGapQueries 產定向雙語 gap 種子（cap 12）。
   * 純函式 buildMoreGapQueries 的 IO 薄封裝（讀 products/contacts/social）。失敗容忍（回已取得的）。
   */
  async function buildMoreGapSeeds(
    orgId: string,
    companyId: string,
    company: Company,
    seedSocialUrls: string[],
  ): Promise<{ angle: string; query: string }[]> {
    const products = await core.companyProducts.list(orgId, companyId).catch(() => [] as CompanyProduct[]);
    const contactRows = await core.db
      .all<{ full_name: string | null; full_name_zh: string | null }>(
        `SELECT full_name, full_name_zh FROM contacts
           WHERE org_id = ? AND company_id = ?
             AND ((background_summary IS NULL OR background_summary = '') OR (photo_url IS NULL OR photo_url = ''))`,
        [orgId, companyId],
      )
      .catch(() => [] as { full_name: string | null; full_name_zh: string | null }[]);
    const contactsNeedingDetail = contactRows
      .map((r) => (r.full_name_zh?.trim() || r.full_name?.trim() || ""))
      .filter((s) => s.length > 0);
    const handles = discoverHandles(seedSocialUrls);
    const socialPlatformsPresent = SOCIAL_PLATFORMS.filter((p) => handles[p]);
    return buildMoreGapQueries({
      companyName: company.name,
      bilingual: hasCjk(company.name) || (company.domain ?? "").toLowerCase().endsWith(".tw"),
      company: company as unknown as Record<string, unknown>,
      products: products.map((p) => ({
        name: p.name,
        pricing: p.pricingModel ?? p.pricingNotes,
        specs: p.specs,
        model: p.model,
      })),
      contactsNeedingDetail,
      socialPlatformsPresent,
    });
  }

  /**
   * deep（全網研究）路徑：DeepResearcher（web）並行官網 detailed 爬蟲（產品）→ 合成 → 寫 CRM。
   * 兩者失敗容忍（partial 可接受）。company 側欄位的 provenance 帶真實外部 source_url（不鎖官網）。
   * mode='more' 為補缺變體（gap 種子查詢、fill-empty、佐證升信心；見內文 isMore 分支）。
   */
  async function runDeep(args: {
    orgId: string;
    jobId: string;
    targetId: string;
    mode: CrawlMode;
    url?: string;
    domain?: string;
    requestedBy?: string;
  }): Promise<RunResult> {
    const { orgId, jobId, targetId, url } = args;
    // more＝「研究更多」補缺變體：DB 空欄種子查詢、基礎角度縮為 overview+news、公司欄 fill-empty、佐證升信心。
    const isMore = args.mode === "more";
    const company = await core.companies.findById(orgId, targetId);
    if (!company) throw new Error("company not found");
    const companyName = company.name;
    const dom = args.domain ?? company.domain ?? domainFromUrl(url);
    // 整場軟 deadline（逐項補查前檢查用；早於硬 withTimeout，讓補查在 job 逾時前先自我收斂＋留時間落庫/markDone/reindex）。
    const runDeadlineAt = Date.now() + softDeadlineMs();

    const deepResearcher = deepResearcherFor(orgId, jobId, args.requestedBy);
    const deepExtractor = deepExtractorFor(orgId, jobId, args.requestedBy);
    const siteExtractor = extractorFor(orgId, jobId, args.requestedBy);

    // 社群帳號種子（WP1 §1.2）：既有 social_links 欄 + 公司 social 欄（youtube/facebook）。官網 hrefs 於爬完後再併入落庫。
    const existingSocial = await core.db.get<{ social_links: string | null }>(
      "SELECT social_links FROM companies WHERE org_id = ? AND id = ?",
      [orgId, targetId],
    );
    const seedSocialUrls = [
      ...parseSocialLinksColumn(existingSocial?.social_links),
      ...(company.socialYoutube ? [company.socialYoutube] : []),
      ...(company.socialFacebook ? [company.socialFacebook] : []),
    ];
    const socialHandles = discoverHandles(seedSocialUrls);

    // more：以「目前 DB 值」的空欄產定向雙語 gap 種子（cap 12/輪），當 follow-up round 的查詢；只發一次（第二輪跑 gap 後即停）。
    const moreGapSeeds = isMore
      ? await buildMoreGapSeeds(orgId, targetId, company, seedSocialUrls)
      : [];
    let gapEmitted = false;

    // 並行（WP1 §1.4 / WP3 §3）：多輪 web 研究 ∥ 官網 detailed 爬蟲（產品）∥ 社群 fetch（youtube/threads）。
    // 各自有界、個別失敗容忍（partial 可接受）。無 url → 跳過官網 crawl（siteRaw=undefined）。
    const sitePromise: Promise<RawCrawl | undefined> = url
      ? crawler.crawl({ url, mode: "detailed", screenshots: false })
      : Promise.resolve(undefined);
    const socialPromise: Promise<Awaited<ReturnType<typeof runSocialFetch>>> =
      deps.socialFetchers && deps.socialFetchers.length > 0
        ? runSocialFetch(
            deps.socialFetchers,
            { companyName, domain: dom, handles: socialHandles },
            { budgetMs: socialFetchBudgetMs(), log: (m) => console.log(m) },
          )
        : Promise.resolve({ sources: [], posts: [] });
    // more：基礎角度縮為 overview+news（baseAngleKeys）、關社群模板（社群缺口已由 gap 種子承載）；follow-up＝gap 種子（發一次）。
    const roundsInput = isMore
      ? { companyName, domain: dom, startUrl: url, includeSocial: false, baseAngleKeys: ["overview", "news"] }
      : { companyName, domain: dom, startUrl: url, includeSocial: true };
    const roundsPromise = runDeepRounds(deepResearcher, roundsInput, {
      rounds: deepResearchRounds(),
      buildFollowUps: isMore
        ? () => {
            if (gapEmitted) return []; // gap 種子只發一次 → 跑完該輪無新種子即停
            gapEmitted = true;
            return moreGapSeeds;
          }
        : (b) => buildFollowUpQueries(companyName, b),
      onRound: async (_round, srcs) => {
        try {
          await jobs.markProgress(orgId, jobId, srcs);
        } catch {
          /* 進度回寫失敗不致命 */
        }
      },
    });

    const [webRes, siteRes, socialRes] = await Promise.allSettled([roundsPromise, sitePromise, socialPromise]);
    const bundle: DeepResearchBundle =
      webRes.status === "fulfilled"
        ? webRes.value.bundle
        : { groundedFindings: [], sourceTexts: [], citationUrls: [] };
    const siteRaw = siteRes.status === "fulfilled" ? siteRes.value : undefined;
    const socialResult = socialRes.status === "fulfilled" ? socialRes.value : { sources: [], posts: [] };
    const socialTexts: SourceText[] = socialResult.sources;
    const socialPosts: NewSocialPost[] = socialResult.posts;
    // 社群 SourceText 併入 bundle（自動繼承 [S#]→真實 URL provenance，WP1 §1.1）。
    if (socialTexts.length > 0) bundle.sourceTexts.push(...socialTexts);

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

    // B4：先對官網既有產品做二段式聚焦補抽（用官網爬到的專頁；有對應專頁者，≤10；並行 ≤3；失敗容忍）。
    // 在 S1-A8 對齊之前——聚焦補抽後的官網產品再與外部視角 union，讓 fill-empty 有更豐富的既有值可比。
    let siteProducts: Partial<CompanyProduct>[] = siteExtract?.products ?? [];
    const gm = geminiFor(orgId, jobId, args.requestedBy);
    if (gm && siteRaw && siteProducts.length > 0) {
      try {
        // 記債：逐項前檢查 runDeadlineAt——補抽超時即停止剩餘產品（best-effort，不拖垮研究）。
        siteProducts = await enrichProductDetails(gm, deps.extractModel, siteProducts, siteRaw, runDeadlineAt);
      } catch (e) {
        console.error("[research:deep] product-detail enrich failed:", e);
      }
    }

    // S1-A8：外部視角產品觀點對齊官網既有產品（正規化名稱含式匹配；fill-empty/union；配不到→uncategorized，不建新列）。
    // 在 resolve 前做——unmatched 落入 deep.uncategorized，其來源 URL 才會一起被下面的 redirect 還原成真實出處。
    let mergedProducts: Partial<CompanyProduct>[] = siteProducts;
    if (deep) {
      const merged = mergeDeepProducts(siteProducts, deep.products ?? []);
      mergedProducts = merged.products;
      for (const up of merged.unmatched) {
        const nm = cleanStr(up.name);
        if (!nm) continue;
        const bits = [
          up.differentiators && up.differentiators.length > 0 ? `差異化：${up.differentiators.join("、")}` : "",
          up.notableCustomers && up.notableCustomers.length > 0 ? `客戶：${up.notableCustomers.join("、")}` : "",
        ].filter(Boolean);
        deep.uncategorized.push({
          text: `外部提及產品「${nm}」${bits.length > 0 ? `（${bits.join("；")}）` : ""}`,
          sourceUrl: up.sourceUrl,
        });
      }
    }

    // provenance 的 grounding-redirect URL → 真實出處 URL（有界、可容錯）：讓徽章顯示真正的新聞/維基網域，
    // 而非中介 redirect。深讀已解析的（citationUrl→resolved）先套用免重抓；其餘實抓。並依真實 URL 重新分類 sourceType。
    let resolvedMap = new Map<string, string>();
    if (deep) {
      resolvedMap = await resolveMerged(deep, bundle);
      // S1-A9：額外解析「已引用但未深讀」的 citation redirect（供 job.sources 收真實網址；不落 UI 欄位）。有界、best-effort。
      if (bundle.citationUrls.length > 0) {
        resolvedMap = await resolveRedirects(deps.fetcher ?? safeFetcher, bundle.citationUrls, {
          known: resolvedMap,
          budgetMs: 20_000,
          max: 40,
        });
      }
      // 未歸類情報 ＋ 商機線索的來源 URL 也對回真實出處（供筆記區「[來源]」連結顯示真新聞/維基網域，非中介 redirect）。
      for (const u of deep.uncategorized) {
        if (u.sourceUrl) u.sourceUrl = resolvedMap.get(u.sourceUrl) ?? u.sourceUrl;
      }
      for (const o of deep.opportunities ?? []) {
        if (o.sourceUrl) o.sourceUrl = resolvedMap.get(o.sourceUrl) ?? o.sourceUrl;
      }
    }

    // 合併公司欄位：web 覆蓋官網（profile 以外部來源為準）；provenance 官網在前、web 在後 → 覆蓋欄 web 勝（真實外部來源）。
    let mergedCompany: Partial<Company> = { ...(siteExtract?.company ?? {}), ...(deep?.company ?? {}) };
    let provenance: ProvenanceInput[] = [
      ...(siteExtract?.provenance ?? []),
      ...(deep?.companyProvenance ?? []),
    ];
    const products: Partial<CompanyProduct>[] = mergedProducts;

    // more：(2) 公司非受信任欄改 fill-empty（既有非空不覆寫）＋(3) 佐證升信心。
    //   - fill-empty：只保留「既有為空」的欄進 payload（含其 provenance），其餘不覆寫、其 provenance 也不寫（避免值/來源漂移）。
    //   - 佐證：既有非空、正規化相等、新 sourceUrl 網域 ≠ 既有 provenance 網域、且既有欄非人工/已驗證 → supersede 一筆
    //     higher-confidence provenance（保留既有值當快照、不動 verified）。
    const boostRows: NewProvenance[] = [];
    if (isMore) {
      const existingProv = await core.provenance.listForEntity(orgId, "company", targetId).catch(() => []);
      const provByField = new Map(existingProv.map((p) => [p.fieldName, p] as const));
      const kept: Partial<Company> = {};
      const filledFields = new Set<string>();
      const existingCompany = company as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(mergedCompany)) {
        if (isEmptyValue(existingCompany[k])) {
          (kept as Record<string, unknown>)[k] = v; // 既有為空 → 允許填
          filledFields.add(k);
        }
      }
      for (const p of provenance) {
        if (filledFields.has(p.fieldName)) continue; // 該欄走 fill-empty 正常寫入，不重複佐證
        const ep = provByField.get(p.fieldName);
        if (ep && (ep.filledBy === "human" || ep.verified === 1)) continue; // 不動人工/已驗證欄（避免 supersede 掉信任）
        const boost = decideEvidenceBoost({
          fieldName: p.fieldName,
          existingValue: existingCompany[p.fieldName],
          newValue: p.value,
          newSourceUrl: p.sourceUrl,
          newSourceType: p.sourceType,
          existing: ep ? { sourceUrl: ep.sourceUrl, confidence: ep.confidence, verified: ep.verified } : undefined,
        });
        if (boost) {
          boostRows.push({
            entityType: "company",
            entityId: targetId,
            fieldName: boost.fieldName,
            valueSnapshot: boost.valueSnapshot,
            filledBy: "crawler",
            sourceType: boost.sourceType ?? "web",
            sourceUrl: boost.sourceUrl,
            confidence: boost.confidence,
            verified: boost.verified,
          });
        }
      }
      mergedCompany = kept;
      provenance = provenance.filter((p) => filledFields.has(p.fieldName));
    }

    const upsertDomain = dom ?? domainFromUrl(siteRaw?.finalUrl ?? url) ?? "";
    // Task 1：deep 不再丟棄官網 contacts——把 siteExtract.contacts 也走 contacts 落庫（先 site 後 deep.people，
    // 靠 CONTACT_SPEC 的 full_name_zh fallback 鍵與 title/title_zh mergeTitle 收斂同一人）。
    const siteContacts = siteExtract?.contacts ?? [];
    const payload: CrawlPayload = { company: mergedCompany, contacts: siteContacts, products, news: [], provenance };
    // provenance 守則：人工建立/確認的公司名不被爬蟲/全網研究覆寫（P2-8）。
    await protectHumanCompanyName(orgId, targetId, companyName, payload);
    const saved = await core.companies.upsertFromCrawl(orgId, upsertDomain, payload, { targetId });
    const companyId = saved.id;

    // more：佐證升信心的 supersede provenance（值/verified 不變、confidence↑）。best-effort，不因記帳失敗而讓研究失敗。
    if (boostRows.length > 0) {
      try {
        await core.provenance.record(orgId, boostRows);
      } catch (e) {
        console.error("[research:more] evidence-boost provenance failed:", e);
      }
    }

    let fieldsFilled = payload.provenance.length;

    if (deep && deep.news.length > 0) {
      await core.companyChildren.bulkUpsertNews(orgId, companyId, deep.news as NewCompanyNews[]);
      fieldsFilled += deep.news.length;
    }
    if (deep && deep.funding.length > 0) {
      await core.companyChildren.bulkUpsertFunding(orgId, companyId, deep.funding as NewCompanyFunding[]);
      fieldsFilled += deep.funding.length;
    }
    if (deep) {
      const savedPeople: Contact[] = [];
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
        const saved = await core.contacts.upsertFromCrawl(orgId, companyId, { contact: person.contact, provenance: prov });
        savedPeople.push(saved);
        fieldsFilled += prov.length;
      }
      // S1-A6：per-contact 背景補查（背景/照片欄空缺的主管，≤5）＋照片獵取。best-effort，補查失敗不讓研究失敗。
      try {
        fieldsFilled += await enrichKeyPeople(orgId, jobId, companyId, companyName, savedPeople, runDeadlineAt, args.requestedBy);
      } catch (e) {
        console.error("[research:deep] key-people enrich failed:", e);
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

    // WP1 §1.2：社群帳號落庫（種子 + 官網 hrefs）→ companies.social_links（JSON）+ field_provenance（filledBy='crawler'）。
    // 優先序（discoverHandles＝先出現者勝、逐一過 classifySocialUrl 正規化）：既有 social_links/公司欄 →
    // 官網爬到的（所有已爬頁面 hrefs）→ **擷取器補缺**（deep.socialLinks，已過 https＋四平台機械保險）。
    // 即「官網爬到的優先、擷取器只補缺」（WP 缺口 1b）。hoist 出 try：S4 社群摘要落庫的 url 需引用此帳號連結。
    const finalHandles: SocialHandles = discoverHandles(seedSocialUrls, siteRaw?.socialLinks, deep?.socialLinks);
    try {
      const linksJson = socialLinksJson(finalHandles);
      if (linksJson) {
        await core.db.run("UPDATE companies SET social_links = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
          linksJson,
          Date.now(),
          orgId,
          companyId,
        ]);
        await core.provenance.record(orgId, [
          {
            entityType: "company",
            entityId: companyId,
            fieldName: "social_links",
            valueSnapshot: linksJson,
            filledBy: "crawler",
            sourceType: "company_website",
            sourceUrl: siteRaw?.finalUrl ?? url,
            confidence: 0.6,
            verified: 0,
          },
        ]);
      }
    } catch (e) {
      console.error("[research:deep] social_links persist failed:", e);
    }

    // Task 3：finalHandles 回饋二次社群抓取——第一輪社群 fetch 只用「種子」handle（socialHandles）；官網爬蟲/deep
    // grounding 才發現的 youtube/threads handle（finalHandles 有、種子沒有）在第一輪並未被抓。對這些「新增平台」做
    // 一次有界二次 social fetch（只跑新增平台、共用剩餘 social 預算、best-effort），結果併入 socialPosts 一起 bulkUpsert。
    // 這樣 grounding 發現的 YT 頻道才會觸發無金鑰 fallback、Threads 公開頁才會被抓。
    if (deps.socialFetchers && deps.socialFetchers.length > 0) {
      const secondPassHandles: SocialHandles = {};
      for (const p of ["youtube", "threads"] as const) {
        if (finalHandles[p] && !socialHandles[p]) secondPassHandles[p] = finalHandles[p];
      }
      const newPlatforms = Object.keys(secondPassHandles);
      if (newPlatforms.length === 0) {
        console.log("[research:deep] social second pass: none discovered");
      } else {
        // 剩餘社群預算：距軟 deadline 的剩餘時間，鉗在單次 social 預算內；不足 30s 即跳過（避免立刻 abort）。
        const remainingMs = Math.min(socialFetchBudgetMs(), Math.max(0, runDeadlineAt - Date.now()));
        if (remainingMs < 30_000) {
          console.log("[research:deep] social second pass: skipped (deadline)");
        } else {
          try {
            const second = await runSocialFetch(
              deps.socialFetchers,
              { companyName, domain: dom, handles: secondPassHandles },
              { budgetMs: remainingMs, log: (m) => console.log(m) },
            );
            if (second.posts.length > 0) socialPosts.push(...second.posts);
            console.log(`[research:deep] social second pass: ${newPlatforms.join(", ")}`);
          } catch (e) {
            console.error("[research:deep] social second pass failed:", e);
          }
        }
      }
    }

    // S4：FB/IG 動態摘要（deep.socialSummaries）→ NewSocialPost。url 優先取該平台帳號連結（finalHandles 有），
    // 否則取真實 citation（cleanUrl）；publishedAt 留空。每平台至多一筆（extractor 已去重；bulkUpsert 自然鍵
    // platform+url 再冪等）。併入 socialPosts 一起 bulkUpsert。
    const summaryPosts: NewSocialPost[] = [];
    const summaryKeys: { platform: "facebook" | "instagram"; title: string }[] = [];
    for (const s of deep?.socialSummaries ?? []) {
      const content = cleanStr(s.summaryZh);
      if (!content) continue;
      const title = s.platform === "facebook" ? "Facebook 動態摘要（AI 整理）" : "Instagram 動態摘要（AI 整理）";
      const linkUrl = finalHandles[s.platform] ?? cleanUrl(s.sourceUrl);
      const post: NewSocialPost = { platform: s.platform, title, content };
      if (linkUrl) post.url = linkUrl;
      summaryPosts.push(post);
      summaryKeys.push({ platform: s.platform, title });
    }

    // 社群結構化貼文落庫（company_social_posts；自然鍵 [platform,url]，重抓更新不重複）。best-effort。
    const allSocialPosts = summaryPosts.length > 0 ? [...socialPosts, ...summaryPosts] : socialPosts;
    if (allSocialPosts.length > 0) {
      try {
        // S4 冪等補強：AI 摘要貼文的自然鍵 [platform,url] 在 url 為 null（無帳號連結亦無 citation）或跨輪
        // 變動（citation ↔ 帳號連結）時無法去重 → 每輪都 INSERT 新列、累積重複「動態摘要（AI 整理）」列。
        // 故落庫前先以「platform + 固定 title」刪同平台既有 AI 摘要列再 upsert，保證每平台至多一筆、重研究冪等。
        // 真實 fetcher 貼文（youtube/threads…）title 不同，不受此刪除影響。
        for (const k of summaryKeys) {
          await core.db.run(
            "DELETE FROM company_social_posts WHERE org_id = ? AND company_id = ? AND platform = ? AND title = ?",
            [orgId, companyId, k.platform, k.title],
          );
        }
        await core.companySocial.bulkUpsert(orgId, companyId, allSocialPosts);
        fieldsFilled += allSocialPosts.length;
      } catch (e) {
        console.error("[research:deep] social posts persist failed:", e);
      }
    }

    // Task 1 / more (4)：落庫完成後收斂同一人的重複主管列（按 full_name_zh 分組；survivor＝human-verified 或最舊）。
    // 深度/more 皆跑；刪 stale profile_cards/embeddings，runJob 收尾的 reindex 會以合併後資料重建。best-effort。
    // 軟 deadline 守衛（比照 enrichKeyPeople 記債）：dedupe 是多步 delete+rebuild（刪 stale 卡→改欄→靠收尾 reindex
    // 重建）。若逼近硬 kill 才起跑，可能被 withTimeout 硬 timeout 打斷成半套（stale 卡已刪、reindex 未跑）。
    // 故超過 runDeadlineAt 即 log 並跳過此尾段，讓 job 留餘裕 markDone＋reindex；未收斂的重複列下輪研究會再收斂。
    if (Date.now() > runDeadlineAt) {
      console.warn(
        "[research:deep] dedupe tail deadline exceeded — skipping dedupeCompanyContacts (next round will converge)",
      );
    } else {
      try {
        const dd = await dedupeCompanyContacts(core.db, orgId, companyId);
        if (dd.groupsMerged > 0 || dd.groupsSkipped > 0) {
          console.log(
            `[research:deep] dedupe contacts: merged=${dd.groupsMerged} removed=${dd.contactsRemoved} skipped=${dd.groupsSkipped}`,
          );
        }
      } catch (e) {
        console.error("[research:deep] dedupeCompanyContacts failed:", e);
      }
    }

    // WP2 §2：單例 AI 筆記（narrative pinned + observations 每條附來源連結）。best-effort。
    if (deep) {
      try {
        // S1-A7：商機線索與未歸類情報同落 observations 單例筆記（研究商機線索 section）。
        await writeSingletonNotes(orgId, companyId, {
          narrativeZh: deep.narrativeZh,
          uncategorized: deep.uncategorized,
          opportunities: deep.opportunities,
        });
      } catch (e) {
        console.error("[research:deep] singleton notes failed:", e);
      }
    }

    // job.sources＝真正「取材自」的網址（S1-A9）：官網爬過的頁 + 深讀真實來源（含社群）+ 解析後的真實出處
    // + 已引用但未深讀的 citation（resolve 後真實 URL）。去重、官網頁優先序不變、cap 60、排除仍是中介 redirect 的雜訊。
    const sources = assembleSources({
      siteVisited: siteRaw?.sourcesVisited,
      deepReadUrls: bundle.sourceTexts.map((s) => s.url),
      citationUrls: bundle.citationUrls,
      resolved: resolvedMap,
    });
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
    // WP 缺口 2：只出現在 uncategorized 的來源 URL 也納入解析集合，否則其 grounding-redirect 不會被還原
    // （observations 筆記的 [來源] 就會停留在 vertexaisearch redirect）。同一 30s 預算、best-effort。
    deep.uncategorized.forEach((u) => add(u.sourceUrl));
    // S1-A7：商機線索的來源 URL 也納入（同 observations 筆記，[來源] 需真實出處）。
    (deep.opportunities ?? []).forEach((o) => add(o.sourceUrl));

    const known = new Map<string, string>();
    for (const st of bundle.sourceTexts) if (st.citationUrl) known.set(st.citationUrl, st.url);

    // max: 48——併入 uncategorized/opportunities/社群來源後，待解析的中介 redirect 變多；預設 16 會截斷，
    // 留下部分 [來源] 停在 vertexaisearch（改由 noteSourceSuffix 降級為「來源待解析」）。放寬到 48。
    const resolved = await resolveRedirects(fetcher, [...used], { known, budgetMs: 30_000, max: 48 });
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

  /**
   * S1-A6：per-contact 背景補查。deep 落庫 people 後，對「背景或照片欄空缺」的主管（≤5 人）各跑一條 grounded 查詢
   * （姓名+公司+職稱 學經歷 LinkedIn，雙語擇一依姓名語言），把回答結構化，**僅回填空欄**（title/titleZh/
   * backgroundSummary/backgroundSummaryZh/linkedinUrl/fullNameZh），帶 provenance（sourceUrl＝真實 citation）。
   * 照片獵取：對仍無 photoUrl 者，取該人 grounding citation 前 2 個 URL fetchRaw（SSRF/渲染預算沿用 crawler），
   *   解析 <img> alt 含人名 token 的 src（og:image 僅當 title 含人名才收），過絕對 http(s)＋副檔名/追蹤像素過濾，
   *   confidence 0.5＋provenance sourceUrl=該頁。查無/失敗即跳過，**嚴禁捏造**。
   * 記債：deadlineAt 逐項前檢查——超時即停止剩餘主管並 log。回新增的欄位數。需 grounding + gemini，缺一即 skip。
   */
  async function enrichKeyPeople(
    orgId: string,
    jobId: string,
    companyId: string,
    companyName: string,
    people: Contact[],
    deadlineAt: number,
    userId?: string,
  ): Promise<number> {
    if (!deps.grounding || !deps.gemini) return 0;
    const grounding = meteredGrounding(deps.grounding, orgId, jobId, userId);
    const gm =
      deps.meter && deps.gemini
        ? meteredGeminiFor(orgId, `person-bg:${jobId}`, "gemini_extract", userId)
        : deps.gemini;
    // 觸發條件：backgroundSummary 或 photoUrl 空缺（尚未補查過 / 尚無頭像）。取前 N。
    const targets = people
      .filter((p) => p.fullName && (!cleanStr(p.backgroundSummary) || !cleanStr(p.photoUrl)))
      .slice(0, PERSON_ENRICH_MAX);
    let filled = 0;
    let cseQueriesUsed = 0; // 照片 v3b：每 job Google CSE 查詢計數（上限 PHOTO_CSE_MAX_PER_JOB）
    for (const c of targets) {
      // 記債：逐項前檢查 deadline——超時即停止剩餘主管（log 一次）。
      if (Date.now() > deadlineAt) {
        console.warn("[research:deep] key-people enrich deadline exceeded — stopping remaining");
        break;
      }
      const zh = hasCjk(c.fullName); // 姓名語言分流：中文名走中文查詢、否則英文
      const query = (
        zh
          ? `${c.fullName} ${companyName} ${c.title ?? ""} 學經歷 背景 經歷 現職 LinkedIn`
          : `${c.fullName} ${companyName} ${c.title ?? ""} background experience career current role LinkedIn`
      )
        .replace(/\s+/g, " ")
        .trim();
      let grounded;
      try {
        grounded = await grounding.answer(query, { companyName, model: deps.extractModel });
      } catch (e) {
        console.error("[research:deep] person grounding failed:", e);
        continue;
      }
      const answer = cleanStr(grounded.answer);
      if (!answer) continue; // 查無 → 跳過
      let bg;
      try {
        bg = await extractPersonBackground(gm, deps.extractModel, answer);
      } catch (e) {
        console.error("[research:deep] person background extract failed:", e);
        continue;
      }
      let srcUrl = firstCitationUrl(grounded.citations);
      // A6：provenance 的 sourceUrl 必須是真實出處。firstCitationUrl 在「全部 citation 皆為 grounding-redirect」時
      // 會退回中介 redirect（vertexaisearch），classifySourceType 會誤標為 'web'。→ 用 resolveRedirects 還原成真實
      // URL（有界、best-effort；還原不出真實出處者保留原值，與 uncategorized/opportunities 路徑一致）。
      if (srcUrl && isGroundingRedirect(srcUrl)) {
        try {
          const map = await resolveRedirects(
            deps.fetcher ?? safeFetcher,
            grounded.citations.map((cc) => cc.url).filter((u): u is string => typeof u === "string" && u.length > 0),
            { budgetMs: 10_000, max: 8 },
          );
          for (const cc of grounded.citations) {
            const real = map.get(cc.url);
            if (real && !isGroundingRedirect(real)) {
              srcUrl = real;
              break;
            }
          }
        } catch (e) {
          console.error("[research:deep] person citation resolve failed:", e);
        }
      }
      const patch: Partial<Contact> = {};
      const prov: ProvenanceInput[] = [];
      const fillEmpty = (field: keyof Contact, existing: unknown, val: string | undefined): void => {
        const v = cleanStr(val);
        if (!v) return; // 無據 → 不填
        if (cleanStr(existing as string)) return; // 僅回填空欄（不覆寫既有非空值）
        (patch as Record<string, unknown>)[field] = v;
        prov.push({
          fieldName: field,
          value: v,
          sourceUrl: srcUrl,
          sourceType: srcUrl ? classifySourceType(srcUrl) : "web",
          confidence: DEEP_CONFIDENCE,
        });
      };
      fillEmpty("title", c.title, bg.title);
      fillEmpty("titleZh", c.titleZh, bg.titleZh);
      fillEmpty("backgroundSummary", c.backgroundSummary, bg.backgroundSummary);
      fillEmpty("backgroundSummaryZh", c.backgroundSummaryZh, bg.backgroundSummaryZh);
      fillEmpty("fullNameZh", c.fullNameZh, bg.fullNameZh);
      fillEmpty("linkedinUrl", c.linkedinUrl, validLinkedinUrl(bg.linkedinUrl));

      // 照片獵取：仍無 photoUrl 者 → 取該人 grounding citation 前 2 個 URL fetchRaw，解析 <img> alt/og:image 含人名者。
      if (!cleanStr(c.photoUrl)) {
        const candidateUrls: string[] = [];
        const addUrl = (u?: string): void => {
          if (u && !candidateUrls.includes(u)) candidateUrls.push(u);
        };
        addUrl(srcUrl); // 已解析的真實 citation 優先
        for (const cc of grounded.citations) addUrl(cc.url);
        const zhName = (patch.fullNameZh as string | undefined) ?? c.fullNameZh;
        for (const purl of candidateUrls.slice(0, 2)) {
          if (Date.now() > deadlineAt) break; // 記債：逐項前檢查
          let raw: Awaited<ReturnType<typeof crawler.fetchRaw>> = null;
          try {
            raw = await crawler.fetchRaw(purl);
          } catch (e) {
            console.error("[research:deep] photo fetchRaw failed:", e);
          }
          if (!raw) continue;
          const page = raw.finalUrl || purl;
          const photo = findPersonPhotoInHtml(raw.html, { fullName: c.fullName, fullNameZh: zhName, pageUrl: page });
          if (photo) {
            patch.photoUrl = photo;
            prov.push({
              fieldName: "photoUrl",
              value: photo,
              sourceUrl: page,
              sourceType: classifySourceType(page),
              confidence: 0.5,
            });
            break;
          }
        }
      }

      // S5 照片 v2：背景 citation 仍找不到頭像 → 專屬照片 grounded 查詢（zh 名走「<中文名> <公司> 專訪 OR 照片」，
      // 否則 en「<name> <company> interview photo」），取 citations 前 2 個 URL fetchRaw 跑同一 findPersonPhotoInHtml
      // （詞界/佔位圖黑名單守衛沿用；每人此輪照片 fetch ≤2；命中寫 photoUrl confidence 0.5＋provenance）。查無即跳過。
      if (!cleanStr(c.photoUrl) && !patch.photoUrl && Date.now() <= deadlineAt) {
        const zhName = cleanStr((patch.fullNameZh as string | undefined) ?? c.fullNameZh);
        const cjkName = zhName ?? (hasCjk(c.fullName) ? c.fullName : undefined);
        const photoQuery = cjkName
          ? `${cjkName} ${companyName} 專訪 OR 照片`
          : `${c.fullName} ${companyName} interview photo`;
        let photoGrounded;
        try {
          photoGrounded = await grounding.answer(photoQuery, { companyName, model: deps.extractModel });
        } catch (e) {
          console.error("[research:deep] photo grounding failed:", e);
        }
        if (photoGrounded) {
          const photoUrls = photoGrounded.citations
            .map((cc) => cc.url)
            .filter((u): u is string => typeof u === "string" && u.length > 0)
            .slice(0, 2);
          for (const purl of photoUrls) {
            if (Date.now() > deadlineAt) break; // 記債：逐項前檢查
            let raw: Awaited<ReturnType<typeof crawler.fetchRaw>> = null;
            try {
              raw = await crawler.fetchRaw(purl);
            } catch (e) {
              console.error("[research:deep] photo fetchRaw failed:", e);
            }
            if (!raw) continue;
            const page = raw.finalUrl || purl;
            const photo = findPersonPhotoInHtml(raw.html, { fullName: c.fullName, fullNameZh: zhName, pageUrl: page });
            if (photo) {
              patch.photoUrl = photo;
              prov.push({
                fieldName: "photoUrl",
                value: photo,
                sourceUrl: page,
                sourceType: classifySourceType(page),
                confidence: 0.5,
              });
              break;
            }
          }
        }
      }
      // 照片 v3b：官網/citation 途徑（v1 alt/鄰近＋v2 專屬照片查詢）仍落空 → Google 圖片 CSE 備援。
      // 每人 1 次查詢、每 job ≤PHOTO_CSE_MAX_PER_JOB 次；憑證未設（deps.googleCse 為空）→ 直接 skip（searchPersonPhotoCse 內優雅回 undefined）。
      // 查詢「<中文名 ?? name> <公司名>」，取第一張過守衛的原圖 link，confidence 0.5＋provenance（sourceUrl=contextLink ?? link）。
      if (
        deps.googleCse &&
        !cleanStr(c.photoUrl) &&
        !patch.photoUrl &&
        cseQueriesUsed < PHOTO_CSE_MAX_PER_JOB &&
        Date.now() <= deadlineAt
      ) {
        cseQueriesUsed++;
        const zhName = cleanStr((patch.fullNameZh as string | undefined) ?? c.fullNameZh);
        const cseName = zhName ?? c.fullName;
        try {
          const img = await searchPersonPhotoCse(deps.googleCse, cseName, companyName);
          if (img) {
            const src = img.contextLink ?? img.link;
            patch.photoUrl = img.link;
            prov.push({
              fieldName: "photoUrl",
              value: img.link,
              sourceUrl: src,
              sourceType: classifySourceType(src),
              confidence: 0.5,
            });
          }
        } catch (e) {
          console.error("[research:deep] photo CSE failed:", e);
        }
      }

      if (prov.length === 0) continue; // 全部欄位皆已有值或查無 → 不寫
      try {
        await core.contacts.upsertFromCrawl(orgId, companyId, {
          contact: { fullName: c.fullName, ...patch },
          provenance: prov,
        });
        filled += prov.length;
      } catch (e) {
        console.error("[research:deep] person enrich upsert failed:", e);
      }
    }
    return filled;
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
        .map((c) => `- ${c.name}${noteSourceSuffix(c.sourceUrl)}`)
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
