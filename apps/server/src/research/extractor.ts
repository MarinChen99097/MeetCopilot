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
// 多頁串接的 prompt 預算：detailed 會帶 ~20+ 頁（產品列表＋明細），需夠大才能餵進足量頁；
// 每頁再各自截 PER_PAGE_PROMPT_CHARS 以保「廣度」（不讓某一長頁吃光預算）。gemini-3.5-flash 長 context 撐得住。
const MAX_PROMPT_CHARS = 180_000;
const PER_PAGE_PROMPT_CHARS = 6_000;
// detailed 抽取要回「每產品含 specs/features」的較大 JSON——放寬輸出 token 上限，避免多產品被截斷。
const EXTRACT_MAX_OUTPUT_TOKENS = 16_384;
// 低溫抽取：預設溫度（~1.0）下同一批頁的產品數 run-to-run 劇烈跳動（實測 cyberpower 1 vs 33）；
// 結構化枚舉要的是穩定、可重現，非創意——壓到 0.3 讓「列出所有產品」一致收斂。
const EXTRACT_TEMPERATURE = 0.3;

export interface CrawlExtractor {
  toCompany(raw: RawCrawl): Promise<CrawlPayload>;
  toContacts(raw: RawCrawl): Promise<Partial<Contact>[]>;
}

/**
 * 模型輸出的單一產品形狀。刻意與 CompanyProduct 略有出入，因兩個欄位對 schema 友善的表示不同：
 *  - specs：CompanyProduct.specs 是自由 key-value 物件（無法枚舉 keys → 空 OBJECT schema 會回空，見 v1 教訓），
 *    故讓模型回 `{name,value}[]` 明列，程式再摺成物件。
 *  - priceText：站上「原樣顯示」的價格字串（如 "NT$4,290 起"）→ 程式解析出 priceFrom/currency、原文留 pricingNotes。
 */
interface ExtractedProduct {
  name?: string;
  category?: string;
  oneLiner?: string;
  description?: string;
  productUrl?: string;
  docsUrl?: string;
  pricingModel?: string;
  priceText?: string;
  targetMarket?: string;
  integrations?: string[];
  differentiators?: string[];
  targetPersonas?: string[];
  keyFeatures?: { name?: string; detail?: string; benefit?: string }[];
  specs?: { name?: string; value?: string }[];
}

