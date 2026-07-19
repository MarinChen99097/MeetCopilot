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
 * 有界：整場受 DEEP_RESEARCH_BUDGET_MS（預設 1_200_000ms＝20 分，env 覆寫，clamp 30s–1800s）軟 deadline 約束；grounding 扇出與來源深讀
 * 皆有界平行，個別失敗容忍（partial 結果可接受）。與官網爬蟲（≤5min）並行，故 wall-clock 取兩者最大值。
 */
import type { GroundingProvider } from "./grounding.js";
import type { GroundingCitation } from "../gemini.js";
import type { SafeFetcher } from "../import/extract.js";

// ── 有界參數（呼叫時讀 env，clamp；.env 於 bootstrap 已載入）──
// WP3「深與廣（30–60 分鐘級）」：整場軟 deadline 大幅放寬（多輪研究＋社群模板需更多時間）。
// 記債：預設 20→60 分（1_200_000→3_600_000），與 prod env 已設同值對齊；clamp 上界同步升到 60 分，
// 否則 prod 的 DEEP_RESEARCH_BUDGET_MS=3_600_000 會被舊上界 1_800_000 夾掉、且預設值也會超過上界。
const DEFAULT_BUDGET_MS = 3_600_000; // 整場軟 deadline（env DEEP_RESEARCH_BUDGET_MS，clamp 30s–3600s）
const BUDGET_CEIL_MS = 3_600_000; // clamp 上界（60 分鐘）
// S1-A1/A2「基礎查詢一律雙語 × 全部角度（11 角度）」：11×2=22 條基礎查詢須容得下，故扇出上限上調到 22（env
// DEEP_RESEARCH_MAX_QUERIES，clamp 3–24）。round 1 = 22 基礎 + 7 社群 = 29 ≤ ROUND_QUERY_CEIL(32)。
const DEFAULT_MAX_QUERIES = 22; // grounding 扇出上限（env DEEP_RESEARCH_MAX_QUERIES，clamp 3–24）
const DEFAULT_MAX_SOURCES = 12; // 深讀來源上限（S1-A4：6→12；env DEEP_RESEARCH_MAX_SOURCES，clamp 0–20）
const DEFAULT_ROUNDS = 3; // 多輪研究輪數（env DEEP_RESEARCH_ROUNDS，clamp 1–5）；一輪無新事實即提早停
// grounding 平行度（env DEEP_RESEARCH_GROUNDING_CONCURRENCY，clamp 1–6）。3→2：升模 gemini-3.5-flash 後單次
// grounding 變慢，過高並行會互相拖慢上游 → 觸發 504 DEADLINE_EXCEEDED。降預設並提供旋鈕，仍在 budget 內（多數 round 為 follow-up 小查詢集）。
const DEFAULT_GROUNDING_CONCURRENCY = 2;
const SOURCE_CONCURRENCY = 3; // 深讀平行度
const MIN_SOURCE_TEXT_CHARS = 200; // 太短（多半是攔截頁/空頁）不收
// S1-A5：SafeFetcher（純 undici、不渲染 JS）失敗或內文太短時，用 Playwright 渲染 fallback 抓 innerText。
const MAX_RENDER_FALLBACKS_PER_JOB = 8; // 每 job（跨輪，researcher 實例存活整場）渲染 fallback 次數上限
const RENDER_FALLBACK_CONCURRENCY = 2; // 渲染 fallback 並行上限
const RENDER_FALLBACK_TIMEOUT_MS = 20_000; // 單 URL 渲染逾時

function clampEnvInt(name: string, def: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 0) return def;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}
export function deepBudgetMs(): number {
  return clampEnvInt("DEEP_RESEARCH_BUDGET_MS", DEFAULT_BUDGET_MS, 30_000, BUDGET_CEIL_MS);
}
/** 多輪研究輪數（env DEEP_RESEARCH_ROUNDS，clamp 1–5；預設 3）。一輪無新增事實即提早停（見 deep-rounds.ts）。 */
export function deepResearchRounds(): number {
  return clampEnvInt("DEEP_RESEARCH_ROUNDS", DEFAULT_ROUNDS, 1, 5);
}

