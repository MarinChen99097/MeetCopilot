/**
 * YouTube 社群 fetcher（RESEARCH_UPGRADE_CONTRACT §1.3；SOCIAL_CRAWL_FINDINGS §1）。
 * **官方 Data API v3**（env YOUTUBE_API_KEY）：解析頻道（handle 或 search）→ channels.list（訂閱數/描述/影片數）
 * → 近期上傳 ≤30 支（playlistItems + videos.list：標題/描述/日期/觀看數）→ 產 SourceText（頻道總覽 1 則＋每支影片 1 則）。
 * 缺 key → 整平台 skip＋一次性 warning（不算 job 失敗）。單一 API 呼叫失敗 → 該部分 skip（回已取得的部分）。
 *
 * 配額（findings §1）：channels/playlistItems/videos 各 1 unit；search 100 units（僅在無 handle 時用一次）。
 */
import { fetchJsonSafe } from "./http.js";
import type { CrawlProvider } from "../crawler.js";
import type { SourceText } from "../deep-research.js";
import type { NewSocialPost } from "@meetcopilot/shared";
import type { SocialFetcher, SocialFetchInput, SocialFetchCtx, SocialFetchResult } from "./types.js";

const API_BASE = "https://www.googleapis.com/youtube/v3";
const MAX_VIDEOS = 30;

