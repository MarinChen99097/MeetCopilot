/**
 * 來源抽取（SafeFetcher）：把「網址」或「PDF」抽成純文字。M1_CONTRACT §2 的 `SafeFetcher` 落地。
 * v2 研究引擎的 undici 路徑（crawler 的 Playwright 路徑另用 page.route 攔截，見 research/crawler.ts）。
 *
 * ⚠️ 網址抽取有 SSRF 風險（伺服器代抓任意 URL）。守則（整包移植自 v1 apps/server/src/import/extract.ts）：
 *  - 只允許 http/https；
 *  - 解析主機名的所有 IP，若任一為 loopback/私有/link-local/CGNAT/雲端 metadata/保留位址一律拒絕；
 *  - **把驗證過的 IP pin 到實際連線**（undici Agent 自訂 lookup）——否則 DNS rebinding（驗證用公網 IP、
 *    連線時改回內網 IP）可繞過檢查（v1 code-review 2026-07-05 抓到的 TOCTOU）；
 *  - 重導「逐跳」重新解析＋驗證＋pin（redirect: manual，最多 3 跳）；
 *  - 單一逾時涵蓋 DNS＋標頭＋**body 讀取全程**（避免慢速滴水 body 拖住連線）＋回應大小上限。
 *
 * `isPrivateIp` / `resolveAndValidate` 匯出供 research/crawler.ts 的 Playwright 逐請求檢查共用（同一套判準）。
 */
import dns from "node:dns/promises";
import net from "node:net";
// 用 undici 自己的 fetch（而非 Node 全域 fetch）——才能把同版 undici 的 Agent 當 dispatcher（IP pin）；
// 混用「安裝的 undici Agent × Node 內建 undici 的全域 fetch」會因版本不符報 "invalid onRequestStart method"。
import { fetch as undiciFetch, Agent, type RequestInit, type Response as UndiciResponse } from "undici";
import pdfParse from "pdf-parse";

const MAX_BODY_BYTES = 3_000_000; // 抓網頁的硬上限
const MAX_TEXT_CHARS = 8000; // 餵進 prompt 的文字上限
const FETCH_TIMEOUT_MS = 10_000; // 涵蓋標頭＋body 的總預算（DNS 另有 DNS_TIMEOUT_MS）
const DNS_TIMEOUT_MS = 5_000; // node:dns.lookup 收不到 AbortSignal，另用 race 綁上限（黑洞/慢速 nameserver 否則會拖過總預算）
const MAX_REDIRECTS = 3;
// 429/503 常是「暫時性」限流（很多站台是 by-IP 節流，非只看 UA）；短暫等一下再試一次，仍失敗才報。
const RETRY_STATUSES = new Set([429, 503]);
const MAX_FETCH_ATTEMPTS = 2;
const MAX_RETRY_WAIT_MS = 2_500; // 尊重 Retry-After 但設上限——避免站台叫我們等 60s 而拖爆總預算

// 送出「像瀏覽器」的標頭——很多站台（WordPress + Cloudflare/Wordfence 等）對非瀏覽器 UA 直接回 429/403。
// 這是使用者主動貼上、想匯入的頁面，用真實瀏覽器 UA 才抓得到（bot UA 實測 429、瀏覽器 UA 200）。
const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "zh-TW,zh;q=0.9,en;q=0.8",
};

/**
 * 位址是否為內部/保留（loopback/私網/link-local/CGNAT/雲端 metadata/測試網段）。
 * 無法判斷 → 保守拒絕（回 true）。crawler 的 Playwright 逐請求檢查共用此判準。
 */
export function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    // noUncheckedIndexedAccess 下用 Number(parts[i])（缺格＝NaN，比較恆 false），避免 number|undefined 的關係運算報錯。
    const parts = ip.split(".");
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / 雲端 metadata (AWS/GCP/Azure 169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT（Alibaba metadata 100.100.100.200）
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF 協定指派 + 192.0.2.0/24 TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a === 198 && b === 51) return true; // 198.51.100.0/24 TEST-NET-2
    if (a === 203 && b === 0) return true; // 203.0.113.0/24 TEST-NET-3
    if (a >= 224) return true; // multicast / 保留 / broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice("::ffff:".length)); // v4-mapped
    if (lower.startsWith("64:ff9b:")) return true; // NAT64（可映射到內網 v4）
    return false;
  }
  return true; // 無法判斷 → 保守拒絕
}

