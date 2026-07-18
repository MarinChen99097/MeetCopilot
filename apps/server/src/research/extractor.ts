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
import type {
  Company,
  Contact,
  CompanyProduct,
  CompanyNews,
  CrawlPayload,
  ProvenanceInput,
  NewCompanyTech,
  NewCompanyDepartment,
} from "@meetcopilot/shared";
import type { RawCrawl, CrawledPage } from "./crawler.js";
import {
  cleanStr,
  dedupUncat,
  filterToImageWhitelist,
  validatePhotoUrl,
  NARRATIVE_UNCAT_SCHEMA,
  type UncategorizedIntel,
} from "./extract-shared.js";
// B4：頁面對齊複用 deep-extractor 的產品名正規化（單一來源，避免枚舉漂移）。單向依賴（deep-extractor 不 import 本檔）。
import { normalizeProductName } from "./deep-extractor.js";
export type { UncategorizedIntel };

/** 統一爬蟲信心（provenance.confidence）。爬蟲抽取值一律標此值，人細填/確認才升信任。 */
const CRAWL_CONFIDENCE = 0.6;
// 多頁串接的 prompt 預算：detailed 會帶 ~20+ 頁（產品列表＋明細），需夠大才能餵進足量頁；
// 每頁再各自截動態上限（computePerPageChars）以保「廣度」（不讓某一長頁吃光預算）。gemini-3.5-flash 長 context 撐得住。
const MAX_PROMPT_CHARS = 180_000;
// B1 每頁截斷動態化：不再固定每頁砍 6000。若「sum(min(page.text, PER_PAGE_MAX_CHARS)) + 雜項（task/header/
// 每頁框線/圖片清單）」放得進 MAX_PROMPT_CHARS，每頁給足 PER_PAGE_MAX_CHARS（＝crawler 每頁存的上限，等於不砍）；
// 否則把「扣掉雜項的預算」按頁數等分、下限 PER_PAGE_MIN_CHARS（頁數過多時仍保每頁最低具體度，整體再由末端 slice 收尾）。
const PER_PAGE_MAX_CHARS = 12_000; // 對齊 crawler.MAX_TEXT_CHARS（每頁最多存 12000 字）→ 放得下就整頁餵
const PER_PAGE_MIN_CHARS = 6_000; // 頁數過多時的每頁下限
// detailed 抽取要回「每產品含 specs/features」的較大 JSON——放寬輸出 token 上限，避免多產品被截斷。
const EXTRACT_MAX_OUTPUT_TOKENS = 16_384;
// 低溫抽取：預設溫度（~1.0）下同一批頁的產品數 run-to-run 劇烈跳動（實測 cyberpower 1 vs 33）；
// 結構化枚舉要的是穩定、可重現，非創意——壓到 0.3 讓「列出所有產品」一致收斂。
const EXTRACT_TEMPERATURE = 0.3;
// 新增子表輸出上限（避免 JSON 爆量／截斷）：techStack/departments 各設硬上限，*Zh 簡介另以 prompt 限 <=2 句。
const MAX_TECH = 12;
const MAX_DEPARTMENTS = 10;
// 每頁在 prompt 附上的圖片清單上限（控 token）。模型只能從此清單挑 imageUrls/photoUrl（其餘視為幻覺被程式濾掉）。
const PROMPT_IMAGES_PER_PAGE = 10;
// B4 二段式（per-product 聚焦補抽）參數。
const PRODUCT_DETAIL_MAX_PAGES = 10; // 最多聚焦補抽的產品數（有對應爬取專頁者）
const PRODUCT_DETAIL_CONCURRENCY = 3; // 聚焦補抽並行上限
// 單一產品 rich schema 輸出上限。MAX_TOKENS 修法（E2E：某產品二段深抽整筆丟失）：gemini-3.5-flash 的 thinking token
// 與輸出共用此預算，原本 4096 對「≥3 keyFeatures＋specs 表＋雙語 gloss」的 rich JSON 偏緊 → thinking 一多即截斷。
// 上調 4096→8192，並在呼叫端壓低 thinkingBudget，確保 JSON 一定放得下。
const PRODUCT_DETAIL_MAX_OUTPUT_TOKENS = 8_192;
// 單品聚焦抽取的 thinking 上限（gemini-3.x flash）：小任務不需長思考，壓低以保 JSON 輸出不被 thinking 吃光。
const PRODUCT_DETAIL_THINKING_BUDGET = 2_048;
const PRODUCT_DETAIL_NEARBY_MAX = 2; // 每產品併入的鄰近相關頁上限
const PRODUCT_NAME_MIN_MATCH = 4; // 名稱含式匹配頁的最短正規化長度（避免過短 token 誤配全站）
/** 空圖片白名單（B4 聚焦抽取不請 imageUrls，foldProduct 需一個 whitelist）。 */
const EMPTY_WHITELIST: ReadonlySet<string> = new Set<string>();

