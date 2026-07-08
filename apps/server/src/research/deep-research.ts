/**
 * DeepResearcher — 「全網」公司深度研究引擎（enrich mode='deep'）。
 *
 * 不鎖官網：官網只是起點。流程：
 *  a. **扇出多角度 Google-Search grounding 查詢**（reuse GroundingProvider）——公司概覽/產業/總部/成立/規模、
 *     近期新聞、募資/投資人/估值、經營團隊/高階主管、主要競爭對手、產品/定位。TW 公司同時出 zh-TW＋英文查詢。
 *  b. 收集 grounded 答案＋引用（去重 citation URL）——這些是真實外部來源（新聞/維基/crunchbase/公開檔）。
 *  c. **深讀** 前 ~4-6 個最高價值、非官網的 citation（SafeFetcher.extractFromUrl，SSRF 安全、有界、可容錯），
 *     取回真實來源全文＋逐跳重導後的真實 URL（finalUrl）。
 *  d. 回結構化 bundle：{ groundedFindings:[{angle,answer,citations}], sourceTexts:[{url,title,text}] }。
 *
 * 有界：整場受 DEEP_RESEARCH_BUDGET_MS（預設 150s，env 覆寫）軟 deadline 約束；grounding 扇出與來源深讀
 * 皆有界平行，個別失敗容忍（partial 結果可接受）。與官網爬蟲（≤5min）並行，故 wall-clock 取兩者最大值。
 */
import type { GroundingProvider } from "./grounding.js";
import type { GroundingCitation } from "../gemini.js";
import type { SafeFetcher } from "../import/extract.js";

// ── 有界參數（呼叫時讀 env，clamp；.env 於 bootstrap 已載入）──
const DEFAULT_BUDGET_MS = 150_000; // 整場軟 deadline（env DEEP_RESEARCH_BUDGET_MS，clamp 30s–300s）
const DEFAULT_MAX_QUERIES = 9; // grounding 扇出上限（env DEEP_RESEARCH_MAX_QUERIES，clamp 3–12）
const DEFAULT_MAX_SOURCES = 6; // 深讀來源上限（env DEEP_RESEARCH_MAX_SOURCES，clamp 0–10）
const GROUNDING_CONCURRENCY = 3; // grounding 平行度
const SOURCE_CONCURRENCY = 3; // 深讀平行度
const MIN_SOURCE_TEXT_CHARS = 200; // 太短（多半是攔截頁/空頁）不收

function clampEnvInt(name: string, def: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 0) return def;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}
export function deepBudgetMs(): number {
  return clampEnvInt("DEEP_RESEARCH_BUDGET_MS", DEFAULT_BUDGET_MS, 30_000, 300_000);
}

export interface DeepResearchInput {
  companyName: string;
  domain?: string;
  startUrl?: string;
}

export interface GroundedFinding {
  angle: string;
  query: string;
  answer: string;
  citations: GroundingCitation[];
}

export interface SourceText {
  /** 逐跳重導後的真實來源 URL（如 grounding redirect → 真實新聞/維基頁）。 */
  url: string;
  title?: string;
  text: string;
  /** 原始 grounding citation URL（重導前）——供把「僅在 provenance 用到的 redirect」對回真實 URL。 */
  citationUrl?: string;
}

export interface DeepResearchBundle {
  groundedFindings: GroundedFinding[];
  sourceTexts: SourceText[];
  /** 去重後、被深讀嘗試過的候選 citation（供 job.sources 與診斷）。 */
  citationUrls: string[];
}

export interface DeepResearcher {
  research(input: DeepResearchInput): Promise<DeepResearchBundle>;
}

// ── 語言推斷 ──────────────────────────────────────────────
function hasCjk(s: string): boolean {
  return /[㐀-鿿豈-﫿]/.test(s);
}
/** TW/華語公司 → 雙語（zh-TW＋英文）；否則英文為主。依名稱含 CJK 或網域 .tw 推斷。 */
function isBilingual(input: DeepResearchInput): boolean {
  if (hasCjk(input.companyName)) return true;
  const d = (input.domain ?? "").toLowerCase();
  return d.endsWith(".tw") || d.includes(".com.tw");
}

