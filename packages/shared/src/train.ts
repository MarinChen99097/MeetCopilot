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

/**
 * 本次對練的目的（每次對練可填，真人＋虛擬人物通用）——注入 persona system prompt，讓 AI 依此情境演對手。
 * 純情境提示，不落 CRM；空字串/未填則不注入。
 */
export interface TrainObjective {
  /** 銷售目標（例：讓對方同意進 POC）。 */
  salesGoal?: string;
  /** 面談目的（例：釐清預算與決策流程）。 */
  meetingPurpose?: string;
}

/** 建立對練 session 輸入（POST /api/train/sessions body）。difficulty 缺省由 service 帶 'neutral'。 */
export interface NewTrainSession {
  contactId: string;
  dealId?: string;
  difficulty?: TrainDifficulty;
  /** 本次對練情境目的（可選）；注入 persona prompt。 */
  objective?: TrainObjective;
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
  /** 所屬公司 id（供「補齊」深連結直接跳到該公司的該主管）。 */
  companyId: string;
  fullName: string;
  /** 繁中姓名（顯示以中文名為主，對齊 CRM：fullNameZh ?? fullName）。 */
  fullNameZh?: string;
  title: string;
  companyName: string;
  readiness: PersonaReadiness;
  /**
   * 該 contact 是否已「解鎖對練」（trainingUnlocked=1：手動解鎖／AI 補齊直接可練／虛擬人物）。
   * server 的 canTrain 閘用 verified 欄位數 OR 此旗標放行；因此 client 判可對練須 `unlocked || (missing===0 && verifiedFields>0)`——
   * **不可只看 verifiedFields**，否則 AI 補齊寫的是未驗證草稿（verifiedFields 不增）會誤判成鎖住（#1 直接可對練失效）。
   */
  unlocked: boolean;
}

// ─────────────────────────────────────────────────────────────
// train 頁自助建對象（#1 AI 補齊真人 persona ＋ #4 AI 虛擬人物）
// ─────────────────────────────────────────────────────────────

/**
 * persona 九欄草稿（POST /personas/:id/draft 回傳、POST /synthetic 輸入時可手動帶）。
 * 鍵與 Contact 的 persona 欄位一致，也對齊 server persona.ts 的 PERSONA_FIELDS（九欄）——增刪欄位須三處同步。
 * 皆為 zh-TW 短句；空/省略＝該欄不填。
 */
export interface PersonaFieldDraft {
  communicationStyle?: string;
  commStyleNotes?: string;
  personalityNotes?: string;
  decisionStyle?: string;
  knownPriorities?: string;
  goalsKpis?: string;
  hotButtons?: string;
  painPoints?: string;
  objectionsRaised?: string;
}

/**
 * #1 回傳：POST /api/train/personas/:contactId/draft。
 * 語意：以該真人主管＋公司的 CRM 脈絡跑 LLM 產九欄草稿，**寫成未驗證草稿**（crawler 級 provenance，
 * 不標 human/verified——不把 AI 對真人的臆測升成人工真相）＋自動設 trainingUnlocked=1（使用者選「補齊後直接可對練」）。
 */
export interface PersonaDraftResult {
  fields: PersonaFieldDraft;
}

/**
 * #4 輸入：POST /api/train/synthetic（建立「AI 虛擬人物」對練角色）。
 * autoDesign=true（或 persona 省略）→ LLM 依該公司設計一個合理決策者 persona；否則用手動帶的 persona 欄位。
 * 落庫：建一個 is_synthetic=1 的 contact（persona 欄位以 human provenance 寫入——虛擬角色由使用者創作，標人工合法）
 * ＋trainingUnlocked=1 → 立即可對練（沿用 startSession/buildPersonaPrompt）。
 */
export interface NewSyntheticPersona {
  companyId: string;
  /** 顯示名（省略時由 service 產生，如「虛擬決策者」）。 */
  fullName?: string;
  /** 職稱（省略時 AI 設計或留空）。 */
  title?: string;
  /** 手動帶的 persona 九欄；autoDesign=true 時忽略。 */
  persona?: PersonaFieldDraft;
  /** true＝讓 AI 依公司決定 persona（等同不帶 persona）。 */
  autoDesign?: boolean;
  /** 對練難度（預設由 startSession 帶 neutral；此處僅記錄設計者偏好，可省略）。 */
  difficulty?: TrainDifficulty;
  /** 設計情境目的（AI 設計 persona 時作為提示；不落 CRM）。 */
  objective?: TrainObjective;
}

/** #4 回傳：新建虛擬 contact 的 id（前端可直接以此開對練）。 */
export interface CreateSyntheticResult {
  contactId: string;
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
