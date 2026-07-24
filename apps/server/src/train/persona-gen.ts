/**
 * 共用 LLM persona 產生器（CRM_UPGRADE_PLAN Phase A2；train 頁自助建對象）。
 *
 *  - draftPersonaForContact（#1）：依已知事實**推斷**一位**真實**決策者的九欄 persona 草稿——語意上是「推斷」，
 *    非已證實事實；呼叫端以未驗證（crawler 級）provenance 寫入，絕不標 human/verified（守 CRM_SCHEMA §11）。
 *  - designSyntheticPersona（#4）：**設計一個虛構但合理**的該公司決策者（非真人）——可自由創作；呼叫端以 human
 *    provenance 寫入合法（虛擬角色由使用者創作，無真人可誤 representation）。
 *
 * 兩者共用同一 responseSchema（九欄皆 string、optional、zh-TW 每欄一短句、可空），僅 prompt 文案不同。
 * 九欄鍵一律 import 自 ./persona.ts 的 PERSONA_FIELDS（增刪欄位只改一處；勿另抄）。外呼有界（沿用 gemini client 逾時慣例）。
 */
import { Type } from "@google/genai";
import type { GeminiClient } from "../gemini.js";
import type { Company, Contact, PersonaFieldDraft, TrainDifficulty, TrainObjective } from "@meetcopilot/shared";
import { PERSONA_FIELDS } from "./persona.js";

/** 每欄的 zh-TW 語意提示（餵給 schema 的 description，引導模型產對的內容）。鍵＝PERSONA_FIELDS。 */
const PERSONA_FIELD_HINTS: Record<(typeof PERSONA_FIELDS)[number], string> = {
  communicationStyle: "溝通風格（例：直接、重數據、偏好簡報還是對話）。",
  commStyleNotes: "溝通上的補充注意事項（例：厭惡空泛話術、喜歡具體案例）。",
  personalityNotes: "人格特質（例：謹慎、務實、重視團隊共識）。",
  decisionStyle: "決策風格（例：資料驅動、需多方背書、快速拍板還是保守）。",
  knownPriorities: "當前最在意的優先事項（例：降本、導入速度、資安合規）。",
  goalsKpis: "被考核的目標或 KPI（例：年度營收成長、系統可用率）。",
  hotButtons: "會讓他眼睛一亮／有共鳴的話題（例：ROI、市場領先地位）。",
  painPoints: "正感受到的痛點（例：現有系統維運成本高、跨部門協作卡關）。",
  objectionsRaised: "他可能提出的疑慮或異議（例：擔心遷移風險、質疑價格）。",
};

/** 建九欄（＋#4 選加 title）的 Gemini responseSchema：皆 STRING、nullable、optional（不入 required）。 */
function buildPersonaSchema(includeTitle: boolean): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const f of PERSONA_FIELDS) {
    properties[f] = { type: Type.STRING, nullable: true, description: PERSONA_FIELD_HINTS[f] };
  }
  if (includeTitle) {
    properties.title = {
      type: Type.STRING,
      nullable: true,
      description: "若未提供職稱，給一個貼合該公司的合理職稱（例：資訊長、採購經理）。",
    };
  }
  return { type: Type.OBJECT, properties };
}

const DRAFT_SCHEMA = buildPersonaSchema(false);
const SYNTHETIC_SCHEMA = buildPersonaSchema(true);

/** 從模型原始輸出挑出九欄（只收非空字串、trim），映射成 PersonaFieldDraft。 */
function pickDraft(raw: Record<string, unknown> | null | undefined): PersonaFieldDraft {
  const out: PersonaFieldDraft = {};
  if (!raw || typeof raw !== "object") return out;
  for (const f of PERSONA_FIELDS) {
    const v = raw[f];
    if (typeof v === "string" && v.trim().length > 0) {
      out[f as keyof PersonaFieldDraft] = v.trim();
    }
  }
  return out;
}

