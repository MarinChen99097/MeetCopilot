/**
 * DeepExtractor — 把 DeepResearcher 的 bundle（grounded 答案 + 深讀來源全文）用 Gemini 結構化合成成 CRM 資料，
 * 且**每個事實都錨定到它真正來源的 URL**（provenance 的關鍵差異化：UI 徽章顯示「此資訊來自 <該新聞/維基>」）。
 *
 * 手法（承 extractor.ts 的 v1 教訓）：union-superset 具體 schema、低溫（0.3）、maxOutputTokens 放寬、gemini-3.5-flash。
 * 來源歸屬：把所有來源編號成 [S1..Sn]（深讀全文優先在前），要求模型對每個公司欄位/新聞/主管/募資/競品標註
 * `sourceIndex`＝它引用的 [S#]；程式再把 index → 真實 URL，寫進 field_provenance.source_url。
 * 只用來源中出現的事實，不臆造（no hallucination）。
 */
import { Type } from "@google/genai";
import { isMaxTokensError, type GeminiClient } from "../gemini.js";
import type {
  Company,
  Contact,
  CompanyNews,
  CompanyFunding,
  CompanyNewsCategory,
  Seniority,
  ProvenanceInput,
  NewCompanyTech,
  NewCompanyDepartment,
} from "@meetcopilot/shared";
import type { DeepResearchBundle } from "./deep-research.js";
import { classifySourceType } from "./deep-research.js";
import { classifySocialUrl } from "./social/discover.js";
import { cleanStr, dedupUncat, NARRATIVE_UNCAT_SCHEMA, type UncategorizedIntel } from "./extract-shared.js";

const MAX_PROMPT_CHARS = 180_000;
const PER_SOURCE_PROMPT_CHARS = 6_000;
const PER_ANSWER_PROMPT_CHARS = 4_000;
const EXTRACT_MAX_OUTPUT_TOKENS = 16_384;
const EXTRACT_TEMPERATURE = 0.3;
const DEEP_CONFIDENCE = 0.55; // 全網合成信心：略低於官網直採（0.6），高於純臆測；人細填/確認才升。

const NEWS_CATEGORIES: CompanyNewsCategory[] = [
  "funding",
  "product",
  "exec_change",
  "mna",
  "partnership",
  "legal",
  "financial",
  "other",
];
const SENIORITIES: Seniority[] = ["c_level", "vp", "director", "manager", "ic", "founder", "board"];
// S1-A7：商機訊號類型（signalType 的 enum；不建 deals，只落一則觀察筆記）。
export type OpportunitySignalType =
  | "hiring"
  | "expansion"
  | "funding"
  | "project"
  | "partnership"
  | "procurement"
  | "other";
const OPPORTUNITY_SIGNALS: OpportunitySignalType[] = [
  "hiring",
  "expansion",
  "funding",
  "project",
  "partnership",
  "procurement",
  "other",
];
// 子表輸出上限（避免 JSON 爆量／截斷）。
const MAX_TECH = 12;
const MAX_DEPARTMENTS = 10;
const MAX_OPPORTUNITIES = 15; // S1-A7：商機線索輸出上限
const MAX_DEEP_PRODUCTS = 20; // S1-A8：外部產品觀點輸出上限

// ── 模型輸出形狀 ──────────────────────────────────────────
interface ExtractedDeep {
  company?: Partial<Record<keyof Company, unknown>>;
  companyFieldSources?: { field?: string; sourceIndex?: number }[];
  news?: {
    title?: string;
    titleZh?: string;
    url?: string;
    source?: string;
    summary?: string;
    summaryZh?: string;
    publishedDate?: string;
    category?: string;
    sourceIndex?: number;
  }[];
  funding?: {
    roundType?: string;
    amount?: number;
    currency?: string;
    announcedDate?: string;
    leadInvestor?: string;
    investors?: string[];
    sourceIndex?: number;
  }[];
  people?: { fullName?: string; fullNameZh?: string; title?: string; titleZh?: string; seniority?: string; sourceIndex?: number }[];
  competitors?: { name?: string; sourceIndex?: number }[];
  /** 公司官方社群帳號 URL（每平台選填完整 URL；WP 缺口 1b）。 */
  socialLinks?: { youtube?: string; facebook?: string; instagram?: string; threads?: string };
  /** S1-A7：商機線索（不建 deals，只落一則觀察筆記）。 */
  opportunities?: { title?: string; detail?: string; signalType?: string; sourceIndex?: number }[];
  /** S1-A8：外部視角的產品觀點（對齊官網既有產品做 fill-empty/union；配不到→uncategorized）。 */
  products?: {
    name?: string;
    differentiators?: string[];
    competitors?: string[];
    notableCustomers?: string[];
    sourceIndex?: number;
  }[];
  /** S4：FB/IG 實質動態的繁中摘要（每平台至多一筆；僅當社群查詢結果含該平台實質動態才產）。 */
  socialSummaries?: { platform?: string; summaryZh?: string; sourceIndex?: number }[];
  narrativeZh?: string;
  uncategorized?: { text?: string; sourceIndex?: number }[];
}

/** S1-A7：一則商機線索（落成 observations 筆記；帶來源 URL 作 provenance）。 */
export interface DeepOpportunity {
  title: string;
  detail?: string;
  signalType: OpportunitySignalType;
  sourceUrl?: string;
}

/** S4：一則 FB/IG 動態摘要（orchestrator 轉一則 company_social_posts 結構化貼文；platform+url 冪等）。 */
export interface DeepSocialSummary {
  platform: "facebook" | "instagram";
  /** 繁中 3-5 句摘要（嚴禁捏造；僅來源含該平台實質動態才產）。 */
  summaryZh: string;
  /** 真實 citation URL（沿用 [S#] provenance）。 */
  sourceUrl?: string;
}

/** S1-A8：外部視角的一項產品觀點（orchestrator 以正規化名稱對齊官網既有產品）。 */
export interface DeepProduct {
  name: string;
  differentiators?: string[];
  competitors?: string[];
  notableCustomers?: string[];
  sourceUrl?: string;
}

