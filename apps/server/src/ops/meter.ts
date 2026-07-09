/**
 * Meter — 計費包裝介面（M5_CONTRACT §B）。**介面 stub，無實作**（實作＝M5 build agent）。
 * 所有 LLM／生圖／embedding／ASR 呼叫經 `meter(orgId, kind, fn, idemKey)` 包裝：
 *   1. 執行 fn（真正的 provider 呼叫）；
 *   2. 依回傳的 usage（token 數取 API usage 欄，無則估）＋集中定價常數估算 est_cost_usd；
 *   3. 以 UsageRepository.record 冪等記一筆（(orgId, idempotencyKey) 去重，重試不重複計費）。
 * 定價常數集中一處（實作階段建 `ops/pricing.ts`；本 stub 不含定價）。
 */
import type { UsageKind } from "@meetcopilot/shared";

/**
 * fn 的回傳：業務結果 result ＋ 供計費的用量欄位。
 * token 欄可空（provider 未回報時由實作估算）；estCostUsd 亦可由實作依 pricing 計算而非 fn 帶入。
 */
export interface MeterResult<T> {
  result: T;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  /** 若 fn 已知精確成本可帶入；否則實作依 kind/model/token 從定價常數估算。 */
  estCostUsd?: number;
  /** 歸屬會議（會中呼叫帶入；非會議情境省略）。 */
  meetingId?: string;
}

export interface Meter {
  /**
   * 包裝一次計費呼叫並冪等記帳。回傳 fn 的 result（計費為副作用）。
   * @param idemKey 冪等鍵（呼叫端決定；(orgId, idemKey) 唯一）——重試同一邏輯呼叫不重複計費。
   * @param userId （ADMIN_CONTRACT §2，可選）發起使用者歸屬，回填 usage_events.user_id。request-scoped
   *   寫入點從 `req.auth.userId` 傳入；背景 job 內部步驟無 request 脈絡時省略（→ user_id NULL）。
   *   可選以不破壞既有呼叫（既有呼叫端不傳 → 行為完全不變）。
   */
  meter<T>(
    orgId: string,
    kind: UsageKind,
    fn: () => Promise<MeterResult<T>>,
    idemKey: string,
    userId?: string,
  ): Promise<T>;
}
