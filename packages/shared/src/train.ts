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

// ─────────────────────────────────────────────────────────────
// 對練情境模式（training_sessions.mode；決定 AI 扮誰＋評分維度）——資料驅動、可擴充
// ─────────────────────────────────────────────────────────────

/** 對練情境模式鍵（training_sessions.mode，預設 'sales'）。新增模式＝在 TRAIN_MODES 加一筆。 */
export const TRAIN_MODES_KEYS = ["sales", "partnership", "government", "interview"] as const;
export type TrainMode = (typeof TRAIN_MODES_KEYS)[number];

/** 一個評分維度：label＝報告顯示（zh），guide＝給評分 LLM 的一句評分依據（en）。 */
export interface TrainScoreDimensionDef {
  label: string;
  guide: string;
}

/**
 * 一個情境模式的完整定義（**單一真相**：web 顯示、server persona 框架、評分 rubric 都讀它）。
 * - label/aiRole/youRole/blurb：zh 顯示（模式選擇卡）。
 * - framing：接在 buildPersonaPrompt 開頭 `You are role-playing {name}, {title} at {company}, ` 之後的英文子句（界定 AI 扮誰、此人立場）。
 * - stance：注入「本次對練情境」段的 zh 立場句（取代舊寫死的「你是買方」）。
 * - coachRole：評分 LLM 的教練身分英文句。
 * - dimensions：此模式的評分維度（label 顯示＋guide 評分依據）；數量可變（評分回傳 labeled 陣列）。
 */
export interface TrainModeDef {
  key: TrainMode;
  label: string;
  aiRole: string;
  youRole: string;
  blurb: string;
  framing: string;
  stance: string;
  coachRole: string;
  dimensions: TrainScoreDimensionDef[];
}

export const TRAIN_MODES: Record<TrainMode, TrainModeDef> = {
  sales: {
    key: "sales",
    label: "銷售對練",
    aiRole: "對方公司的決策者／買方",
    youRole: "業務",
    blurb: "你向對方公司決策者推銷，練提案、處理異議、推進成交。",
    framing:
      'in a live sales meeting where a salesperson (the "rep") is pitching to you — you are the buyer/decision-maker weighing whether to purchase',
    stance: "你是買方，不必配合業務的目標，該質疑、該把關就照你的立場來",
    coachRole: "an expert B2B sales coach reviewing a role-play practice call (evaluate the salesperson)",
    dimensions: [
      { label: "異議處理", guide: "how well the rep acknowledged and resolved the customer's objections/pushback" },
      { label: "需求挖掘", guide: "quality of questions uncovering needs, priorities, pain, and buying process" },
      { label: "清晰度", guide: "how clear, concise, and jargon-free the rep's explanations were" },
      { label: "收尾", guide: "whether the rep advanced the deal — clear next steps, asked for commitment" },
    ],
  },
  partnership: {
    key: "partnership",
    label: "尋求合作簡報",
    aiRole: "對方公司的高階主管（評估是否合作）",
    youRole: "提案者",
    blurb: "你向對方公司高階報告，爭取策略合作，練互利論證與信任建立。",
    framing:
      "in a meeting where you are a senior decision-maker evaluating whether to enter a strategic partnership the presenter is proposing — you are NOT being sold a product; you weigh mutual benefit, fit, and risk as a potential partner",
    stance: "你是對方公司的高階主管，正在評估這樁合作是否值得——關注互利、契合度、風險與可行性，該追問、該把關就照你的立場來",
    coachRole:
      "an expert partnership/business-development coach reviewing a role-play where someone pitches a business partnership (evaluate the presenter)",
    dimensions: [
      { label: "價值主張", guide: "how clearly the presenter articulated a compelling, differentiated value proposition" },
      { label: "互利論證", guide: "how well they framed mutual benefit / win-win rather than one-sided asks" },
      { label: "信任建立", guide: "credibility, rapport, and how they addressed risk and trust concerns" },
      { label: "推進下一步", guide: "whether they secured a concrete next step toward cooperation" },
    ],
  },
  government: {
    key: "government",
    label: "政府簡報",
    aiRole: "政府審查／承辦人員",
    youRole: "報告者",
    blurb: "你向政府承辦／審查人員報告專案，練政策對齊、合規論述與答詢。",
    framing:
      "in a briefing where you are a government official/reviewer and the presenter is reporting a project or proposal to you seeking approval, funding, or support — you scrutinize policy alignment, compliance, public value, and feasibility with a public-sector gatekeeper's diligence",
    stance: "你是政府審查／承辦人員，正在審視這個提案——嚴謹把關政策對齊、法規合規、公共價值與可行性，該質詢、該要證據就直接問",
    coachRole:
      "an expert public-sector communications coach reviewing a role-play where someone briefs a government official (evaluate the presenter)",
    dimensions: [
      { label: "政策對齊", guide: "how well the presenter tied the proposal to relevant policy goals and priorities" },
      { label: "合規嚴謹", guide: "rigor on regulations, procedures, accountability, and evidence" },
      { label: "公共價值", guide: "how clearly they conveyed public benefit and impact" },
      { label: "答詢應變", guide: "how well they handled the official's probing questions and challenges" },
    ],
  },
  interview: {
    key: "interview",
    label: "面試",
    aiRole: "面試官",
    youRole: "求職者",
    blurb: "AI 當面試官提問追問，你回答；練表達、專業深度與臨場反應。",
    framing:
      "in a live job interview where you are the interviewer and the other person is the candidate answering your questions — probe their experience, skills, and fit, and ask natural follow-ups",
    stance: "你是面試官，正在面試這位求職者——依其回答自然追問，評估其能力與適配，該挖深、該追問就直接問",
    coachRole: "an expert interview coach reviewing a mock job interview (evaluate the CANDIDATE, not the interviewer)",
    dimensions: [
      { label: "表達溝通", guide: "clarity, structure, and confidence of the candidate's communication" },
      { label: "專業深度", guide: "depth and correctness of the domain knowledge and experience the candidate demonstrated" },
      { label: "情境反應", guide: "how well the candidate handled follow-ups, curveballs, and pressure" },
      { label: "結構化回答", guide: "whether answers were well-structured (e.g. STAR), concrete, and on-point" },
    ],
  },
};

