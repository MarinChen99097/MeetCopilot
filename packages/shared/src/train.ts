/**
 * 語音模擬訓練契約型別（M4）。前後端共用的凍結接縫。
 * 唯一真相來源＝API_CONTRACT §7（wire 形狀）與 M234_CONTRACT §M4（008_training.sql DDL）。
 * 架構事實：瀏覽器拿 ephemeral token **直連 Gemini Live**，音訊不經我方 server（API_FINDINGS §A）。
 */

// ─────────────────────────────────────────────────────────────
// 對練 session（008_training.sql: training_sessions）
// ─────────────────────────────────────────────────────────────

/** 對練難度（training_sessions.difficulty，CHECK）。 */
export const TRAIN_DIFFICULTIES = ["friendly", "neutral", "hostile"] as const;
export type TrainDifficulty = (typeof TRAIN_DIFFICULTIES)[number];

/** 逐字稿說話者（雙向）：rep＝業務、ai＝扮演 persona 的模型。 */
export type TrainSpeaker = "rep" | "ai";

/** 對練逐字稿一輪（POST /api/train/sessions/:id/transcript body 的元素）。 */
export interface TrainTurn {
  speaker: TrainSpeaker;
  text: string;
  t: number; // ms
}

/** 對練 session（domain 實體）。transcript 於對練中/結束時上傳累積。 */
export interface TrainSession {
  id: string;
  orgId: string;
  contactId: string;
  dealId?: string;
  difficulty: TrainDifficulty;
  startedAt?: number;
  endedAt?: number;
  transcript?: TrainTurn[];
  createdAt: number;
}

/** 建立對練 session 輸入（POST /api/train/sessions body）。difficulty 缺省由 service 帶 'neutral'。 */
export interface NewTrainSession {
  contactId: string;
  dealId?: string;
  difficulty?: TrainDifficulty;
}

// ─────────────────────────────────────────────────────────────
// persona 選擇（GET /api/train/personas；只列 persona 欄位過 verified 閘者）
// ─────────────────────────────────────────────────────────────

/** persona 準備度：已驗證欄位數 ＋ 仍缺的欄位名（不足者引導回 /crm 補齊，不可硬開）。 */
export interface PersonaReadiness {
  verifiedFields: number;
  missing: string[];
}

/** 可對練的 contact（GET /api/train/personas 的陣列元素）。 */
export interface PersonaOption {
  contactId: string;
  fullName: string;
  title: string;
  companyName: string;
  readiness: PersonaReadiness;
}

// ─────────────────────────────────────────────────────────────
// startSession 回傳（POST /api/train/sessions → Live ephemeral token）
// ─────────────────────────────────────────────────────────────

/** Gemini Live 直連憑證（server 只發，語音不經我方 server）。 */
export interface TrainLive {
  ephemeralToken: string;
  model: string;
  expireTime: number; // epoch ms
}

/** startSession 回傳的 persona 摘要（給對練畫面顯示名牌）。 */
export interface TrainPersonaRef {
  displayName: string;
  title: string;
}

/** POST /api/train/sessions 回傳形狀（API_CONTRACT §7）。 */
export interface StartTrainSessionResult {
  sessionId: string;
  live: TrainLive;
  persona: TrainPersonaRef;
}

// ─────────────────────────────────────────────────────────────
// 課後評分報告（008_training.sql: training_reports；GET /api/train/reports/:id）
// ─────────────────────────────────────────────────────────────

/** 四維評分（0–100）。 */
export interface TrainScores {
  objectionHandling: number;
  discovery: number;
  clarity: number;
  closing: number;
}

/** highlight 引述卡種類：好的 / 待改進。 */
export type TrainHighlightKind = "good" | "improve";

/** highlight 引述卡（逐字引述 ＋ 評語）。 */
export interface TrainHighlight {
  quote: string;
  comment: string;
  kind: TrainHighlightKind;
}

/** 評分報告（GET /api/train/reports/:id 回傳形狀，API_CONTRACT §7）。 */
export interface TrainReport {
  scores: TrainScores;
  highlights: TrainHighlight[];
  summary: string;
  transcriptRef?: string;
}

/** 建立評分報告輸入（TrainingRepository.createReport；finish 觸發評分後寫入）。 */
export interface NewTrainReport {
  sessionId: string;
  scores: TrainScores;
  highlights: TrainHighlight[];
  summary: string;
  transcriptRef?: string;
}