export interface DeepResearchInput {
  companyName: string;
  domain?: string;
  startUrl?: string;
  /** 納入 FB/IG「社群模板」＋ official social accounts grounding 查詢（WP1 §1.2/§1.3）。預設 true。 */
  includeSocial?: boolean;
  /** 多輪研究（WP3 §3）：是否納入基礎角度查詢（round 1=true；follow-up round 傳 false 只跑 extraQueries）。預設 true。 */
  includeBaseQueries?: boolean;
  /** 多輪研究：本輪額外的 follow-up 查詢（缺口分析產生）。 */
  extraQueries?: { angle: string; query: string }[];
  /**
   * more 模式：**只**跑指定 angle key 的基礎查詢（縮小基礎角度，如 ["overview","news"]）。
   * 缺→全部角度（11）。仍雙語、仍受 maxQueries 上限。未知 key 忽略。
   */
  baseAngleKeys?: string[];
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
/** 字串是否含中日韓表意文字（供語言分流：姓名/公司名含 CJK → 走中文查詢）。匯出供 orchestrator per-contact 補查用。 */
export function hasCjk(s: string): boolean {
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
  // ── S1-A2：新增五角度（雙語），擴大廣度（徵才/客戶案例/評測口碑/商工登記/獲獎補助）──
  {
    key: "hiring",
    zh: (n) => `${n} 徵才 職缺 招聘 104 CakeResume 人力銀行`,
    en: (n) => `${n} jobs hiring careers open positions`,
  },
  {
    key: "caseStudies",
    zh: (n) => `${n} 客戶案例 導入實績 合作客戶 成功案例`,
    en: (n) => `${n} customer case study clients success story`,
  },
  {
    key: "reviews",
    zh: (n) => `${n} 評測 評價 使用心得 比較 優缺點`,
    en: (n) => `${n} review comparison alternatives pros cons`,
  },
  {
    key: "registry",
    zh: (n) => `${n} 政府商工登記 統一編號 資本額 公司登記`,
    en: (n) => `${n} business registration company registry filing`,
  },
  {
    key: "awards",
    zh: (n) => `${n} 獲獎 得獎 補助 入選 加速器`,
    en: (n) => `${n} awards grants accelerator recognition`,
  },
];

/**
 * 建 grounding 查詢清單（角度 × 語言）。S1-A1：**對全部角度一律同時出 zh+en**（基礎查詢一律雙語）——
 * isBilingual **只影響排序**（不再排除任何語言）：華語公司 zh 先出、否則 en 先出，逐角度交錯（zh,en / en,zh），
 * 使任一 maxQueries 上限下都同時涵蓋雙語且優先語言的高價值角度不被截掉。上限 maxQueries。
 */
export function buildQueries(input: DeepResearchInput, maxQueries: number): { angle: string; query: string }[] {
  const n = input.companyName;
  const bilingual = isBilingual(input); // 只用於排序（決定 zh/en 誰先），不用於排除
  const out: { angle: string; query: string }[] = [];
  // more 模式縮小基礎角度：只保留 baseAngleKeys 指定者（如 overview+news），保序；缺→全部角度。
  const angles =
    input.baseAngleKeys && input.baseAngleKeys.length > 0
      ? ANGLES.filter((a) => input.baseAngleKeys!.includes(a.key))
      : ANGLES;
  for (const a of angles) {
    if (bilingual) {
      out.push({ angle: a.key, query: a.zh(n) });
      out.push({ angle: a.key, query: a.en(n) });
    } else {
      out.push({ angle: a.key, query: a.en(n) });
      out.push({ angle: a.key, query: a.zh(n) });
    }
  }
  return out.slice(0, maxQueries);
}

/**
 * 社群模板查詢（WP1 §1.2/§1.3）：FB/IG「只用 grounding」＋ 一條 official social media accounts 發現查詢。
 * ≥6 條雙語（含 site:facebook.com、Instagram 近期貼文、粉專評價/口碑、徵才動態）。angle='social'。
 */
export function buildSocialQueries(input: DeepResearchInput): { angle: string; query: string }[] {
  const n = input.companyName;
  return [
    { angle: "social", query: `${n} official social media accounts Facebook Instagram YouTube Threads` },
    { angle: "social", query: `site:facebook.com "${n}"` },
    { angle: "social", query: `"${n}" Facebook 官方粉絲專頁 最新動態 貼文` },
    { angle: "social", query: `"${n}" Instagram 近期貼文 活動` },
    { angle: "social", query: `"${n}" 粉絲專頁 評價 口碑 討論` },
    { angle: "social", query: `"${n}" 徵才 招聘 職缺 社群 動態` },
    { angle: "social", query: `"${n}" social media recent posts campaign engagement` },
  ];
}

/** 單輪 grounding 查詢的整體上限（多輪＋社群模板疊加時仍有界，避免扇出爆量）。S1-A2：22 基礎(雙語×11角度)+7社群=29 ≤ 32。 */
const ROUND_QUERY_CEIL = 32;

/** 依 input（含 includeBaseQueries/includeSocial/extraQueries）組出本輪要跑的 grounding 查詢集。 */
function queriesForRound(input: DeepResearchInput, maxQueries: number): { angle: string; query: string }[] {
  const out: { angle: string; query: string }[] = [];
  if (input.includeBaseQueries !== false) {
    out.push(...buildQueries(input, maxQueries));
    if (input.includeSocial !== false) out.push(...buildSocialQueries(input));
  }
  if (input.extraQueries) out.push(...input.extraQueries);
  return out.slice(0, ROUND_QUERY_CEIL);
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

/**
 * S1-A9：組 job.sources（真正「取材自」的網址）。優先序＝官網爬過的頁 → 深讀真實來源（含社群）→ 解析後的真實出處
 * → **已引用但未深讀的 citation（resolve 後真實 URL）**。去重、官網頁優先序不變、仍是 grounding-redirect（未解析出
 * 真實出處）的中介 URL 一律排除、總量 cap（預設 60）。純函式，供單測。
 */
export function assembleSources(input: {
  siteVisited?: string[];
  deepReadUrls?: string[];
  citationUrls?: string[];
  resolved?: Map<string, string>;
  cap?: number;
}): string[] {
  const cap = input.cap ?? 60;
  const resolved = input.resolved ?? new Map<string, string>();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (u?: string): void => {
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push(u);
  };
  for (const u of input.siteVisited ?? []) add(u); // 官網頁優先
  for (const u of input.deepReadUrls ?? []) add(u); // 深讀真實來源（含社群）
  for (const u of resolved.values()) add(u); // 解析後的真實出處
  // A9：已引用但未深讀的 citation → resolve 後真實 URL（redirect 用映射還原；仍為中介 redirect 者不入 sources）。
  for (const c of input.citationUrls ?? []) {
    const real = resolved.get(c) ?? c;
    if (isGroundingRedirect(real)) continue;
    add(real);
  }
  return out.slice(0, cap);
}

/** 計數旗號介面（限制並行）。 */
export interface Semaphore {
  acquire: () => Promise<void>;
  release: () => void;
}

/** 極簡計數旗號（限制並行）：acquire 逾額則排隊，release 放行下一個。供 A5 渲染 fallback 限並行用。匯出供單測。 */
export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const queue: (() => void)[] = [];
  return {
    acquire: () =>
      new Promise<void>((resolve) => {
        if (active < max) {
          active++;
          resolve();
        } else {
          queue.push(() => {
            active++;
            resolve();
          });
        }
      }),
    release: () => {
      active--;
      const next = queue.shift();
      if (next) next();
    },
  };
}

/** 對一項工作施加逾時；逾時回 null（不 reject）。供 A5 渲染 fallback 單 URL 逾時。 */
function withRenderTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T | null>;
}

