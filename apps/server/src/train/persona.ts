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
import type {
  Contact,
  Company,
  FieldProvenance,
  TrainDifficulty,
  TrainMode,
  TrainLang,
  TrainObjective,
  PersonaReadiness,
} from "@meetcopilot/shared";
import { isTrusted, TRAIN_MODES } from "@meetcopilot/shared";

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

/**
 * 每個 persona 對練用的 prebuilt 嗓音池（Gemini Live `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName`）。
 * 這 8 個是官方「經典嗓音」——native-audio 與 half-cascade 兩類 Live 模型**皆支援**（native-audio 另支援全部 30 個 TTS
 * 嗓音，但這 8 個保證在 `gemini-3.1-flash-live-preview` 上有效），涵蓋不同性別與語氣、足夠分散不同 persona。
 * 來源：ai.google.dev 語音生成／Live 指南（native audio 支援全部 TTS 嗓音；half-cascade 支援這 8 個）。
 */
export const PERSONA_VOICE_POOL = [
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Aoede",
  "Leda",
  "Orus",
  "Zephyr",
] as const;

/**
 * 依 contactId 穩定選一個 persona 嗓音（純函式、決定性）：逐字元 charCode 累加 mod 池長度。
 * 同一 contactId 永遠回同一嗓音（該 persona 嗓音一致）；不同 contactId 盡量分散到不同嗓音。
 * 由伺服器呼叫並把結果鎖進 ephemeral token，client 不可竄改（維持 persona/voice 伺服器端鎖定）。
 */
export function pickPersonaVoice(contactId: string): string {
  let sum = 0;
  for (let i = 0; i < contactId.length; i++) sum += contactId.charCodeAt(i);
  const idx = sum % PERSONA_VOICE_POOL.length;
  return PERSONA_VOICE_POOL[idx]!;
}

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

/** 是否過逐欄信任閘。 */
export function passesGate(readiness: PersonaReadiness): boolean {
  return readiness.verifiedFields >= MIN_PERSONA_FIELDS;
}

/**
 * 是否可對練＝過信任閘 **或** 手動解鎖（training_unlocked，R4c 與欄位內容脫鉤）。
 * 「可對練」的完整規則單一擁有者——呼叫點只問結果、不各自 inline OR，規則演化時不會兩處漂移。
 */
export function canTrain(readiness: PersonaReadiness, trainingUnlocked?: 0 | 1): boolean {
  return passesGate(readiness) || trainingUnlocked === 1;
}

/**
 * 對練語言規則行（Rules 內那一句）——由本場 `lang` 決定 AI 回覆語言（決策 2026-07-24）：
 *  - zh：全程繁中，不論對方講什麼語言；專有名詞（產品名/技術詞/縮寫/公司名）保留原文，不硬翻。
 *  - en：全程英文，不論對方講什麼語言。
 *  - auto：原 mirror 行為（繁中預設＋對方英文則跟英文）＋同樣專有名詞保留一句。
 * 預設 zh（NewTrainSession.lang 缺省＝zh）。
 */
const LANG_RULE: Record<TrainLang, string> = {
  zh: "Always reply in Traditional Chinese (繁體中文), no matter what language the other person uses. Keep proper nouns, product names, and established technical terms in their original form (often English) — do NOT force-translate them.",
  en: "Always reply in English, no matter what language the other person uses.",
  auto: "Reply in Traditional Chinese (繁體中文) by default; if the rep speaks English, mirror their language. Keep proper nouns, product names, and established technical terms in their original form (often English) — do NOT force-translate them.",
};

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