export interface CrawlExtractor {
  toCompany(raw: RawCrawl): Promise<CompanyExtraction>;
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
  /** 型號/SKU（如 CP1500PFCLCD）；規格/明細頁有才填。 */
  model?: string;
  category?: string;
  oneLiner?: string;
  /** zh-TW 一句話定位（另產；不覆寫來源語言的 oneLiner）。 */
  oneLinerZh?: string;
  description?: string;
  /** zh-TW 精簡描述（另產；不覆寫來源語言的 description）。 */
  descriptionZh?: string;
  productUrl?: string;
  docsUrl?: string;
  pricingModel?: string;
  priceText?: string;
  targetMarket?: string;
  integrations?: string[];
  differentiators?: string[];
  targetPersonas?: string[];
  /** B3：此產品用到/建於的技術棧（如 AWS、React；保留原名）。 */
  techStack?: string[];
  /** B3：此產品的競品（頁面明列時）。 */
  competitors?: string[];
  keyFeatures?: { name?: string; detail?: string; benefit?: string }[];
  specs?: { name?: string; value?: string }[];
  /** 產品圖片 URL（模型只能從提供的頁面圖片清單挑；程式端過白名單驗證後併入 mediaUrls）。 */
  imageUrls?: string[];
}

/** 模型輸出的技術棧單筆（zh-TW，惟技術/產品專有名保留原名）。摺成 NewCompanyTech。 */
interface ExtractedTech {
  category?: string;
  vendor?: string;
  product?: string;
  detectedFrom?: string;
}

/** 模型輸出的部門單筆（zh-TW）。摺成 NewCompanyDepartment（name 必填）。 */
interface ExtractedDepartment {
  name?: string;
  focus?: string;
  headcountEstimate?: number;
}

/**
 * company 抽取形狀：Partial<Company>（含新 descriptionZh 欄）＋模型另附的子表陣列。
 * techStack/departments 並非 companies 欄位（是子表），故在此掛在 company 物件下、由 toCompany 拆出，
 * 不讓它們污染 company 欄位寫入與 companyProvenance。
 */
type ExtractedCompany = Partial<Company> & {
  techStack?: ExtractedTech[];
  departments?: ExtractedDepartment[];
};

/** Gemini 回傳的抽取形狀（camelCase 對齊 domain 欄位；皆 optional，模型缺值即略）。 */
interface ExtractedShape {
  company?: ExtractedCompany;
  contacts?: Partial<Contact>[];
  products?: ExtractedProduct[];
  news?: Partial<CompanyNews>[];
  narrativeZh?: string;
  uncategorized?: { text?: string; sourceIndex?: number }[];
}

/**
 * toCompany 的回傳：CrawlPayload（落庫用）＋ WP2 筆記區資料（narrativeZh / uncategorized）。
 * 加寬（非改 shared CrawlPayload）：落庫端仍當 CrawlPayload 用；orchestrator 另取 narrative/uncategorized 產單例筆記。
 */
