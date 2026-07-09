/**
 * zh-TW presentational label maps（純顯示用，非 API 欄位）。
 * 計費 kind 名稱＝真相來源 packages/shared/src/ops-types.ts 的 USAGE_KINDS（6 種）：
 * gemini_text / gemini_extract / gemini_live / openai_image / embedding / asr；
 * 此處只映射「顯示名稱」，不編造任何金額或費率（單價由 server 端 PRICING__* env 設定）。
 */

/** 已知計費項目說明（/usage「現行 PRICING 表」用）。未知 kind 走 fallback。 */
export const KIND_LABELS: Record<string, string> = {
  gemini_text: "Gemini 文字（會中分析等）",
  gemini_extract: "Gemini 擷取（匯入解析）",
  gemini_live: "Gemini Live（語音模擬）",
  openai_image: "OpenAI 生圖",
  embedding: "向量嵌入查詢",
  asr: "語音轉寫 ASR",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  member: "成員",
};
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export const JOB_STATUS_LABELS: Record<string, string> = {
  queued: "排隊中",
  running: "執行中",
  done: "完成",
  failed: "失敗",
};
export function jobStatusLabel(status: string): string {
  return JOB_STATUS_LABELS[status] ?? status;
}

export const JOB_MODE_LABELS: Record<string, string> = {
  quick: "快速",
  detailed: "詳細",
  deep: "深入",
};
export function jobModeLabel(mode: string): string {
  return JOB_MODE_LABELS[mode] ?? mode;
}

export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: "啟用中",
  suspended: "已停權",
};
export function accountStatusLabel(status: string): string {
  return ACCOUNT_STATUS_LABELS[status] ?? status;
}

export const GROUP_BY_LABELS: Record<string, string> = {
  org: "依組織",
  kind: "依項目",
  model: "依模型",
  day: "依日期",
};
