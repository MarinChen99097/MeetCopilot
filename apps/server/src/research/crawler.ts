/**
 * CrawlProvider — Playwright（chromium）渲染爬蟲（M1_CONTRACT §2；spike S4）。
 *
 * SSRF（S4 硬核）：undici 的 DNS-pin **對 Playwright 的網路堆疊不適用**（它走 Chromium 自己的 stack）。
 * 落地手法（借 docs/research/EZPAGESITE_CRAWLER.md「v2 必修的缺口」）：
 *  1. **導航前**：解析目標 host 的所有 IP，任一私網/保留 → 拒絕（resolveAndValidate，與 undici 路徑同一套判準），
 *     並取回「已驗證的公網 IP」。
 *  2. **把已驗證 IP pin 進 Chromium**：以 `--host-resolver-rules=MAP <host> <ip>` 啟動（**只 pin 目標 host**）——
 *     Chromium 對起始 host 只會連到我們驗證過的那個 IP（關掉 DNS rebinding／TOCTOU：不再有第二次獨立解析）。
 *     這也涵蓋 detailed 的同源子頁（同 host → 同 pin）。其餘 host 不 fail-close（見 3）。
 *  3. **page.route('**\/*')** 仍逐一攔截每個子請求（含 redirect）做 SSRF 判定——其餘 host 的私網防線靠這層。
 *  ⚠️ 取捨（2026-07-07 修正）：曾加 `MAP * ~NOTFOUND` fail-close 其餘 host，但這會讓常見的 www↔apex 跨 host 重導
 *     （如 www.ghost.org→ghost.org）整個導航失敗（ERR_NAME_NOT_RESOLVED）——實測 ghost.org 被誤擋。改為只 pin
 *     目標 host、其餘 host 交給步驟 3 的 page.route 逐請求 SSRF 閘（resolveAndValidate 擋私網）：使用者提供之目標
 *     URL 的 TOCTOU 仍關閉（已 pin），而跨 host 頁面渲染／重導不再被誤擋。子資源 host 屬 route-guard 判定期防線。
 *
 * quick=單頁 text+meta（不變的快路徑）。
 * detailed=**2 層 BFS ＋有界平行**（key to fitting depth+breadth in 5 min）：
 *  - 從首頁抓 a[href]（含可見文字），以雙語關鍵字（英/中）對 **pathname＋連結文字**評分，取高分同源連結（level 1）；
 *    再從 level-1 頁抓它們的高分連結（level 2）——這樣才觸達「產品列表→產品明細」頁。
 *  - 以 CRAWL_CONCURRENCY（預設 5）條平行 worker（同 context 多開 Page）抓，總頁數 MAX_CRAWL_PAGES（預設 28）為上限；
 *    URL 正規化（去 #fragment／追蹤參數／尾斜線）去重；同源限制（同 host → 同 IP pin）。
 *  - 整場仍受硬 deadline 約束（L13：任何 hung nav/close 都要能被掐斷）；逼近 deadline → 停止加頁，回傳已抓到的（partial 可接受）。
 */
import { chromium, type Browser, type BrowserServer, type Page, type Route, type Request as PwRequest } from "playwright";
import { isPrivateIp, resolveAndValidate } from "../import/extract.js";

/**
 * 建 Chromium `--host-resolver-rules` 值：**只把已驗證的目標 host pin 到它的公網 IP**（不 fail-close 其餘 host）。
 * 這是 F4（DNS-rebinding TOCTOU）對「使用者提供之目標 URL」的核心：Chromium 不再對目標 host 做第二次獨立解析，
 * 只會連到我們驗證過的 IP。其餘 host（跨站子資源／www↔apex 重導）交給 context.route 逐請求 SSRF 閘
 * （resolveAndValidate 擋私網）——先前的 `,MAP * ~NOTFOUND` fail-closed 會讓常見的 www→apex 跨 host 重導
 * （如 www.ghost.org→ghost.org）整個導航失敗（ERR_NAME_NOT_RESOLVED），故移除。
 * IPv6 需加方括號（Chromium rule 的 replacement 以 host[:port] 解析）。匯出供單元測試斷言。
 */