interface YtChannel {
  id?: string;
  snippet?: { title?: string; description?: string; customUrl?: string };
  statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
interface YtChannelList {
  items?: YtChannel[];
}
interface YtSearchList {
  items?: { id?: { channelId?: string }; snippet?: { channelId?: string } }[];
}
interface YtPlaylistItems {
  items?: { contentDetails?: { videoId?: string } }[];
}
interface YtVideo {
  id?: string;
  snippet?: { title?: string; description?: string; publishedAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}
interface YtVideoList {
  items?: YtVideo[];
}

/** 從 handle/URL 抽出 channelId（UC…）或 handle（不含 @）。回 { channelId? , handle? }。 */
function parseYoutubeRef(raw: string | undefined): { channelId?: string; handle?: string } {
  if (!raw) return {};
  const s = raw.trim();
  // 純 handle 或 @handle
  if (/^@?[A-Za-z0-9._-]+$/.test(s) && !s.includes("/")) {
    return { handle: s.replace(/^@/, "") };
  }
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    const parts = u.pathname.split("/").filter(Boolean);
    // /channel/UC...
    const chIdx = parts.indexOf("channel");
    if (chIdx >= 0 && parts[chIdx + 1]) return { channelId: parts[chIdx + 1] };
    // /@handle
    const at = parts.find((p) => p.startsWith("@"));
    if (at) return { handle: at.replace(/^@/, "") };
    // /c/Name or /user/Name → treat trailing as handle-ish (search fallback covers it)
    const cIdx = parts.findIndex((p) => p === "c" || p === "user");
    if (cIdx >= 0 && parts[cIdx + 1]) return { handle: parts[cIdx + 1] };
  } catch {
    /* not a URL → ignore */
  }
  return {};
}

function q(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

const CHANNEL_PARTS = "snippet,statistics,contentDetails";

async function resolveChannel(
  apiKey: string,
  input: SocialFetchInput,
  signal: AbortSignal,
  log: (m: string) => void,
): Promise<YtChannel | undefined> {
  const ref = parseYoutubeRef(input.handles.youtube);
  // 1) 已知 channelId → 直接查（1 unit）。
  if (ref.channelId) {
    const r = await fetchJsonSafe<YtChannelList>(
      `${API_BASE}/channels?${q({ part: CHANNEL_PARTS, id: ref.channelId, key: apiKey })}`,
      signal,
    );
    if (r.items?.[0]) return r.items[0];
  }
  // 2) 已知 handle → forHandle（1 unit）。
  if (ref.handle) {
    const r = await fetchJsonSafe<YtChannelList>(
      `${API_BASE}/channels?${q({ part: CHANNEL_PARTS, forHandle: `@${ref.handle}`, key: apiKey })}`,
      signal,
    );
    if (r.items?.[0]) return r.items[0];
  }
  // 3) 無 handle 或解析失敗 → search（100 units，一次）→ channels.list。
  const s = await fetchJsonSafe<YtSearchList>(
    `${API_BASE}/search?${q({ part: "snippet", type: "channel", maxResults: "1", q: input.companyName, key: apiKey })}`,
    signal,
  );
  const channelId = s.items?.[0]?.id?.channelId ?? s.items?.[0]?.snippet?.channelId;
  if (!channelId) {
    log(`[social:youtube] no channel found for "${input.companyName}"`);
    return undefined;
  }
  const r = await fetchJsonSafe<YtChannelList>(
    `${API_BASE}/channels?${q({ part: CHANNEL_PARTS, id: channelId, key: apiKey })}`,
    signal,
  );
  return r.items?.[0];
}

/** 統計字串（YouTube 回傳皆字串）→ 有限正整數；缺/非法→省略。 */
function numOr(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
/** ISO 時間字串 → epoch ms；缺/非法→undefined。 */
function epochMs(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}
/** 只保留有值的 metrics 鍵（避免落庫空鍵）。 */
function pruneMetrics(m: Record<string, number | undefined>): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(m)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length > 0 ? out : undefined;
}

function channelItem(ch: YtChannel): { source: SourceText; post: NewSocialPost } {
  const title = ch.snippet?.title ?? "YouTube channel";
  const url = ch.id ? `https://www.youtube.com/channel/${ch.id}` : "https://www.youtube.com";
  const st = ch.statistics ?? {};
  const lines = [
    `YouTube 官方頻道：${title}`,
    ch.statistics?.subscriberCount ? `訂閱數：約 ${st.subscriberCount}` : "",
    st.videoCount ? `影片數：${st.videoCount}` : "",
    st.viewCount ? `總觀看數：${st.viewCount}` : "",
    ch.snippet?.description ? `頻道簡介：${ch.snippet.description}` : "",
  ].filter(Boolean);
  const metrics = pruneMetrics({
    subscribers: numOr(st.subscriberCount),
    videoCount: numOr(st.videoCount),
    views: numOr(st.viewCount),
  });
  return {
    source: { url, title: `${title} — YouTube 頻道`, text: lines.join("\n") },
    post: { platform: "youtube", url, title: `${title} — YouTube 頻道`, content: ch.snippet?.description, metrics },
  };
}

function videoItem(v: YtVideo): { source: SourceText; post: NewSocialPost } | undefined {
  const id = v.id;
  if (!id) return undefined;
  const title = v.snippet?.title ?? "YouTube video";
  const url = `https://www.youtube.com/watch?v=${id}`;
  const st = v.statistics ?? {};
  const lines = [
    `YouTube 影片：${title}`,
    v.snippet?.publishedAt ? `發布日期：${v.snippet.publishedAt}` : "",
    st.viewCount ? `觀看數：${st.viewCount}` : "",
    v.snippet?.description ? `描述：${v.snippet.description}` : "",
  ].filter(Boolean);
  const metrics = pruneMetrics({
    views: numOr(st.viewCount),
    likes: numOr(st.likeCount),
    comments: numOr(st.commentCount),
  });
  return {
    source: { url, title, text: lines.join("\n") },
    post: {
      platform: "youtube",
      url,
      title,
      content: v.snippet?.description,
      publishedAt: epochMs(v.snippet?.publishedAt),
      metrics,
    },
  };
}

// ── 無金鑰 fallback：Playwright 抓頻道 /videos 頁 → 解析 ytInitialData（SOCIAL_CRAWL_FINDINGS §1 備援）──

/** 無金鑰 fallback 從 ytInitialData 解析出的單支影片（純資料；供產 NewSocialPost）。 */
export interface YtScrapedVideo {
  videoId: string;
  title: string;
  /** 觀看數在地化字串（如「觀看次數：2,859次」/「2.8K views」）；抽不到省略。 */
  viewsText?: string;
  /** 相對日期在地化字串（如「2 天前」/「3 weeks ago」）；抽不到省略。 */
  publishedText?: string;
}

/**
 * 由 youtube handle/URL 推出頻道 `/videos` 頁 URL（無金鑰 Playwright 抓取用）。無法解析回 undefined。
 * 純 handle→`/@handle/videos`；channelId→`/channel/UC…/videos`；完整 URL→沿用其 path 再補 `/videos`。
 */
export function youtubeVideosUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^@?[A-Za-z0-9._-]+$/.test(s) && !s.includes("/")) {
    return `https://www.youtube.com/@${s.replace(/^@/, "")}/videos`;
  }
  const ref = parseYoutubeRef(s);
  if (ref.channelId) return `https://www.youtube.com/channel/${ref.channelId}/videos`;
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (!/(^|\.)youtube\.com$/i.test(u.hostname)) {
      return ref.handle ? `https://www.youtube.com/@${ref.handle}/videos` : undefined;
    }
    const path = u.pathname.replace(/\/+$/, "");
    if (!path) return undefined;
    return /\/videos$/i.test(path) ? `https://www.youtube.com${path}` : `https://www.youtube.com${path}/videos`;
  } catch {
    return ref.handle ? `https://www.youtube.com/@${ref.handle}/videos` : undefined;
  }
}

