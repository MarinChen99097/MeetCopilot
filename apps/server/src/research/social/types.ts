/**
 * 社群來源層介面（RESEARCH_UPGRADE_CONTRACT §1.4，凍結命名）。
 *
 * 所有社群內容一律化為既有 `SourceText`（deep-research.ts 之形狀），注入 `DeepResearchBundle.sourceTexts`，
 * 自動繼承 [S#]→真實 URL provenance（§1.1）。**不新造 provenance 機制。**
 *
 * 各平台取得路徑（使用者拍板，不得改道，§1.3）：
 *  - YouTube：官方 Data API v3（env YOUTUBE_API_KEY，缺→整平台 skip＋一次性 warning，不算失敗）。
 *  - Threads：自建無登入 Playwright 爬公開 profile/貼文頁（走既有 SSRF-safe crawler 路徑）；解析失敗→skip＋log。
 *  - FB／IG：只用 Gemini grounding（不在此層；由 deep-research 的社群模板查詢承載）。
 */
import type { SourceText } from "../deep-research.js";
import type { NewSocialPost } from "@meetcopilot/shared";

export type SocialHandles = {
  youtube?: string;
  facebook?: string;
  instagram?: string;
  threads?: string;
};

/**
 * 社群 fetcher 回傳（RESEARCH_UPGRADE v2）：
 *  - sources：注入 DeepResearchBundle.sourceTexts（自動繼承 [S#]→真實 URL provenance，§1.1）——語意不變。
 *  - posts：**同一份內容的結構化鏡像**，orchestrator 落 company_social_posts（bulkUpsert 自然鍵 [platform,url]；
 *    youtube metrics 存 views/subscribers 等）。posts 為附加輸出，不取代 sources。
 */
export interface SocialFetchResult {
  sources: SourceText[];
  posts: NewSocialPost[];
}

export interface SocialFetchInput {
  companyName: string;
  domain?: string;
  handles: SocialHandles;
}

export interface SocialFetchCtx {
  signal: AbortSignal;
  budgetMs: number;
  log: (m: string) => void;
}

export interface SocialFetcher {
  platform: "youtube" | "threads";
  /** 回 { sources（注入 bundle）, posts（落 company_social_posts）}。失敗/skip → { sources:[], posts:[] }。 */
  fetch(input: SocialFetchInput, ctx: SocialFetchCtx): Promise<SocialFetchResult>;
}
