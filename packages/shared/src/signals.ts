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
  // 會中 CRM 消費（RESEARCH_UPGRADE_CONTRACT §4.2）：以下兩類為「檢索觸發」訊號——
  // 用來把最新交談焦點餵給會中 CRM 檢索，**觸發 CRM 補充卡但不觸發自動研究 job**
  // （auto-research 觸發條件不變，見 realtime/orchestrator.ts AUTO_RESEARCH_KINDS）。
  "person_mention", // 提到人名（對方在場/被提及的人）
  "topic_shift", // 話題轉換（討論焦點改變）
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** 單一訊號項（API_CONTRACT §6 server→client `signals` 的陣列元素）。 */
export interface SignalItem {
  id: string;
  kind: SignalKind;
  label: string;
  confidence: number; // 0..1
}
