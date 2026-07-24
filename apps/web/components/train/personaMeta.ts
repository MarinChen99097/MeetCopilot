import type { TrainDifficulty } from "@meetcopilot/shared";

/**
 * 對練 UI 共用中繼資料（PersonaPicker ＋ SyntheticPersonaCreator 共用，抽出成獨立模組避免兩者互 import 成環）。
 */

/** 難度顯示中繼（label／提示／色調 tone），對齊 TRAIN_DIFFICULTIES。 */
export const DIFFICULTY_META: Record<TrainDifficulty, { label: string; hint: string; tone: string }> = {
  friendly: { label: "友善", hint: "配合、給你空間鋪陳", tone: "ok" },
  neutral: { label: "中性", hint: "務實、就事論事", tone: "info" },
  hostile: { label: "敵對", hint: "多疑、頻繁打斷施壓", tone: "danger" },
};

/**
 * persona 九欄的繁中標籤（鍵＝Contact persona 欄位＝server persona.ts 的 PERSONA_FIELDS）。
 * PersonaPicker 用於把 readiness.missing 的英文欄名翻成中文；SyntheticPersonaCreator 用於手動填九欄的標籤。
 */
export const FIELD_LABELS: Record<string, string> = {
  communicationStyle: "溝通風格",
  commStyleNotes: "溝通備註",
  personalityNotes: "個性特質",
  decisionStyle: "決策風格",
  knownPriorities: "優先事項",
  goalsKpis: "目標／KPI",
  hotButtons: "在意點",
  painPoints: "痛點",
  objectionsRaised: "曾提異議",
};
