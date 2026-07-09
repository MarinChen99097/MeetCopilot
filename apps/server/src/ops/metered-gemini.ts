/**
 * meteredGeminiClient — 把一個 GeminiClient 包成「呼叫即冪等記帳」的同介面 client（M5_CONTRACT §B）。
 *
 * 動機：orgId 是 per-request 的，而 GeminiClient 於 router 建構時即固定；故不在建構期綁 org，而是
 *   在**服務方法內（此時已有 orgId）** 現包一個 metered client，交給既有純函式（generation/extractor）——
 *   呼叫端邏輯完全不變，只是每次 generateJson/embed 會多記一筆 usage_event。
 *
 * kind 語意：generateJson 記為 ctx.kind（gemini_text／gemini_extract…）；embed 一律記為 'embedding'
 *   （embedding 呼叫本質就是 embedding，與外層 ctx 無關）。generateGrounded 目前不計費（透傳）。
 *
 * idemKey：以 `${idemPrefix}:${seq}` 遞增——單一邏輯操作（一次生成含多次 gemini 呼叫）內每個呼叫唯一；
 *   不同請求用不同 prefix（帶 uuid/jobId），故不同請求的真實成本不會被誤去重。
 */
import type { GeminiClient, GenerateJsonOptions, Metered } from "../gemini.js";
import type { UsageKind } from "@meetcopilot/shared";
import type { Meter, MeterResult } from "./meter.js";

/** Map a provider `{value,usage}` result into the Meter callback's MeterResult (one mapping, reused by both paths). */
function toMeterResult<T>(metered: Metered<T>, meetingId?: string): MeterResult<T> {
  const { value, usage } = metered;
  return {
    result: value,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    meetingId,
  };
}

export interface MeteredGeminiCtx {
  orgId: string;
  /** generateJson 記帳的 kind（gemini_text / gemini_extract / ...）。 */
  kind: UsageKind;
  /** 歸屬會議（會中呼叫帶入；否則省略）。 */
  meetingId?: string;
  /** 發起使用者歸屬（ADMIN_CONTRACT §2，可選；request-scoped 寫入點帶 req.auth.userId → usage_events.user_id）。 */
  userId?: string;
  /** idempotency_key 前綴（建議帶 jobId/uuid，確保跨請求唯一）。 */
  idemPrefix: string;
}

export function meteredGeminiClient(base: GeminiClient, meter: Meter, ctx: MeteredGeminiCtx): GeminiClient {
  let seq = 0;
  const nextKey = (tag: string): string => `${ctx.idemPrefix}:${tag}:${seq++}`;

  return {
    isConfigured: () => base.isConfigured(),
    generateGrounded: (opts) => base.generateGrounded(opts),
    generateJsonMetered: (opts) => base.generateJsonMetered(opts),
    embedMetered: (text) => base.embedMetered(text),

    async generateJson<T>(opts: GenerateJsonOptions): Promise<T> {
      return meter.meter<T>(
        ctx.orgId,
        ctx.kind,
        async () => toMeterResult(await base.generateJsonMetered<T>(opts), ctx.meetingId),
        nextKey("gen"),
        ctx.userId,
      );
    },

    async embed(text: string): Promise<number[]> {
      return meter.meter<number[]>(
        ctx.orgId,
        "embedding",
        async () => toMeterResult(await base.embedMetered(text), ctx.meetingId),
        nextKey("embed"),
        ctx.userId,
      );
    },
  };
}