export interface CompanyExtraction extends CrawlPayload {
  narrativeZh?: string;
  uncategorized?: UncategorizedIntel[];
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
        // zh-TW 精簡公司簡介（另產；不覆寫來源語言的 description）。
        descriptionZh: { type: S.STRING },
        tagline: { type: S.STRING },
        // zh-TW 精簡標語（另產；不覆寫來源語言的 tagline）。
        taglineZh: { type: S.STRING },
        industry: { type: S.STRING },
        // zh-TW 產業別（industry 的繁中翻譯；另產）。
        industryZh: { type: S.STRING },
        subIndustries: { type: S.ARRAY, items: { type: S.STRING } },
        businessModel: { type: S.STRING },
        // zh-TW 商業模式（businessModel 的繁中 gloss；另產）。
        businessModelZh: { type: S.STRING },
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
        // 技術棧（company_tech 子表；zh-TW，技術/產品專有名保留原名如 AWS/React）。toCompany 拆出→bulkUpsertTech。
        techStack: {
          type: S.ARRAY,
          items: {
            type: S.OBJECT,
            properties: {
              category: { type: S.STRING },
              vendor: { type: S.STRING },
              product: { type: S.STRING },
              detectedFrom: { type: S.STRING },
            },
          },
        },
        // 部門/團隊（company_departments 子表；zh-TW）。toCompany 拆出→bulkUpsertDepartments。
        departments: {
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
        },
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
          // zh-TW 姓名（僅來源實際出現中文名才填；嚴禁音譯捏造）。
          fullNameZh: { type: S.STRING },
          firstName: { type: S.STRING },
          lastName: { type: S.STRING },
          // 人物照片 URL（只能從提供的頁面圖片清單挑；程式端過白名單驗證）。
          photoUrl: { type: S.STRING },
          title: { type: S.STRING },
          // zh-TW 職稱簡述（另產；不覆寫來源語言的 title）。
          titleZh: { type: S.STRING },
          department: { type: S.STRING },
          seniority: {
            type: S.STRING,
            enum: ["c_level", "vp", "director", "manager", "ic", "founder", "board"],
          },
          email: { type: S.STRING },
          linkedinUrl: { type: S.STRING },
          bio: { type: S.STRING },
          // zh-TW 背景摘要（另產）。
          backgroundSummaryZh: { type: S.STRING },
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
          // 型號/SKU（如 CP1500PFCLCD）；規格/明細頁有才填。
          model: { type: S.STRING },
          category: { type: S.STRING },
          oneLiner: { type: S.STRING },
          // zh-TW 一句話定位（另產）。
          oneLinerZh: { type: S.STRING },
          description: { type: S.STRING },
          // zh-TW 精簡描述（另產）。
          descriptionZh: { type: S.STRING },
          productUrl: { type: S.STRING },
          docsUrl: { type: S.STRING },
          pricingModel: { type: S.STRING },
          // 站上原樣顯示的價格字串（含幣別/單位，如 "NT$4,290 起"、"$99/mo"）。程式再解析成 priceFrom/currency。
          priceText: { type: S.STRING },
          targetMarket: { type: S.STRING },
          integrations: { type: S.ARRAY, items: { type: S.STRING } },
          differentiators: { type: S.ARRAY, items: { type: S.STRING } },
          targetPersonas: { type: S.ARRAY, items: { type: S.STRING } },
          // B3：此產品的技術棧（用到/建於的技術/平台；保留 AWS/React 等原名）。
          techStack: { type: S.ARRAY, items: { type: S.STRING } },
          // B3：此產品的競品（頁面明列「competitors / alternatives / 相較於」時）。
          competitors: { type: S.ARRAY, items: { type: S.STRING } },
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
          // 產品圖片 URL（只能從下方每頁 PAGE IMAGES 清單逐字挑；程式端過白名單驗證後併入 mediaUrls）。
          imageUrls: { type: S.ARRAY, items: { type: S.STRING } },
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
          // zh-TW 標題簡述（另產）。
          titleZh: { type: S.STRING },
          url: { type: S.STRING },
          source: { type: S.STRING },
          summary: { type: S.STRING },
          // zh-TW 摘要（另產）。
          summaryZh: { type: S.STRING },
          category: {
            type: S.STRING,
            enum: ["funding", "product", "exec_change", "mna", "partnership", "legal", "financial", "other"],
          },
        },
        required: ["title"],
      },
    },
    // WP2 §2：narrativeZh + uncategorized（共用片段，見 extract-shared.NARRATIVE_UNCAT_SCHEMA）。
    ...NARRATIVE_UNCAT_SCHEMA,
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
  "MINIMUM SPECIFICITY (hard requirement per product, whenever the site describes the product): at least 3 `keyFeatures[]` each WITH a concrete `detail`, AND at least one sentence of `targetMarket`. If the page shows a price you MUST fill `priceText`; if the page has a spec/comparison table you MUST fill `specs[]`. Do not return a bare `{name}` for a product that has a real page — dig the specifics out of the text. (Still: never invent facts the text does not contain.)",
  "- `model`: the product's model number / SKU EXACTLY as printed on the spec/detail page (e.g. 'CP1500PFCLCD', 'ABC-123'). Fill ONLY when the page actually shows one; otherwise leave empty. NEVER invent a model code.",
  "- `imageUrls`: image URLs for THIS product. You MUST pick ONLY from the `PAGE IMAGES` list shown under each page below, copying the URL VERBATIM. NEVER invent, guess, or modify an image URL. If none of the listed images clearly belongs to this product, leave it empty.",
  "- `category`: the product's family/type (e.g. '在線式 UPS 不斷電系統', 'PDU 電源分配器').",
  "- `oneLiner` + `description`: one short line + a short paragraph of what it is / who it's for.",
  "- `pricingModel` + `priceText`: the pricing type, and the price EXACTLY as shown on the page (keep the currency and units, e.g. 'NT$4,290', '$99/mo'). If the page shows ANY price for this product you MUST fill `priceText` verbatim; leave it empty ONLY when no price appears at all. NEVER invent a price.",
  "- `targetMarket` (and `targetPersonas` if stated): ALWAYS provide at least one sentence on who the product is for (e.g. '中小企業伺服器機房', '家庭與 SOHO'); infer it from the marketing copy even when it is not explicitly labelled.",
  "- `keyFeatures[]`: list AT LEAST 3 of the product's notable features whenever the page describes it; each MUST have a `name` AND a concrete `detail` (what it does / the spec behind it), plus a `benefit` when the page states one. A one-or-two-item or detail-less feature list on a product with a real page is a failure — extract the specifics.",
  "- `techStack` + `competitors`: the technologies the product is built on / integrates with (keep AWS/React/Kubernetes/SAP original) and named competing products or alternatives — ONLY when the page actually states them; otherwise leave empty.",
  "- `specs[]`: technical spec rows from a spec/comparison table as {name,value} pairs, e.g. {name:'容量', value:'1500VA/900W'}, {name:'輸出電壓', value:'110V'}, {name:'外型架構', value:'直立式'}. Product-detail AND product-comparison pages list models by attribute columns (capacity/architecture/form-factor/voltage/runtime) — attach those attribute values as specs[] on the matching product. If a product's page contains such a table you MUST populate `specs[]` for that product from it.",
  "Also include, only when the text states them: HQ location, founded year, social links, key customers, and named people (as `contacts[]`).",
  "PEOPLE (contacts[]) — for each named person: `fullNameZh` = the person's Chinese name ONLY if it literally appears in the source text (official site/bio). NEVER transliterate a romanized name into Chinese or fabricate a Chinese name — leave it empty if the source has no Chinese name. `photoUrl` = the person's photo, picked ONLY from the `PAGE IMAGES` list VERBATIM; never invent one.",
  "TECH & DEPARTMENTS (only when the text states them): `company.techStack[]` = technologies/vendors/products the company itself uses or is built on ({category, vendor, product, detectedFrom = where on the page you saw it}); `company.departments[]` = the company's internal teams/divisions ({name, focus, headcountEstimate}). Write these DIRECTLY in Traditional Chinese (zh-TW), but keep technical/product proper nouns in their original form (e.g. AWS, React, Kubernetes, SAP). Cap: at most 12 techStack items and at most 10 departments.",
  "LANGUAGE — bilingual output. Keep every PRIMARY text field verbatim in the page's own source language (e.g. Traditional Chinese if the page is Chinese; do NOT translate the primary fields; quote the company's own wording). IN ADDITION, for each `*Zh` field — company.descriptionZh, company.taglineZh, company.industryZh, company.businessModelZh, products[].oneLinerZh, products[].descriptionZh, contacts[].titleZh, contacts[].backgroundSummaryZh, news[].titleZh, news[].summaryZh — emit a concise Traditional-Chinese (zh-TW, Taiwan usage) gloss of that item's corresponding primary field, each at most 2 sentences. company.industryZh is the Traditional-Chinese TRANSLATION of the industry label. If the source is already zh-TW you may condense it. (fullNameZh is NOT a gloss — see PEOPLE: only fill it from a Chinese name actually present in the source.) Field NAMES stay as in the schema (English keys).",
  "narrativeZh: write a Traditional-Chinese (zh-TW), plain-language narrative of 8-20 sentences synthesizing the company's type, business model, current situation, and (if visible) social presence. Keep proper nouns original; a readable briefing, NOT a bullet list.",
  "uncategorized: EVERY important fact in the text that does NOT fit the structured fields above (company/contacts/products/news) MUST be captured here as {text, sourceIndex} — DO NOT discard it (e.g. partnerships, awards, certifications context, notable customers, events). At most 25 items; each `text` one concise sentence. sourceIndex may be 0 (single-site source).",
  "Leave a field empty ONLY when the text does not state it. Do NOT fabricate identifiers, prices, numbers, or specs you cannot see in the text. Keep each text value concise and never repeat text. Return ONLY valid JSON matching the schema.",
].join(" ");

