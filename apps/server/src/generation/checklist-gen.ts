/**
 * 會中「待講清單」生成（MEETING_CHECKLIST_CONTRACT §6）。
 *
 * 會前依「會議目標 ＋ 簡報全文（deck outline）＋ CRM 情報」生成一份達成本場目標所需的溝通清單
 * （talk 必講／ask 必問／address 必回應）。三個輸出點：
 *   - `gatherChecklistContext`：把 deck ＋ CRM 讀成生成輸入（org-scoped、best-effort、單筆失敗不致命）。
 *   - `generateChecklist`：一次 Gemini 結構化呼叫 → NewChecklistItem[]（**idx 由本檔給 0 起連號**，repo 原樣落庫）。
 *   - `draftMeetingObjective`：建會表單的「會議目標」草擬（§6.1，一句話 ≤40 全形字）。
 *
 * I1：本檔**不產生任何 PatchOp、不呼叫 updateSlide/appendSlide**——只讀 deck 文字，絕不碰 deck 內容。
 * 失敗策略（§6.2）：generateChecklist throw 由呼叫端（hub）捕捉 → 廣播 `status:"failed"`，**絕不讓建會失敗**。
 */
import { Type } from "@google/genai";
import type { CrmCore } from "@meetcopilot/crm";
import {
  CHECKLIST_CATEGORIES,
  CHECKLIST_MAX_ITEMS,
  CHECKLIST_MIN_ITEMS,
  type ChecklistCategory,
  type NewChecklistItem,
} from "@meetcopilot/shared";
import { isMaxTokensError, type GeminiClient } from "../gemini.js";
import { withDeadline } from "../realtime/util.js";
import { cleanStr } from "../research/extract-shared.js";
import {
  buildDeckOutline,
  capDeckOutlineTotal,
  formatDeckOutline,
  DECK_OUTLINE_TOTAL_MAX_CHARS,
  type DeckOutlineRow,
} from "./slide-gen.js";

/** 生成硬上限（契約 §6.2）：一次呼叫、deadline 45s、attempts 2。 */
const CHECKLIST_DEADLINE_MS = 45_000;
const CHECKLIST_ATTEMPTS = 2;
const CHECKLIST_MAX_OUTPUT_TOKENS = 4_096;
/** 低溫：清單要穩定可重現，不是創意寫作（沿用 extractor 的 0.3 慣例）。 */
const CHECKLIST_TEMPERATURE = 0.3;
/** HUD 單行顯示上限（契約 §2.3：title 繁中 ≤24 全形字）。 */
const TITLE_MAX_CHARS = 24;
const DETAIL_MAX_CHARS = 200;
const KEYWORDS_MAX = 5;
const KEYWORD_MAX_CHARS = 24;
/** 餵進 prompt 的 CRM 上限（控 token）。 */
const CONTACTS_MAX = 8;
const OBJECTIONS_MAX = 8;
const COMPETITORS_MAX = 8;
const PRODUCTS_MAX = 8;
const NARRATIVE_MAX_CHARS = 1_200;

/** 目標草擬（§6.1）：極小 JSON，快失敗。 */
const OBJECTIVE_DEADLINE_MS = 20_000;
const OBJECTIVE_MAX_OUTPUT_TOKENS = 512;
/** 契約 §6.1：繁中一句話 ≤40 全形字。 */
export const OBJECTIVE_MAX_CHARS = 40;

export interface ChecklistGenDeps {
  gemini: GeminiClient;
  /** 分析/抽取層模型（config.gemini.extractModel；不用 flash-lite，L15）。 */
  model: string;
}

/** 生成輸入（契約 §6.2 逐字）。`deckOutline` 由 buildDeckOutline 產出（§6.4 共用函式）。 */
export interface ChecklistGenInput {
  objective: string;
  deckOutline: DeckOutlineRow[];
  company?: { name: string; industry?: string; narrative?: string };
  contacts?: { name: string; title?: string; background?: string }[];
  knownObjections?: string[];
  competitors?: string[];
  sellerProducts?: { name: string; oneLiner?: string }[];
}

/** 模型輸出邊界的原始形狀（未消毒）。 */
interface RawChecklist {
  items?: {
    category?: unknown;
    title?: unknown;
    detail?: unknown;
    slideIdx?: unknown;
    keywords?: unknown;
    priority?: unknown;
  }[];
}