export interface DeepPerson {
  contact: Partial<Contact>;
  sourceUrl?: string;
  sourceType?: string;
}

export interface DeepExtraction {
  company: Partial<Company>;
  /** 每個公司欄位的來源（sourceUrl＝真實新聞/維基 URL、sourceType＝分類）。餵給 company.upsertFromCrawl 的 provenance。 */
  companyProvenance: ProvenanceInput[];
  news: Partial<CompanyNews>[];
  funding: Partial<CompanyFunding>[];
  people: DeepPerson[];
  competitors: { name: string; sourceUrl?: string; sourceType?: string }[];
  /** 對方技術棧（company_tech 子表）→ orchestrator 走 bulkUpsertTech。 */
  techStack: NewCompanyTech[];
  /** 對方部門（company_departments 子表）→ orchestrator 走 bulkUpsertDepartments。 */
  departments: NewCompanyDepartment[];
  /**
   * 擷取器判定的公司**官方**社群 URL（已過機械保險：只 https＋四平台網域）→ orchestrator 以「補缺」優先序
   * 併入 social_links（官網爬到的優先）。WP 缺口 1b/1c。可能為 []（來源無或不確定即不填）。
   */
  socialLinks: string[];
  /** S1-A7：商機線索（每則帶真實來源 URL）→ orchestrator 落一則 observations 筆記「研究商機線索」。可能為 []。 */
  opportunities?: DeepOpportunity[];
  /** S1-A8：外部視角產品觀點（每則帶真實來源 URL）→ orchestrator 對齊官網既有產品 fill-empty/union。可能為 []。 */
  products?: DeepProduct[];
  /** S4：FB/IG 動態摘要（每平台至多一筆）→ orchestrator 轉 company_social_posts。可能為 []。 */
  socialSummaries?: DeepSocialSummary[];
  /** zh-TW 平鋪直敘敘事（8–20 句）→ 筆記區 narrative 單例（WP2 §2）。 */
  narrativeZh?: string;
  /** 未歸類情報（≤25，每條帶來源 URL）→ 筆記區 observations 單例（WP2 §2）。 */
  uncategorized: UncategorizedIntel[];
}

export interface DeepExtractInput {
  companyName: string;
  domain?: string;
  bundle: DeepResearchBundle;
}

export interface DeepExtractor {
  toDeep(input: DeepExtractInput): Promise<DeepExtraction>;
}

const S = Type;

/**
 * 允許模型填的公司側欄位（web 可得的 profile；URL/身分欄不請模型回，避免污染——見 extractor.ts 教訓）。
 * ⚠️ 刻意**不放**自由 NUMBER 欄（valuation/fundingTotal/annualRevenue）：實測會誘發模型「跑掉」的退化數字生成
 *   （如 `0.00123456789101112…`）撐爆 JSON 導致整份抽取失敗。金額類事實改由 funding[]（離散輪次）承載；
 *   規模用 STRING 區間（revenueRange/employeeRange）＋ employeeCount（INTEGER，有界）表達即可。
 */
const COMPANY_PROPS: Record<string, unknown> = {
  description: { type: S.STRING },
  // zh-TW 精簡公司簡介（另產；不覆寫來源語言的 description）。是 companies 欄位（走 COMPANY_FIELD_KEYS/provenance）。
  descriptionZh: { type: S.STRING },
  industry: { type: S.STRING },
  // zh-TW 產業別（industry 的繁中翻譯；另產）。
  industryZh: { type: S.STRING },
  // zh-TW 精簡標語（公司定位的繁中 gloss；另產）。
  taglineZh: { type: S.STRING },
  businessModel: { type: S.STRING },
  // zh-TW 商業模式（businessModel 的繁中 gloss；另產）。
  businessModelZh: { type: S.STRING },
  foundedYear: { type: S.INTEGER },
  ownershipType: { type: S.STRING },
  stockTicker: { type: S.STRING },
  employeeCount: { type: S.INTEGER },
  employeeRange: { type: S.STRING },
  revenueRange: { type: S.STRING },
  hqCountry: { type: S.STRING },
  hqRegion: { type: S.STRING },
  hqCity: { type: S.STRING },
  fundingStage: { type: S.STRING },
  investors: { type: S.ARRAY, items: { type: S.STRING } },
};
const COMPANY_FIELD_KEYS = new Set(Object.keys(COMPANY_PROPS));

