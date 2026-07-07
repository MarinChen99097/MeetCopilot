/**
 * RateLimiter — per-org ＋ per-IP token bucket 限流介面（M5_CONTRACT §C）。**介面 stub，無實作**（實作＝M5 build agent）。
 * 套在貴的端點（/decks/generate、/research/enrich、/decks/:id/image-jobs、/train/sessions）；
 * 超限回 429 `{error}`（middleware 對映 decision.allowed=false → 429，帶 Retry-After）。
 * 實作以記憶體 token bucket 即可（決策 20：單 VM 單進程；日後多實例再換共享儲存）。
 */

/** 一次 take 的裁決。allowed=false → 呼叫端回 429；retryAfterMs 供 Retry-After 標頭（毫秒→秒無條件進位）。 */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs?: number;
}

export interface RateLimiter {
  /**
   * 取一個 token（同時檢核 per-org 與 per-IP 兩個 bucket，任一超限即 allowed=false）。
   * @param orgId 租戶（authenticated 端點必有）。
   * @param ip 用戶端 IP（trust proxy 後的真實來源）。
   */
  take(orgId: string, ip: string): RateLimitDecision;
}