/** 把公司事實整理成 grounding 背景（僅取非空欄；zh-TW 標籤）。 */
function companyFacts(company: Company | null): string[] {
  const facts: string[] = [];
  if (!company) return facts;
  facts.push(`公司名稱：${company.name}`);
  const industry = company.industryZh ?? company.industry;
  if (industry) facts.push(`產業：${industry}`);
  const desc = company.descriptionZh ?? company.description;
  if (desc) facts.push(`公司簡介：${desc}`);
  if (company.businessModelZh ?? company.businessModel) {
    facts.push(`商業模式：${company.businessModelZh ?? company.businessModel}`);
  }
  if (company.recentNewsSummary) facts.push(`近期動態：${company.recentNewsSummary}`);
  if (Array.isArray(company.painPoints) && company.painPoints.length > 0) {
    facts.push(`公司層級痛點：${company.painPoints.join("；")}`);
  }
  return facts;
}

/** 把對練情境目的（銷售目標／面談目的）整理成一段（無值回 null）。 */
function objectiveLines(objective?: TrainObjective): string[] {
  const lines: string[] = [];
  const salesGoal = objective?.salesGoal?.trim();
  const meetingPurpose = objective?.meetingPurpose?.trim();
  if (salesGoal) lines.push(`業務此次的銷售目標：${salesGoal}`);
  if (meetingPurpose) lines.push(`此次面談目的：${meetingPurpose}`);
  return lines;
}

const MAX_OUTPUT_TOKENS = 1024;

// ─────────────────────────────────────────────────────────────
// #1 推斷真實決策者的 persona 草稿（未驗證；呼叫端以 crawler 級 provenance 寫入）
// ─────────────────────────────────────────────────────────────

const DRAFT_SYSTEM = [
  "你是資深 B2B 銷售情報分析師。下面是一位**真實**企業決策者的已知事實。",
  "請根據這些事實，**推斷（infer）**他在銷售會議中的溝通風格、決策風格與在意點，協助業務準備對練。",
  "這是**推斷**、不是已證實事實——請務必合理、貼近其職務與產業，切勿杜撰具體數字、預算或私人細節。",
  "以繁體中文（zh-TW）作答，每個欄位一句精簡短句；資訊不足以合理推斷的欄位請留空（null），不要硬填。",
].join("");

export interface DraftPersonaInput {
  company: Company | null;
  contact: Contact;
}