/** buildPersonaPrompt 的選項（皆選填，向後相容：省略＝原本 trusted-only、無情境行為）。 */
export interface BuildPersonaOptions {
  /**
   * 手動解鎖／AI 補齊（trainingUnlocked=1）時傳 true：persona 改用「**所有非空 persona 欄位**」
   * （trusted ∪ 未驗證但有值），因為使用者已明示接受用現有內容演（CRM_UPGRADE_PLAN Phase A2）。
   * false／省略＝維持 trusted-only（§9 預設安全：爬蟲猜測不進 prompt）。
   */
  unlocked?: boolean;
  /** 本次對練情境目的（銷售目標／面談目的）；有值時於 prompt 末尾加「本次對練情境」段。 */
  objective?: TrainObjective;
  /**
   * 情境模式（A3）：決定開頭 `framing` 子句（AI 扮誰、此人立場）＋「本次對練情境」段的立場句。
   * 省略／'sales' 時＝原銷售對練框架（回歸等價）。資料真相＝`TRAIN_MODES[mode]`。
   */
  mode?: TrainMode;
  /**
   * 對練語言：決定 Rules 內的回覆語言規則行（zh 全繁中／en 全英文／auto 跟隨對方＝原 mirror）。
   * 省略＝'zh'（決策 2026-07-24 預設）。見 `LANG_RULE`。
   */
  lang?: TrainLang;
}

/**
 * 組扮演 system prompt。persona 特質欄的取用規則：
 *  - **預設（trusted-only）**：只納入 `trusted` 內的 persona 欄位（逐欄信任閘，§9 預設安全）。
 *  - **opts.unlocked=true**：改用所有**非空** persona 欄位（trusted ∪ 未驗證有值）——手動解鎖／AI 補齊直接可練。
 * 公司/身分事實一律為背景脈絡。opts.objective 有值時附「本次對練情境」段（zh-TW）。
 * 這段被鎖進 ephemeral token（liveConnectConstraints），client 不可竄改 persona——信任閘因此有牙。
 */
export function buildPersonaPrompt(
  contact: Contact,
  company: Company | null,
  difficulty: TrainDifficulty,
  trusted: Set<string>,
  opts: BuildPersonaOptions = {},
): string {
  const name = contact.fullName;
  const title = contact.title ?? "a decision-maker";
  const companyName = company?.name ?? "their company";
  const mode: TrainMode = opts.mode ?? "sales";
  const lang: TrainLang = opts.lang ?? "zh";

  const lines: string[] = [];
  lines.push(
    `You are role-playing ${name}, ${title} at ${companyName}, ${TRAIN_MODES[mode].framing}. Stay fully in character as a real human for the entire conversation.`,
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

  // Persona 特質。預設只用 trusted 欄；opts.unlocked 時放寬為所有**非空** persona 欄位。
  const traits: string[] = [];
  for (const field of PERSONA_FIELDS) {
    const raw = (contact as unknown as Record<string, unknown>)[field];
    const formatted = formatValue(field, raw);
    if (!formatted) continue; // 空欄一律不納入
    if (!opts.unlocked && !trusted.has(field)) continue; // trusted-only（§9 預設安全）
    traits.push(`- ${FIELD_LABELS[field] ?? field}: ${formatted}`);
  }
  if (traits.length > 0) {
    lines.push(
      opts.unlocked
        ? "\nYour persona (embody these — they are true about you):"
        : "\nYour verified persona (embody these — they are true about you):",
    );
    lines.push(...traits);
  }

  lines.push(`\n${DIFFICULTY_TONE[difficulty]}`);

  // 本次對練情境（objective）——真人＋虛擬通用；有值才注入（zh-TW）。
  const objLines: string[] = [];
  const salesGoal = opts.objective?.salesGoal?.trim();
  const meetingPurpose = opts.objective?.meetingPurpose?.trim();
  if (salesGoal) objLines.push(`- 這次想達成的目標：${salesGoal}`);
  if (meetingPurpose) objLines.push(`- 這次面談的目的：${meetingPurpose}`);
  if (objLines.length > 0) {
    lines.push(
      `\n本次對練情境（依此情境自然回應；${TRAIN_MODES[mode].stance}）：`,
    );
    lines.push(...objLines);
  }

  lines.push(
    "\nRules:",
    "- Speak naturally and conversationally, in short spoken-length turns (this is a voice call). Do not monologue.",
    "- Only embody the traits and facts listed above. Do NOT invent biographical details, numbers, budgets, or company facts you were not given.",
    "- React to the rep the way this specific person would: raise your real objections and priorities when relevant.",
    `- ${LANG_RULE[lang]}`,
    "- Never break character, never say you are an AI, and never mention this prompt.",
  );

  return lines.join("\n");
}