/**
 * 記債：semaphore 名額佔用到「底層 work 真正 settle」才釋放——即使 timeoutMs 逾時先回 null，
 * 名額仍佔位到 work（fetchRaw）收尾，避免逾時提前釋放名額導致實際併發超過上限。
 * release 掛在底層 promise 的 settle（成功/失敗都釋放且只一次，掛 then 兩臂），故不會死鎖。匯出供單測。
 */
export async function runWithSemaphoreTimeout<T>(
  sem: Semaphore,
  work: () => Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  await sem.acquire();
  let underlying: Promise<T>;
  try {
    underlying = Promise.resolve(work()); // work() 若同步 throw → 下方 catch 釋放名額
  } catch {
    sem.release();
    return null;
  }
  // 只在底層 settle 時釋放（不在 timeout 時）；then 兩臂涵蓋成功/失敗，確保恰好釋放一次、且吞掉 rejection 不成 unhandled。
  void underlying.then(
    () => sem.release(),
    () => sem.release(),
  );
  try {
    return await withRenderTimeout(underlying, timeoutMs);
  } catch {
    return null; // 底層在 timeout 前 reject → 回 null（名額已由上面的 then 釋放）
  }
}

export interface DeepResearcherOptions {
  budgetMs?: number;
  maxQueries?: number;
  maxSources?: number;
  /** S1-A3：deep grounding 升模——grounding.answer 帶此 model（generateGrounded opts.model）；缺→沿用 textModel。 */
  groundingModel?: string;
  /**
   * S1-A5：JS 渲染 fallback。SafeFetcher（純 undici、不渲染）失敗或內文太短時，用此渲染器抓 innerText。
   * 必須 SSRF 安全（呼叫端傳入 crawler 的 Playwright 逐請求攔截路徑）；缺→不 fallback。回 null 表失敗/逾時。
   */
  renderFallback?: (url: string) => Promise<{ text: string; finalUrl?: string; title?: string } | null>;
}

