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
import type { GeminiClient } from "../gemini.js";
import type {
  Company,
  Contact,
  CompanyNews,
  CompanyFunding,
  CompanyNewsCategory,
  Seniority,
  ProvenanceInput,
} from "@meetcopilot/shared";
import type { DeepResearchBundle } from "./deep-research.js";
import { classifySourceType } from "./deep-research.js";

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

// ── 模型輸出形狀 ──────────────────────────────────────────
interface ExtractedDeep {
  company?: Partial<Record<keyof Company, unknown>>;
  companyFieldSources?: { field?: string; sourceIndex?: number }[];
  news?: {
    title?: string;
    url?: string;
    source?: string;
    summary?: string;
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
  people?: { fullName?: string; title?: string; seniority?: string; sourceIndex?: number }[];
  competitors?: { name?: string; sourceIndex?: number }[];
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
  industry: { type: S.STRING },
  businessModel: { type: S.STRING },
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

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    company: { type: S.OBJECT, properties: COMPANY_PROPS },
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
          url: { type: S.STRING },
          source: { type: S.STRING },
          summary: { type: S.STRING },
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
          title: { type: S.STRING },
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
  "people: named executives/leaders with their title and seniority.",
  "competitors: named competitor companies.",
  "Write text values in the language of the sources (Traditional Chinese for zh sources — do not translate); keep values concise; never repeat text. Field NAMES stay English per the schema. Return ONLY valid JSON matching the schema.",
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

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
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
        if (url) row.url = url;
        const source = cleanStr(n.source) ?? ref?.title;
        if (source) row.source = source;
        const summary = cleanStr(n.summary);
        if (summary) row.summary = summary;
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
        const title = cleanStr(p.title);
        if (title) contact.title = title;
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

      return { company, companyProvenance, news, funding, people, competitors };
    },
  };
}