export function hostResolverRules(host: string, ip: string, family: 4 | 6): string {
  const target = family === 6 ? `[${ip}]` : ip;
  return `MAP ${host} ${target}`;
}

// 單頁導航預算：預設 45s。重量級 JS 產品頁（如 CyberPower ut_ups 產品系列頁）的 domcontentloaded
// 常 >20s 才觸發——20s 會硬敗。env `CRAWL_NAV_TIMEOUT_MS` 覆寫，clamp 到 [5s,120s]。這只是「軟預算」，
// 真正的硬上界仍是下方整場 crawl deadline（L13：外部進程一定要能被我方逾時掐斷）。
const DEFAULT_NAV_TIMEOUT_MS = 60_000; // 使用者「慢慢爬沒事」：單頁更有耐心（clamp 上限仍 120s）
const NAV_TIMEOUT_MIN_MS = 5_000;
const NAV_TIMEOUT_MAX_MS = 120_000;
// domcontentloaded 逾時後的「寬鬆重試」預算：改用 waitUntil:"commit"（navigation 一 commit 就 resolve，
// 不等 DOM/子資源），再往下搶救已渲染的部分。短而有界，避免疊加到逼近 deadline。
const RETRY_NAV_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 4_000; // networkidle 等待上限（超時不視為失敗）
const MAX_TEXT_CHARS = 12_000; // 每頁抽取文字上限
// detailed BFS 參數：
const MAX_CRAWL_PAGES_DEFAULT = 28; // 整場總頁數（含首頁）預設；env MAX_CRAWL_PAGES 覆寫，clamp [2,40]
const CRAWL_CONCURRENCY_DEFAULT = 5; // 平行 worker 數預設；env CRAWL_CONCURRENCY 覆寫，clamp [1,8]
const MAX_CRAWL_DEPTH = 2; // 從首頁往下追連結的層數（level 1 產品列表 → level 2 產品明細）
const LEVEL1_FRACTION = 0.35; // 非末層取用預算比例——留較多餘額給更深層的產品明細頁（否則 level-1 分類頁就把預算吃光）
// softDeadline 相對硬 deadline 的安全邊際：留給「回傳 partial ＋有界 teardown（≤10s）」在硬上限前收尾，
// 避免整場 crawl 被外層硬 guard reject（會丟掉已抓到的頁）。
const DEADLINE_SAFETY_MARGIN_MS = 15_000;
// 整場 crawl 硬 deadline（仍有界，L13：hung navigation/close 不能卡死背景 enrich job）。
// 使用者「慢慢爬沒事」→放寬讓慢頁爬得完：quick 單頁 120s、detailed（最多 5 子頁）300s。
// 可經 env CRAWL_DEADLINE_QUICK_MS / CRAWL_DEADLINE_DETAILED_MS 覆寫（於呼叫時讀，見 crawlDeadlineMs）。
const CRAWL_DEADLINE_QUICK_DEFAULT_MS = 120_000;
const CRAWL_DEADLINE_DETAILED_DEFAULT_MS = 300_000;

/**
 * 從 env（`CRAWL_NAV_TIMEOUT_MS`）解析單頁導航逾時，clamp 到 [5s,120s]；未設/非法 → 45s。
 * **在呼叫時讀取**（非 import 時）：apps/server/.env 由 loadConfig() 於 bootstrap 載入，crawl 實際
 * 執行時 process.env 已就緒。此值只是軟預算，整場 crawl 仍受上方 deadline 硬界約束。匯出供測試。
 */