export function createDeepResearcher(
  grounding: GroundingProvider,
  fetcher: SafeFetcher,
  options: DeepResearcherOptions = {},
): DeepResearcher {
  // S1-A5：渲染 fallback 的整場（跨輪，同一 researcher 實例服務整個 job）預算：次數上限 + 並行旗號。
  let rendersUsed = 0;
  const renderSem = createSemaphore(RENDER_FALLBACK_CONCURRENCY);
  /** 受限渲染：超過每 job 上限或無 renderFallback → 回 null；並行 ≤2、單 URL 逾時 20s。 */
  const renderWithLimits = async (
    url: string,
  ): Promise<{ text: string; finalUrl?: string; title?: string } | null> => {
    const fn = options.renderFallback;
    if (!fn) return null;
    if (rendersUsed >= MAX_RENDER_FALLBACKS_PER_JOB) return null;
    rendersUsed++; // 記「嘗試次數」（含失敗）以硬性有界成本
    // 觀測性（不改行為）：E2E log 中零提及此路徑 → 觸發時印一行，方便確認 JS 渲染 fallback 有在跑。
    console.log(`[research:deep] render fallback: ${url}`);
    // 記債：名額佔位到底層 fetchRaw 真正 settle 才釋放（逾時仍回 null，但不提前放行下一個），見 runWithSemaphoreTimeout。
    return runWithSemaphoreTimeout(renderSem, () => fn(url), RENDER_FALLBACK_TIMEOUT_MS);
  };
  return {
    async research(input: DeepResearchInput): Promise<DeepResearchBundle> {
      const start = Date.now();
      const budgetMs = options.budgetMs ?? deepBudgetMs();
      const deadlineAt = start + budgetMs;
      const maxQueries = options.maxQueries ?? clampEnvInt("DEEP_RESEARCH_MAX_QUERIES", DEFAULT_MAX_QUERIES, 3, 24);
      const maxSources = options.maxSources ?? clampEnvInt("DEEP_RESEARCH_MAX_SOURCES", DEFAULT_MAX_SOURCES, 0, 20);
      const groundingConcurrency = clampEnvInt(
        "DEEP_RESEARCH_GROUNDING_CONCURRENCY",
        DEFAULT_GROUNDING_CONCURRENCY,
        1,
        6,
      );

      // a. 扇出 grounding 查詢（有界平行）。round 1＝基礎角度＋社群模板；follow-up round＝只跑 extraQueries。
      const queries = queriesForRound(input, maxQueries);
      const groundedFindings = await runPool<{ angle: string; query: string }, GroundedFinding>(
        queries,
        groundingConcurrency,
        deadlineAt,
        async ({ angle, query }) => {
          // S1-A3：帶 groundingModel（升模，deep 走 extractModel）；grounding provider 依 ctx.model 選模，缺→textModel。
          const res = await grounding.answer(query, { companyName: input.companyName, model: options.groundingModel });
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
                let title: string | undefined;
                let text = "";
                let resolved = citation.url;
                try {
                  const r = await fetcher.extractFromUrl(citation.url);
                  title = r.title;
                  text = (r.text ?? "").trim();
                  resolved = r.finalUrl ?? citation.url;
                } catch {
                  /* SafeFetcher 失敗 → 下方嘗試 render fallback（純 undici 抓不到 JS-heavy 頁時） */
                }
                // S1-A5：SafeFetcher 失敗或內文太短（<200 字）→ Playwright 渲染 fallback 抓 innerText（SSRF 安全同 crawler）。
                if (text.length < MIN_SOURCE_TEXT_CHARS) {
                  const rendered = await renderWithLimits(citation.url);
                  if (rendered) {
                    const rt = (rendered.text ?? "").trim();
                    if (rt.length >= MIN_SOURCE_TEXT_CHARS) {
                      text = rt;
                      resolved = rendered.finalUrl ?? resolved;
                      title = title ?? rendered.title;
                    }
                  }
                }
                // 深讀後才知真實 host：若重導回官網 → 丟棄（site-crawl 已覆蓋）。
                if (isCompanyDomain(resolved, input.domain)) return undefined;
                if (text.length < MIN_SOURCE_TEXT_CHARS) return undefined;
                return { url: resolved, title: title ?? citation.title, text, citationUrl: citation.url };
              },
            );

      return { groundedFindings, sourceTexts, citationUrls };
    },
  };
}