/** 由爬到的所有頁面圖片（ogImage + images.src）組白名單——擷取器據此驗證模型回傳的 imageUrls/photoUrl（防幻覺，契約三）。 */
export function buildImageWhitelist(raw: RawCrawl): Set<string> {
  const s = new Set<string>();
  for (const p of raw.pages) {
    if (p.ogImage) s.add(p.ogImage);
    for (const img of p.images ?? []) if (img?.src) s.add(img.src);
  }
  return s;
}

/** 組單頁 PAGE IMAGES 區塊（og:image 先、其後頁內 img；每頁上限 PROMPT_IMAGES_PER_PAGE）。無圖回空字串。 */
function pageImagesBlock(p: CrawledPage): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  const add = (u: string | null | undefined, alt?: string): void => {
    if (!u || seen.has(u) || lines.length >= PROMPT_IMAGES_PER_PAGE) return;
    seen.add(u);
    lines.push(alt ? `- ${u} | ${alt}` : `- ${u}`);
  };
  add(p.ogImage);
  for (const img of p.images ?? []) add(img.src, img.alt || undefined);
  if (lines.length === 0) return "";
  return `\n[PAGE IMAGES] (pick imageUrls/photoUrl ONLY from these, verbatim):\n${lines.join("\n")}`;
}

/**
 * B1：由各頁文字長度與「雜項」預算算出**動態的每頁字元上限**。純函式（供單測）。
 *  - textLengths：各頁 innerText 長度（爬蟲已各自截 ≤12000，但此處仍以 min 夾住以防呼叫端未截）。
 *  - miscChars：非頁面文字的固定開銷（task + header + 每頁框線 label + PAGE IMAGES 清單 + join 換行）。
 * 規則：sum(min(len, PER_PAGE_MAX_CHARS)) + miscChars ≤ MAX_PROMPT_CHARS → 回 PER_PAGE_MAX_CHARS（放得下就整頁餵）；
 *       否則把「MAX_PROMPT_CHARS − miscChars」按頁數等分，clamp 到 [PER_PAGE_MIN_CHARS, PER_PAGE_MAX_CHARS]。
 * 頁數極多以致每頁 < PER_PAGE_MIN_CHARS 時仍回下限（接受超出，整體 prompt 由末端 slice(MAX_PROMPT_CHARS) 硬收尾）。
 */
export function computePerPageChars(textLengths: number[], miscChars: number): number {
  const n = textLengths.length;
  if (n === 0) return PER_PAGE_MAX_CHARS;
  const fullSum = textLengths.reduce((s, l) => s + Math.min(Math.max(0, l), PER_PAGE_MAX_CHARS), 0);
  if (fullSum + miscChars <= MAX_PROMPT_CHARS) return PER_PAGE_MAX_CHARS;
  const textBudget = Math.max(0, MAX_PROMPT_CHARS - miscChars);
  const perPage = Math.floor(textBudget / n);
  return Math.min(PER_PAGE_MAX_CHARS, Math.max(PER_PAGE_MIN_CHARS, perPage));
}