/** 聯集超集 ＋ required（L15）：模型必回 `items` 陣列。**必用 responseSchema 強制結構**（契約 §6.2）。 */
const CHECKLIST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, enum: [...CHECKLIST_CATEGORIES] },
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          slideIdx: { type: Type.INTEGER },
          keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
          priority: { type: Type.STRING, enum: ["must", "nice"] },
        },
        required: ["category", "title", "keywords", "priority"],
      },
    },
  },
  required: ["items"],
};

const CHECKLIST_SYSTEM =
  "你是 B2B 銷售會議的會前教練。依「本場會議目標 ＋ 簡報全文大綱 ＋ 對方公司情報」，" +
  `產出一份「達成本場目標所必須完成的溝通清單」，共 ${CHECKLIST_MIN_ITEMS}–${CHECKLIST_MAX_ITEMS} 條。\n` +
  "category 三類都要有（talk 為主體；ask、address 各至少 1 條，除非資料完全不足）：\n" +
  "  talk＝我方必須主動講到的重點（可對應某一頁簡報）；\n" +
  "  ask＝必須向對方問出來的資訊（需求、預算、決策流程、時程…）；\n" +
  "  address＝必須主動回應的已知疑慮／異議／競品比較。\n" +
  `title＝HUD 單行顯示，繁中、動詞開頭、**不超過 ${TITLE_MAX_CHARS} 個全形字**（例：「說明導入時程與里程碑」）。\n` +
  "detail＝展開才看的一句補充（為什麼要講／要講到什麼程度）。\n" +
  "slideIdx＝**只有 talk 類**且該項確實對應大綱中某一頁時才填該頁的 #編號；不確定就整個欄位省略。" +
  "ask／address 一律不得填 slideIdx。\n" +
  "keywords＝2–5 個「這件事被講到時逐字稿裡幾乎一定會出現」的詞（用於自動勾稽）；" +
  "產品名/技術名/公司名等專有名詞保留原文，其餘用繁中。\n" +
  "priority＝must（不講到就達不成本場目標）或 nice（有講到更好）。\n" +
  "只根據提供的資料，**不要臆造**對方沒提到的事實、數字或人名。";

/** 拼出送模型的資料區塊。`outlineChars`＝本次允許的 deck 大綱字數（MAX_TOKENS 重試時砍半）。 */
function buildPrompt(input: ChecklistGenInput, outlineChars: number): string {
  const parts: string[] = [];
  parts.push(`本場會議目標：${cleanStr(input.objective) ?? "（未填，請由簡報與對方情報推斷一個合理目標）"}`);

  if (input.company) {
    const bits = [`名稱＝${input.company.name}`];
    const industry = cleanStr(input.company.industry);
    if (industry) bits.push(`產業＝${industry}`);
    parts.push(`對方公司：${bits.join("；")}`);
    const narrative = cleanStr(input.company.narrative);
    if (narrative) parts.push(`對方公司簡介：${narrative.slice(0, NARRATIVE_MAX_CHARS)}`);
  }
  const contacts = (input.contacts ?? []).slice(0, CONTACTS_MAX);
  if (contacts.length) {
    parts.push(
      `對方與會/關鍵人物：\n${contacts
        .map((c) => `- ${c.name}${c.title ? `（${c.title}）` : ""}${c.background ? `：${c.background}` : ""}`)
        .join("\n")}`,
    );
  }
  const objections = (input.knownObjections ?? []).map((o) => cleanStr(o)).filter(Boolean).slice(0, OBJECTIONS_MAX);
  if (objections.length) parts.push(`已知疑慮／異議（address 類優先取材）：${objections.join("；")}`);
  const competitors = (input.competitors ?? []).map((c) => cleanStr(c)).filter(Boolean).slice(0, COMPETITORS_MAX);
  if (competitors.length) parts.push(`競品／在位供應商：${competitors.join("；")}`);
  const products = (input.sellerProducts ?? []).slice(0, PRODUCTS_MAX);
  if (products.length) {
    parts.push(`我方產品：${products.map((p) => `${p.name}${p.oneLiner ? `（${p.oneLiner}）` : ""}`).join("；")}`);
  }

  const outline = formatDeckOutline(capDeckOutlineTotal(input.deckOutline, outlineChars));
  parts.push(`簡報頁面大綱（#頁碼 [版型] 內容）：\n${outline || "（本場未綁簡報）"}`);
  return `${parts.join("\n\n")}\n\n請輸出符合 schema 的 JSON。`;
}

