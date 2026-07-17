/**
 * YouTube 社群 fetcher（RESEARCH_UPGRADE_CONTRACT §1.3；SOCIAL_CRAWL_FINDINGS §1）。
 * **官方 Data API v3**（env YOUTUBE_API_KEY）：解析頻道（handle 或 search）→ channels.list（訂閱數/描述/影片數）
 * → 近期上傳 ≤30 支（playlistItems + videos.list：標題/描述/日期/觀看數）→ 產 SourceText（頻道總覽 1 則＋每支影片 1 則）。
 * 缺 key → 整平台 skip＋一次性 warning（不算 job 失敗）。單一 API 呼叫失敗 → 該部分 skip（回已取得的部分）。
 *
 * 配額（findings §1）：channels/playlistItems/videos 各 1 unit；search 100 units（僅在無 handle 時用一次）。
 */
import { fetchJsonSafe } from "./http.js";
import type { SourceText } from "../deep-research.js";
import type { SocialFetcher, SocialFetchInput, SocialFetchCtx } from "./types.js";

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

function channelSourceText(ch: YtChannel): SourceText {
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
  return { url, title: `${title} — YouTube 頻道`, text: lines.join("\n") };
}

function videoSourceText(v: YtVideo): SourceText | undefined {
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
  return { url, title, text: lines.join("\n") };
}

/**
 * YouTube fetcher 工廠。apiKey 空 → fetch() 記一次 warning 並回 []（整平台優雅 skip，不算 job 失敗）。
 */
export function createYoutubeFetcher(apiKey: string): SocialFetcher {
  return {
    platform: "youtube",
    async fetch(input: SocialFetchInput, ctx: SocialFetchCtx): Promise<SourceText[]> {
      if (!apiKey) {
        ctx.log("[social:youtube] YOUTUBE_API_KEY not set — skipping YouTube platform");
        return [];
      }
      try {
        const ch = await resolveChannel(apiKey, input, ctx.signal, ctx.log);
        if (!ch) return [];
        const out: SourceText[] = [channelSourceText(ch)];

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
                const stx = videoSourceText(v);
                if (stx) out.push(stx);
              }
            }
          } catch (e) {
            ctx.log(`[social:youtube] uploads fetch failed (partial): ${(e as Error).message}`);
          }
        }
        ctx.log(`[social:youtube] collected ${out.length} source(s) for "${input.companyName}"`);
        return out;
      } catch (e) {
        // 解析失敗 → skip＋log，不得害整個 job 失敗（orchestrator 亦 allSettled 兜底）。
        ctx.log(`[social:youtube] skipped (${(e as Error).message})`);
        return [];
      }
    },
  };
}