// techStack/departments 掛在 company 子物件下但屬子表（非 companies 欄位）；刻意不入 COMPANY_PROPS，
// 故不會被 COMPANY_FIELD_KEYS 當公司欄複製/寫 provenance——由 toDeep 另行拆出映射成 NewCompanyTech/Department。
const TECH_SCHEMA: Record<string, unknown> = {
  type: S.ARRAY,
  items: {
    type: S.OBJECT,
    properties: {
      category: { type: S.STRING },
      vendor: { type: S.STRING },
      product: { type: S.STRING },
      detectedFrom: { type: S.STRING },
      // 一句 zh-TW：這是什麼＋該公司怎麼用（來源沒講就省略）。
      noteZh: { type: S.STRING },
    },
  },
};
const DEPARTMENTS_SCHEMA: Record<string, unknown> = {
  type: S.ARRAY,
  items: {
    type: S.OBJECT,
    properties: {
      name: { type: S.STRING },
      focus: { type: S.STRING },
      headcountEstimate: { type: S.INTEGER },
    },
    required: ["name"],
  },
};

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    company: {
      type: S.OBJECT,
      properties: { ...COMPANY_PROPS, techStack: TECH_SCHEMA, departments: DEPARTMENTS_SCHEMA },
    },
    companyFieldSources: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: { field: { type: S.STRING }, sourceIndex: { type: S.INTEGER } },
        required: ["field", "sourceIndex"],
      },
    },
    news: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          title: { type: S.STRING },
          titleZh: { type: S.STRING }, // zh-TW 標題簡述（另產）
          url: { type: S.STRING },
          source: { type: S.STRING },
          summary: { type: S.STRING },
          summaryZh: { type: S.STRING }, // zh-TW 摘要（另產）
          publishedDate: { type: S.STRING }, // YYYY 或 YYYY-MM-DD；程式轉 epoch
          category: { type: S.STRING, enum: NEWS_CATEGORIES as unknown as string[] },
          sourceIndex: { type: S.INTEGER },
        },
        required: ["title"],
      },
    },
    funding: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          roundType: { type: S.STRING },
          amount: { type: S.NUMBER },
          currency: { type: S.STRING },
          announcedDate: { type: S.STRING },
          leadInvestor: { type: S.STRING },
          investors: { type: S.ARRAY, items: { type: S.STRING } },
          sourceIndex: { type: S.INTEGER },
        },
      },
    },
    people: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          fullName: { type: S.STRING },
          fullNameZh: { type: S.STRING }, // zh-TW 姓名（僅來源實際出現中文名才填；嚴禁音譯捏造）
          title: { type: S.STRING },
          titleZh: { type: S.STRING }, // zh-TW 職稱簡述（另產）
          seniority: { type: S.STRING, enum: SENIORITIES as unknown as string[] },
          sourceIndex: { type: S.INTEGER },
        },
        required: ["fullName"],
      },
    },
    competitors: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: { name: { type: S.STRING }, sourceIndex: { type: S.INTEGER } },
        required: ["name"],
      },
    },
    // WP 缺口 1b：公司官方社群帳號 URL（每平台選填完整 URL；模型不確定即省略——見 SYSTEM 指示）。
    socialLinks: {
      type: S.OBJECT,
      properties: {
        youtube: { type: S.STRING },
        facebook: { type: S.STRING },
        instagram: { type: S.STRING },
        threads: { type: S.STRING },
      },
    },
    // S1-A7：商機線索（signalType 限定枚舉；title 必填）。
    opportunities: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          title: { type: S.STRING },
          detail: { type: S.STRING },
          signalType: { type: S.STRING, enum: OPPORTUNITY_SIGNALS as unknown as string[] },
          sourceIndex: { type: S.INTEGER },
        },
        required: ["title"],
      },
    },
    // S1-A8：外部視角產品觀點（name 必填；差異化/競品/知名客戶皆選填）。
    products: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          name: { type: S.STRING },
          differentiators: { type: S.ARRAY, items: { type: S.STRING } },
          competitors: { type: S.ARRAY, items: { type: S.STRING } },
          notableCustomers: { type: S.ARRAY, items: { type: S.STRING } },
          sourceIndex: { type: S.INTEGER },
        },
        required: ["name"],
      },
    },
    // S4：FB/IG 動態摘要（platform 限 facebook/instagram；summaryZh 繁中 3-5 句；只在有實質動態時產）。
    socialSummaries: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          platform: { type: S.STRING, enum: ["facebook", "instagram"] },
          summaryZh: { type: S.STRING },
          sourceIndex: { type: S.INTEGER },
        },
        required: ["platform", "summaryZh"],
      },
    },
    // WP2 §2：narrativeZh + uncategorized（共用片段，見 extract-shared.NARRATIVE_UNCAT_SCHEMA）。
    ...NARRATIVE_UNCAT_SCHEMA,
  },
  required: ["company"],
};

