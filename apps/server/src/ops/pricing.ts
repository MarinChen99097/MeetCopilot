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

/**
 * model 未命中 PRICING 時，依 kind 的退回定價（估算值）。
 * 註記（ADMIN_CONTRACT §3.1）：`asr` 目前以「同級 flash token 估算」佔位——ASR 供應商多按**音訊分鐘**或
 * **chunk** 計費，非 token；ASR 記帳（meter(...,'asr')）token 欄留 NULL，est_cost 走本 fallback（無 token → 0），
 * 待上線以 provider 官方分鐘/chunk 單價校正（可用 PRICING__ 環境覆寫或未來擴充計量單位）。
 */
const FALLBACK_BY_KIND: Record<UsageKind, ModelPrice> = {
  gemini_text: { inputPerM: 0.1, outputPerM: 0.4 },
  gemini_extract: { inputPerM: 0.3, outputPerM: 2.5 },
  gemini_live: { inputPerM: 0.5, outputPerM: 2.0 },
  openai_image: { perImage: 0.04 },
  embedding: { inputPerM: 0.15 },
  asr: { inputPerM: 0.3, outputPerM: 2.5 },
};

/** 已被環境變數覆寫的 model id 集合（source 標記用；loadPricingOverrides 填入）。 */
const overriddenModels = new Set<string>();

/** model id → 環境變數片段（UPPER_SNAKE）：`gemini-3.5-flash` → `GEMINI_3_5_FLASH`。 */
function envKeyOf(model: string): string {
  return model.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** 解析一個環境值為正有限數；非法/缺省回 undefined（不覆寫）。 */
function num(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * 環境覆寫落地（ADMIN_CONTRACT §3.4；兌現本檔原註解）：boot 時讀
 *   `PRICING__<MODEL_UPPER_SNAKE>__INPUT_PER_M` / `__OUTPUT_PER_M` / `__PER_IMAGE`
 * 覆寫既有 PRICING model 條目（就地改 PRICING，供 estimateCostUsd 讀取）。est_cost_usd 仍為**寫入時凍結**值
 * （改常數/覆寫不回溯既有列）。回傳被覆寫的 model 清單（供 boot log）。呼叫端於 index.ts boot 一次。
 */
export function loadPricingOverrides(env: NodeJS.ProcessEnv = process.env): string[] {
  const changed: string[] = [];
  for (const model of Object.keys(PRICING)) {
    const key = envKeyOf(model);
    const input = num(env[`PRICING__${key}__INPUT_PER_M`]);
    const output = num(env[`PRICING__${key}__OUTPUT_PER_M`]);
    const perImage = num(env[`PRICING__${key}__PER_IMAGE`]);
    if (input === undefined && output === undefined && perImage === undefined) continue;
    const price = PRICING[model]!;
    if (input !== undefined) price.inputPerM = input;
    if (output !== undefined) price.outputPerM = output;
    if (perImage !== undefined) price.perImage = perImage;
    overriddenModels.add(model);
    changed.push(model);
  }
  return changed;
}

/** GET /api/admin/pricing 一列（ADMIN_CONTRACT §4 #10）。 */
export interface PricingRow {
  kind: UsageKind;
  model?: string;
  inputPerM?: number;
  outputPerM?: number;
  perImage?: number;
  source: "default" | "env";
}

/** 免責說明（GET /api/admin/pricing）。呈現「估算、非權威帳單」立場。 */
export const PRICING_DISCLAIMER =
  "定價為營運可調的估算值，非權威帳單：本專案 model id 於撰稿時無公開定價，數值依同級模型公開牌價推估；" +
  "est_cost_usd 為寫入當下凍結值（改常數/覆寫不回溯）。上線前應以 provider 官方定價校正（可用 PRICING__ 環境變數覆寫）。";

/**
 * 依 (kind, model) 配對產生現行定價列（含 env 覆寫結果與 source 標記）。呼叫端（admin route）用實際設定的
 * model id（config.gemini/openai）組配對；model 命中 PRICING 用之，否則退回 FALLBACK_BY_KIND。
 */
export function pricingRows(pairs: { kind: UsageKind; model?: string }[]): PricingRow[] {
  return pairs.map(({ kind, model }) => {
    const price = priceFor(kind, model); // same (model→PRICING, else kind fallback) resolution as estimateCostUsd
    const source: "default" | "env" = model && overriddenModels.has(model) ? "env" : "default";
    return {
      kind,
      model,
      inputPerM: price.inputPerM,
      outputPerM: price.outputPerM,
      perImage: price.perImage,
      source,
    };
  });
}

/** 單一定價解析點：model 命中 PRICING（含 env 覆寫後的值）用之，否則退回 FALLBACK_BY_KIND[kind]。 */
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