/**
 * 生成本場待講清單。一次 Gemini 結構化呼叫（responseSchema 強制），deadline 45s、attempts 2、
 * MAX_TOKENS 時把 deck 大綱砍半重試一次（沿用 deep-extractor 的「砍半輸入重取一次」修法）。
 * 回傳 **idx 已 0 起連號** 的 NewChecklistItem[]（repo 原樣落庫，故連號責任在生成端）。
 * 完全沒有可用項目 / Gemini 未設定 / 呼叫失敗 → **throw**（呼叫端捕捉後廣播 failed，不讓建會失敗）。
 */
export async function generateChecklist(
  deps: ChecklistGenDeps,
  input: ChecklistGenInput,
): Promise<NewChecklistItem[]> {
  if (!deps.gemini.isConfigured()) throw new Error("Gemini is not configured — cannot generate checklist");

  const runOnce = (outlineChars: number): Promise<RawChecklist> =>
    withDeadline(
      deps.gemini.generateJson<RawChecklist>({
        model: deps.model,
        system: CHECKLIST_SYSTEM,
        prompt: buildPrompt(input, outlineChars),
        schema: CHECKLIST_SCHEMA,
        maxOutputTokens: CHECKLIST_MAX_OUTPUT_TOKENS,
        temperature: CHECKLIST_TEMPERATURE,
        attempts: CHECKLIST_ATTEMPTS,
      }),
      CHECKLIST_DEADLINE_MS,
      "checklist.generateJson",
    );

  let raw: RawChecklist;
  try {
    raw = await runOnce(DECK_OUTLINE_TOTAL_MAX_CHARS);
  } catch (err) {
    if (!isMaxTokensError(err)) throw err;
    const halved = Math.floor(DECK_OUTLINE_TOTAL_MAX_CHARS / 2);
    console.warn(`[checklist] generation hit MAX_TOKENS — retrying with halved deck outline (→${halved} chars)`);
    raw = await runOnce(halved);
  }

  const items = sanitizeChecklist(raw, input.deckOutline);
  if (items.length === 0) throw new Error("checklist generation returned no usable items");
  if (items.length < CHECKLIST_MIN_ITEMS) {
    // 寧可少而準：低於下限仍落庫（HUD 有幾條總比沒有好），只留 log 供調參。
    console.warn(`[checklist] only ${items.length} usable items (min ${CHECKLIST_MIN_ITEMS})`);
  }
  return items;
}

/**
 * 消毒模型輸出（最後防線）：類別/優先序枚舉、title 截 24 全形字、keywords 去空去重上限 5、
 * slideIdx 只允許 talk 類且**在大綱實際存在的頁碼集合內**（idx 是原始頁序，buildDeckOutline 預設跳過
 * 沒有文字的頁但保留原始頁碼 → 跳空頁後不連號，**不可用列數當上限**，否則模型正確回的尾頁頁碼會被誤丟；
 * 反之用集合檢查還能精確排除「被跳過的空頁頁碼」，避免把 talk 項綁到純圖頁）、
 * 上限 CHECKLIST_MAX_ITEMS（截斷時保住三類都在），最後給 **0 起連號 idx**。純函式，供單測。
 *
 * `deckOutline` 就是餵給模型的那份大綱（capDeckOutlineTotal 只截文字不刪列，故 idx 集合＝模型看到的 #編號集合）。
 */
export function sanitizeChecklist(raw: RawChecklist, deckOutline: readonly DeckOutlineRow[]): NewChecklistItem[] {
  const pages = new Set(deckOutline.map((r) => r.idx));
  const rows: Omit<NewChecklistItem, "idx">[] = [];
  for (const r of raw?.items ?? []) {
    const category = r?.category as ChecklistCategory;
    if (!CHECKLIST_CATEGORIES.includes(category)) continue;
    const title = cleanStr(r?.title)?.slice(0, TITLE_MAX_CHARS);
    if (!title) continue;

    const keywords: string[] = [];
    for (const k of Array.isArray(r?.keywords) ? r.keywords : []) {
      const kw = cleanStr(k)?.slice(0, KEYWORD_MAX_CHARS);
      if (!kw || keywords.includes(kw)) continue;
      keywords.push(kw);
      if (keywords.length >= KEYWORDS_MAX) break;
    }
    // 一個關鍵詞都沒給 → 退回 title 當唯一關鍵詞（勾稽命中率低，但項目本身仍要顯示給報告者）。
    if (keywords.length === 0) keywords.push(title);

    // slideIdx 只有 talk 類可能有值（契約 §6.2）；ask/address 恆 undefined；
    // 不在大綱頁碼集合內（越界、或指到被跳過的空頁）一律丟棄。`pages.has` 已隱含「整數且 >=0」。
    const rawIdx = r?.slideIdx;
    const slideIdx =
      category === "talk" && typeof rawIdx === "number" && pages.has(rawIdx) ? rawIdx : undefined;

    rows.push({
      category,
      title,
      detail: cleanStr(r?.detail)?.slice(0, DETAIL_MAX_CHARS),
      slideIdx,
      keywords,
      priority: r?.priority === "nice" ? "nice" : "must",
    });
  }
  return capWithCategoryCoverage(rows).map((row, idx) => ({ ...row, idx }));
}