/** 共用：於呼叫時讀 env（非 import 時，避 .env 尚未載入），未設/非法→def，clamp 到 [min,max]。 */
function clampEnvMs(envName: string, def: number, min: number, max: number): number {
  const raw = Number(process.env[envName]);
  if (!Number.isFinite(raw) || raw <= 0) return def;
  return Math.min(Math.max(Math.trunc(raw), min), max);
}
export function navTimeoutMs(): number {
  return clampEnvMs("CRAWL_NAV_TIMEOUT_MS", DEFAULT_NAV_TIMEOUT_MS, NAV_TIMEOUT_MIN_MS, NAV_TIMEOUT_MAX_MS);
}
/**
 * 整場 crawl deadline（呼叫時讀 env）。使用者要求「爬官網限 5 分鐘以內」→ **硬上限 300s（5 分鐘）**：
 * detailed 預設 300s、上限 300s；quick 預設 120s、上限 300s。env 可調低但**不得超過 5 分鐘**。
 */
export const CRAWL_HARD_CAP_MS = 300_000; // 5 分鐘硬上限（使用者需求）
export function crawlDeadlineMs(mode: "quick" | "detailed"): number {
  return mode === "detailed"
    ? clampEnvMs("CRAWL_DEADLINE_DETAILED_MS", CRAWL_DEADLINE_DETAILED_DEFAULT_MS, 30_000, CRAWL_HARD_CAP_MS)
    : clampEnvMs("CRAWL_DEADLINE_QUICK_MS", CRAWL_DEADLINE_QUICK_DEFAULT_MS, 15_000, CRAWL_HARD_CAP_MS);
}
/**
 * detailed BFS 的總頁數上限（含首頁；呼叫時讀 env MAX_CRAWL_PAGES）。預設 28、clamp [2,40]。
 * 真正的硬止血仍是整場 crawl deadline（≤5 分鐘）：無論頁數上限多少，逼近 deadline 就停止加頁。匯出供測試。
 */
export function maxCrawlPages(): number {
  return clampEnvMs("MAX_CRAWL_PAGES", MAX_CRAWL_PAGES_DEFAULT, 2, 40);
}
/**
 * detailed BFS 的平行 worker 數（呼叫時讀 env CRAWL_CONCURRENCY）。預設 5、clamp [1,8]——
 * 這是「5 分鐘內塞進更多頁」的關鍵：同一 context 多開 Page 併發抓，慢頁不擋其他頁。匯出供測試。
 */
export function crawlConcurrency(): number {
  return clampEnvMs("CRAWL_CONCURRENCY", CRAWL_CONCURRENCY_DEFAULT, 1, 8);
}
// browser.close() 在此機器上會永久卡住 → 給它 5s，逾時就 SIGKILL 底層 Chromium process。
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

/** 抽取到的單頁內容。 */
export interface CrawledPage {
  url: string;
  title?: string;
  text: string;
  screenshot?: string; // data:image/png;base64,...（僅 detailed + screenshots 開啟時）
}

/** 爬蟲原始輸出（餵給 CrawlExtractor）。 */
export interface RawCrawl {
  url: string; // 請求的起始 URL
  finalUrl?: string; // 導航後的實際 URL（含 redirect）
  title?: string;
  metaDescription?: string;
  /** 首頁 + 子頁（quick 僅首頁）。 */
  pages: CrawledPage[];
  /** 打過的所有 URL（寫入 crawl_jobs.sources_json）。 */
  sourcesVisited: string[];
}

/** crawl 選項（API_CONTRACT §3 enrich 的 mode 對映）。 */
export interface CrawlOptions {
  url: string;
  mode: "quick" | "detailed";
  maxSubPages?: number;
  screenshots?: boolean; // detailed 才有意義；預設關（省時）
}

export interface CrawlProvider {
  crawl(opts: CrawlOptions): Promise<RawCrawl>;
}

/**
 * 子頁連結評分關鍵字——**雙語（英/中）**，且對「pathname＋連結可見文字」一起評分（borrow ezpagesite 權重法，
 * 但擴充中文與 spec/價格/型號 類詞，優先產品/規格/定價頁）。用 substring（非 \b），因 CJK 與已解碼路徑沒有詞界。
 */
