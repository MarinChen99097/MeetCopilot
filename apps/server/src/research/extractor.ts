/**
 * CrawlExtractor — 把 RawCrawl（渲染後的頁面文字）用 Gemini 結構化抽取成 CRM 欄位（M1_CONTRACT §2）。
 *
 * ⚠️ v1 教訓（空白投影片）：responseSchema **必須是 union-superset 的具體 schema**，
 *    不可給空的 `{type:OBJECT}`——否則模型會回空物件。此處明列 company / contacts / products / news 的欄位。
 *
 * provenance：CrawlPayload.provenance 是**公司級**逐欄來源（ProvenanceInput{fieldName,value,sourceUrl,confidence}）。
 *  由抽出的 company 物件逐欄合成——sourceUrl=首頁 finalUrl，confidence=統一爬蟲信心（M1 簡化；per-field 精度後續再談）。
 *  contacts/products/news 的子實體 provenance 由 CompanyRepository.upsertFromCrawl（B1）在同一 tx 內自理。
 */
import { Type } from "@google/genai";
import type { GeminiClient } from "../gemini.js";
import type { Company, Contact, CompanyProduct, CompanyNews, CrawlPayload, ProvenanceInput } from "@meetcopilot/shared";
import type { RawCrawl } from "./crawler.js";

/** 統一爬蟲信心（provenance.confidence）。爬蟲抽取值一律標此值，人細填/確認才升信任。 */
const CRAWL_CONFIDENCE = 0.6;
const MAX_PROMPT_CHARS = 24_000; // 餵給 Gemini 的頁面文字上限（多頁串接）

export interface CrawlExtractor {
  toCompany(raw: RawCrawl): Promise<CrawlPayload>;
  toContacts(raw: RawCrawl): Promise<Partial<Contact>[]>;
}

/** Gemini 回傳的抽取形狀（camelCase 對齊 domain 欄位；皆 optional，模型缺值即略）。 */
interface ExtractedShape {
  company?: Partial<Company>;
  contacts?: Partial<Contact>[];
  products?: Partial<CompanyProduct>[];
  news?: Partial<CompanyNews>[];
}

const S = Type; // 別名

/** union-superset responseSchema（明列可爬欄位，見 CRM_SCHEMA §11「爬蟲能填什麼」）。 */
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    company: {
      type: S.OBJECT,
      properties: {
        name: { type: S.STRING },
        legalName: { type: S.STRING },
        domain: { type: S.STRING },
        websiteUrl: { type: S.STRING },
        logoUrl: { type: S.STRING },
        description: { type: S.STRING },
        tagline: { type: S.STRING },
        industry: { type: S.STRING },
        subIndustries: { type: S.ARRAY, items: { type: S.STRING } },
        businessModel: { type: S.STRING },
        keywords: { type: S.ARRAY, items: { type: S.STRING } },
        foundedYear: { type: S.INTEGER },
        ownershipType: { type: S.STRING },
        stockTicker: { type: S.STRING },
        employeeCount: { type: S.INTEGER },
        employeeRange: { type: S.STRING },
        hqCountry: { type: S.STRING },
        hqRegion: { type: S.STRING },
        hqCity: { type: S.STRING },
        hqAddress: { type: S.STRING },
        phoneMain: { type: S.STRING },
        emailGeneral: { type: S.STRING },
        socialLinkedin: { type: S.STRING },
        socialTwitter: { type: S.STRING },
        socialFacebook: { type: S.STRING },
        socialYoutube: { type: S.STRING },
        socialGithub: { type: S.STRING },
        productsOffered: { type: S.ARRAY, items: { type: S.STRING } },
        keyCustomers: { type: S.ARRAY, items: { type: S.STRING } },
        certifications: { type: S.ARRAY, items: { type: S.STRING } },
        awards: { type: S.ARRAY, items: { type: S.STRING } },
        hiringSignals: { type: S.ARRAY, items: { type: S.STRING } },
      },
    },
    contacts: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          fullName: { type: S.STRING },
          firstName: { type: S.STRING },
          lastName: { type: S.STRING },
          title: { type: S.STRING },
          department: { type: S.STRING },
          seniority: {
            type: S.STRING,
            enum: ["c_level", "vp", "director", "manager", "ic", "founder", "board"],
          },
          email: { type: S.STRING },
          linkedinUrl: { type: S.STRING },
          bio: { type: S.STRING },
          locationCity: { type: S.STRING },
          locationCountry: { type: S.STRING },
        },
        required: ["fullName"],
      },
    },
    products: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: {
          name: { type: S.STRING },
          category: { type: S.STRING },
          oneLiner: { type: S.STRING },
          description: { type: S.STRING },
          productUrl: { type: S.STRING },
          docsUrl: { type: S.STRING },
          pricingModel: { type: S.STRING },
          integrations: { type: S.ARRAY, items: { type: S.STRING } },
          targetMarket: { type: S.STRING },
        },
        required: ["name"],
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
          category: {
            type: S.STRING,
            enum: ["funding", "product", "exec_change", "mna", "partnership", "legal", "financial", "other"],
          },
        },
        required: ["title"],
      },
    },
  },
};

const SYSTEM = [
  "You extract B2B company intelligence from a prospect company's own website text for a sales CRM.",
  "Only extract facts explicitly present in the provided page text. Do NOT invent, guess emails, or hallucinate.",
  "If a field is unknown, omit it. Prefer the company's self-description over marketing fluff.",
  "Return valid JSON matching the schema exactly.",
].join(" ");

function buildPrompt(raw: RawCrawl): string {
  const header = `Source site: ${raw.finalUrl ?? raw.url}\nPage title: ${raw.title ?? ""}\nMeta: ${raw.metaDescription ?? ""}\n`;
  const bodies = raw.pages
    .map((p, i) => `\n--- PAGE ${i + 1}: ${p.url} ---\n${p.text}`)
    .join("\n");
  return (header + bodies).slice(0, MAX_PROMPT_CHARS);
}

/** 由抽出的 company 物件逐欄合成公司級 provenance（爬蟲來源）。 */
function companyProvenance(company: Partial<Company> | undefined, sourceUrl?: string): ProvenanceInput[] {
  if (!company) return [];
  const out: ProvenanceInput[] = [];
  for (const [fieldName, value] of Object.entries(company)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    out.push({ fieldName, value: serialized, sourceUrl, confidence: CRAWL_CONFIDENCE });
  }
  return out;
}

export function createCrawlExtractor(gemini: GeminiClient): CrawlExtractor {
  async function extract(raw: RawCrawl): Promise<ExtractedShape> {
    if (!gemini.isConfigured()) throw new Error("GEMINI_API_KEY not configured");
    return gemini.generateJson<ExtractedShape>({
      system: SYSTEM,
      prompt: buildPrompt(raw),
      schema: RESPONSE_SCHEMA,
    });
  }

  return {
    async toCompany(raw: RawCrawl): Promise<CrawlPayload> {
      const ex = await extract(raw);
      const sourceUrl = raw.finalUrl ?? raw.url;
      const company: Partial<Company> = ex.company ?? {};
      // websiteUrl 缺就補上起始站，讓 upsert 有可寫的 domain 依據。
      if (!company.websiteUrl) company.websiteUrl = sourceUrl;
      return {
        company,
        contacts: ex.contacts ?? [],
        products: ex.products ?? [],
        news: ex.news ?? [],
        provenance: companyProvenance(company, sourceUrl),
      };
    },

    async toContacts(raw: RawCrawl): Promise<Partial<Contact>[]> {
      const ex = await extract(raw);
      return ex.contacts ?? [];
    },
  };
}
