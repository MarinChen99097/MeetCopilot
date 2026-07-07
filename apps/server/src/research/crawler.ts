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
 * quick=單頁 text+meta；detailed=+ 子頁連結評分（最多 5，同源）+ 選配截圖。robust 逾時 + body 文字上限。
 */
import { chromium, type Browser, type BrowserServer, type Route, type Request as PwRequest } from "playwright";
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

const NAV_TIMEOUT_MS = 20_000; // 單頁導航預算
const SETTLE_TIMEOUT_MS = 4_000; // networkidle 等待上限（超時不視為失敗）
const MAX_TEXT_CHARS = 12_000; // 每頁抽取文字上限
const MAX_SUB_PAGES = 5; // detailed 子頁上限（同 ezpagesite max_sub_pages）
// 整場 crawl 硬 deadline：quick（單頁）45s、detailed（含子頁）90s。逾時→整個 crawl reject，
// 讓 hung navigation/close 也不能卡死背景 enrich job（M1 verify 主 bug）。
const CRAWL_DEADLINE_QUICK_MS = 45_000;
const CRAWL_DEADLINE_DETAILED_MS = 90_000;
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

/** 子頁連結評分關鍵字（borrow ezpagesite main.py:2317-2323 的權重法）。 */
const LINK_KEYWORDS: { re: RegExp; weight: number }[] = [
  { re: /\b(about|company|who-?we-?are)\b/i, weight: 5 },
  { re: /\b(product|products|solutions?|platform|features?)\b/i, weight: 5 },
  { re: /\b(pricing|plans?)\b/i, weight: 4 },
  { re: /\b(team|leadership|people|management|founders?)\b/i, weight: 4 },
  { re: /\b(customers?|case-?stud(y|ies)|clients?)\b/i, weight: 3 },
  { re: /\b(news|press|blog|media)\b/i, weight: 2 },
  { re: /\b(contact|careers?|jobs?)\b/i, weight: 2 },
  { re: /\b(docs?|documentation|developers?)\b/i, weight: 3 },
];

function scoreLink(href: string): number {
  let score = 0;
  for (const k of LINK_KEYWORDS) if (k.re.test(href)) score += k.weight;
  return score;
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

async function extractPage(
  browserPage: import("playwright").Page,
  url: string,
  wantShot: boolean,
): Promise<CrawledPage> {
  await browserPage.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  // 給 SPA 一點沉澱時間，但不因 networkidle 逾時而失敗。
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
  let screenshot: string | undefined;
  if (wantShot) {
    const buf = await browserPage
      .screenshot({ fullPage: false, type: "png" })
      .catch(() => null);
    if (buf) screenshot = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
  }
  return { url: browserPage.url() || url, title: title || undefined, text, screenshot };
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
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    const wantShots = opts.mode === "detailed" && Boolean(opts.screenshots);
    const home = await extractPage(page, opts.url, wantShots);
    const sourcesVisited = [home.url];
    const pages: CrawledPage[] = [home];
    const metaRaw = await page
      .evaluate(
        "(function(){var m=document.querySelector('meta[name=description]');return m?(m.getAttribute('content')||''):''})()",
      )
      .catch(() => "");
    const metaDescription = String(metaRaw ?? "") || undefined;

    if (opts.mode === "detailed") {
      const cap = Math.min(opts.maxSubPages ?? MAX_SUB_PAGES, MAX_SUB_PAGES);
      const origin = new URL(home.url).origin;
      const hrefsRaw = await page
        .evaluate(
          "Array.prototype.slice.call(document.querySelectorAll('a[href]')).map(function(a){return a.href;})",
        )
        .catch(() => [] as unknown);
      const hrefs = Array.isArray(hrefsRaw)
        ? hrefsRaw.filter((h): h is string => typeof h === "string")
        : [];
      const seen = new Set<string>([home.url]);
      const candidates: { url: string; score: number }[] = [];
      for (const raw of hrefs) {
        let abs: URL;
        try {
          abs = new URL(raw, home.url);
        } catch {
          continue;
        }
        abs.hash = "";
        const norm = abs.toString();
        if (abs.origin !== origin) continue; // 同源限制
        if (seen.has(norm)) continue;
        seen.add(norm);
        const score = scoreLink(abs.pathname);
        if (score > 0) candidates.push({ url: norm, score });
      }
      candidates.sort((x, y) => y.score - x.score);
      for (const c of candidates.slice(0, cap)) {
        if (Date.now() > deadline) break; // 趨近 deadline → 停止加子頁，回傳已抓到的
        try {
          const sub = await extractPage(page, c.url, wantShots);
          pages.push(sub);
          sourcesVisited.push(sub.url);
        } catch {
          // 單一子頁失敗不致命——續抓其餘。
        }
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
      const deadlineMs =
        opts.mode === "detailed" ? CRAWL_DEADLINE_DETAILED_MS : CRAWL_DEADLINE_QUICK_MS;
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
