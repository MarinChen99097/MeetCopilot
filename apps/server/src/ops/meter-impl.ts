/**
 * createMeter — Meter（ops/meter.ts 凍結介面）的實作（M5_CONTRACT §B）。借 v1 記帳/冪等模式。
 *
 * meter(orgId, kind, fn, idemKey)：
 *   1. 執行 fn（真正的 provider 呼叫）——**業務結果優先**：fn 拋錯即向上傳播（真的失敗了，不記帳）。
 *   2. fn 成功後，依回傳 usage（token 取自 API usage 欄）＋中央 PRICING 估算 est_cost_usd
 *      （fn 若已帶精確 estCostUsd 則採用之，例如生圖的 per-image 成本）。
 *   3. 以 UsageRepository.record 冪等記一筆——**記帳為副作用，絕不影響業務**：record 失敗只 log，
 *      仍回傳 fn 的 result（計費瑕疵不該讓使用者的生成/分析失敗）。
 *
 * 冪等：(orgId, idemKey) 唯一（repo INSERT OR IGNORE）——同一邏輯呼叫用同一 idemKey 重試不重複計費。
 */
import type { UsageRepository } from "@meetcopilot/crm";
import type { UsageKind } from "@meetcopilot/shared";
import type { Meter, MeterResult } from "./meter.js";
import { estimateCostUsd, taxMultiplierFor } from "./pricing.js";
import { withSuppressedMetering } from "./metering-context.js";

export function createMeter(usage: UsageRepository): Meter {
  return {
    async meter<T>(
      orgId: string,
      kind: UsageKind,
      fn: () => Promise<MeterResult<T>>,
      idemKey: string,
      userId?: string,
    ): Promise<T> {
      // explicit metering：fn 執行期間抑制安全網（避免同一次呼叫被 raw-client 安全網重複補記）。失敗即向上拋（不記帳）。
      const out = await withSuppressedMetering(fn);
      // 稅前估算（019 差別計價：reasoning≈output、cached 較便宜）；fn 若帶精確成本（生圖 per-image）優先。
      const estCostUsd =
        out.estCostUsd ??
        estimateCostUsd(kind, out.model, out.inputTokens, out.outputTokens, out.reasoningTokens, out.cachedInputTokens);
      try {
        await usage.record(orgId, {
          kind,
          model: out.model,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          reasoningTokens: out.reasoningTokens,
          cachedInputTokens: out.cachedInputTokens,
          retryCount: out.retryCount,
          estCostUsd, // 稅前
          costTaxMultiplier: taxMultiplierFor(kind), // 每列稅率快照（含稅＝estCostUsd × 此值）
          meetingId: out.meetingId,
          userId, // ADMIN_CONTRACT §2：發起使用者歸屬（可選；省略 → NULL）
          idempotencyKey: idemKey,
        });
      } catch (err) {
        // 記帳瑕疵絕不冒泡到業務路徑（決策：可觀測性 < 功能正確性）。
        console.warn(`[meter] record failed (org=${orgId}, kind=${kind}): ${(err as Error).message}`);
      }
      return out.result;
    },
  };
}