/**
 * 從頁面 HTML 抽 `ytInitialData` 的 JSON 物件（`var ytInitialData = {...};` / `window["ytInitialData"] = {...}`）。
 * 以平衡括號（忽略字串內括號與轉義）擷取第一個物件字面量並 JSON.parse。找不到/解析失敗 → undefined。純函式。
 */
export function extractYtInitialData(html: string): unknown {
  if (typeof html !== "string" || !html) return undefined;
  const anchor = html.indexOf("ytInitialData");
  if (anchor < 0) return undefined;
  const eq = html.indexOf("=", anchor);
  if (eq < 0) return undefined;
  const braceStart = html.indexOf("{", eq);
  if (braceStart < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(braceStart, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** 取 { simpleText } 或 { runs:[{text}] } 的合併文字。無 → undefined。 */
function runsText(v: unknown): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (typeof o.simpleText === "string" && o.simpleText.trim()) return o.simpleText.trim();
  if (Array.isArray(o.runs)) {
    const s = o.runs.map((r) => (typeof (r as { text?: unknown }).text === "string" ? (r as { text: string }).text : "")).join("");
    return s.trim() || undefined;
  }
  return undefined;
}

/** 是否為觀看數字串（含「觀看」或 view/views）。 */
function isViewsText(t: string): boolean {
  return /觀看|views?/i.test(t);
}
/** 是否為相對日期字串（zh 結尾「前」/ en「ago」）。 */
function isRelativeDateText(t: string): boolean {
  return /前|ago/i.test(t);
}

/** 於 lockupViewModel 子樹遞迴收集所有 metadataParts[].text.content（供分辨觀看數/日期）。有界。 */
function collectMetadataPartTexts(node: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 12 || out.length > 20) return out;
  if (Array.isArray(node)) {
    for (const x of node) collectMetadataPartTexts(x, out, depth + 1);
    return out;
  }
  if (!node || typeof node !== "object") return out;
  const o = node as Record<string, unknown>;
  if (Array.isArray(o.metadataParts)) {
    for (const part of o.metadataParts) {
      const text = (part as { text?: { content?: unknown } })?.text?.content;
      if (typeof text === "string" && text.trim()) out.push(text.trim());
    }
  }
  for (const v of Object.values(o)) collectMetadataPartTexts(v, out, depth + 1);
  return out;
}

/** 新版 lockupViewModel → YtScrapedVideo（contentId / lockupMetadataViewModel.title.content / metadataParts）。 */
function fromLockup(lv: Record<string, unknown>): YtScrapedVideo | undefined {
  const videoId = typeof lv.contentId === "string" ? lv.contentId : undefined;
  if (!videoId) return undefined;
  const meta = lv.metadata as { lockupMetadataViewModel?: { title?: { content?: unknown } } } | undefined;
  const titleContent = meta?.lockupMetadataViewModel?.title?.content;
  const title = typeof titleContent === "string" ? titleContent : "";
  const parts = collectMetadataPartTexts(lv);
  return { videoId, title, viewsText: parts.find(isViewsText), publishedText: parts.find(isRelativeDateText) };
}

/** 舊版 videoRenderer → YtScrapedVideo（videoId / title.runs / viewCountText / publishedTimeText）。 */
function fromVideoRenderer(vr: Record<string, unknown>): YtScrapedVideo | undefined {
  const videoId = typeof vr.videoId === "string" ? vr.videoId : undefined;
  if (!videoId) return undefined;
  const title = runsText(vr.title) ?? "";
  const viewsText = runsText(vr.viewCountText) ?? runsText(vr.shortViewCountText);
  const publishedText = runsText(vr.publishedTimeText);
  return { videoId, title, viewsText, publishedText };
}

/**
 * 深走 ytInitialData 收集影片（新 `lockupViewModel` ＋舊 `videoRenderer` 皆容忍）。去重（videoId）、有界（深度/數量）。
 * 純函式，供 no-key fallback 與單測。
 */
export function parseYtInitialData(data: unknown, max = 15): YtScrapedVideo[] {
  const out: YtScrapedVideo[] = [];
  const seen = new Set<string>();
  const push = (v: YtScrapedVideo | undefined): void => {
    if (!v || seen.has(v.videoId)) return;
    seen.add(v.videoId);
    out.push(v);
  };
  const visit = (node: unknown, depth: number): void => {
    if (out.length >= max || depth > 16) return;
    if (Array.isArray(node)) {
      for (const x of node) {
        if (out.length >= max) return;
        visit(x, depth + 1);
      }
      return;
    }
    if (!node || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.lockupViewModel && typeof o.lockupViewModel === "object") push(fromLockup(o.lockupViewModel as Record<string, unknown>));
    if (o.videoRenderer && typeof o.videoRenderer === "object") push(fromVideoRenderer(o.videoRenderer as Record<string, unknown>));
    for (const v of Object.values(o)) {
      if (out.length >= max) return;
      visit(v, depth + 1);
    }
  };
  visit(data, 0);
  return out.slice(0, max);
}

/**
 * 觀看數在地化字串 → 整數。支援千分位逗號、小數＋K/M/B 與中文萬/億後綴（「觀看次數：2,859次」→2859、
 * 「2.8K views」→2800、「1.2萬次觀看」→12000）。抽不到數字 → undefined。純函式，供單測。
 */
export function parseViewCount(text: string | undefined): number | undefined {
  if (typeof text !== "string") return undefined;
  const cleaned = text.replace(/,/g, "");
  const m = /(\d+(?:\.\d+)?)\s*([KkMmBb萬万億亿]?)/.exec(cleaned);
  if (!m) return undefined;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return undefined;
  const suffix = m[2];
  const mult =
    suffix === "K" || suffix === "k"
      ? 1e3
      : suffix === "M" || suffix === "m"
        ? 1e6
        : suffix === "B" || suffix === "b"
          ? 1e9
          : suffix === "萬" || suffix === "万"
            ? 1e4
            : suffix === "億" || suffix === "亿"
              ? 1e8
              : 1;
  return Math.round(num * mult);
}

/**
 * 相對日期在地化字串 → epoch ms（best-effort，now 減去偏移；月≈30 天、年≈365 天）。
 * zh：X 分鐘/小時/天/週/個月/年前；en：X minutes/hours/days/weeks/months/years ago。解析不了 → null。純函式，供單測。
 */
export function parseRelativeDate(text: string | undefined, now: number = Date.now()): number | null {
  if (typeof text !== "string") return null;
  const m = /(\d+)/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const DAY = 86_400_000;
  let unit: number;
  if (/分鐘|minute/i.test(text)) unit = 60_000;
  else if (/小時|hour/i.test(text)) unit = 3_600_000;
  else if (/週|周|week/i.test(text)) unit = 7 * DAY;
  else if (/個月|month/i.test(text)) unit = 30 * DAY;
  else if (/年|year/i.test(text)) unit = 365 * DAY;
  else if (/天|日|day/i.test(text)) unit = DAY;
  else return null;
  return now - n * unit;
}

/** 無金鑰 fallback：Playwright 抓 `/videos` 頁 → 解析 ytInitialData → 產 SourceText/NewSocialPost（≤15）。失敗即回空。 */
async function scrapeYoutubeNoKey(
  crawler: CrawlProvider,
  input: SocialFetchInput,
  ctx: SocialFetchCtx,
): Promise<SocialFetchResult> {
  const empty: SocialFetchResult = { sources: [], posts: [] };
  try {
    const videosUrl = youtubeVideosUrl(input.handles.youtube);
    if (!videosUrl) {
      ctx.log(`[social:youtube] no-key: cannot derive /videos URL from "${input.handles.youtube}" — skipping`);
      return empty;
    }
    const raw = await crawler.fetchRaw(videosUrl);
    if (!raw) {
      ctx.log(`[social:youtube] no-key: fetchRaw returned nothing for ${videosUrl} — skipping`);
      return empty;
    }
    const data = extractYtInitialData(raw.html);
    if (data === undefined) {
      ctx.log(`[social:youtube] no-key: ytInitialData not found in ${videosUrl} — skipping`);
      return empty;
    }
    const vids = parseYtInitialData(data, MAX_NOKEY_VIDEOS);
    const sources: SourceText[] = [];
    const posts: NewSocialPost[] = [];
    for (const v of vids) {
      const url = `https://www.youtube.com/watch?v=${v.videoId}`;
      const lines = [
        `YouTube 影片：${v.title}`,
        v.viewsText ? `觀看數：${v.viewsText}` : "",
        v.publishedText ? `發布：${v.publishedText}` : "",
      ].filter(Boolean);
      sources.push({ url, title: v.title || url, text: lines.join("\n") });
      const post: NewSocialPost = { platform: "youtube", url };
      if (v.title) post.title = v.title;
      const views = parseViewCount(v.viewsText);
      if (views !== undefined) post.metrics = { views };
      const publishedAt = parseRelativeDate(v.publishedText);
      if (publishedAt !== null) post.publishedAt = publishedAt;
      posts.push(post);
    }
    ctx.log(`[social:youtube] no-key scrape collected ${posts.length} video(s) for "${input.companyName}"`);
    return { sources, posts };
  } catch (e) {
    ctx.log(`[social:youtube] no-key scrape skipped (${(e as Error).message})`);
    return empty;
  }
}

const MAX_NOKEY_VIDEOS = 15;

/**
 * YouTube fetcher 工廠。apiKey 空 → 若有 youtube handle 且有 crawler，改走無金鑰 Playwright `/videos` 抓取 fallback；
 * 否則記一次 warning 並回 []（整平台優雅 skip，不算 job 失敗）。
 */
export function createYoutubeFetcher(apiKey: string, crawler?: CrawlProvider): SocialFetcher {
  return {
    platform: "youtube",
    async fetch(input: SocialFetchInput, ctx: SocialFetchCtx): Promise<SocialFetchResult> {
      const empty: SocialFetchResult = { sources: [], posts: [] };
      if (!apiKey) {
        if (crawler && input.handles.youtube) {
          ctx.log("[social:youtube] YOUTUBE_API_KEY not set — trying no-key /videos scrape fallback");
          return scrapeYoutubeNoKey(crawler, input, ctx);
        }
        ctx.log("[social:youtube] YOUTUBE_API_KEY not set — skipping YouTube platform");
        return empty;
      }
      try {
        const ch = await resolveChannel(apiKey, input, ctx.signal, ctx.log);
        if (!ch) return empty;
        const chItem = channelItem(ch);
        const sources: SourceText[] = [chItem.source];
        const posts: NewSocialPost[] = [chItem.post];

        const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
        if (uploads) {
          try {
            const pl = await fetchJsonSafe<YtPlaylistItems>(
              `${API_BASE}/playlistItems?${q({ part: "contentDetails", playlistId: uploads, maxResults: String(MAX_VIDEOS), key: apiKey })}`,
              ctx.signal,
            );
            const ids = (pl.items ?? [])
              .map((i) => i.contentDetails?.videoId)
              .filter((x): x is string => Boolean(x))
              .slice(0, MAX_VIDEOS);
            if (ids.length > 0) {
              const vids = await fetchJsonSafe<YtVideoList>(
                `${API_BASE}/videos?${q({ part: "snippet,statistics", id: ids.join(","), key: apiKey })}`,
                ctx.signal,
              );
              for (const v of vids.items ?? []) {
                const item = videoItem(v);
                if (item) {
                  sources.push(item.source);
                  posts.push(item.post);
                }
              }
            }
          } catch (e) {
            ctx.log(`[social:youtube] uploads fetch failed (partial): ${(e as Error).message}`);
          }
        }
        ctx.log(`[social:youtube] collected ${sources.length} source(s) for "${input.companyName}"`);
        return { sources, posts };
      } catch (e) {
        // 解析失敗 → skip＋log，不得害整個 job 失敗（orchestrator 亦 allSettled 兜底）。
        ctx.log(`[social:youtube] skipped (${(e as Error).message})`);
        return empty;
      }
    },
  };
}
