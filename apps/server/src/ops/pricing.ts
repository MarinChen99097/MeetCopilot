/**
 * 中央定價常數（M5_CONTRACT §B：「定價常數集中一處」）。Meter 依此把 token 用量估算成 est_cost_usd。
 *
 * ⚠️ 這些數字是**營運可調的估算值**，非權威帳單：
 *  - 本專案的 model id（gemini-3.1-flash-lite / gemini-3.5-flash / gemini-embedding-001 /
 *    gemini-3.1-flash-live-preview / gpt-image-2）在撰稿當下無公開定價，數值依同級模型公開牌價推估。
 *  - 上線前應以 provider 官方定價校正（並可用環境變數覆寫——見檔尾 envOverrides）。
 *  - est_cost_usd 僅供 org 用量觀測與粗略成本控管，不作為對外收費依據（決策 20：無計費）。
 *
 * 單位：token 類為 USD / 1M tokens（input、output 分開）；生圖類為 USD / 張。
 */

/** 單一 model 的定價。token 類填 inputPerM/outputPerM；生圖類填 perImage。 */
export interface ModelPrice {
  /** USD per 1,000,000 input tokens。 */
  inputPerM?: number;
  /** USD per 1,000,000 output tokens。 */
  outputPerM?: number;
  /** USD per generated image（生圖模型）。 */
  perImage?: number;
}

import type { UsageKind } from "@meetcopilot/shared";

/**
 * 依 model id 的定價表（估算值，見檔頭警告）。未命中則退回 FALLBACK_BY_KIND。
 * 數值來源＝同級模型公開牌價的保守推估：
 *  - flash-lite ≈ $0.10 in / $0.40 out（Gemini Flash-Lite 級）
 *  - flash      ≈ $0.30 in / $2.50 out（Gemini Flash 級；analysis/extract/生成用）
 *  - embedding  ≈ $0.15 in（無 output 計費）
 *  - live       ≈ $0.50 in / $2.00 out（即時語音級，偏高估）
 *  - gpt-image-2 medium ≈ $0.04 / 張
 */
export const PRICING: Record<string, ModelPrice> = {
  "gemini-3.1-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
  "gemini-3.5-flash": { inputPerM: 0.3, outputPerM: 2.5 },
  "gemini-embedding-001": { inputPerM: 0.15 },
  "gemini-3.1-flash-live-preview": { inputPerM: 0.5, outputPerM: 2.0 },
  "gpt-image-2": { perImage: 0.04 },
};

/** model 未命中 PRICING 時，依 kind 的退回定價（估算值）。 */
const FALLBACK_BY_KIND: Record<UsageKind, ModelPrice> = {
  gemini_text: { inputPerM: 0.1, outputPerM: 0.4 },
  gemini_extract: { inputPerM: 0.3, outputPerM: 2.5 },
  gemini_live: { inputPerM: 0.5, outputPerM: 2.0 },
  openai_image: { perImage: 0.04 },
  embedding: { inputPerM: 0.15 },
  asr: { inputPerM: 0.3, outputPerM: 2.5 },
};

/** 環境變數覆寫（上線校正用）：`PRICING__<MODEL_UPPER_SNAKE>__INPUT_PER_M` 等，於 loadPricingOverrides 套用。 */
function priceFor(kind: UsageKind, model: string | undefined): ModelPrice {
  return (model && PRICING[model]) || FALLBACK_BY_KIND[kind];
}

/**
 * 估算一次呼叫的成本（USD）。生圖類走 perImage（token 忽略）；token 類走 input/output × 用量。
 * 缺 token（provider 未回報）→ 該部分算 0（不臆造）；估不出（無定價）→ 0。永不為負／NaN。
 */
export function estimateCostUsd(
  kind: UsageKind,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): number {
  const price = priceFor(kind, model);
  if (kind === "openai_image") {
    return round6(price.perImage ?? 0);
  }
  const inCost = ((inputTokens ?? 0) / 1_000_000) * (price.inputPerM ?? 0);
  const outCost = ((outputTokens ?? 0) / 1_000_000) * (price.outputPerM ?? 0);
  const total = inCost + outCost;
  return Number.isFinite(total) && total > 0 ? round6(total) : 0;
}

/** 6 位小數（micro-USD 級）四捨五入，避免浮點雜訊塞進 est_cost_usd。 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
