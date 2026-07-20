/**
 * 記帳脈絡（AsyncLocalStorage）＋ 運行時「安全網補記」（對齊 ezpage 的 SDK-boundary autolog）。
 *
 * 目標：**任何繞過 metered wrapper 的 raw AI 呼叫也不會靜默漏記成本**。做法：
 *  - 在邊界（realtime hub 每場、每個 authed request）用 `runWithMetering(ctx, fn)` 設一個脈絡
 *    （orgId/userId/meetingId/kind/meter）。
 *  - raw GeminiClient 的公開方法（generateJson/generateGrounded/embed）呼叫後叫 `safetyNetRecord(usage)`：
 *    脈絡存在且**未被抑制**時，補記一筆 usage_event（best-effort、fire-and-forget）。
 *  - explicit metering（`meter.meter` / metered wrapper）進行期間，meter-impl 以 `withSuppressedMetering`
 *    設抑制旗標——避免「已明確記帳的呼叫」被安全網重複記（雙記防護）。
 *
 * 為何不會與既有 metered 路徑雙記：metered wrapper 走的是 `generateJsonMetered`/`embedMetered`（Metered 變體，
 * **不掛安全網**）；手動 meter（grounded）在 `meter.meter` 的 fn 內執行 → 被抑制。安全網只補「純 raw 且未抑制」者。
 *
 * 無 import 迴圈：本檔只 import 型別（Meter/UsageKind）；gemini.ts 與 meter-impl.ts 反向 import 本檔的函式。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { UsageKind } from "@meetcopilot/shared";
import type { Meter } from "./meter.js";

export interface MeteringCtx {
  orgId: string;
  userId?: string;
  meetingId?: string;
  /** 脈絡內 raw AI 呼叫的預設歸類（安全網補記用；embed 一律記 'embedding'）。 */
  kind: UsageKind;
  meter: Meter;
  /** idempotency_key 前綴（每個邊界唯一，避免跨邊界誤去重）。 */
  idemPrefix: string;
  /** 遞增序號（安全網每筆唯一 idem key）。 */
  seq: { n: number };
  /**
   * 抑制深度計數器（>0 時安全網不補記）。**用計數器而非布林**：deep research 的 grounding 是同一脈絡內
   * **並行**多個 explicit meter，布林的「存/還原 prev」在非 LIFO 併發下會被先完成者提早清掉、讓兄弟呼叫的
   * 安全網誤放行 → 雙記。計數器則「任一 explicit meter 在飛即抑制」，併發安全。
   */
  suppressed: { depth: number };
}

const als = new AsyncLocalStorage<MeteringCtx>();

/** 在計費脈絡內執行 fn（邊界設定）。內部任何 raw AI 呼叫 → 安全網補記。seq/suppressed 由本函式初始化。 */
export function runWithMetering<T>(ctx: Omit<MeteringCtx, "seq" | "suppressed">, fn: () => T): T {
  return als.run({ ...ctx, seq: { n: 0 }, suppressed: { depth: 0 } }, fn);
}

export function currentMeteringCtx(): MeteringCtx | undefined {
  return als.getStore();
}

/** explicit metering 期間抑制安全網（meter.meter 內用）；無脈絡則 no-op。計數器＝可重入且併發安全。 */
export async function withSuppressedMetering<T>(fn: () => Promise<T>): Promise<T> {
  const ctx = als.getStore();
  if (!ctx) return fn();
  ctx.suppressed.depth++;
  try {
    return await fn();
  } finally {
    ctx.suppressed.depth--;
  }
}

export interface SafetyNetUsage {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

/**
 * raw AI 呼叫的安全網補記：有脈絡且未抑制時補記一筆（fire-and-forget、meter 內部吞錯）。
 * kindOverride 供 embed 用（embed 一律 'embedding'，與外層 ctx.kind 無關）。
 */
export function safetyNetRecord(usage: SafetyNetUsage, kindOverride?: UsageKind): void {
  const ctx = als.getStore();
  if (!ctx || ctx.suppressed.depth > 0) return;
  const kind = kindOverride ?? ctx.kind;
  const idemKey = `${ctx.idemPrefix}:sn:${ctx.seq.n++}`;
  const { orgId, meetingId, userId, meter } = ctx;
  // **走出 ALS 脈絡再記**：safetyNetRecord 自己的 meter.meter 會經 meter-impl 的 withSuppressedMetering 短暫 depth++；
  // 若不 exit，會誤抑制同脈絡內併發的兄弟安全網補記（自我干擾→漏記）。exit 後 als.getStore() 為空 → 不動 depth。
  // explicit metering（wrapper/手動）仍在脈絡內執行、照常抬 depth 抑制安全網——不受影響。
  als.exit(() => {
    void meter
      .meter(
        orgId,
        kind,
        async () => ({
          result: undefined,
          model: usage.model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cachedInputTokens,
          meetingId,
        }),
        idemKey,
        userId,
      )
      .catch(() => {
        /* 安全網補記為 best-effort；meter 內部已吞 record 錯誤，這裡再兜底 */
      });
  });
}