/**
 * 截到 CHECKLIST_MAX_ITEMS，且**不讓截斷把某一類整個切掉**（契約 §6.2「三類都要有」）：
 * 先取前 N 條，若某類原本有、被截掉了，就從「條數最多的類別」尾端換掉一條讓它進來。
 */
function capWithCategoryCoverage<T extends { category: ChecklistCategory }>(rows: T[]): T[] {
  if (rows.length <= CHECKLIST_MAX_ITEMS) return rows;
  const kept = rows.slice(0, CHECKLIST_MAX_ITEMS);
  for (const cat of CHECKLIST_CATEGORIES) {
    if (kept.some((r) => r.category === cat)) continue;
    const missing = rows.find((r) => r.category === cat);
    if (!missing) continue;
    const counts = new Map<ChecklistCategory, number>();
    for (const r of kept) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    let dominant: ChecklistCategory = kept[kept.length - 1]!.category;
    for (const [c, n] of counts) if (n > (counts.get(dominant) ?? 0)) dominant = c;
    const victim = kept.map((r) => r.category).lastIndexOf(dominant);
    if (victim >= 0) kept[victim] = missing;
  }
  return kept;
}

// ─────────────────────────────────────────────────────────────
// §6.1 會議目標草擬
// ─────────────────────────────────────────────────────────────

const OBJECTIVE_SCHEMA = {
  type: Type.OBJECT,
  properties: { objective: { type: Type.STRING } },
  required: ["objective"],
};

/**
 * 依「簡報大綱＋對方公司」草擬一句話會議目標（契約 §6.1）。繁中、≤40 全形字。
 * 資料不足（無 deck 也無 company）或任何失敗 → 回 `""`（**不 throw**；建會表單留空即可）。
 */
export async function draftMeetingObjective(
  deps: ChecklistGenDeps,
  input: { title?: string; company?: { name: string; industry?: string }; deckOutline: DeckOutlineRow[] },
): Promise<string> {
  if (!deps.gemini.isConfigured()) return "";
  if (!input.company && input.deckOutline.length === 0) return ""; // 資料不足 → 空字串
  const parts: string[] = [];
  const title = cleanStr(input.title);
  if (title) parts.push(`會議標題：${title}`);
  if (input.company) {
    parts.push(`對方公司：${input.company.name}${input.company.industry ? `（${input.company.industry}）` : ""}`);
  }
  if (input.deckOutline.length) {
    parts.push(`簡報頁面大綱：\n${formatDeckOutline(input.deckOutline)}`);
  }
  try {
    const raw = await withDeadline(
      deps.gemini.generateJson<{ objective?: unknown }>({
        model: deps.model,
        system:
          "你是 B2B 銷售會議的會前教練。依提供的簡報與對方公司資訊，寫出「本場會議想達成什麼」的一句話目標。" +
          `繁體中文、**不超過 ${OBJECTIVE_MAX_CHARS} 個全形字**、可直接放進表單欄位；` +
          "動詞開頭、具體可判斷是否達成（例：「讓對方同意進入 POC 並排定時程」）。不要加引號或前後綴說明。",
        prompt: `${parts.join("\n\n")}\n\n請輸出符合 schema 的 JSON。`,
        schema: OBJECTIVE_SCHEMA,
        maxOutputTokens: OBJECTIVE_MAX_OUTPUT_TOKENS,
        temperature: CHECKLIST_TEMPERATURE,
        attempts: CHECKLIST_ATTEMPTS,
      }),
      OBJECTIVE_DEADLINE_MS,
      "checklist.draftObjective",
    );
    return cleanStr(raw?.objective)?.slice(0, OBJECTIVE_MAX_CHARS) ?? "";
  } catch (err) {
    console.warn(`[checklist] objective draft failed: ${(err as Error).message}`);
    return ""; // 優雅降級：表單欄位留空，使用者自己填
  }
}