/** Gemini 回傳的抽取形狀（camelCase 對齊 domain 欄位；皆 optional，模型缺值即略）。 */
interface ExtractedShape {
  company?: Partial<Company>;
  contacts?: Partial<Contact>[];
  products?: ExtractedProduct[];
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
        // NOTE: domain/websiteUrl are deliberately NOT requested from the model. The crawler already
        // knows the canonical URL (raw.finalUrl) and we derive domain from it. Asking a text model to
        // echo the URL is redundant AND was the exact corruption vector (M1 verify): the model emitted a
        // stray quote right after ".../" — sometimes a smart quote, sometimes an escaped \" — which
        // collapsed the whole object into the websiteUrl string and dropped industry/description/etc.
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
      // Force the model to actually emit the high-value fields it otherwise skips. A company's own
      // homepage always supports name+description+industry; without `required`, gemini fills the easy
      // fields (name/tagline) + products[] and drops description/industry (observed on ghost.org & cyberpower.com).
      required: ["name", "description", "industry"],
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
          // 站上原樣顯示的價格字串（含幣別/單位，如 "NT$4,290 起"、"$99/mo"）。程式再解析成 priceFrom/currency。
          priceText: { type: S.STRING },
          targetMarket: { type: S.STRING },
          integrations: { type: S.ARRAY, items: { type: S.STRING } },
          differentiators: { type: S.ARRAY, items: { type: S.STRING } },
          targetPersonas: { type: S.ARRAY, items: { type: S.STRING } },
          // 產品重點功能（來自 feature 區塊）。
          keyFeatures: {
            type: S.ARRAY,
            items: {
              type: S.OBJECT,
              properties: {
                name: { type: S.STRING },
                detail: { type: S.STRING },
                benefit: { type: S.STRING },
              },
              required: ["name"],
            },
          },
          // 規格明細（來自產品明細頁的規格表）：label→value 對。空 OBJECT schema 會回空，故用具名 pair 陣列。
          specs: {
            type: S.ARRAY,
            items: {
              type: S.OBJECT,
              properties: {
                name: { type: S.STRING },
                value: { type: S.STRING },
              },
              required: ["name", "value"],
            },
          },
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
  "You are a B2B sales-intelligence analyst. Read a prospect company's OWN website text and return a structured company profile as JSON for a sales CRM.",
  "The text spans MULTIPLE pages of the same site, each labelled with its source URL: a homepage, product-LIST pages, and product-DETAIL/spec pages. Use the detail/spec pages to enrich each product.",
  "A marketing homepage's hero and feature sections ARE the company's self-description. Synthesize these company fields from that copy even when they are not explicitly labelled:",
  "- `description`: 2-3 FULL sentences on WHAT the company does and for whom. REQUIRED whenever the page explains the business.",
  "- `industry`: the product category / vertical as a short label (e.g. '不斷電系統 (UPS) 與電源管理' or 'Publishing & newsletter software'). REQUIRED whenever it can be inferred.",
  "- `businessModel`: e.g. 'B2B hardware', 'B2B SaaS', 'open-source + hosted'.",
  "- `tagline`: ONLY the site's short headline slogan (roughly <= 12 words). Do NOT put the full description in `tagline`.",
  "- `productsOffered`: the product/service names.",
  "PRODUCTS — this is the highest-value output. List EVERY distinct product / model / series the site describes as its own `products[]` entry; do NOT cap the list (a hardware catalog may have a dozen or more). For each, fill from the detail/spec pages when present:",
  "- `category`: the product's family/type (e.g. '在線式 UPS 不斷電系統', 'PDU 電源分配器').",
  "- `oneLiner` + `description`: one short line + a short paragraph of what it is / who it's for.",
  "- `pricingModel` + `priceText`: the pricing type, and the price EXACTLY as shown on the page (keep the currency and units, e.g. 'NT$4,290', '$99/mo'). Only if a price is actually shown.",
  "- `targetMarket` (and `targetPersonas` if stated): who the product is for (e.g. '中小企業伺服器機房', '家庭與 SOHO').",
  "- `keyFeatures[]`: the product's notable features (name + optional detail/benefit).",
  "- `specs[]`: technical spec rows from a spec/comparison table as {name,value} pairs, e.g. {name:'容量', value:'1500VA/900W'}, {name:'輸出電壓', value:'110V'}, {name:'外型架構', value:'直立式'}. Product-detail AND product-comparison pages list models by attribute columns (capacity/architecture/form-factor/voltage/runtime) — attach those attribute values as specs[] on the matching product. A page WITH such a table SHOULD populate specs[].",
  "Also include, only when the text states them: HQ location, founded year, social links, key customers, and named people (as `contacts[]`).",
  "Write the extracted text values in the SAME language as the page (e.g. Traditional Chinese if the page is in Chinese) — do not translate; quote the company's own wording. Field NAMES stay as in the schema (English keys).",
  "Leave a field empty ONLY when the text does not state it. Do NOT fabricate identifiers, prices, numbers, or specs you cannot see in the text. Keep each text value concise and never repeat text. Return ONLY valid JSON matching the schema.",
].join(" ");

function buildPrompt(raw: RawCrawl): string {
  const header = `Source site: ${raw.finalUrl ?? raw.url}\nPage title: ${raw.title ?? ""}\nMeta description: ${raw.metaDescription ?? ""}\nPages crawled: ${raw.pages.length}\n`;
  // 每頁各自截 PER_PAGE_PROMPT_CHARS（保廣度：不讓某一長頁吃光 prompt 預算），再整體截 MAX_PROMPT_CHARS。
  const bodies = raw.pages
    .map((p, i) => `\n--- PAGE ${i + 1}: ${p.url} ---\n${p.text.slice(0, PER_PAGE_PROMPT_CHARS)}`)
    .join("\n");
  const task =
    "TASK: Read the multi-page website text below (each page labelled with its URL) and produce a company-profile JSON. " +
    "Fill `description` and `industry` from what the site says the company does, even if not explicitly labelled. " +
    "List EVERY product/model/series the site describes under `products[]`, and enrich each with category, pricing (priceText as shown), targetMarket, keyFeatures[] and specs[] taken from the product-detail/spec pages. " +
    "Use only facts from the text; keep values short and do not repeat yourself.\n\n";
  return (task + header + bodies).slice(0, MAX_PROMPT_CHARS);
}

/**
 * 清掉 URL 尾端的污染（逗號/分號/引號/括號/空白）。防「websiteUrl 帶尾逗號」這類 join/format 或模型污染
 * （M1 verify 觀察到 "https://ghost.org/,"）。只動 URL 類欄位，不碰 description 等可含標點的自由文字。
 */