/** #1：依已知事實推斷此真實決策者的九欄 persona 草稿（zh-TW，可空）。 */
export async function draftPersonaForContact(
  gemini: GeminiClient,
  { company, contact }: DraftPersonaInput,
): Promise<PersonaFieldDraft> {
  const facts: string[] = [];
  facts.push(`姓名：${contact.fullNameZh ?? contact.fullName}`);
  if (contact.title ?? contact.titleZh) facts.push(`職稱：${contact.titleZh ?? contact.title}`);
  if (contact.department) facts.push(`部門：${contact.department}`);
  if (contact.seniority) facts.push(`資歷層級：${contact.seniority}`);
  if (contact.decisionPower) facts.push(`採購決策角色：${contact.decisionPower}`);
  if (contact.backgroundSummaryZh ?? contact.backgroundSummary) {
    facts.push(`背景：${contact.backgroundSummaryZh ?? contact.backgroundSummary}`);
  }
  facts.push(...companyFacts(company));

  const prompt =
    `【這位決策者的已知事實】\n${facts.map((f) => `- ${f}`).join("\n")}\n\n` +
    "請據此推斷其 persona 九欄並回傳 JSON。";

  const raw = await gemini.generateJson<Record<string, unknown>>({
    system: DRAFT_SYSTEM,
    prompt,
    schema: DRAFT_SCHEMA,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  return pickDraft(raw);
}

// ─────────────────────────────────────────────────────────────
// #4 設計虛構但合理的決策者（呼叫端以 human provenance 寫入）
// ─────────────────────────────────────────────────────────────

const SYNTHETIC_SYSTEM = [
  "你要為 B2B 銷售對練**設計一個虛構但合理**的企業決策者角色（非真人）。",
  "請依該公司的產業與情境自由創作其人格特質，使角色可信、具挑戰性，能讓業務練到真本事。",
  "以繁體中文（zh-TW）作答，每個欄位一句精簡短句。若未提供職稱，請在 title 欄給一個貼合該公司的合理職稱。",
].join("");

export interface DesignPersonaInput {
  company: Company | null;
  hints: {
    title?: string;
    difficulty?: TrainDifficulty;
    objective?: TrainObjective;
  };
}

/** #4：設計一個虛構但合理的該公司決策者（九欄＋可選 title；zh-TW）。 */
export async function designSyntheticPersona(
  gemini: GeminiClient,
  { company, hints }: DesignPersonaInput,
): Promise<{ fields: PersonaFieldDraft; title?: string }> {
  const facts: string[] = [];
  facts.push(...companyFacts(company));
  if (hints.title?.trim()) facts.push(`指定職稱：${hints.title.trim()}`);
  if (hints.difficulty) facts.push(`設計難度傾向：${hints.difficulty}`);
  facts.push(...objectiveLines(hints.objective));

  const factsBlock =
    facts.length > 0
      ? `【設計依據】\n${facts.map((f) => `- ${f}`).join("\n")}\n\n`
      : "";
  const prompt = `${factsBlock}請設計此虛構決策者的 persona 九欄${hints.title?.trim() ? "" : "（含合理 title）"}並回傳 JSON。`;

  const raw = await gemini.generateJson<Record<string, unknown>>({
    system: SYNTHETIC_SYSTEM,
    prompt,
    schema: SYNTHETIC_SCHEMA,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  const fields = pickDraft(raw);
  const title = typeof raw?.title === "string" && raw.title.trim().length > 0 ? raw.title.trim() : undefined;
  return { fields, title };
}

// ─────────────────────────────────────────────────────────────
// 共用：PersonaFieldDraft（九欄皆 string）→ Partial<Contact> patch
// ─────────────────────────────────────────────────────────────

/**
 * 把九欄 persona 草稿（皆短字串）映射成 Contact patch。
 * 五個 `_json` 陣列欄（knownPriorities/goalsKpis/hotButtons/painPoints）以單元素陣列存；objectionsRaised
 * 存成 `[{objection}]`（對齊 ObjectionRaised 形狀，buildPersonaPrompt 的 formatValue 能還原）。scalar 欄直存字串。
 * 只納入非空欄（空/省略＝不寫該欄）。#1（AI 草稿）與 #4（虛擬人物）共用此映射，只是寫入 provenance 路徑不同。
 */
export function personaDraftToContactPatch(fields: PersonaFieldDraft): Partial<Contact> {
  const patch: Partial<Contact> = {};
  const s = (v?: string): string | undefined => {
    const t = v?.trim();
    return t && t.length > 0 ? t : undefined;
  };
  const communicationStyle = s(fields.communicationStyle);
  if (communicationStyle) patch.communicationStyle = communicationStyle;
  const commStyleNotes = s(fields.commStyleNotes);
  if (commStyleNotes) patch.commStyleNotes = commStyleNotes;
  const personalityNotes = s(fields.personalityNotes);
  if (personalityNotes) patch.personalityNotes = personalityNotes;
  const decisionStyle = s(fields.decisionStyle);
  if (decisionStyle) patch.decisionStyle = decisionStyle;
  const knownPriorities = s(fields.knownPriorities);
  if (knownPriorities) patch.knownPriorities = [knownPriorities];
  const goalsKpis = s(fields.goalsKpis);
  if (goalsKpis) patch.goalsKpis = [goalsKpis];
  const hotButtons = s(fields.hotButtons);
  if (hotButtons) patch.hotButtons = [hotButtons];
  const painPoints = s(fields.painPoints);
  if (painPoints) patch.painPoints = [painPoints];
  const objectionsRaised = s(fields.objectionsRaised);
  if (objectionsRaised) patch.objectionsRaised = [{ objection: objectionsRaised }];
  return patch;
}