/** dns.lookup 無法被取消，用 race 綁一個上限——避免慢速/黑洞 nameserver 讓 handler 卡過總預算。 */
async function lookupAll(hostname: string): Promise<{ address: string; family: number }[]> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("DNS 解析逾時")), DNS_TIMEOUT_MS);
  });
  try {
    return await Promise.race([dns.lookup(hostname, { all: true }), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** 解析主機名，驗證所有 IP 皆為公網，回傳一個要 pin 的 IP＋family。literal IP 直接驗。 */
export async function resolveAndValidate(hostname: string): Promise<{ ip: string; family: 4 | 6 }> {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("目標位址為內部/保留位址，不允許抓取");
    return { ip: hostname, family: net.isIPv6(hostname) ? 6 : 4 };
  }
  const addrs = await lookupAll(hostname);
  if (addrs.length === 0) throw new Error("無法解析網域");
  for (const a of addrs) {
    if (isPrivateIp(a.address)) throw new Error("網域解析到內部位址，不允許抓取");
  }
  const chosen = addrs[0]!;
  return { ip: chosen.address, family: chosen.family === 6 ? 6 : 4 };
}

/** 建一個把 DNS 釘死到已驗證 IP 的 undici Agent——關掉 DNS rebinding 的漏洞。 */
function pinnedAgent(ip: string, family: 4 | 6): Agent {
  const lookup = (
    _hostname: string,
    options: { all?: boolean } | undefined,
    cb: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
  ) => {
    if (options && options.all) cb(null, [{ address: ip, family }]);
    else cb(null, ip, family);
  };
  return new Agent({
    connect: { lookup: lookup as never, timeout: FETCH_TIMEOUT_MS },
    headersTimeout: FETCH_TIMEOUT_MS,
    bodyTimeout: FETCH_TIMEOUT_MS,
  });
}

async function safeFetch(
  rawUrl: string,
  signal: AbortSignal,
  depth: number,
  dispatchers: Agent[],
): Promise<UndiciResponse> {
  if (depth > MAX_REDIRECTS) throw new Error("重導次數過多");
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("只允許 http/https 網址");
  const { ip, family } = await resolveAndValidate(u.hostname);
  const dispatcher = pinnedAgent(ip, family);
  dispatchers.push(dispatcher);

  const init: RequestInit = {
    redirect: "manual",
    signal,
    dispatcher,
    headers: BROWSER_HEADERS,
  };
  const res = await undiciFetch(rawUrl, init);

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    await res.body?.cancel().catch(() => {});
    if (!loc) throw new Error("重導回應缺少 location");
    return safeFetch(new URL(loc, rawUrl).toString(), signal, depth + 1, dispatchers); // 逐跳重新驗證＋pin
  }
  return res;
}

/** 解析回應真正的字元編碼：Content-Type charset → HTML <meta charset> → 預設 utf-8。 */
function resolveCharset(buf: Buffer, ctype: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(ctype)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  // 無 header charset 時，嗅探開頭位元組的 <meta charset> / <meta http-equiv>（用 latin1 讀，只為抓 ASCII 標記）。
  const head = buf.subarray(0, 2048).toString("latin1");
  const meta =
    /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+http-equiv=["']?content-type["']?[^>]*content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  return (meta ?? "utf-8").toLowerCase();
}

/** 依解析出的編碼把 body 解成字串。Node 內建 TextDecoder 支援 big5/gbk/gb18030/shift_jis 等；未知標籤退回 utf-8。 */
function decodeBody(buf: Buffer, ctype: string): string {
  const label = resolveCharset(buf, ctype);
  if (label === "utf-8" || label === "utf8") return buf.toString("utf8");
  try {
    return new TextDecoder(label).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}

/** 極簡 HTML → 純文字：去 script/style/註解、抽 <title>、剝標籤、收斂空白、截斷。 */
function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(titleMatch[1] ?? "").trim().slice(0, 200) : undefined;
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|h[1-6]|li|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    // 標籤剝除後文字只會更短，故先截到一個安全上限（留給後續 decode/收斂空白的膨脹餘裕）再處理，
    // 避免對最多 3MB 的網頁全文重複跑多次 O(n) replace。
    .slice(0, MAX_TEXT_CHARS * 4);
  const text = decodeEntities(body).replace(/[ \t\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { title, text: text.slice(0, MAX_TEXT_CHARS) };
}

// 合法 Unicode 範圍才轉字元，避免 &#9999999999; 這類越界值讓 String.fromCodePoint 丟 RangeError 而崩掉整頁抽取。
function codePoint(n: number): string {
  return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => codePoint(parseInt(n, 16))) // 十六進位數值字元參照 &#xNNNN;
    .replace(/&#(\d+);/g, (_, n) => codePoint(Number(n)));
}

/**
 * 抓網址並抽成純文字。回傳 { title?, text, finalUrl? }。SSRF-guarded（含 DNS pin）＋單一逾時涵蓋 body。
 * `finalUrl`＝逐跳重導後實際抓到的 URL（如 grounding 的 redirect → 真實新聞/維基頁）；供 deep 研究把
 * provenance 錨定到「真正的來源網址」而非中介 redirect。缺（無 res.url）→ 沿用請求的 rawUrl。
 */
export async function extractFromUrl(rawUrl: string): Promise<{ title?: string; text: string; finalUrl?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const dispatchers: Agent[] = [];
  try {
    let res = await safeFetch(rawUrl, controller.signal, 0, dispatchers);
    for (let attempt = 1; RETRY_STATUSES.has(res.status) && attempt < MAX_FETCH_ATTEMPTS; attempt++) {
      // Retry-After 可為「秒數」或「HTTP-date」；先試秒數，非有限值再試日期形式，都拿不到就退回 800ms。
      const raw = res.headers.get("retry-after");
      let raSec = Number(raw);
      if (!Number.isFinite(raSec)) {
        const t = Date.parse(raw ?? "");
        raSec = Number.isFinite(t) ? (t - Date.now()) / 1000 : 0;
      }
      const waitMs = Math.min(raSec > 0 ? raSec * 1000 : 800, MAX_RETRY_WAIT_MS);
      await res.body?.cancel().catch(() => {});
      // 讓 sleep 也能被外層 controller 中止——否則等待期間逾時，醒來還會對已 abort 的 signal 再發一次 safeFetch
      // （浪費 DNS 解析＋必然 AbortError）。sleep 後若已 abort 就直接跳出，不再重試。
      await new Promise<void>((resolve) => {
        const sig = controller.signal;
        const t = setTimeout(done, waitMs);
        function done() {
          clearTimeout(t);
          sig.removeEventListener("abort", done);
          resolve();
        }
        sig.addEventListener("abort", done, { once: true });
      });
      if (controller.signal.aborted) break;
      res = await safeFetch(rawUrl, controller.signal, 0, dispatchers); // 重跑 safeFetch → 重導/SSRF 全部重驗＋重 pin
    }
    if (res.status === 429 || res.status === 503) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`來源網站暫時限流（${res.status}），請稍後再試`);
    }
    if (!res.ok) throw new Error(`來源回應 ${res.status}`);
    // res.url＝最後一跳（非重導）的請求 URL＝真實來源頁（redirect: manual + 逐跳遞迴後）。
    const finalUrl = typeof res.url === "string" && res.url.length > 0 ? res.url : rawUrl;
    const ctype = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml|text\/plain/i.test(ctype)) {
      await res.body?.cancel().catch(() => {});
      throw new Error(`不支援的內容型別：${ctype || "未知"}（僅支援網頁）`);
    }
    const len = Number(res.headers.get("content-length") ?? "0");
    if (len && len > MAX_BODY_BYTES) {
      await res.body?.cancel().catch(() => {});
      throw new Error("網頁過大");
    }

    // 串流讀取原始位元組並在上限處截斷；逾時由外層 controller（涵蓋 body）保證，慢速滴水會被 abort。
    // 不在這裡硬解 utf8——先拿到 bytes，再依 Content-Type/<meta> 的實際編碼解碼（Big5/GBK 等站台才不會變亂碼）。
    const reader = res.body?.getReader();
    let buf: Buffer;
    if (!reader) {
      buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_BODY_BYTES);
    } else {
      const chunks: Buffer[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.length;
          if (total > MAX_BODY_BYTES) {
            chunks.push(Buffer.from(value.slice(0, value.length - (total - MAX_BODY_BYTES))));
            await reader.cancel();
            break;
          }
          chunks.push(Buffer.from(value));
        }
      }
      buf = Buffer.concat(chunks);
    }
    return { ...htmlToText(decodeBody(buf, ctype)), finalUrl };
  } finally {
    clearTimeout(timer);
    for (const d of dispatchers) void d.close().catch(() => {});
  }
}

/** 從 PDF buffer 抽純文字（供 grounding；不是 1:1 匯入成頁）。 */
export async function extractFromPdf(buffer: Buffer): Promise<{ text: string }> {
  const parsed = await pdfParse(buffer, { max: 50 }); // 只解析前 50 頁——防超大 PDF 逐頁解析拖爆 CPU/記憶體
  const text = String(parsed?.text ?? "").replace(/\n\s*\n+/g, "\n").trim().slice(0, MAX_TEXT_CHARS);
  if (!text) throw new Error("PDF 未擷取到文字（可能是掃描/圖片型 PDF）");
  return { text };
}

/** M1_CONTRACT §2 SafeFetcher：undici DNS-pin 單頁抽取＋PDF 抽取的具名綁定。 */
export interface SafeFetcher {
  extractFromUrl(url: string): Promise<{ title?: string; text: string; finalUrl?: string }>;
  extractFromPdf(buf: Buffer): Promise<{ text: string }>;
}

/** 預設 SafeFetcher 實例（函式綁定）。 */
export const safeFetcher: SafeFetcher = { extractFromUrl, extractFromPdf };