// ─────────────────────────────────────────────────────────────
// CRM ＋ deck 讀取（生成輸入組裝）
// ─────────────────────────────────────────────────────────────

/** 生成輸入的來源綁定（皆可缺；deckId 與 companyId 全缺 → 呼叫端不生成，契約 §6.3）。 */
export interface ChecklistContextRef {
  deckId?: string;
  companyId?: string;
  dealId?: string;
}

export interface ChecklistContext {
  deckOutline: DeckOutlineRow[];
  company?: { name: string; industry?: string; narrative?: string };
  contacts?: { name: string; title?: string; background?: string }[];
  knownObjections?: string[];
  competitors?: string[];
}

/**
 * 讀 deck ＋ CRM 組裝生成輸入（全部 **org-scoped**、逐項 best-effort——單筆讀失敗只少一段脈絡，不讓整份生成掛掉）。
 *
 * 對映（CRM 無「我方產品」模型，故 sellerProducts 留空）：
 *   company.narrative ← descriptionZh ?? description；industry ← industryZh ?? industry
 *   contacts ← contacts.list（ContactSummary 無背景欄，故 background 不填）
 *   knownObjections ← deal.riskFlags ∪ company.painPoints；competitors ← deal.competitors ?? company.currentVendors
 *
 * I1：只讀（findWithSlides / findById / list），**不寫任何 deck 欄位**。
 */
export async function gatherChecklistContext(
  core: CrmCore,
  orgId: string,
  ref: ChecklistContextRef,
): Promise<ChecklistContext> {
  const out: ChecklistContext = { deckOutline: [] };

  if (ref.deckId) {
    try {
      const found = await core.decks.findWithSlides(orgId, ref.deckId);
      if (found) {
        // 逐頁文字：extractSlideText(spec) → 空則 slide.textExtract（C2 才有值）→ 仍空則跳過（契約 §6.4）。
        out.deckOutline = buildDeckOutline(found.slides.map((s) => ({ spec: s.spec, textExtract: s.textExtract })));
      }
    } catch (err) {
      console.warn(`[checklist] deck load failed (deck=${ref.deckId}): ${(err as Error).message}`);
    }
  }

  if (ref.companyId) {
    try {
      const company = await core.companies.findById(orgId, ref.companyId);
      if (company) {
        out.company = {
          name: company.name,
          industry: cleanStr(company.industryZh) ?? cleanStr(company.industry),
          narrative: cleanStr(company.descriptionZh) ?? cleanStr(company.description),
        };
        const pains = (company.painPoints ?? []).map((p) => cleanStr(p)).filter((p): p is string => Boolean(p));
        if (pains.length) out.knownObjections = pains;
        const vendors = (company.currentVendors ?? []).map((v) => cleanStr(v)).filter((v): v is string => Boolean(v));
        if (vendors.length) out.competitors = vendors;
      }
    } catch (err) {
      console.warn(`[checklist] company load failed (company=${ref.companyId}): ${(err as Error).message}`);
    }
    try {
      const contacts = await core.contacts.list(orgId, ref.companyId);
      const mapped = contacts.slice(0, CONTACTS_MAX).map((c) => ({
        name: cleanStr(c.fullNameZh) ?? c.fullName,
        title: cleanStr(c.titleZh) ?? cleanStr(c.title),
      }));
      if (mapped.length) out.contacts = mapped;
    } catch (err) {
      console.warn(`[checklist] contacts load failed (company=${ref.companyId}): ${(err as Error).message}`);
    }
  }

  if (ref.dealId) {
    try {
      const deal = await core.deals.findById(orgId, ref.dealId);
      if (deal) {
        const risks = (deal.riskFlags ?? []).map((r) => cleanStr(r)).filter((r): r is string => Boolean(r));
        if (risks.length) out.knownObjections = [...risks, ...(out.knownObjections ?? [])];
        const rivals = (deal.competitors ?? []).map((c) => cleanStr(c)).filter((c): c is string => Boolean(c));
        if (rivals.length) out.competitors = rivals; // deal 層競品比公司層「現有供應商」更貼本案
      }
    } catch (err) {
      console.warn(`[checklist] deal load failed (deal=${ref.dealId}): ${(err as Error).message}`);
    }
  }

  return out;
}