// ─────────────────────────────────────────────────────────────
// 對練語言（只影響本場 persona prompt 的回覆語言規則；不落 CRM）
// ─────────────────────────────────────────────────────────────

/** 對練語言：zh＝AI 全程繁中、en＝AI 全程英文、auto＝跟隨對方語言（原 mirror 行為）。預設 zh。 */
export const TRAIN_LANGS = ["zh", "en", "auto"] as const;
export type TrainLang = (typeof TRAIN_LANGS)[number];

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
  /** 情境模式（決定 persona 框架＋評分維度）；舊列回填 'sales'。 */
  mode: TrainMode;
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
  /** 情境模式（可選，預設 'sales'）；決定 persona 框架＋評分維度。 */
  mode?: TrainMode;
  /** 對練語言（可選，預設 'zh'）；決定 AI 回覆語言（zh 全中文／en 全英文／auto 跟隨對方）。 */
  lang?: TrainLang;
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
  /**
   * W4「上次分數」：**最近一份**對練報告的總分（0–100，各維度平均四捨五入）。
   * 從既有 training_reports/training_sessions 帶出；**從未練過（或練過但沒評分報告）→ undefined**，
   * 前端顯示「尚未對練」，不得補 0（0 分和沒練過是兩件事）。
   */
  lastScore?: number;
  /** 上次對練時間 epoch-ms（session.ended_at，缺則取報告產生時間）。無報告 → undefined。 */
  lastPracticedAt?: number;
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

/** 單一評分維度：label＝維度名（依模式，見 TRAIN_MODES[mode].dimensions）、score＝0–100。 */
export interface TrainScoreDimension {
  label: string;
  score: number;
}

/**
 * 評分（labeled 陣列，各模式維度數/名稱可不同；order 即顯示順序）。
 * 取代舊的固定四維 object——舊儲存列（{objectionHandling,discovery,clarity,closing}）由 repo 讀取時
 * 相容轉為此陣列（用 TRAIN_MODES.sales.dimensions 的 label 對應）。
 */
export type TrainScores = TrainScoreDimension[];

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
