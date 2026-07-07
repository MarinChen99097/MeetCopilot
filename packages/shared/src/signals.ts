/**
 * 會中分析訊號 schema。
 * enum key 一律語言無關英文 key（i18n 規則）；本檔為 SignalKind 的唯一真相來源。
 * 前端訊號 catalog、server 的 Gemini enum、CRM `meeting_signals.type` 一律 import 此常數，不各自硬列。
 *
 * 對齊 API_CONTRACT §6（server→client `signals`）與 CRM_SCHEMA §7（`meeting_signals.type`）。
 */

export const SIGNAL_KINDS = [
  "interest",
  "objection",
  "pain",
  "competitor_mention",
  "buying_signal",
  "risk",
  "pricing",
  "next_step",
  "landmine",
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** 單一訊號項（API_CONTRACT §6 server→client `signals` 的陣列元素）。 */
export interface SignalItem {
  id: string;
  kind: SignalKind;
  label: string;
  confidence: number; // 0..1
}