const LINK_KEYWORDS: { re: RegExp; weight: number }[] = [
  // 產品／系列／規格／型號（最高權重——這是 CRM 要的深資料所在）
  { re: /product|solutions?|platform|features?|series|catalog(ue)?|line-?up|models?|spec(ification)?s?|datasheet/i, weight: 5 },
  { re: /產品|系列|型號|規格|產品線|型錄|技術規格|解決方案/, weight: 5 },
  // 定價／購買
  { re: /pricing|plans?|price|quote|buy|shop|store|where-?to-?buy/i, weight: 4 },
  { re: /價格|定價|報價|購買|商店|經銷|通路|哪裡買/, weight: 4 },
  // 技術文件／支援／下載（常含 spec）
  { re: /docs?|documentation|developers?|support|download|resources?|manuals?/i, weight: 3 },
  { re: /文件|技術|下載|支援|服務|手冊|資源/, weight: 3 },
  // 關於／公司
  { re: /about|company|who-?we-?are|profile|overview|corporate/i, weight: 3 },
  { re: /關於|公司|簡介|概覽|品牌|企業/, weight: 3 },
  // 團隊／主管
  { re: /team|leadership|people|management|founders?|executives?|board/i, weight: 3 },
  { re: /團隊|主管|領導|經營團隊|管理團隊|創辦人|高層|董事/, weight: 3 },
  // 客戶／案例
  { re: /customers?|case-?stud(y|ies)|clients?|success|references?/i, weight: 2 },
  { re: /客戶|案例|實績|成功案例|合作夥伴/, weight: 2 },
  // 新聞／媒體
  { re: /news|press|blog|media|events?|insights?/i, weight: 2 },
  { re: /新聞|消息|公告|媒體|活動|部落格/, weight: 2 },
  // 聯絡／徵才（低權重，仍偶含公司資訊）
  { re: /contact|careers?|jobs?/i, weight: 1 },
  { re: /聯絡|聯繫|徵才|職缺|人才/, weight: 1 },
];

/** 認證/交易/工具/法遵頁——跳過（return 0）：無 CRM 價值又會排擠產品明細頁的預算。只比對 pathname。 */
const LINK_EXCLUDE_RE =
  /(^|\/)(sign-?in|log-?in|log-?out|sign-?up|register|account|my-?account|cart|checkout|wishlist|password|reset|search|sitemap|privacy|terms|cookies?|gdpr|legal|subscribe|newsletter|rss|feed)(\/|$)/i;
/**
 * 「個別產品明細/規格頁」加成——這是 specs/pricing/features 的真正所在，須排在「產品總覽/分類頁」之前。
 * CyberPower 的明細頁樣式：/product/sku/<model>；一般站另見 /series/、/model/、/dp/、product-detail、規格/型號/比較。
 */
const LINK_DETAIL_BOOST: { re: RegExp; weight: number }[] = [
  { re: /\/sku\/|\/product\/sku|\/series\/|\/model\/|\/dp\/|product-?detail/i, weight: 5 },
  { re: /comparison|compare|spec(ification)?s?|datasheet|規格|型號|比較|技術規格/i, weight: 2 },
];

/** 對「pathname（試解碼）＋連結文字」評分。分數越高越像產品明細/規格/定價/公司頁。認證/工具頁→0。 */
function scoreLink(pathname: string, text: string): number {
  let path = pathname;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    /* 保留原樣 */
  }
  if (LINK_EXCLUDE_RE.test(path)) return 0;
  const hay = `${path} ${text}`;
  let score = 0;
  for (const k of LINK_KEYWORDS) if (k.re.test(hay)) score += k.weight;
  for (const k of LINK_DETAIL_BOOST) if (k.re.test(hay)) score += k.weight;
  return score;
}

/** 已評分的候選連結（url 已正規化）。 */
interface ScoredLink {
  url: string;
  score: number;
}

/** 追蹤／噪音 query 參數（去除以穩定 dedup key，不影響內容）。 */
const TRACKING_PARAM_RE = /^(utm_|mc_|ref$|ref_|fbclid$|gclid$|gclsrc$|_ga$|yclid$|msclkid$|igshid$|mkt_tok$|src$|source$)/i;

/**
 * URL 正規化（dedup key）：去 #fragment、去追蹤參數、其餘 query 依鍵排序、去尾斜線（root 除外）。
 * 讓 `/p/`、`/p`、`/p?utm_x=1#top` 收斂為同一鍵，避免重複抓同一頁。
 */
