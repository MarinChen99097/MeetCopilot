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
  /** 019（ezpage 對齊）：reasoning/thinking tokens 單價（USD/1M；通常≈output，缺則退 output）。 */
  reasoningPerM?: number;
  /** 019：cached input tokens 單價（USD/1M；較 input 便宜，缺則退 input＝不打折）。 */
  cachedInputPerM?: number;
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
  "gemini-3.1-flash-lite": { inputPerM: 0.1, outputPerM: 0.4, reasoningPerM: 0.4, cachedInputPerM: 0.025 },
  "gemini-3.5-flash": { inputPerM: 0.3, outputPerM: 2.5, reasoningPerM: 2.5, cachedInputPerM: 0.075 },
  "gemini-embedding-001": { inputPerM: 0.15 },
  "gemini-3.1-flash-live-preview": { inputPerM: 0.5, outputPerM: 2.0, reasoningPerM: 2.0, cachedInputPerM: 0.125 },
  "gpt-image-2": { perImage: 0.04 },
};

/**
 * model 未命中 PRICING 時，依 kind 的退回定價（估算值）。
 * 註記（ADMIN_CONTRACT §3.1）：`asr` 目前以「同級 flash token 估算」佔位——ASR 供應商多按**音訊分鐘**或
 * **chunk** 計費，非 token；ASR 記帳（meter(...,'asr')）token 欄留 NULL，est_cost 走本 fallback（無 token → 0），
 * 待上線以 provider 官方分鐘/chunk 單價校正（可用 PRICING__ 環境覆寫或未來擴充計量單位）。
 */
const FALLBACK_BY_KIND: Record<UsageKind, ModelPrice> = {
  gemini_text: { inputPerM: 0.1, outputPerM: 0.4, reasoningPerM: 0.4, cachedInputPerM: 0.025 },
  gemini_extract: { inputPerM: 0.3, outputPerM: 2.5, reasoningPerM: 2.5, cachedInputPerM: 0.075 },
  gemini_live: { inputPerM: 0.5, outputPerM: 2.0, reasoningPerM: 2.0, cachedInputPerM: 0.125 },
  openai_image: { perImage: 0.04 },
  embedding: { inputPerM: 0.15 },
  asr: { inputPerM: 0.3, outputPerM: 2.5, reasoningPerM: 2.5, cachedInputPerM: 0.075 },
};

/**
 * 019（ezpage 對齊）：稅率倍率（含稅＝稅前 est_cost_usd × 此值）。使用者拍板：×1.25 套**全部** AI kind。
 * env `COST_TAX_MULTIPLIER` 可覆寫（比照 ezpage settings.json 的 cost_tax_multiplier=1.25 可熱調）。
 * 每列記帳時以 `taxMultiplierFor(kind)` 取值並快照進 usage_events.cost_tax_multiplier（改此值不回溯既有列）。
 */
export const DEFAULT_TAX_MULTIPLIER = ((): number => {
  const n = Number(process.env.COST_TAX_MULTIPLIER);
  return Number.isFinite(n) && n > 0 ? n : 1.25;
})();
export function taxMultiplierFor(_kind: UsageKind): number {
  return DEFAULT_TAX_MULTIPLIER; // 目前全 kind 一致；若日後改「僅生圖加成」在此依 kind 分流。
}

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
    const reasoning = num(env[`PRICING__${key}__REASONING_PER_M`]);
    const cachedIn = num(env[`PRICING__${key}__CACHED_IN_PER_M`]);
    const perImage = num(env[`PRICING__${key}__PER_IMAGE`]);
    if (
      input === undefined &&
      output === undefined &&
      reasoning === undefined &&
      cachedIn === undefined &&
      perImage === undefined
    )
      continue;
    const price = PRICING[model]!;
    if (input !== undefined) price.inputPerM = input;
    if (output !== undefined) price.outputPerM = output;
    if (reasoning !== undefined) price.reasoningPerM = reasoning;
    if (cachedIn !== undefined) price.cachedInputPerM = cachedIn;
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
  reasoningPerM?: number;
  cachedInputPerM?: number;
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
      reasoningPerM: price.reasoningPerM,
      cachedInputPerM: price.cachedInputPerM,
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
 * 估算一次呼叫的**稅前**成本（USD）。生圖類走 perImage（token 忽略）；token 類走差別計價：
 *  - cached input 較便宜（019）：inputTokens 內含 cached，故 uncached=(input-cached) 走 input 價、cached 走 cached 價（避免雙算）。
 *  - reasoning/thinking（019）為額外輸出（candidatesTokenCount 不含 thoughts）→ 走 reasoning 價（缺則退 output）。
 * 缺 token（provider 未回報）→ 該部分算 0（不臆造）；估不出（無定價）→ 0。永不為負／NaN。
 */
export function estimateCostUsd(
  kind: UsageKind,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  reasoningTokens?: number,
  cachedInputTokens?: number,
): number {
  const price = priceFor(kind, model);
  if (kind === "openai_image") {
    return round6(price.perImage ?? 0);
  }
  const cached = Math.max(0, cachedInputTokens ?? 0);
  const uncachedInput = Math.max(0, (inputTokens ?? 0) - cached);
  const inCost = (uncachedInput / 1_000_000) * (price.inputPerM ?? 0);
  const cachedCost = (cached / 1_000_000) * (price.cachedInputPerM ?? price.inputPerM ?? 0);
  const outCost = ((outputTokens ?? 0) / 1_000_000) * (price.outputPerM ?? 0);
  const reasoningCost = (Math.max(0, reasoningTokens ?? 0) / 1_000_000) * (price.reasoningPerM ?? price.outputPerM ?? 0);
  const total = inCost + cachedCost + outCost + reasoningCost;
  return Number.isFinite(total) && total > 0 ? round6(total) : 0;
}

/** 6 位小數（micro-USD 級）四捨五入，避免浮點雜訊塞進 est_cost_usd。 */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
