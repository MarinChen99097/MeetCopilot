/**
 * redactPii — 純函式 PII 遮蔽（email／電話／信用卡樣式 → 遮罩）。
 * 借 v1 `apps/server/src/pii.ts` 的樣式，提升到 @meetcopilot/shared 供**兩端**共用：
 *   (a) server：送 LLM 分析前（不必要的原始 PII 不外送）＋ 落 DB 前（M5_CONTRACT §A）。
 *   (b) client（潛在）：HUD 顯示逐字稿前的前端遮蔽。
 * 無外部相依、無 I/O、確定性 → 可安全跨前後端引用。
 */

/** email：local@domain.tld。 */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 信用卡樣式：13–19 碼數字，允許空白或連字號分組（含無分隔純連續數字）。先於電話處理避免被切碎。 */
const CREDIT_CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
/** 電話／其他長數字序列：8 碼以上連續數字（信用卡已先處理，這裡收殘餘較短連號）。 */
const PHONE_RE = /\d{8,}/g;

/** 遮罩替代字元。 */
const MASK = "***";

/**
 * 以 MASK 取代 text 內的 email／信用卡／長數字序列。空字串／falsy 原樣回傳。
 * 順序：email → 信用卡 → 電話（信用卡需在電話之前，否則長卡號會被電話規則先切碎）。
 */
export function redactPii(text: string): string {
  if (!text) return text;
  let out = text.replace(EMAIL_RE, MASK);
  out = out.replace(CREDIT_CARD_RE, MASK);
  out = out.replace(PHONE_RE, MASK);
  return out;
}