interface Angle {
  key: string;
  zh: (n: string) => string;
  en: (n: string) => string;
}
const ANGLES: Angle[] = [
  {
    key: "overview",
    zh: (n) => `${n} 公司簡介 主要業務 產業別 總部所在地 成立年份 員工人數 公司規模`,
    en: (n) => `${n} company overview business industry headquarters founded year employees size`,
  },
  {
    key: "news",
    zh: (n) => `${n} 最新消息 新聞 近期發展 公告`,
    en: (n) => `${n} latest news recent developments announcements`,
  },
  {
    key: "funding",
    zh: (n) => `${n} 募資 融資輪 投資人 估值`,
    en: (n) => `${n} funding round investors valuation`,
  },
  {
    key: "leadership",
    zh: (n) => `${n} 經營團隊 高階主管 董事長 執行長 總經理 創辦人 姓名 職稱`,
    en: (n) => `${n} leadership key executives CEO founder chairman management team names titles`,
  },
  {
    key: "competitors",
    zh: (n) => `${n} 主要競爭對手 同業 競品`,
    en: (n) => `${n} main competitors rivals alternatives`,
  },
  {
    key: "products",
    zh: (n) => `${n} 產品 服務 解決方案 市場定位`,
    en: (n) => `${n} products services solutions market positioning`,
  },
];
/** locale 敏感角度（雙語時額外出 zh-TW 查詢）。 */
const ZH_ANGLES = new Set(["overview", "news", "leadership"]);

/** 建 grounding 查詢清單（角度 × 語言）。雙語＝ zh(3 個 locale-敏感) + en(全部)；否則 en(全部)。上限 maxQueries。 */
export function buildQueries(input: DeepResearchInput, maxQueries: number): { angle: string; query: string }[] {
  const n = input.companyName;
  const bilingual = isBilingual(input);
  const out: { angle: string; query: string }[] = [];
  if (bilingual) {
    for (const a of ANGLES) if (ZH_ANGLES.has(a.key)) out.push({ angle: a.key, query: a.zh(n) });
  }
  for (const a of ANGLES) out.push({ angle: a.key, query: a.en(n) });
  return out.slice(0, maxQueries);
}

// ── 來源分類與排序 ────────────────────────────────────────
/** 由 URL/標題判定 provenance 的 source_type（維基/新聞/公開檔/web）。 */
export function classifySourceType(urlOrTitle: string): string {
  const s = urlOrTitle.toLowerCase();
  if (s.includes("wikipedia.org") || s.includes("維基")) return "wikipedia";
  if (s.includes("crunchbase.com")) return "crunchbase";
  if (s.includes("linkedin.com")) return "linkedin";
  if (
    /bloomberg|reuters|techcrunch|forbes|nikkei|cnbc|wsj|ft\.com|businesswire|prnewswire|經濟日報|工商時報|中央社|digitimes|ithome|bnext|天下|鉅亨|moneydj/.test(
      s,
    )
  )
    return "news";
  return "web";
}

/** 高價值來源加權（排序深讀優先序）。 */
function sourceValueWeight(urlOrTitle: string): number {
  const t = classifySourceType(urlOrTitle);
  switch (t) {
    case "wikipedia":
      return 5;
    case "crunchbase":
      return 4;
    case "news":
      return 4;
    case "linkedin":
      return 2;
    default:
      return 1;
  }
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** URL host 是否即公司自家網域（deep 深讀跳過——官網由 site-crawl 覆蓋）。 */
function isCompanyDomain(url: string, domain?: string): boolean {
  if (!domain) return false;
  const h = hostOf(url);
  if (!h) return false;
  const d = domain.replace(/^www\./i, "").toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

// ── 有界平行池 ────────────────────────────────────────────
async function runPool<T, R>(
  items: T[],
  concurrency: number,
  deadlineAt: number,
  worker: (item: T) => Promise<R | undefined>,
): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      if (Date.now() > deadlineAt) return;
      const i = idx++;
      if (i >= items.length) return;
      try {
        const r = await worker(items[i] as T);
        if (r !== undefined) results.push(r);
      } catch {
        /* 個別失敗容忍 */
      }
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, run));
  return results;
}

/** URL 是否為 Gemini grounding 的中介 redirect（非真實出處，302 導向真正的新聞/維基）。 */
export function isGroundingRedirect(url: string): boolean {
  const h = hostOf(url) ?? "";
  return h.includes("vertexaisearch") || h.endsWith("googleusercontent.com") || url.includes("grounding-api-redirect");
}

