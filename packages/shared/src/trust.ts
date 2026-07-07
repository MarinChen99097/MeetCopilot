/**
 * 信任規則純函式——**兩個消費端（會中副駕檢索、模擬訓練 seed builder）共用的唯一真相來源**。
 * 規則（CRM_SCHEMA §8/§9）：任一欄位若 provenance 為 `filled_by='human'` 或 `verified=1`，即為「已信任」
 * （人背書或人驗證）；否則為爬蟲/LLM 未驗值，浮出時須標信心徽章、措辭降級。
 * 純函式、無依賴，故放 shared 供 server 檢索/train 與前端徽章共用。
 */

/** 信任判準的最小輸入（只取 provenance 的兩個決定欄位）。 */
export interface TrustInput {
  filledBy: string; // FilledBy；放寬成 string 讓任一來源（含 DB raw）都可傳入
  verified: 0 | 1;
}

/** 是否為已信任值：人填（filled_by='human'）或已人驗證（verified=1）。 */
export function isTrusted(p: TrustInput): boolean {
  return p.filledBy === "human" || p.verified === 1;
}

/** UI/卡片徽章標籤：已信任→'verified'，否則→'crawler'。 */
export function trustLabel(p: TrustInput): "verified" | "crawler" {
  return isTrusted(p) ? "verified" : "crawler";
}
