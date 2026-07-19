/**
 * Threads 社群 fetcher（RESEARCH_UPGRADE_CONTRACT §1.3；SOCIAL_CRAWL_FINDINGS §4）。
 * **自建無登入 Playwright** 爬公開 profile 頁（走既有 SSRF-safe crawler.fetchRaw）；資料在頁內 `<script>` JSON。
 * ≤30 則貼文 → SourceText。解析失敗 → skip＋log，**不得讓整個 job 失敗**（回 []）。禁登入態爬取。
 */
import type { CrawlProvider } from "../crawler.js";
import type { NewSocialPost } from "@meetcopilot/shared";
import type { SocialFetcher, SocialFetchInput, SocialFetchCtx, SocialFetchResult } from "./types.js";

const MAX_POSTS = 30;
const MIN_POST_CHARS = 8;
const MAX_POST_CHARS = 800;

/**
 * Threads/Instagram「未登入攔截頁」UI 字串標記（小寫、子字串比對）。抽到的「貼文」命中 ≥2 條即判為登入牆內容。
 * 取材：E2E 實錄的 Threads 未登入攔截頁文案（Connact 案例把整頁 UI 當貼文落庫）。真實貼文（caption/text JSON）
 * 幾乎不會同時出現其中兩條，故 ≥2 命中對真實內容誤判率低。
 */
const LOGIN_WALL_MARKERS = [
  "scan to get the app",
  "log in with",
  "forgot password",
  "continue with instagram",
  "sign up with instagram",
  "log in to see",
  "see what people are sharing on threads",
  "terms of use",
  "privacy policy",
];

/**
 * 判定抓到的內容其實是 Threads 登入牆（非真實貼文）。純函式，供 fetcher 與單測。
 *  - finalUrl 被導去 `/login` 或 `/accounts/login` → 直接判死（登入牆 redirect）。
 *  - 否則掃「抽出的貼文」合併文字：命中 ≥2 條已知登入頁 UI 標記 → 判死。
 * 兩者皆不符 → false（視為真實內容）。
 */
export function isLoginWallContent(finalUrl: string | undefined, posts: string[]): boolean {
  if (finalUrl) {
    let path = finalUrl;
    try {
      path = new URL(finalUrl).pathname;
    } catch {
      /* finalUrl 非合法 URL → 退回整串比對 */
    }
    if (/\/(accounts\/)?login(\/|\?|#|$)/i.test(path)) return true;
  }
  const hay = posts.join("\n").toLowerCase();
  if (!hay) return false;
  let hits = 0;
  for (const marker of LOGIN_WALL_MARKERS) {
    if (hay.includes(marker)) {
      hits++;
      if (hits >= 2) return true;
    }
  }
  return false;
}

/** 從 handle/URL 推出 threads profile URL（無登入公開頁）。無法解析回 undefined。 */
function threadsProfileUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^@?[A-Za-z0-9._]+$/.test(s) && !s.includes("/")) {
    return `https://www.threads.net/@${s.replace(/^@/, "")}`;
  }
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (/threads\.(net|com)$/i.test(u.hostname)) {
      const at = u.pathname.split("/").filter(Boolean).find((p) => p.startsWith("@"));
      if (at) return `https://www.threads.net/${at}`;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/** 深走 JSON 值，收集看似「貼文文字」的字串（key ∈ {text,caption}）。有界（深度/數量）避免爆量。 */
function collectPostTexts(root: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (v: unknown, key: string, depth: number): void => {
    if (depth > 12 || out.length >= MAX_POSTS * 3) return;
    if (typeof v === "string") {
      if ((key === "text" || key === "caption") && v.trim().length >= MIN_POST_CHARS) {
        const t = v.trim().slice(0, MAX_POST_CHARS);
        if (!seen.has(t)) {
          seen.add(t);
          out.push(t);
        }
      }
      return;
    }
    if (Array.isArray(v)) {
      for (const item of v) visit(item, key, depth + 1);
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) visit(val, k, depth + 1);
    }
  };
  visit(root, "", 0);
  return out;
}

/** 從 outerHTML 抽 `<script type="application/json">` 區塊、JSON.parse 後收集貼文文字。解析失敗即略過該區塊。 */
function extractPostsFromHtml(html: string): string[] {
  const texts: string[] = [];
  const re = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  let blocks = 0;
  while ((m = re.exec(html)) !== null && blocks < 40) {
    blocks++;
    const body = m[1];
    if (!body) continue;
    try {
      texts.push(...collectPostTexts(JSON.parse(body)));
    } catch {
      /* not valid JSON → skip block */
    }
    if (texts.length >= MAX_POSTS) break;
  }
  return texts;
}

export function createThreadsFetcher(crawler: CrawlProvider): SocialFetcher {
  return {
    platform: "threads",
    async fetch(input: SocialFetchInput, ctx: SocialFetchCtx): Promise<SocialFetchResult> {
      const empty: SocialFetchResult = { sources: [], posts: [] };
      const profileUrl = threadsProfileUrl(input.handles.threads);
      if (!profileUrl) {
        ctx.log(`[social:threads] no threads handle for "${input.companyName}" — skipping`);
        return empty;
      }
      try {
        const raw = await crawler.fetchRaw(profileUrl);
        if (!raw) {
          ctx.log(`[social:threads] fetch returned nothing for ${profileUrl} — skipping`);
          return empty;
        }
        // 貼文優先取 <script> JSON；抽不到則退回 innerText（登入/consent 牆時多半空 → skip）。
        let posts = extractPostsFromHtml(raw.html);
        if (posts.length === 0 && raw.text) {
          const lines = raw.text
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l.length >= MIN_POST_CHARS)
            .slice(0, MAX_POSTS);
          posts = lines.map((l) => l.slice(0, MAX_POST_CHARS));
        }
        posts = posts.slice(0, MAX_POSTS);
        const url = raw.finalUrl || profileUrl;
        // 登入牆偵測：Threads/IG 未登入攔截頁——finalUrl 轉去 /login，或抽出的「貼文」其實是登入頁 UI 字串
        // （命中 ≥2 條已知標記）。整平台 skip，避免把登入頁 UI 當成貼文落庫（實測 Connact 案例）。
        if (isLoginWallContent(raw.finalUrl, posts)) {
          ctx.log(`[social:threads] threads login wall — skipping (${url})`);
          return empty;
        }
        if (posts.length === 0) {
          ctx.log(`[social:threads] no public posts parsed for ${profileUrl} — skipping`);
          return empty;
        }
        const title = `${input.companyName} — Threads`;
        const body = `Threads 公開檔案：${input.companyName}\n近期公開貼文（${posts.length} 則）：\n- ${posts.join("\n- ")}`;
        // Threads 個別貼文無穩定 URL → 以 profile URL 為自然鍵，落一則彙整貼文（結構化鏡像）；postCount 供顯示。
        const post: NewSocialPost = { platform: "threads", url, title, content: body, metrics: { postCount: posts.length } };
        ctx.log(`[social:threads] collected ${posts.length} post(s) from ${profileUrl}`);
        return { sources: [{ url, title, text: body }], posts: [post] };
      } catch (e) {
        ctx.log(`[social:threads] skipped (${(e as Error).message})`);
        return empty;
      }
    },
  };
}