/**
 * 把一批（grounding redirect）URL 解析成真實出處 URL（逐跳重導後的 finalUrl），有界、可容錯。
 * `known`（citationUrl→resolved，來自深讀）先套用免重抓；其餘 redirect URL 才實抓解析。回 redirect→real 映射。
 * 用途：把「只在 provenance 用到、未深讀」的 redirect 也對成真實網址，使 UI 徽章顯示真正的新聞/維基網域。
 */
export async function resolveRedirects(
  fetcher: SafeFetcher,
  urls: string[],
  opts: { known?: Map<string, string>; budgetMs?: number; concurrency?: number; max?: number } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>(opts.known ?? []);
  const todo = [...new Set(urls)].filter((u) => isGroundingRedirect(u) && !out.has(u)).slice(0, opts.max ?? 16);
  if (todo.length === 0) return out;
  const deadlineAt = Date.now() + (opts.budgetMs ?? 30_000);
  await runPool<string, string>(todo, opts.concurrency ?? 4, deadlineAt, async (u) => {
    const { finalUrl } = await fetcher.extractFromUrl(u);
    if (finalUrl && !isGroundingRedirect(finalUrl)) out.set(u, finalUrl);
    return undefined;
  });
  return out;
}

export interface DeepResearcherOptions {
  budgetMs?: number;
  maxQueries?: number;
  maxSources?: number;
}

export function createDeepResearcher(
  grounding: GroundingProvider,
  fetcher: SafeFetcher,
  options: DeepResearcherOptions = {},
): DeepResearcher {
  return {
    async research(input: DeepResearchInput): Promise<DeepResearchBundle> {
      const start = Date.now();
      const budgetMs = options.budgetMs ?? deepBudgetMs();
      const deadlineAt = start + budgetMs;
      const maxQueries = options.maxQueries ?? clampEnvInt("DEEP_RESEARCH_MAX_QUERIES", DEFAULT_MAX_QUERIES, 3, 12);
      const maxSources = options.maxSources ?? clampEnvInt("DEEP_RESEARCH_MAX_SOURCES", DEFAULT_MAX_SOURCES, 0, 10);

      // a. 扇出 grounding 查詢（有界平行）。
      const queries = buildQueries(input, maxQueries);
      const groundedFindings = await runPool<{ angle: string; query: string }, GroundedFinding>(
        queries,
        GROUNDING_CONCURRENCY,
        deadlineAt,
        async ({ angle, query }) => {
          const res = await grounding.answer(query, { companyName: input.companyName });
          if (!res.answer || !res.answer.trim()) return undefined;
          return { angle, query, answer: res.answer.trim(), citations: res.citations };
        },
      );

      // b. 匯總＋去重 citation（跨角度），並累計「被引用次數」以輔助排序。
      const seen = new Map<string, { citation: GroundingCitation; freq: number }>();
      for (const f of groundedFindings) {
        for (const c of f.citations) {
          if (!c.url) continue;
          const key = c.url;
          const prev = seen.get(key);
          if (prev) prev.freq += 1;
          else seen.set(key, { citation: c, freq: 1 });
        }
      }
      const citationUrls = [...seen.keys()];

      // c. 排序候選（跳過官網），取前 maxSources 深讀。value 權重（維基/新聞優先）× 引用次數。
      const ranked = [...seen.values()]
        .filter((e) => !isCompanyDomain(e.citation.url, input.domain))
        .filter((e) => !isCompanyDomain(e.citation.title, input.domain))
        .map((e) => ({
          ...e,
          score: sourceValueWeight(`${e.citation.url} ${e.citation.title}`) * 10 + e.freq,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSources);

      const sourceTexts =
        Date.now() > deadlineAt || ranked.length === 0
          ? []
          : await runPool<{ citation: GroundingCitation }, SourceText>(
              ranked,
              SOURCE_CONCURRENCY,
              deadlineAt,
              async ({ citation }) => {
                const { title, text, finalUrl } = await fetcher.extractFromUrl(citation.url);
                const resolved = finalUrl ?? citation.url;
                // 深讀後才知真實 host：若重導回官網 → 丟棄（site-crawl 已覆蓋）。
                if (isCompanyDomain(resolved, input.domain)) return undefined;
                if (!text || text.trim().length < MIN_SOURCE_TEXT_CHARS) return undefined;
                return { url: resolved, title: title ?? citation.title, text: text.trim(), citationUrl: citation.url };
              },
            );

      return { groundedFindings, sourceTexts, citationUrls };
    },
  };
}
