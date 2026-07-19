/**
 * 社群來源層編排（RESEARCH_UPGRADE_CONTRACT §1）。
 * runSocialFetch：把 youtube/threads fetcher 有界並行跑，彙整成 SourceText[]（注入 DeepResearchBundle.sourceTexts）。
 * 個別平台失敗/skip 容忍（不害整個 job）。FB/IG 不在此層（由 deep-research 的社群模板 grounding 承載）。
 */
import type { CrawlProvider } from "../crawler.js";
import type { SourceText } from "../deep-research.js";
import type { NewSocialPost } from "@meetcopilot/shared";
import { createYoutubeFetcher } from "./youtube.js";
import { createThreadsFetcher } from "./threads.js";
import type { SocialFetcher, SocialFetchInput, SocialFetchResult } from "./types.js";

export type { SocialFetcher, SocialFetchInput, SocialFetchResult, SocialHandles, SocialFetchCtx } from "./types.js";
export { discoverHandles, socialLinksJson, parseSocialLinksColumn, classifySocialUrl, instagramUsername } from "./discover.js";

const DEFAULT_SOCIAL_BUDGET_MS = 600_000; // 四平台合計預算（env SOCIAL_FETCH_BUDGET_MS，clamp 30s–1800s）

/** 社群 fetch 總預算（呼叫時讀 env SOCIAL_FETCH_BUDGET_MS，clamp 30s–1800s；預設 600s）。 */
export function socialFetchBudgetMs(): number {
  const raw = Number(process.env.SOCIAL_FETCH_BUDGET_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_SOCIAL_BUDGET_MS;
  return Math.min(Math.max(Math.trunc(raw), 30_000), 1_800_000);
}

/**
 * 建 youtube + threads fetcher（FB/IG 走 grounding，不在此）。youtubeApiKey 空但有 youtube handle →
 * youtube fetcher 走無金鑰 Playwright /videos 抓取 fallback（用同一 crawler）；無 handle → 優雅 skip。
 */
export function createSocialFetchers(deps: { youtubeApiKey: string; crawler: CrawlProvider }): SocialFetcher[] {
  return [createYoutubeFetcher(deps.youtubeApiKey, deps.crawler), createThreadsFetcher(deps.crawler)];
}

/**
 * 有界並行跑所有社群 fetcher，彙整 { sources（注入 bundle）, posts（落 company_social_posts）}。
 * budgetMs 到期 → 以 AbortSignal 中止未完成的 fetch，回已取得的。
 * 個別 fetcher throw 亦被吞掉（各 fetcher 內部已 skip＋log；這裡再兜底）。
 */
export async function runSocialFetch(
  fetchers: SocialFetcher[],
  input: SocialFetchInput,
  opts: { budgetMs?: number; log?: (m: string) => void } = {},
): Promise<SocialFetchResult> {
  const budgetMs = opts.budgetMs ?? socialFetchBudgetMs();
  const log = opts.log ?? (() => {});
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const empty: SocialFetchResult = { sources: [], posts: [] };
    const results = await Promise.allSettled(
      fetchers.map((f) =>
        f.fetch(input, { signal: controller.signal, budgetMs, log }).catch((e) => {
          log(`[social:${f.platform}] error swallowed: ${(e as Error).message}`);
          return empty;
        }),
      ),
    );
    const sources: SourceText[] = [];
    const posts: NewSocialPost[] = [];
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      sources.push(...r.value.sources);
      posts.push(...r.value.posts);
    }
    return { sources, posts };
  } finally {
    clearTimeout(timer);
  }
}