function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  const trimmed = u.trim().replace(/[\s,;'"’“”)\]}]+$/u, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 由「站上原樣顯示的價格字串」best-effort 解析出數值＋幣別。解析不出就回 undefined（原文仍留 pricingNotes）。 */
function parsePrice(text: string): { amount: number; currency?: string } | undefined {
  const numMatch = text.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!numMatch) return undefined;
  const amount = Number(numMatch[1]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  let currency: string | undefined;
  // NT$/新台幣 先判（避免被泛用 `$` 誤判成 USD）；`元` 在台灣站脈絡多為 TWD。
  if (/NT\$|NTD|新台幣|台幣/.test(text)) currency = "TWD";
  else if (/US\$|USD/.test(text)) currency = "USD";
  else if (/€|EUR/.test(text)) currency = "EUR";
  else if (/£|GBP/.test(text)) currency = "GBP";
  else if (/¥|JPY/.test(text)) currency = "JPY";
  else if (/RMB|CNY|人民幣/.test(text)) currency = "CNY";
  else if (/元/.test(text)) currency = "TWD";
  else if (/\$/.test(text)) currency = "USD";
  return { amount, currency };
}

const strArr = (v: unknown): string[] | undefined => {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
  return out.length > 0 ? out : undefined;
};

/** 把模型的 ExtractedProduct[] 摺成 domain 的 Partial<CompanyProduct>[]（specs 陣列→物件、priceText→priceFrom/currency/pricingNotes）。 */
function toProducts(items: ExtractedProduct[] | undefined): Partial<CompanyProduct>[] {
  if (!Array.isArray(items)) return [];
  const out: Partial<CompanyProduct>[] = [];
  for (const p of items) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) continue;
    const prod: Partial<CompanyProduct> = { name };
    if (p.category) prod.category = p.category;
    if (p.oneLiner) prod.oneLiner = p.oneLiner;
    if (p.description) prod.description = p.description;
    const purl = cleanUrl(p.productUrl);
    if (purl) prod.productUrl = purl;
    const durl = cleanUrl(p.docsUrl);
    if (durl) prod.docsUrl = durl;
    if (p.pricingModel) prod.pricingModel = p.pricingModel;
    if (p.targetMarket) prod.targetMarket = p.targetMarket;
    const integrations = strArr(p.integrations);
    if (integrations) prod.integrations = integrations;
    const differentiators = strArr(p.differentiators);
    if (differentiators) prod.differentiators = differentiators;
    const targetPersonas = strArr(p.targetPersonas);
    if (targetPersonas) prod.targetPersonas = targetPersonas;
    // 價格：原文留 pricingNotes；能解析就補 priceFrom/currency。
    if (typeof p.priceText === "string" && p.priceText.trim()) {
      prod.pricingNotes = p.priceText.trim();
      const parsed = parsePrice(p.priceText);
      if (parsed) {
        prod.priceFrom = parsed.amount;
        if (parsed.currency) prod.currency = parsed.currency;
      }
    }
    // 功能：{name,detail?,benefit?}[]（ProductFeature）。
    if (Array.isArray(p.keyFeatures)) {
      const feats = p.keyFeatures
        .filter((f): f is { name: string; detail?: string; benefit?: string } => Boolean(f) && typeof f.name === "string" && f.name.trim().length > 0)
        .map((f) => ({ name: f.name.trim(), detail: f.detail?.trim() || undefined, benefit: f.benefit?.trim() || undefined }));
      if (feats.length > 0) prod.keyFeatures = feats;
    }
    // 規格：{name,value}[] → 自由 key-value 物件。
    if (Array.isArray(p.specs)) {
      const specObj: Record<string, string> = {};
      for (const s of p.specs) {
        const k = typeof s?.name === "string" ? s.name.trim() : "";
        const v = typeof s?.value === "string" ? s.value.trim() : "";
        if (k && v) specObj[k] = v;
      }
      if (Object.keys(specObj).length > 0) prod.specs = specObj;
    }
    out.push(prod);
  }
  return out;
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

export function createCrawlExtractor(gemini: GeminiClient, extractModel?: string): CrawlExtractor {
  async function extract(raw: RawCrawl): Promise<ExtractedShape> {
    if (!gemini.isConfigured()) throw new Error("GEMINI_API_KEY not configured");
    const prompt = buildPrompt(raw);
    return gemini.generateJson<ExtractedShape>({
      model: extractModel,
      system: SYSTEM,
      prompt,
      schema: RESPONSE_SCHEMA,
      maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
      temperature: EXTRACT_TEMPERATURE,
    });
  }

  return {
    async toCompany(raw: RawCrawl): Promise<CrawlPayload> {
      const ex = await extract(raw);
      const sourceUrl = cleanUrl(raw.finalUrl ?? raw.url) ?? (raw.finalUrl ?? raw.url);
      const company: Partial<Company> = ex.company ?? {};
      // 正規化模型可能回傳的 URL 欄位（去尾端逗號等污染）。
      company.websiteUrl = cleanUrl(company.websiteUrl);
      company.logoUrl = cleanUrl(company.logoUrl) ?? company.logoUrl;
      // websiteUrl 缺就補上起始站，讓 upsert 有可寫的 domain 依據。
      if (!company.websiteUrl) company.websiteUrl = sourceUrl;
      return {
        company,
        contacts: ex.contacts ?? [],
        products: toProducts(ex.products),
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
