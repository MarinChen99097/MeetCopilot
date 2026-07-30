/**
 * 會中「待講清單」（Meeting Checklist）的共用型別與常數。
 * **唯一真相來源＝`docs/MEETING_CHECKLIST_CONTRACT.md` §4**（本檔逐字實作；漂移＝bug）。
 *
 * 語意：會前依「會議目標 ＋ 簡報全文 ＋ CRM 情報」生成一份達成本場目標所需的溝通清單
 * （必講 talk／必問 ask／必回應 address），會中隨對話與簡報進度自動劃掉，報告者可隨時手動改。
 *
 * I3（契約 §1）：清單絕不外流——wire 上只走 hud，`present` 端永遠看不到本型別的任何資料。
 */

/** 清單分類：talk＝必講、ask＝必問、address＝必回應。 */
export const CHECKLIST_CATEGORIES = ["talk", "ask", "address"] as const;
export type ChecklistCategory = (typeof CHECKLIST_CATEGORIES)[number];

/** 項目狀態：pending＝未講、covered＝已涵蓋、skipped＝報告者主動略過。 */
export const CHECKLIST_STATUSES = ["pending", "covered", "skipped"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** 劃掉來源：transcript＝對話勾稽、slide＝簡報進度、manual＝報告者手動。 */
export const CHECKLIST_COVER_SOURCES = ["transcript", "slide", "manual"] as const;
export type ChecklistCoverSource = (typeof CHECKLIST_COVER_SOURCES)[number];

/** 單一待講項目（HUD 顯示 ＋ 持久層 row 的 domain 形狀）。 */
export interface ChecklistItem {
  id: string;
  idx: number;
  category: ChecklistCategory;
  title: string;
  detail?: string;
  slideIdx?: number;
  keywords: string[];
  priority: "must" | "nice";
  status: ChecklistStatus;
  coveredBy?: ChecklistCoverSource;
  coveredAt?: number;
  evidence?: string;
}

/** 生成端產出的新項目（id 與狀態三欄由持久層/勾稽端決定）。 */
export type NewChecklistItem = Omit<ChecklistItem, "id" | "status" | "coveredBy" | "coveredAt" | "evidence">;

export const CHECKLIST_MAX_ITEMS = 14; // 生成上限
export const CHECKLIST_MIN_ITEMS = 6;
export const CHECKLIST_PROMPT_MAX_PENDING = 15; // 送進分析 prompt 的 pending 上限
export const SLIDE_DWELL_COVER_MS = 20_000; // 翻頁自動判 covered 的最小停留

/**
 * 「must 優先、同 priority 再依 idx」的**唯一** comparator（契約 §7.1 pending 注入順序＝§8 HUD「下一個待辦」）。
 * server（hub 注入分析 prompt）與 web（ChecklistPanel nextPending）都必須用這一個——兩端各寫一份就會出現
 * 「HUD 顯示的下一項 ≠ 模型認定的最優先項」的漂移。
 */
export function compareChecklistOrder(
  a: Pick<ChecklistItem, "priority" | "idx">,
  b: Pick<ChecklistItem, "priority" | "idx">,
): number {
  return a.priority === b.priority ? a.idx - b.idx : a.priority === "must" ? -1 : 1;
}