const SYSTEM = [
  "You are a B2B sales-intelligence analyst. You are given WEB research about a prospect company gathered from MULTIPLE independent public sources (news articles, Wikipedia, public profiles) — NOT the company's own marketing site.",
  "Synthesize a structured company profile as JSON for a sales CRM. Use ONLY facts that appear in the provided findings/sources; do NOT invent numbers, names, dates, or identifiers.",
  "CRITICAL — source attribution: every source is numbered [S1], [S2], .... For each company field you fill, add a `companyFieldSources` entry {field, sourceIndex} naming which [S#] the value came from. For each news item, funding round, person, and competitor, set its `sourceIndex` to the [S#] that supports it.",
  "company: fill description (2-3 sentences on what the company does), industry, businessModel, foundedYear, ownershipType (e.g. 'public'/'private'/'subsidiary'), stockTicker, employeeCount/employeeRange, hqCountry/hqRegion/hqCity, revenueRange/annualRevenue, fundingStage/fundingTotal/valuation, investors[] — ONLY when the sources state them.",
  "news: recent, concrete developments (title, the article url if present, source/outlet, a one-line summary, publishedDate as YYYY or YYYY-MM-DD, and a category).",
  "funding: rounds if mentioned (roundType, amount as a number, currency, announcedDate, leadInvestor, investors[]).",
  "people: named executives/leaders with their title and seniority. `fullNameZh` = the person's Chinese name ONLY if a source explicitly gives it; NEVER transliterate a romanized name into Chinese or fabricate one — leave empty otherwise. (Do NOT emit person photos in deep mode.)",
  "competitors: named competitor companies.",
  "socialLinks (OPTIONAL): the company's OFFICIAL social-media account URLs — youtube, facebook, instagram, threads. For each platform, give the FULL https URL of the account/page ONLY when a source explicitly confirms it is THIS company's own official account. If you are unsure, or cannot confirm the official account from the provided sources, OMIT that platform entirely — do NOT guess or fabricate handles.",
  "company.techStack[] (only when stated): technologies/vendors/products the company uses or is built on ({category, vendor, product, detectedFrom, noteZh = ONE Traditional-Chinese sentence on what it is AND how this company uses it — OMIT when the sources do not support it, never invent}); company.departments[] (only when stated): internal teams/divisions ({name, focus, headcountEstimate}). Write these DIRECTLY in Traditional Chinese (zh-TW), but keep technical/product proper nouns original (e.g. AWS, React, Kubernetes). Cap: at most 12 techStack items and at most 10 departments.",
  "opportunities[] (only when the sources state a concrete buying/sales signal): each {title (a short zh-TW label), detail (one zh-TW sentence), signalType, sourceIndex}. signalType is ONE of: hiring (they are hiring / expanding a team), expansion (new office/market/product-line expansion), funding (raised or seeking capital), project (a named initiative/RFP/deployment), partnership (a new alliance/channel), procurement (a purchase/tender/vendor-selection), other. Only real signals present in the sources — do NOT invent. At most 15.",
  "products[] (external view; only products the sources actually attribute to THIS company): each {name (the product's own name, verbatim), differentiators[] (zh-TW), competitors[] (competing products/companies named), notableCustomers[] (named customers/logos), sourceIndex}. This is the OUTSIDE-IN view of the company's products from news/reviews/case-studies — used to enrich the official-site product list; do NOT fabricate names. At most 20.",
  "socialSummaries[] (produce whenever the findings — especially the [social] search results — contain ANY concrete fact about the company's OWN Facebook or Instagram presence): each {platform (either 'facebook' or 'instagram'), summaryZh (a 3-5 sentence Traditional-Chinese zh-TW summary), sourceIndex ([S#] of the real citation)}. A 'concrete fact' includes ANY of: the page/account EXISTS, a follower/like count, a recent post/announcement/campaign, a hiring/recruiting post, an event, or reviews/ratings/word-of-mouth. If you have even ONE such fact for a platform, WRITE the summary and state EXACTLY what the sources say (e.g. '<公司> 設有官方 Facebook 粉絲專頁，粉絲數約 X，近期貼文多為產品公告與活動訊息，整體評價正面。'). OMIT a platform ONLY when the sources contain NOTHING at all about it. At most ONE entry per platform. NEVER fabricate posts, numbers, dates, or activity the sources do not state (寧缺勿假：有一分證據說一分話). This is distinct from YouTube/Threads which are fetched separately.",
  "LANGUAGE — bilingual output. Keep every PRIMARY text field verbatim in the language of the sources (Traditional Chinese for zh sources; do NOT translate the primary fields; keep values concise; never repeat text). IN ADDITION, emit a concise Traditional-Chinese (zh-TW, Taiwan usage) gloss in each `*Zh` field: company.descriptionZh (of description), company.industryZh (the Traditional-Chinese TRANSLATION of the industry label), company.businessModelZh (of businessModel), company.taglineZh (a concise Traditional-Chinese positioning line for the company), news[].titleZh/summaryZh (of that item's title/summary), and people[].titleZh (of that person's title) — each at most 2 sentences; if the source is already zh-TW you may condense it. (fullNameZh is NOT a gloss — only fill it from a Chinese name actually present in the sources.)",
  "narrativeZh: write a Traditional-Chinese (zh-TW), plain-language narrative of 8-20 sentences that synthesizes the company's type, business model, current situation/recent developments, and its social-media presence & sentiment (from the social findings). Keep proper nouns (brand/product/person names) in their original form. This is a readable briefing, NOT a bullet list.",
  "uncategorized: CRITICAL — EVERY important fact you found in the sources that does NOT fit any structured field above (company/news/funding/people/competitors/techStack/departments) MUST be captured here as {text, sourceIndex} — DO NOT discard it. Examples: partnerships, awards, controversies, market share, notable customers, hiring drives, event/campaign activity, community sentiment. At most 25 items; each `text` one concise sentence with its supporting [S#] as sourceIndex.",
  "Field NAMES stay English per the schema. Return ONLY valid JSON matching the schema.",
].join(" ");

interface SourceRef {
  url: string;
  title?: string;
  sourceType: string;
}

/** 建來源登錄（[S1..Sn]）：深讀全文優先在前（真實 URL+內文），其後補上僅有標題的 citation。index 為 1-based。 */
function buildRegistry(bundle: DeepResearchBundle): { registry: SourceRef[]; textByIndex: Map<number, string> } {
  const registry: SourceRef[] = [];
  const textByIndex = new Map<number, string>();
  const indexByUrl = new Map<string, number>();
  const push = (url: string, title: string | undefined, text?: string): void => {
    if (!url) return;
    if (indexByUrl.has(url)) {
      if (text) textByIndex.set(indexByUrl.get(url)!, text);
      return;
    }
    registry.push({ url, title, sourceType: classifySourceType(`${url} ${title ?? ""}`) });
    const idx = registry.length; // 1-based
    indexByUrl.set(url, idx);
    if (text) textByIndex.set(idx, text);
  };
  for (const st of bundle.sourceTexts) push(st.url, st.title, st.text);
  for (const f of bundle.groundedFindings) for (const c of f.citations) push(c.url, c.title);
  return { registry, textByIndex };
}

function buildPrompt(input: DeepExtractInput, registry: SourceRef[], textByIndex: Map<number, string>): string {
  const indexByUrl = new Map<string, number>();
  registry.forEach((r, i) => indexByUrl.set(r.url, i + 1));

  const head = `COMPANY: ${input.companyName}${input.domain ? ` (${input.domain})` : ""}\n`;

  const findings = input.bundle.groundedFindings
    .map((f) => {
      const cited = f.citations
        .map((c) => indexByUrl.get(c.url))
        .filter((n): n is number => typeof n === "number")
        .map((n) => `S${n}`)
        .join(", ");
      return `\n[${f.angle}] ${f.answer.slice(0, PER_ANSWER_PROMPT_CHARS)}${cited ? `\n  (sources: ${cited})` : ""}`;
    })
    .join("\n");

  const docs = registry
    .map((r, i) => {
      const n = i + 1;
      const body = textByIndex.get(n);
      const bodyStr = body ? `\n${body.slice(0, PER_SOURCE_PROMPT_CHARS)}` : "";
      return `\n[S${n}] ${r.title ?? ""} — ${r.url}${bodyStr}`;
    })
    .join("\n");

  const task =
    "TASK: Synthesize a CRM company profile JSON from the web findings and source documents below. " +
    "Attribute EVERY filled field/item to the source index [S#] it came from (companyFieldSources / sourceIndex). " +
    "Use only facts present in the text.\n\n";

  return (
    task +
    head +
    "\n=== GROUNDED FINDINGS (web search summaries) ===\n" +
    findings +
    "\n\n=== SOURCE DOCUMENTS (each labelled [S#] with its url) ===\n" +
    docs
  ).slice(0, MAX_PROMPT_CHARS);
}