function buildPrompt(raw: RawCrawl): string {
  const header = `Source site: ${raw.finalUrl ?? raw.url}\nPage title: ${raw.title ?? ""}\nMeta description: ${raw.metaDescription ?? ""}\nPages crawled: ${raw.pages.length}\n`;
  const task =
    "TASK: Read the multi-page website text below (each page labelled with its URL) and produce a company-profile JSON. " +
    "Fill `description` and `industry` from what the site says the company does, even if not explicitly labelled. " +
    "List EVERY product/model/series the site describes under `products[]`, and enrich each with category, pricing (priceText as shown), targetMarket, keyFeatures[] and specs[] taken from the product-detail/spec pages. " +
    "Use only facts from the text; keep values short and do not repeat yourself.\n\n";
  // 每頁尾附 PAGE IMAGES 清單（模型挑 imageUrls/photoUrl 的唯一合法來源）。先算「非頁面文字」的固定開銷（雜項），
  // 再據此動態決定每頁能給多少字（B1）：放得下就整頁餵、否則按頁數等分（下限 6000）。
  const frames = raw.pages.map((p, i) => ({
    prefix: `\n--- PAGE ${i + 1}: ${p.url} ---\n`,
    images: pageImagesBlock(p),
    text: p.text,
  }));
  const miscChars =
    task.length +
    header.length +
    frames.reduce((s, f) => s + f.prefix.length + f.images.length, 0) +
    Math.max(0, frames.length - 1); // join("\n") 的換行
  const perPage = computePerPageChars(frames.map((f) => f.text.length), miscChars);
  const bodies = frames.map((f) => `${f.prefix}${f.text.slice(0, perPage)}${f.images}`).join("\n");
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

/**
 * 把一筆模型 ExtractedProduct 摺成 domain 的 Partial<CompanyProduct>（specs 陣列→物件、priceText→priceFrom/
 * currency/pricingNotes、keyFeatures 去空、techStack/competitors 去空去重）。無 name → undefined。
 * imageUrls 過白名單驗證（防幻覺，契約三）：只保留確實爬到的圖片 URL，通過者併入 mediaUrls。
 * 共用於首段全站抽取（toProducts）與 B4 二段式聚焦抽取（extractOneProductDetail）。
 */
function foldProduct(p: ExtractedProduct, imageWhitelist: ReadonlySet<string>): Partial<CompanyProduct> | undefined {
  const name = typeof p?.name === "string" ? p.name.trim() : "";
  if (!name) return undefined;
  const prod: Partial<CompanyProduct> = { name };
  if (typeof p.model === "string" && p.model.trim()) prod.model = p.model.trim();
  // 產品圖片：只收白名單內的（幻覺 URL 濾掉）→ 併入 mediaUrls。
  const imgs = filterToImageWhitelist(p.imageUrls, imageWhitelist);
  if (imgs.length > 0) prod.mediaUrls = imgs;
  if (p.category) prod.category = p.category;
  if (p.oneLiner) prod.oneLiner = p.oneLiner;
  if (p.oneLinerZh) prod.oneLinerZh = p.oneLinerZh;
  if (p.description) prod.description = p.description;
  if (p.descriptionZh) prod.descriptionZh = p.descriptionZh;
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
  // B3：techStack / competitors（去空去重）。
  const techStack = strArr(p.techStack);
  if (techStack) prod.techStack = techStack;
  const competitors = strArr(p.competitors);
  if (competitors) prod.competitors = competitors;
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
  return prod;
}

/**
 * 把模型的 ExtractedProduct[] 摺成 domain 的 Partial<CompanyProduct>[]（逐筆 foldProduct；無 name 者略）。
 */
function toProducts(items: ExtractedProduct[] | undefined, imageWhitelist: ReadonlySet<string>): Partial<CompanyProduct>[] {
  if (!Array.isArray(items)) return [];
  const out: Partial<CompanyProduct>[] = [];
  for (const p of items) {
    const prod = foldProduct(p, imageWhitelist);
    if (prod) out.push(prod);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// B4 二段式（per-product 聚焦補抽）：首段抽完清單後，對「有對應爬取專頁」的產品逐一跑聚焦抽取。
// ────────────────────────────────────────────────────────────────────────────

/** 單一產品 rich schema（B4 第二段）：required 仍只留 name（防幻覺），其餘具體度靠 PRODUCT_DETAIL_SYSTEM 強制。 */
const PRODUCT_DETAIL_SCHEMA: Record<string, unknown> = {
  type: S.OBJECT,
  properties: {
    name: { type: S.STRING },
    model: { type: S.STRING },
    category: { type: S.STRING },
    oneLiner: { type: S.STRING },
    oneLinerZh: { type: S.STRING },
    description: { type: S.STRING },
    descriptionZh: { type: S.STRING },
    pricingModel: { type: S.STRING },
    priceText: { type: S.STRING },
    targetMarket: { type: S.STRING },
    targetPersonas: { type: S.ARRAY, items: { type: S.STRING } },
    differentiators: { type: S.ARRAY, items: { type: S.STRING } },
    integrations: { type: S.ARRAY, items: { type: S.STRING } },
    techStack: { type: S.ARRAY, items: { type: S.STRING } },
    competitors: { type: S.ARRAY, items: { type: S.STRING } },
    keyFeatures: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: { name: { type: S.STRING }, detail: { type: S.STRING }, benefit: { type: S.STRING } },
        required: ["name"],
      },
    },
    specs: {
      type: S.ARRAY,
      items: {
        type: S.OBJECT,
        properties: { name: { type: S.STRING }, value: { type: S.STRING } },
        required: ["name", "value"],
      },
    },
  },
  required: ["name"],
};

const PRODUCT_DETAIL_SYSTEM = [
  "You are a B2B product analyst. You are given the FULL text of ONE product's own page (plus nearby related pages from the same site) and the product's name.",
  "Return a SINGLE rich JSON object describing ONLY that product, matching the schema.",
  "Extract as much concrete detail as the page supports: at least 3 `keyFeatures` each WITH a `detail`; a one-sentence `targetMarket`; `priceText` EXACTLY as shown if any price appears; `specs[]` as {name,value} pairs from any spec/comparison table; plus `pricingModel`, `targetPersonas`, `differentiators`, `integrations`, `techStack` (keep AWS/React/Kubernetes/SAP original), `competitors`, and `model`/SKU when the page shows one.",
  "LANGUAGE: keep primary fields verbatim in the page's own language; additionally emit `oneLinerZh` and `descriptionZh` as a concise Traditional-Chinese (zh-TW) gloss.",
  "NEVER invent facts, prices, specs, or model codes the text does not contain. Leave a field empty when the page does not state it. Return ONLY valid JSON.",
].join(" ");

/** 正規化 URL 供頁面對齊（origin+pathname、lowercase、去尾斜線）；解析失敗回原字串小寫去尾斜線。 */
function normUrlForMatch(u: string): string {
  try {
    const url = new URL(u);
    let s = `${url.origin}${url.pathname}`.toLowerCase();
    if (s.length > 1 && s.endsWith("/")) s = s.replace(/\/+$/, "");
    return s;
  } catch {
    return u.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/** 陣列 union 去重（case-insensitive，保留首見原文）；空 → undefined。供 B4 merge。 */
function unionStrArr(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of [...(a ?? []), ...(b ?? [])]) {
    const t = typeof x === "string" ? x.trim() : "";
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.length > 0 ? out : undefined;
}

/** B4：一筆產品↔爬取頁的對齊結果。 */
export interface ProductPageMatch {
  productIndex: number;
  page: CrawledPage;
  nearby: CrawledPage[];
}

/**
 * B4：把首段產品清單對齊到「有對應爬取專頁」的頁（≤max）。純函式，供單測。
 * 優先 `productUrl` 完全命中爬取頁（正規化 URL 相等）；否則正規化產品名含式匹配頁 url/title
 * （名稱正規化長度 < PRODUCT_NAME_MIN_MATCH 則不做名稱匹配，避免短 token 誤配全站）。
 * nearby＝其餘同名（含式匹配）頁（≤PRODUCT_DETAIL_NEARBY_MAX，供聚焦抽取補鄰近脈絡）。
 */
export function matchProductsToPages(
  products: { name?: string; productUrl?: string }[],
  pages: CrawledPage[],
  max = PRODUCT_DETAIL_MAX_PAGES,
): ProductPageMatch[] {
  const matches: ProductPageMatch[] = [];
  for (let i = 0; i < products.length; i++) {
    if (matches.length >= max) break;
    const p = products[i]!;
    const name = cleanStr(p.name);
    if (!name) continue;
    let page: CrawledPage | undefined;
    // 1) productUrl 完全命中爬取頁
    const purl = cleanStr(p.productUrl);
    if (purl) {
      const target = normUrlForMatch(purl);
      page = pages.find((pg) => normUrlForMatch(pg.url) === target);
    }
    // 2) 正規化名稱含式匹配頁 url/title
    const nname = normalizeProductName(name);
    if (!page && nname.length >= PRODUCT_NAME_MIN_MATCH) {
      page = pages.find((pg) => normalizeProductName(`${pg.url} ${pg.title ?? ""}`).includes(nname));
    }
    if (!page) continue;
    const matchedUrl = page.url;
    const nearby =
      nname.length >= PRODUCT_NAME_MIN_MATCH
        ? pages
            .filter((pg) => pg.url !== matchedUrl && normalizeProductName(`${pg.url} ${pg.title ?? ""}`).includes(nname))
            .slice(0, PRODUCT_DETAIL_NEARBY_MAX)
        : [];
    matches.push({ productIndex: i, page, nearby });
  }
  return matches;
}

/** B4：對單一產品的專頁（＋鄰近頁）跑聚焦抽取，回 rich Partial<CompanyProduct>。失敗上拋（呼叫端容忍）。 */
async function extractOneProductDetail(
  gemini: GeminiClient,
  extractModel: string | undefined,
  productName: string,
  page: CrawledPage,
  nearby: CrawledPage[],
): Promise<Partial<CompanyProduct> | undefined> {
  const parts = [`PRODUCT NAME: ${productName}`, "", `=== PRIMARY PAGE: ${page.url} ===`, page.text.slice(0, PER_PAGE_MAX_CHARS)];
  for (const nb of nearby) {
    parts.push("", `=== RELATED PAGE: ${nb.url} ===`, nb.text.slice(0, PER_PAGE_MAX_CHARS));
  }
  const prompt = parts.join("\n").slice(0, MAX_PROMPT_CHARS);
  const ex = await gemini.generateJson<ExtractedProduct>({
    model: extractModel,
    system: PRODUCT_DETAIL_SYSTEM,
    prompt,
    schema: PRODUCT_DETAIL_SCHEMA,
    maxOutputTokens: PRODUCT_DETAIL_MAX_OUTPUT_TOKENS,
    thinkingBudget: PRODUCT_DETAIL_THINKING_BUDGET,
    temperature: EXTRACT_TEMPERATURE,
  });
  // 聚焦抽取不請 imageUrls → 空白名單即可（不影響其餘欄位）。
  return foldProduct(ex, EMPTY_WHITELIST);
}

/**
 * B4 merge：把聚焦抽取的 detail 併回 base 產品——純量 fill-empty（不覆寫既有非空）、陣列 union 去重、
 * keyFeatures 依名稱 union、specs 依 key union（既有 key 不覆寫）。就地變異 base。
 */
function mergeProductDetail(base: Partial<CompanyProduct>, detail: Partial<CompanyProduct>): void {
  const isEmpty = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const scalarKeys: (keyof CompanyProduct)[] = [
    "model", "category", "oneLiner", "oneLinerZh", "description", "descriptionZh",
    "pricingModel", "priceFrom", "currency", "pricingNotes", "targetMarket",
  ];
  for (const k of scalarKeys) {
    if (isEmpty(base[k]) && !isEmpty(detail[k])) (base as Record<string, unknown>)[k] = detail[k];
  }
  const arrKeys: (keyof CompanyProduct)[] = ["differentiators", "competitors", "integrations", "techStack", "targetPersonas"];
  for (const k of arrKeys) {
    const merged = unionStrArr(base[k] as string[] | undefined, detail[k] as string[] | undefined);
    if (merged) (base as Record<string, unknown>)[k] = merged;
  }
  // keyFeatures：依名稱（lowercase）union，既有優先、補新名。
  if (detail.keyFeatures && detail.keyFeatures.length > 0) {
    const seen = new Set((base.keyFeatures ?? []).map((f) => f.name.toLowerCase()));
    const add = detail.keyFeatures.filter((f) => f.name && !seen.has(f.name.toLowerCase()));
    if (add.length > 0) base.keyFeatures = [...(base.keyFeatures ?? []), ...add];
  }
  // specs：依 key union（既有 key 不覆寫）。
  if (detail.specs && Object.keys(detail.specs).length > 0) {
    base.specs = { ...detail.specs, ...(base.specs ?? {}) };
  }
  const media = unionStrArr(base.mediaUrls, detail.mediaUrls);
  if (media) base.mediaUrls = media;
}

/**
 * B4：二段式 per-product 聚焦補抽。對「有對應爬取專頁」的產品（≤10）逐一跑聚焦抽取（並行 ≤3），
 * 回傳 rich 欄位以 fill-empty + 陣列 union 併回既有產品（不覆寫既有非空值）。
 * 失敗容忍：單品失敗只略過該品、不影響其餘與全局。gemini 未設定/無頁/無產品 → 原樣返回。
 * 回新陣列（就地複製產品，不變異入參）。由 orchestrator 在站點抽取完成後對 standard 與 deep 兩路徑呼叫。
 */
export async function enrichProductDetails(
  gemini: GeminiClient,
  extractModel: string | undefined,
  products: Partial<CompanyProduct>[],
  raw: RawCrawl,
): Promise<Partial<CompanyProduct>[]> {
  if (!gemini.isConfigured() || !Array.isArray(products) || products.length === 0) return products;
  if (!raw?.pages || raw.pages.length === 0) return products;
  const out = products.map((p) => ({ ...p }));
  const matches = matchProductsToPages(out, raw.pages);
  if (matches.length === 0) return out;
  let idx = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = idx++;
      if (i >= matches.length) return;
      const m = matches[i]!;
      const base = out[m.productIndex]!;
      const name = cleanStr(base.name);
      if (!name) continue;
      try {
        const detail = await extractOneProductDetail(gemini, extractModel, name, m.page, m.nearby);
        if (detail) mergeProductDetail(base, detail);
      } catch (e) {
        console.error(`[extract:product-detail] "${name}" failed (non-fatal):`, e);
      }
    }
  };
  const n = Math.min(PRODUCT_DETAIL_CONCURRENCY, matches.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return out;
}

/** 模型 techStack → NewCompanyTech[]（去空、上限 MAX_TECH）。至少要有 vendor/product/category 之一才成一列。 */
function toTechStack(items: ExtractedTech[] | undefined): NewCompanyTech[] {
  if (!Array.isArray(items)) return [];
  const out: NewCompanyTech[] = [];
  for (const t of items) {
    const category = typeof t?.category === "string" ? t.category.trim() : "";
    const vendor = typeof t?.vendor === "string" ? t.vendor.trim() : "";
    const product = typeof t?.product === "string" ? t.product.trim() : "";
    const detectedFrom = typeof t?.detectedFrom === "string" ? t.detectedFrom.trim() : "";
    if (!category && !vendor && !product) continue; // 純 detectedFrom 無資訊 → 跳過
    const row: NewCompanyTech = { confidence: CRAWL_CONFIDENCE };
    if (category) row.category = category;
    if (vendor) row.vendor = vendor;
    if (product) row.product = product;
    if (detectedFrom) row.detectedFrom = detectedFrom;
    out.push(row);
    if (out.length >= MAX_TECH) break;
  }
  return out;
}

/** 模型 departments → NewCompanyDepartment[]（name 必填、去空、上限 MAX_DEPARTMENTS）。 */
function toDepartments(items: ExtractedDepartment[] | undefined): NewCompanyDepartment[] {
  if (!Array.isArray(items)) return [];
  const out: NewCompanyDepartment[] = [];
  for (const d of items) {
    const name = typeof d?.name === "string" ? d.name.trim() : "";
    if (!name) continue;
    const row: NewCompanyDepartment = { name };
    if (typeof d.focus === "string" && d.focus.trim()) row.focus = d.focus.trim();
    if (typeof d.headcountEstimate === "number" && Number.isFinite(d.headcountEstimate) && d.headcountEstimate >= 0) {
      row.headcountEstimate = Math.round(d.headcountEstimate);
    }
    out.push(row);
    if (out.length >= MAX_DEPARTMENTS) break;
  }
  return out;
}

/**
 * 主管清單：先逐欄 cleanStr 去空字串（與 deep-extractor 一致），再對 photoUrl 過白名單驗證（防幻覺，契約三）。
 * Gemini 結構化輸出會對未填的 optional STRING 回空字串（""）——若原封落庫，fullNameZh/titleZh 等空 gloss
 * 會在 web 端經 `fullNameZh ?? fullName` 因「空字串非 nullish、不 fallback」蓋掉本來一定有值的 fullName，
 * 導致人物姓名/職稱顯示成空白。故此處把每個字串欄的空值刪除（＝落庫為 NULL），非空值 trim。
 * 回新物件（不變異模型輸出）。
 */
function sanitizeContacts(
  items: Partial<Contact>[] | undefined,
  imageWhitelist: ReadonlySet<string>,
): Partial<Contact>[] {
  if (!Array.isArray(items)) return [];
  return items.map((c) => {
    const out: Partial<Contact> = { ...c };
    for (const key of Object.keys(out) as (keyof Contact)[]) {
      const v = out[key];
      if (typeof v !== "string") continue; // enum/陣列/數值欄不動
      const cleaned = cleanStr(v);
      if (cleaned === undefined) delete out[key]; // 空字串 gloss → 刪除（落庫 NULL；勿蓋 web 端 `??` fallback）
      else (out as Record<string, unknown>)[key] = cleaned;
    }
    const photo = validatePhotoUrl(out.photoUrl, imageWhitelist);
    if (photo) out.photoUrl = photo;
    else delete out.photoUrl; // 幻覺照片 URL（不在爬到清單）→ 丟棄
    return out;
  });
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
    async toCompany(raw: RawCrawl): Promise<CompanyExtraction> {
      const ex = await extract(raw);
      const sourceUrl = cleanUrl(raw.finalUrl ?? raw.url) ?? (raw.finalUrl ?? raw.url);
      // 圖片白名單（防幻覺，契約三）：products[].imageUrls / contacts[].photoUrl 只認確實爬到的圖片 URL。
      const imageWhitelist = buildImageWhitelist(raw);
      // techStack/departments 由模型掛在 company 下但屬子表 → 先拆出，勿讓其污染 company 欄位與 provenance。
      const exCompany: ExtractedCompany = ex.company ?? {};
      const { techStack: rawTech, departments: rawDepts, ...companyFields } = exCompany;
      const company: Partial<Company> = companyFields;
      // 正規化模型可能回傳的 URL 欄位（去尾端逗號等污染）。
      company.websiteUrl = cleanUrl(company.websiteUrl);
      company.logoUrl = cleanUrl(company.logoUrl) ?? company.logoUrl;
      // websiteUrl 缺就補上起始站，讓 upsert 有可寫的 domain 依據。
      if (!company.websiteUrl) company.websiteUrl = sourceUrl;
      // WP2：未歸類情報——standard 只有單一來源（本站），每條 sourceUrl＝站上 finalUrl（共用 dedupUncat）。
      const uncategorized = dedupUncat(ex.uncategorized, () => sourceUrl);
      const narrativeZh = cleanStr(ex.narrativeZh);
      return {
        company,
        contacts: sanitizeContacts(ex.contacts, imageWhitelist),
        products: toProducts(ex.products, imageWhitelist),
        news: ex.news ?? [],
        techStack: toTechStack(rawTech),
        departments: toDepartments(rawDepts),
        provenance: companyProvenance(company, sourceUrl),
        narrativeZh,
        uncategorized: uncategorized.length > 0 ? uncategorized : undefined,
      };
    },

    async toContacts(raw: RawCrawl): Promise<Partial<Contact>[]> {
      const ex = await extract(raw);
      // photoUrl 過白名單（防幻覺）；fullNameZh/titleZh 等字串欄 cleanStr 去空（見 sanitizeContacts）。
      return sanitizeContacts(ex.contacts, buildImageWhitelist(raw));
    },
  };
}
