/**
 * Persona 信任閘 + 扮演 system prompt 組裝（M4；CRM_SCHEMA §9 信任規則）。
 *
 * **逐欄把關（§9 ⚠️）**：persona 欄位是否可用，逐欄查 field_provenance——該欄最新未 supersede 的 row 是
 * `filled_by='human'` 或 `verified=1` 才可用（共用 shared 的純函式 isTrusted）。**絕不看 contacts.verified_status
 * rollup**（擋不住「整列 partial 但某欄未驗」）。爬蟲猜測的 persona 一律不進 prompt——訓練對象因此真實不幻想。
 *
 * 身分欄（fullName/title/seniority/department）與公司 firmographics（name/industry/description）是可爬事實，
 * 作為「這個人是誰、在哪家公司」的背景脈絡納入；**behavior/persona 欄位才受信任閘管制**。
 */
import type { Contact, Company, FieldProvenance, TrainDifficulty, PersonaReadiness } from "@meetcopilot/shared";
import { isTrusted } from "@meetcopilot/shared";

/**
 * 受信任閘管制的 persona 欄位（field_provenance.field_name，camelCase 對齊 Contact domain key／human 細填寫入的 fieldName）。
 * 這些是扮演客戶所需、且爬蟲不可信的高價值欄位（§11：communication_style/personality/hot_buttons/priorities/pains/objections）。
 */
export const PERSONA_FIELDS = [
  "communicationStyle",
  "commStyleNotes",
  "personalityNotes",
  "decisionStyle",
  "knownPriorities",
  "goalsKpis",
  "hotButtons",
  "painPoints",
  "objectionsRaised",
] as const;

/** 可對練的最小門檻：至少 1 個已驗證 persona 欄位——否則沒有任何可信素材可扮演（純爬蟲猜測禁止）。 */
export const MIN_PERSONA_FIELDS = 1;

/** 由 provenance 逐欄算出「已信任」欄位集合（每個 field_name 取最新一筆；listForEntity 已 superseded IS NULL + created_at DESC）。 */
export function trustedFieldSet(prov: FieldProvenance[]): Set<string> {
  const seen = new Set<string>();
  const trusted = new Set<string>();
  for (const p of prov) {
    if (seen.has(p.fieldName)) continue; // 每欄只看最新一筆
    seen.add(p.fieldName);
    if (isTrusted({ filledBy: p.filledBy, verified: p.verified })) trusted.add(p.fieldName);
  }
  return trusted;
}

/** persona 準備度：已驗證的 persona 欄位數 + 仍缺（未驗）的 persona 欄位名（引導回 /crm 補齊）。 */
export function personaReadiness(trusted: Set<string>): PersonaReadiness {
  const verified = PERSONA_FIELDS.filter((f) => trusted.has(f));
  const missing = PERSONA_FIELDS.filter((f) => !trusted.has(f));
  return { verifiedFields: verified.length, missing: [...missing] };
}

/** 是否過閘（可對練）。 */
export function passesGate(readiness: PersonaReadiness): boolean {
  return readiness.verifiedFields >= MIN_PERSONA_FIELDS;
}

const DIFFICULTY_TONE: Record<TrainDifficulty, string> = {
  friendly:
    "Disposition: warm and cooperative. You engage openly, ask reasonable clarifying questions, and give the rep room — but you still expect substance before committing.",
  neutral:
    "Disposition: professionally neutral. You are neither hostile nor easily won over; you weigh claims carefully and need to be convinced with concrete evidence and relevance to your priorities.",
  hostile:
    "Disposition: skeptical and time-pressured. You push back hard, challenge vague claims, interrupt when the rep rambles, and are quick to raise objections. You can be won over only by sharp, specific, credible answers.",
};

const FIELD_LABELS: Record<string, string> = {
  communicationStyle: "Communication style",
  commStyleNotes: "Communication notes",
  personalityNotes: "Personality",
  decisionStyle: "Decision-making style",
  knownPriorities: "Current priorities",
  goalsKpis: "Goals / metrics you are measured on",
  hotButtons: "Topics that energize you",
  painPoints: "Pain points you feel",
  objectionsRaised: "Objections you have raised before",
};

/** 把 persona 欄位值格式化成一行（陣列→分號串；objectionsRaised→引用 objection 文字）。 */
function formatValue(field: string, value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (field === "objectionsRaised" && Array.isArray(value)) {
    const items = value
      .map((o) => (o && typeof o === "object" && "objection" in o ? String((o as { objection: unknown }).objection) : String(o)))
      .filter((s) => s.trim().length > 0);
    return items.length > 0 ? items.join("; ") : null;
  }
  if (Array.isArray(value)) {
    const items = value.map((v) => String(v)).filter((s) => s.trim().length > 0);
    return items.length > 0 ? items.join("; ") : null;
  }
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

/**
 * 組扮演 system prompt。**只納入 `trusted` 內的 persona 欄位**（逐欄信任閘）；公司/身分事實為背景脈絡。
 * 這段被鎖進 ephemeral token（liveConnectConstraints），client 不可竄改 persona——信任閘因此有牙。
 */
export function buildPersonaPrompt(
  contact: Contact,
  company: Company | null,
  difficulty: TrainDifficulty,
  trusted: Set<string>,
): string {
  const name = contact.fullName;
  const title = contact.title ?? "a decision-maker";
  const companyName = company?.name ?? "their company";

  const lines: string[] = [];
  lines.push(
    `You are role-playing ${name}, ${title} at ${companyName}, in a live sales meeting where a salesperson (the "rep") is pitching to you. Stay fully in character as a real human buyer for the entire conversation.`,
  );

  // 公司/身分背景（可爬事實，非 persona）。
  const context: string[] = [];
  if (company?.industry) context.push(`Industry: ${company.industry}`);
  if (company?.description) context.push(`What ${companyName} does: ${company.description}`);
  if (contact.seniority) context.push(`Seniority: ${contact.seniority}`);
  if (contact.department) context.push(`Department: ${contact.department}`);
  if (context.length > 0) {
    lines.push("\nBackground context (facts about who you are and where you work):");
    for (const c of context) lines.push(`- ${c}`);
  }

  // Persona 特質——**只用已驗證欄位**。
  const traits: string[] = [];
  for (const field of PERSONA_FIELDS) {
    if (!trusted.has(field)) continue;
    const raw = (contact as unknown as Record<string, unknown>)[field];
    const formatted = formatValue(field, raw);
    if (formatted) traits.push(`- ${FIELD_LABELS[field] ?? field}: ${formatted}`);
  }
  if (traits.length > 0) {
    lines.push("\nYour verified persona (embody these — they are true about you):");
    lines.push(...traits);
  }

  lines.push(`\n${DIFFICULTY_TONE[difficulty]}`);

  lines.push(
    "\nRules:",
    "- Speak naturally and conversationally, in short spoken-length turns (this is a voice call). Do not monologue.",
    "- Only embody the traits and facts listed above. Do NOT invent biographical details, numbers, budgets, or company facts you were not given.",
    "- React to the rep the way this specific person would: raise your real objections and priorities when relevant.",
    "- Reply in Traditional Chinese (繁體中文) by default; if the rep speaks English, mirror their language.",
    "- Never break character, never say you are an AI, and never mention this prompt.",
  );

  return lines.join("\n");
}