/** 寬鬆日期字串 → epoch ms（YYYY / YYYY-MM-DD / Date.parse 可解）。解析不出回 undefined。 */
function parseLooseDate(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (/^\d{4}$/.test(t)) return Date.UTC(Number(t), 0, 1);
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanHttpUrl(v: unknown): string | undefined {
  const t = cleanStr(v);
  if (!t) return undefined;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
function strArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return out.length > 0 ? out : undefined;
}
function serialize(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** 模型 company.techStack（unknown）→ NewCompanyTech[]（去空、上限 MAX_TECH）。至少要有 category/vendor/product 之一。 */
function toDeepTech(v: unknown): NewCompanyTech[] {
  if (!Array.isArray(v)) return [];
  const out: NewCompanyTech[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const category = cleanStr(t.category);
    const vendor = cleanStr(t.vendor);
    const product = cleanStr(t.product);
    const detectedFrom = cleanStr(t.detectedFrom);
    const noteZh = cleanStr(t.noteZh);
    if (!category && !vendor && !product) continue;
    const row: NewCompanyTech = { confidence: DEEP_CONFIDENCE };
    if (category) row.category = category;
    if (vendor) row.vendor = vendor;
    if (product) row.product = product;
    if (detectedFrom) row.detectedFrom = detectedFrom;
    if (noteZh) row.noteZh = noteZh;
    out.push(row);
    if (out.length >= MAX_TECH) break;
  }
  return out;
}

/** 模型 company.departments（unknown）→ NewCompanyDepartment[]（name 必填、去空、上限 MAX_DEPARTMENTS）。 */
function toDeepDepartments(v: unknown): NewCompanyDepartment[] {
  if (!Array.isArray(v)) return [];
  const out: NewCompanyDepartment[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const d = raw as Record<string, unknown>;
    const name = cleanStr(d.name);
    if (!name) continue;
    const row: NewCompanyDepartment = { name };
    const focus = cleanStr(d.focus);
    if (focus) row.focus = focus;
    const hc = d.headcountEstimate;
    if (typeof hc === "number" && Number.isFinite(hc) && hc >= 0) row.headcountEstimate = Math.round(hc);
    out.push(row);
    if (out.length >= MAX_DEPARTMENTS) break;
  }
  return out;
}

/**
 * 模型 socialLinks（unknown 物件）→ 過濾後的社群 URL 清單。機械保險（WP 缺口 1c）：**只接受 https ＋
 * classifySocialUrl 命中的四平台網域**；其餘（http、非四平台、非法 URL）一律丟棄。key 與實際平台不符不影響——
 * orchestrator 的 discoverHandles 會依 URL 本身重新分類。跨 key 去重。
 */
function toDeepSocialLinks(v: unknown): string[] {
  if (!v || typeof v !== "object") return [];
  const obj = v as Record<string, unknown>;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of ["youtube", "facebook", "instagram", "threads"]) {
    const raw = cleanStr(obj[key]);
    if (!raw) continue;
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      continue; // 非法 URL
    }
    if (u.protocol !== "https:") continue; // 只接受 https（機械保險）
    if (classifySocialUrl(raw) === undefined) continue; // 只接受四平台網域
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** 陣列文字欄正規化：去空/非字串、trim、去重（保序）。回 undefined 表無有效項（供 fill-empty 判斷）。 */
function cleanStrArr(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const t = cleanStr(x);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * S1-A7：模型 opportunities（unknown）→ DeepOpportunity[]。title 必填、signalType 落枚舉（缺/非法→'other'）、
 * sourceUrl 由 resolveUrl(sourceIndex) 決定；上限 MAX_OPPORTUNITIES。
 */
function toDeepOpportunities(
  v: unknown,
  resolveUrl: (idx: unknown) => string | undefined,
): DeepOpportunity[] {
  if (!Array.isArray(v)) return [];
  const out: DeepOpportunity[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const title = cleanStr(o.title);
    if (!title || seen.has(title)) continue;
    seen.add(title);
    const sig = cleanStr(o.signalType);
    const signalType: OpportunitySignalType =
      sig && (OPPORTUNITY_SIGNALS as string[]).includes(sig) ? (sig as OpportunitySignalType) : "other";
    const row: DeepOpportunity = { title, signalType };
    const detail = cleanStr(o.detail);
    if (detail) row.detail = detail;
    const src = resolveUrl(o.sourceIndex);
    if (src) row.sourceUrl = src;
    out.push(row);
    if (out.length >= MAX_OPPORTUNITIES) break;
  }
  return out;
}

/**
 * S1-A8：模型 products（unknown）→ DeepProduct[]。name 必填、陣列欄去空去重、sourceUrl 由 resolveUrl 決定；
 * 上限 MAX_DEEP_PRODUCTS。orchestrator 再以正規化名稱對齊官網既有產品。
 */
function toDeepProducts(v: unknown, resolveUrl: (idx: unknown) => string | undefined): DeepProduct[] {
  if (!Array.isArray(v)) return [];
  const out: DeepProduct[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const name = cleanStr(p.name);
    if (!name) continue;
    const key = normalizeProductName(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const row: DeepProduct = { name };
    const diff = cleanStrArr(p.differentiators);
    if (diff) row.differentiators = diff;
    const comp = cleanStrArr(p.competitors);
    if (comp) row.competitors = comp;
    const cust = cleanStrArr(p.notableCustomers);
    if (cust) row.notableCustomers = cust;
    const src = resolveUrl(p.sourceIndex);
    if (src) row.sourceUrl = src;
    out.push(row);
    if (out.length >= MAX_DEEP_PRODUCTS) break;
  }
  return out;
}

/**
 * S4：模型 socialSummaries（unknown）→ DeepSocialSummary[]。platform 限 facebook/instagram、summaryZh 非空、
 * sourceUrl 由 resolveUrl 決定；**每平台至多一筆**（保序取首筆，orchestrator bulkUpsert 自然鍵 platform+url 再冪等）。
 */
function toDeepSocialSummaries(
  v: unknown,
  resolveUrl: (idx: unknown) => string | undefined,
): DeepSocialSummary[] {
  if (!Array.isArray(v)) return [];
  const out: DeepSocialSummary[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const s = raw as Record<string, unknown>;
    const platform = cleanStr(s.platform)?.toLowerCase();
    if (platform !== "facebook" && platform !== "instagram") continue;
    if (seen.has(platform)) continue; // 每平台至多一筆
    const summaryZh = cleanStr(s.summaryZh);
    if (!summaryZh) continue;
    seen.add(platform);
    const row: DeepSocialSummary = { platform, summaryZh };
    const src = resolveUrl(s.sourceIndex);
    if (src) row.sourceUrl = src;
    out.push(row);
    if (out.length >= 2) break; // 至多 fb + ig 兩筆
  }
  return out;
}

/**
 * S1-A8/A10：產品名稱正規化（對齊 key）——lowercase、去所有空白/標點/符號（Unicode-aware）。
 * 例：「CP1500 PFCLCD」與「cp1500pfclcd」→ 同 key。純函式，供 orchestrator 對齊與單測。
 */
export function normalizeProductName(name: string): string {
  return name.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

/**
 * S1-A8/A10：兩產品名是否對齊——正規化後相等，或**任一含另一**（含式匹配可接受）。
 * 空字串一律不匹配（避免空 key 對齊到全部）。純函式，供 orchestrator 對齊與單測。
 */
export function productNameMatches(a: string, b: string): boolean {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

// ── S1-A6：per-contact 背景補查（把一則 grounded 答案結構化成可回填的背景欄）──
/** per-contact 補查抽取結果（僅供 orchestrator「回填空欄」；每欄皆選填、無據即缺）。 */
export interface PersonBackground {
  title?: string;
  titleZh?: string;
  backgroundSummary?: string;
  backgroundSummaryZh?: string;
  linkedinUrl?: string;
  fullNameZh?: string;
}
/** 模型輸出邊界的原始形狀（未消毒）；形狀同 PersonBackground，經 cleanStr/saneTitle 消毒後才成 PersonBackground。 */
type PersonBackgroundRaw = PersonBackground;
const PERSON_BG_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    title: { type: S.STRING },
    titleZh: { type: S.STRING },
    backgroundSummary: { type: S.STRING },
    backgroundSummaryZh: { type: S.STRING },
    linkedinUrl: { type: S.STRING },
    fullNameZh: { type: S.STRING },
  },
};
const PERSON_BG_SYSTEM = [
  "You are a B2B sales research analyst. You are given a grounded web answer about ONE named executive at a company.",
  "Extract a concise structured profile as JSON. Use ONLY facts stated in the answer; do NOT invent titles, employers, dates, URLs, or Chinese names.",
  // title MUST be a SINGLE primary title. If the person holds many roles (e.g. CTO + co-founder + advisor + board member),
  // pick the ONE most-senior/primary title and IGNORE the rest — do NOT enumerate or concatenate roles. (Root-cause guard:
  // enumerating overlapping roles into titleZh sends gemini-3.5-flash into a token-repetition loop → MAX_TOKENS.)
  "title = the person's SINGLE primary current job title at this company, in the source language (a few words only; if the person holds several roles, pick the ONE most senior/primary title and IGNORE the rest — never list or concatenate multiple titles). backgroundSummary = a concise career/education background of AT MOST 3 sentences (source language) — do NOT exceed 3 sentences.",
  "Bilingual gloss: titleZh = the Traditional-Chinese (zh-TW) of the SINGLE primary title, AT MOST 8 characters, ONE title only — NEVER concatenate or list multiple titles, NEVER repeat a word, and NEVER put dates, URLs, or a summary in this field. backgroundSummaryZh = a Traditional-Chinese (zh-TW) summary of AT MOST 2 sentences. If the source is already zh-TW you may condense it.",
  "linkedinUrl = the person's own LinkedIn profile URL ONLY if it explicitly appears in the answer. fullNameZh = the person's Chinese name ONLY if the answer explicitly gives it; NEVER transliterate a romanized name.",
  "OUTPUT ONLY the single JSON object defined by the schema — no preamble, no markdown fences, no repetition. OMIT any field you are not certain of (do NOT emit empty strings, placeholders, or guesses); a JSON object with only the few fields you can confirm is CORRECT and preferred. Keep EVERY value SHORT; never repeat a word, phrase, or sentence.",
].join(" ");

/** 初次餵入 extractPersonBackground 的 grounded 答案截斷（減少誘發面；非根因，但降 token）。 */
const PERSON_BG_INPUT_CHARS = 6_000;
/** MAX_TOKENS 單次重試時的更嚴截斷（再砍半）＋重取一次獨立樣本。 */
const PERSON_BG_RETRY_CHARS = 3_000;
/** 職稱欄長度上限（防污染守衛）：真實職稱極短，超過此長度＝模型把背景灌進職稱欄。EN 職稱寬列 80、zh titleZh 40。 */
const PERSON_TITLE_MAXLEN = 80;
const PERSON_TITLEZH_MAXLEN = 40;

/**
 * 職稱欄防污染守衛（寧缺勿錯）：職稱本質簡短，若過長／含 URL／含換行＝模型把日期/背景/連結灌進職稱欄的欄位污染
 *（實測 temp 稍高時偶發 `titleZh="營運長2020年起…https://…"`）→ 視為缺（回 undefined，不落庫垃圾）。純函式。
 */
function saneTitle(v: string | undefined, maxLen: number): string | undefined {
  if (!v) return undefined;
  if (v.length > maxLen) return undefined;
  if (/https?:\/\//i.test(v) || /[\n\r]/.test(v)) return undefined;
  return v;
}

/**
 * S1-A6：把一則 grounded 答案結構化成可回填的背景欄（title/titleZh/backgroundSummary/backgroundSummaryZh/
 * linkedinUrl/fullNameZh）。低溫、maxOutputTokens 有界。**嚴禁捏造**（見 SYSTEM）。失敗/空 → 回 {} 或上拋。
 *
 * MAX_TOKENS 修法 v3（根因經 usageMetadata 實測定位）：先前 v2（放寬 8192／壓 thinkingBudget）**無效**——實測顯示
 * finishReason=MAX_TOKENS 時 `thoughtsTokenCount=undefined`（thinking 非元兇），而 `candidatesTokenCount` 撐滿整個
 * maxOutputTokens：模型對 `titleZh` 進入**退化重複循環**（如 "技術長合夥創辦人兼技術長技術長技術長…" 灌爆輸出→JSON 未收尾
 * →不可解析）。誘因＝人物身兼多職（CTO＋共同創辦人＋顧問＋董事），模型想把所有職稱塞進單一 gloss 欄而繞不出來。
 * gemini-3.5-flash **不支援 frequencyPenalty**（「Penalty is not enabled for this model」），故改以四管齊下：
 *  1. **prompt 硬性單一職稱**（根因解）：title/titleZh 只取「單一主要職稱」、titleZh ≤8 字、禁列舉/禁重複/禁塞日期URL（見 SYSTEM）。
 *  2. **thinkingConfig 關閉 + maxOutputTokens 2048 + temperature 0.4**：實測 6/6 乾淨（temp 0.3 偏易循環、1.0 反更糟；
 *     max 2048 對 ~250 token 的小 JSON 綽綽有餘，且循環時 ~5s 快失敗而非 ~20s）。thinking 必須關（否則 thinking token 會吃掉 2048）。
 *  3. **輸入截斷 6000／MAX_TOKENS 重試砍半 3000 重取獨立樣本**（每次獨立取樣在新配置下 ~100% 成功；再失敗才上拋，呼叫端逐人隔離跳過）。
 *  4. **職稱欄防污染守衛 saneTitle**：擋殘餘的欄位污染（過長/含 URL/含換行的 title/titleZh 視為缺，寧缺勿錯）。
 */
export async function extractPersonBackground(
  gemini: GeminiClient,
  extractModel: string | undefined,
  groundedAnswer: string,
): Promise<PersonBackground> {
  const answer = cleanStr(groundedAnswer);
  if (!answer) return {};
  const runOnce = (chars: number): Promise<PersonBackgroundRaw> =>
    gemini.generateJson<PersonBackgroundRaw>({
      model: extractModel,
      system: PERSON_BG_SYSTEM,
      prompt: `WEB ANSWER (about the executive):\n${answer.slice(0, chars)}`,
      schema: PERSON_BG_SCHEMA,
      maxOutputTokens: 2048,
      thinkingBudget: 0, // 關閉 thinking：小任務不需，且與 max=2048 共存的必要條件（否則 thinking 吃光預算）。
      temperature: 0.4,
      attempts: 2,
    });

  let ex: PersonBackgroundRaw;
  try {
    ex = await runOnce(PERSON_BG_INPUT_CHARS);
  } catch (e) {
    // MAX_TOKENS 單次重試：輸入再砍半並重取一次獨立樣本（新配置下退化循環為罕見隨機事件，重取幾乎必成）。
    // 仍失敗/非 MAX_TOKENS 即上拋 → 呼叫端 enrichKeyPeople 逐人 try/catch 隔離跳過（維持寧缺勿錯、單人失敗不影響他人）。
    if (!isMaxTokensError(e) || answer.length <= PERSON_BG_RETRY_CHARS) throw e;
    console.warn(
      `[research:deep] person background MAX_TOKENS — retrying with halved input (${answer.length}→${PERSON_BG_RETRY_CHARS} chars)`,
    );
    ex = await runOnce(PERSON_BG_RETRY_CHARS);
  }

  const out: PersonBackground = {};
  const title = saneTitle(cleanStr(ex?.title), PERSON_TITLE_MAXLEN);
  if (title) out.title = title;
  const titleZh = saneTitle(cleanStr(ex?.titleZh), PERSON_TITLEZH_MAXLEN);
  if (titleZh) out.titleZh = titleZh;
  const bg = cleanStr(ex?.backgroundSummary);
  if (bg) out.backgroundSummary = bg;
  const bgZh = cleanStr(ex?.backgroundSummaryZh);
  if (bgZh) out.backgroundSummaryZh = bgZh;
  const li = cleanHttpUrl(ex?.linkedinUrl);
  if (li) out.linkedinUrl = li;
  const nameZh = cleanStr(ex?.fullNameZh);
  if (nameZh) out.fullNameZh = nameZh;
  return out;
}

export function createDeepExtractor(gemini: GeminiClient, extractModel?: string): DeepExtractor {
  return {
    async toDeep(input: DeepExtractInput): Promise<DeepExtraction> {
      if (!gemini.isConfigured()) throw new Error("GEMINI_API_KEY not configured");
      const { registry, textByIndex } = buildRegistry(input.bundle);
      const resolve = (idx: unknown): SourceRef | undefined => {
        const n = typeof idx === "number" ? idx : Number(idx);
        if (!Number.isInteger(n) || n < 1 || n > registry.length) return undefined;
        return registry[n - 1];
      };
      const primary: SourceRef | undefined = registry[0]; // fallback 來源（最高價值）。

      const ex = await gemini.generateJson<ExtractedDeep>({
        model: extractModel,
        system: SYSTEM,
        prompt: buildPrompt(input, registry, textByIndex),
        schema: RESPONSE_SCHEMA,
        maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
        temperature: EXTRACT_TEMPERATURE,
        attempts: 3, // 全網合成偶有模型跑掉→JSON 壞；多給一次重試（低溫下多半第二/三次即穩定收斂）。
      });

      // ── 公司欄位 + 逐欄 provenance（source_url＝真實來源）──
      const company: Partial<Company> = {};
      const rawCompany = (ex.company ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(rawCompany)) {
        if (!COMPANY_FIELD_KEYS.has(k)) continue;
        if (v === undefined || v === null || v === "") continue;
        if (Array.isArray(v) && v.length === 0) continue;
        (company as Record<string, unknown>)[k] = v;
      }
      // techStack/departments（掛在 company 下但屬子表；COMPANY_FIELD_KEYS 未含 → 上面迴圈已略過）。
      const techStack = toDeepTech(rawCompany.techStack);
      const departments = toDeepDepartments(rawCompany.departments);
      // 欄位→來源 index 映射（模型給的）。
      const fieldSource = new Map<string, SourceRef>();
      for (const fs of ex.companyFieldSources ?? []) {
        const field = cleanStr(fs.field);
        if (!field || !COMPANY_FIELD_KEYS.has(field)) continue;
        const ref = resolve(fs.sourceIndex);
        if (ref) fieldSource.set(field, ref);
      }
      const companyProvenance: ProvenanceInput[] = [];
      for (const [field, value] of Object.entries(company)) {
        const ref = fieldSource.get(field) ?? primary;
        companyProvenance.push({
          fieldName: field,
          value: serialize(value),
          sourceUrl: ref?.url,
          sourceType: ref?.sourceType ?? "web",
          confidence: DEEP_CONFIDENCE,
        });
      }

      // ── 新聞 ──
      const news: Partial<CompanyNews>[] = [];
      for (const n of ex.news ?? []) {
        const title = cleanStr(n.title);
        if (!title) continue;
        const ref = resolve(n.sourceIndex);
        const url = cleanHttpUrl(n.url) ?? ref?.url;
        const category = NEWS_CATEGORIES.includes(n.category as CompanyNewsCategory)
          ? (n.category as CompanyNewsCategory)
          : undefined;
        const row: Partial<CompanyNews> = { title };
        const titleZh = cleanStr(n.titleZh);
        if (titleZh) row.titleZh = titleZh;
        if (url) row.url = url;
        const source = cleanStr(n.source) ?? ref?.title;
        if (source) row.source = source;
        const summary = cleanStr(n.summary);
        if (summary) row.summary = summary;
        const summaryZh = cleanStr(n.summaryZh);
        if (summaryZh) row.summaryZh = summaryZh;
        const publishedAt = parseLooseDate(n.publishedDate);
        if (publishedAt !== undefined) row.publishedAt = publishedAt;
        if (category) row.category = category;
        news.push(row);
      }

      // ── 募資 ──
      const funding: Partial<CompanyFunding>[] = [];
      for (const r of ex.funding ?? []) {
        const roundType = cleanStr(r.roundType);
        const amount = typeof r.amount === "number" && Number.isFinite(r.amount) ? r.amount : undefined;
        const leadInvestor = cleanStr(r.leadInvestor);
        const investors = strArr(r.investors);
        // 至少要有一個實質欄位才成一列。
        if (!roundType && amount === undefined && !leadInvestor && !investors) continue;
        const ref = resolve(r.sourceIndex) ?? primary;
        const row: Partial<CompanyFunding> = {};
        if (roundType) row.roundType = roundType;
        if (amount !== undefined) row.amount = amount;
        const currency = cleanStr(r.currency);
        if (currency) row.currency = currency;
        const announcedAt = parseLooseDate(r.announcedDate);
        if (announcedAt !== undefined) row.announcedAt = announcedAt;
        if (leadInvestor) row.leadInvestor = leadInvestor;
        if (investors) row.investors = investors;
        if (ref?.url) row.sourceUrl = ref.url;
        funding.push(row);
      }

      // ── 主管（key people）──
      const people: DeepPerson[] = [];
      for (const p of ex.people ?? []) {
        const fullName = cleanStr(p.fullName);
        if (!fullName) continue;
        const ref = resolve(p.sourceIndex) ?? primary;
        const contact: Partial<Contact> = { fullName };
        const fullNameZh = cleanStr(p.fullNameZh);
        if (fullNameZh) contact.fullNameZh = fullNameZh;
        const title = cleanStr(p.title);
        if (title) contact.title = title;
        const titleZh = cleanStr(p.titleZh);
        if (titleZh) contact.titleZh = titleZh;
        if (SENIORITIES.includes(p.seniority as Seniority)) contact.seniority = p.seniority as Seniority;
        people.push({ contact, sourceUrl: ref?.url, sourceType: ref?.sourceType ?? "web" });
      }

      // ── 競爭對手 ──
      const competitors: { name: string; sourceUrl?: string; sourceType?: string }[] = [];
      const seenComp = new Set<string>();
      for (const c of ex.competitors ?? []) {
        const name = cleanStr(c.name);
        if (!name || seenComp.has(name.toLowerCase())) continue;
        seenComp.add(name.toLowerCase());
        const ref = resolve(c.sourceIndex) ?? primary;
        competitors.push({ name, sourceUrl: ref?.url, sourceType: ref?.sourceType ?? "web" });
      }

      // ── WP 缺口 1b/1c：公司官方社群 URL（機械保險：只 https＋四平台；orchestrator 以「補缺」併入）──
      const socialLinks = toDeepSocialLinks(ex.socialLinks);

      // ── S1-A7/A8：商機線索 + 外部產品觀點（每則錨定其 [S#] 的真實 URL；provenance 沿用 resolve→primary fallback）──
      const srcOf = (idx: unknown): string | undefined => (resolve(idx) ?? primary)?.url;
      const opportunities = toDeepOpportunities(ex.opportunities, srcOf);
      const products = toDeepProducts(ex.products, srcOf);
      // S4：FB/IG 動態摘要（sourceUrl 取真實 citation；未給 index 不 fallback primary，避免摘要錯掛無關來源）。
      const socialSummaries = toDeepSocialSummaries(ex.socialSummaries, (idx) => resolve(idx)?.url);

      // ── WP2：zh-TW 敘事 + 未歸類情報（每條錨定其 [S#] 的真實 URL；共用 dedupUncat）──
      const narrativeZh = cleanStr(ex.narrativeZh);
      const uncategorized = dedupUncat(ex.uncategorized, (u) => (resolve(u.sourceIndex) ?? primary)?.url);

      return {
        company,
        companyProvenance,
        news,
        funding,
        people,
        competitors,
        techStack,
        departments,
        socialLinks,
        opportunities,
        products,
        socialSummaries,
        narrativeZh,
        uncategorized,
      };
    },
  };
}