function normalizeUrl(u: URL): string {
  const c = new URL(u.toString());
  c.hash = "";
  for (const key of [...c.searchParams.keys()]) {
    if (TRACKING_PARAM_RE.test(key)) c.searchParams.delete(key);
  }
  c.searchParams.sort();
  if (c.pathname.length > 1 && c.pathname.endsWith("/")) {
    c.pathname = c.pathname.replace(/\/+$/, "");
  }
  return c.toString();
}

/** 從一個已導航的 Page 抓 a[href]＋可見文字，映射為同源、正規化、評分>0 的候選（頁內先去重）。 */
async function collectScoredLinks(browserPage: Page, origin: string): Promise<ScoredLink[]> {
  const raw = await browserPage
    .evaluate(
      "Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(function(a){return {href:a.href, text:(a.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120)};})",
    )
    .catch(() => [] as unknown);
  const arr = Array.isArray(raw) ? raw : [];
  const localSeen = new Set<string>();
  const out: ScoredLink[] = [];
  for (const item of arr) {
    const href = (item as { href?: unknown } | null)?.href;
    const textRaw = (item as { text?: unknown } | null)?.text;
    if (typeof href !== "string") continue;
    let abs: URL;
    try {
      abs = new URL(href, browserPage.url());
    } catch {
      continue;
    }
    if (abs.origin !== origin) continue; // 同源限制（同 host → 同 IP pin，SSRF 不放大）
    const norm = normalizeUrl(abs);
    if (localSeen.has(norm)) continue;
    localSeen.add(norm);
    const score = scoreLink(abs.pathname, typeof textRaw === "string" ? textRaw : "");
    if (score > 0) out.push({ url: norm, score });
  }
  return out;
}

/** 對一個 request 的 URL 判定是否放行（供 page.route）。快取每 host 的判定。 */
function makeRouteGuard(cache: Map<string, Promise<boolean>>) {
  const allowed = async (rawUrl: string): Promise<boolean> => {
    let u: URL;
    try {
      u = new URL(rawUrl);
    } catch {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname;
    let decision = cache.get(host);
    if (!decision) {
      decision = (async () => {
        try {
          await resolveAndValidate(host); // 任一 IP 私網即 throw
          return true;
        } catch {
          return false;
        }
      })();
      cache.set(host, decision);
    }
    return decision;
  };
  return async (route: Route, request: PwRequest): Promise<void> => {
    try {
      const ok = await allowed(request.url());
      if (ok) await route.continue();
      else await route.abort("blockedbyclient");
    } catch {
      await route.abort("failed").catch(() => {});
    }
  };
}

/** 去掉 URL 的 #fragment（純 client-side，不影響 server 導航，去掉更乾淨、避免奇怪等待）。原 URL 由呼叫端另留作 provenance。 */
function stripHash(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

async function extractPage(
  browserPage: import("playwright").Page,
  url: string,
  wantShot: boolean,
  navTimeout: number,
): Promise<CrawledPage> {
  const navUrl = stripHash(url);
  // 導航策略（root causes 1–3）：
  //  (1) 先以 domcontentloaded＋navTimeout 導航——它**不等子資源**，故被 route-guard abort 的跨站
  //      子請求（SSRF 閘）不會卡住 goto；只有主文件本身會被等待。
  //  (2) 逾時（重量級 JS 頁 domcontentloaded 遲遲不觸發）**不硬敗**：改以 waitUntil:"commit"
  //      （navigation 一 commit 即 resolve、不等 DOM）寬鬆重試一次，再往下抽「已渲染的部分」。
  //  (3) navUrl 已去掉 #fragment。
  try {
    await browserPage.goto(navUrl, { waitUntil: "domcontentloaded", timeout: navTimeout });
  } catch {
    await browserPage
      .goto(navUrl, { waitUntil: "commit", timeout: RETRY_NAV_TIMEOUT_MS })
      .catch(() => {}); // 連 commit 都失敗（DNS/連線被擋）→ 下方仍嘗試搶救，真的空才丟錯。
  }
  // 給 SPA 一點沉澱時間，但不因 networkidle 逾時而失敗（有界；不會卡在被 abort 的子請求上）。
  await browserPage.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  const title = await browserPage.title().catch(() => undefined);
  // 用 **string-form** evaluate（在瀏覽器內執行），避免在 Node lib（無 DOM）下 typecheck `document`。
  const rawText = await browserPage
    .evaluate("document.body ? document.body.innerText : ''")
    .catch(() => "");
  const text = String(rawText ?? "")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT_CHARS);
  // 部分頁勝過整個 job 失敗：只有「真的什麼都沒渲染」才算導航失敗（首頁失敗上拋、子頁失敗被上層 try 吞掉並續抓）。
  if (!title && text.length === 0) {
    throw new Error(`crawl navigation produced no content: ${navUrl}`);
  }
  let screenshot: string | undefined;
  if (wantShot) {
    const buf = await browserPage
      .screenshot({ fullPage: false, type: "png" })
      .catch(() => null);
    if (buf) screenshot = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
  }
  return { url: browserPage.url() || navUrl, title: title || undefined, text, screenshot };
}

/** BROWSER_CLOSE_TIMEOUT_MS 後 resolve 的計時器（有界等待；配合 server.kill() 強制收尾）。 */
function boundedWait<T>(p: Promise<T>): Promise<T | void> {
  return Promise.race<T | void>([
    p,
    new Promise<void>((resolve) => setTimeout(resolve, BROWSER_CLOSE_TIMEOUT_MS)),
  ]).catch(() => {});
}

/**
 * 有界拆除：先給正常 close BROWSER_CLOSE_TIMEOUT_MS（此機器上 close() 會永久卡→不等它），
 * 再 server.kill() 強制終止底層 Chromium process。無論 close 是否卡住都一定返回——
 * 這是「crawl() 永不 hang」的關鍵一環。用 launchServer+connect 就是為了拿到能真正強殺的 BrowserServer。
 */
async function teardown(browser: Browser | null, server: BrowserServer | null): Promise<void> {
  if (browser) {
    // close() 卡住/失敗都不致命——底下 server.kill() 會強制收尾。
    await boundedWait(browser.close());
  }
  if (server) {
    // BrowserServer.kill() 強制終止底層 process（正解：不依賴公開型別沒有的 Browser.process()）。
    await boundedWait(server.kill());
  }
}

/** 執行一次 crawl 的實體（含 browser 生命週期＋有界 teardown）；整場 deadline 由 crawl() 以 Promise.race 施加。 */
async function runCrawl(opts: CrawlOptions, deadlineMs: number): Promise<RawCrawl> {
  // 導航前的第一道閘：起始 host 必須解析為公網（也擋 literal 內網 IP）。
  const start = new URL(opts.url); // 非法 URL → throw（route 呼叫端映射 400/failed）
  if (start.protocol !== "http:" && start.protocol !== "https:") {
    throw new Error("只允許 http/https 網址");
  }
  // 私網 → throw；回傳已驗證的公網 IP，等下 pin 進 Chromium（堵死 rebinding：不再有第二次獨立解析）。
  const validated = await resolveAndValidate(start.hostname);

  const deadline = Date.now() + deadlineMs;
  // 內部軟 deadline：比外層硬 guard 早 DEADLINE_SAFETY_MARGIN_MS 停手，讓 runCrawl 有時間回傳 partial ＋有界 teardown，
  // 在 5 分鐘硬上限前收尾（否則整場被 crawl() 的硬 guard reject → 丟掉已抓到的頁）。
  const softDeadline = deadline - DEADLINE_SAFETY_MARGIN_MS;
  let server: BrowserServer | null = null;
  let browser: Browser | null = null;
  const routeCache = new Map<string, Promise<boolean>>();
  try {
    // launchServer + connect：拿到 BrowserServer，teardown 才能 server.kill() 真正強殺（Browser 無 public process()）。
    // --host-resolver-rules：Chromium 只會把起始 host 連到我們驗證過的 IP（F4）；其餘 host 由 context.route 逐請求把關。
    server = await chromium.launchServer({
      headless: true,
      args: ["--no-sandbox", `--host-resolver-rules=${hostResolverRules(start.hostname, validated.ip, validated.family)}`],
    });
    browser = await chromium.connect(server.wsEndpoint());
    const context = await browser.newContext({
      userAgent: "MeetCopilot/0.1 (research-crawler)",
      viewport: { width: 1366, height: 900 },
    });
    // 每個子請求逐一過 SSRF 閘（含 redirect 觸發的新請求）。
    await context.route("**/*", makeRouteGuard(routeCache));

    const page = await context.newPage();
    const navTimeout = navTimeoutMs(); // env CRAWL_NAV_TIMEOUT_MS（預設 45s，clamp 5–120s）
    page.setDefaultNavigationTimeout(navTimeout);

    const wantShots = opts.mode === "detailed" && Boolean(opts.screenshots);
    const home = await extractPage(page, opts.url, wantShots, navTimeout);
    const sourcesVisited = [home.url];
    const pages: CrawledPage[] = [home];
    const metaRaw = await page
      .evaluate(
        "(function(){var m=document.querySelector('meta[name=description]');return m?(m.getAttribute('content')||''):''})()",
      )
      .catch(() => "");
    const metaDescription = String(metaRaw ?? "") || undefined;

    if (opts.mode === "detailed") {
      const origin = new URL(home.url).origin;
      // 總頁數上限：env MAX_CRAWL_PAGES（預設 28）；opts.maxSubPages 若提供可再壓低（1 首頁 + N 子頁）。
      const pageBudget = Math.min(maxCrawlPages(), 1 + (opts.maxSubPages ?? Number.MAX_SAFE_INTEGER));
      const concurrency = crawlConcurrency();
      // 已見（正規化）URL——含「已抓」與「已排入 frontier」，只在單執行緒段變動，避免平行 worker 重複排入。
      const seen = new Set<string>([normalizeUrl(new URL(home.url))]);
      const markNew = (links: ScoredLink[]): ScoredLink[] => {
        const fresh: ScoredLink[] = [];
        for (const l of links) {
          if (seen.has(l.url)) continue;
          seen.add(l.url);
          fresh.push(l);
        }
        return fresh;
      };

      // 平行頁池（同 context 多開 Page；含首頁的 page 當 pool[0] 複用）。context.route 是 context 級 → 每頁都過 SSRF 閘。
      const pool: Page[] = [page];
      const ensurePages = async (n: number): Promise<Page[]> => {
        while (pool.length < n) {
          const p = await context.newPage();
          p.setDefaultNavigationTimeout(navTimeout);
          pool.push(p);
        }
        return pool.slice(0, n);
      };

      // 有界平行抓一批 URL；整批對 softDeadline 賽跑（逾時即回已完成的，不空等 in-flight 慢頁——它們由 teardown 收尾）。
      const fetchMany = async (
        urls: string[],
        collect: boolean,
      ): Promise<{ page: CrawledPage; links: ScoredLink[] }[]> => {
        const results: { page: CrawledPage; links: ScoredLink[] }[] = [];
        if (urls.length === 0 || Date.now() > softDeadline) return results;
        const workers = await ensurePages(Math.min(concurrency, urls.length));
        let idx = 0;
        const runWorker = async (wp: Page): Promise<void> => {
          for (;;) {
            if (Date.now() > softDeadline) return;
            const i = idx++;
            if (i >= urls.length) return;
            const url = urls[i]!;
            try {
              const cp = await extractPage(wp, url, wantShots, navTimeout);
              const links = collect ? await collectScoredLinks(wp, origin) : [];
              results.push({ page: cp, links });
            } catch {
              // 單一子頁失敗不致命——續抓其餘。
            }
          }
        };
        const all = Promise.all(workers.map(runWorker));
        all.catch(() => {}); // race 掉 all 後殘餘 worker 的錯誤已在其 try/catch 內處理，這裡兜底避免 unhandled rejection。
        let timer: ReturnType<typeof setTimeout> | undefined;
        const guard = new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.max(0, softDeadline - Date.now()));
        });
        await Promise.race([all, guard]);
        if (timer) clearTimeout(timer);
        return results;
      };

      // 依「導航後的最終 URL」去重（避免多個候選各自 redirect 到同一頁——如都導回首頁——被重複抽取、浪費預算）。
      const fetchedFinals = new Set<string>([normalizeUrl(new URL(home.url))]);

      // frontier = 已排入、依分數降冪的候選（尚未抓）。首頁連結 → level-1 候選。
      let frontier = markNew(await collectScoredLinks(page, origin)).sort((a, b) => b.score - a.score);

      // 2 層 BFS：depth 1 抓 level-1（限量、保留預算）並展開其連結；depth 2 抓 level-2（不再展開）。
      for (let depth = 1; depth <= MAX_CRAWL_DEPTH; depth++) {
        if (Date.now() > softDeadline || pages.length >= pageBudget || frontier.length === 0) break;
        const remaining = pageBudget - pages.length;
        const collect = depth < MAX_CRAWL_DEPTH; // 末層不再展開連結
        const take = collect
          ? Math.min(frontier.length, remaining, Math.max(1, Math.ceil((pageBudget - 1) * LEVEL1_FRACTION)))
          : Math.min(frontier.length, remaining);
        const batch = frontier.slice(0, take);
        frontier = frontier.slice(take); // 未取的同層候選留在 frontier（次要 fallback，別浪費預算）
        if (process.env.CRAWL_DEBUG) {
          // 診斷用（env-gated，production 預設關）：印各層抓取量，供 ops/驗證觀察 BFS 深度與頁數。
          console.error(
            `[crawl] depth ${depth}/${MAX_CRAWL_DEPTH}: fetching ${batch.length} (visited ${pages.length}/${pageBudget}, frontier left ${frontier.length}, concurrency ${concurrency})`,
          );
        }
        const results = await fetchMany(batch.map((b) => b.url), collect);
        const children: ScoredLink[] = [];
        for (const r of results) {
          if (pages.length >= pageBudget) break;
          let finalNorm: string;
          try {
            finalNorm = normalizeUrl(new URL(r.page.url));
          } catch {
            finalNorm = r.page.url;
          }
          if (fetchedFinals.has(finalNorm)) continue; // 導航後撞到已抓過的最終 URL（如都導回首頁）→ 略過
          fetchedFinals.add(finalNorm);
          pages.push(r.page);
          sourcesVisited.push(r.page.url);
          if (collect) children.push(...r.links);
        }
        // 下一輪：本層新子連結（更深的產品明細）＋未取同層候選，重新去重＋降冪排序。
        frontier = [...frontier, ...markNew(children)].sort((a, b) => b.score - a.score);
      }
    }

    return {
      url: opts.url,
      finalUrl: home.url,
      title: home.title,
      metaDescription: metaDescription || undefined,
      pages,
      sourcesVisited,
    };
  } finally {
    // 有界拆除：close 逾時就 server.kill() 強殺——保證此函式一定回傳/丟錯，永不 hang（即使 connect/close 拋錯，server 也一定被 kill）。
    await teardown(browser, server);
  }
}

export function createCrawlProvider(): CrawlProvider {
  return {
    async crawl(opts: CrawlOptions): Promise<RawCrawl> {
      // 整場 crawl 硬 deadline：hung navigation/close 也不得卡死背景 enrich job。逾時 → 明確 Error。
      const deadlineMs = crawlDeadlineMs(opts.mode);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const guard = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`crawl exceeded overall deadline (${deadlineMs}ms)`)),
          deadlineMs,
        );
      });
      const work = runCrawl(opts, deadlineMs);
      // 若 deadline 先 reject，work 稍後才 reject（被強制關閉的 nav）——先掛 catch 避免 unhandled rejection。
      work.catch(() => {});
      try {
        return await Promise.race([work, guard]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

// 匯出判準供測試（Verify 的 SSRF 測試可直接呼叫）。
export { isPrivateIp };
