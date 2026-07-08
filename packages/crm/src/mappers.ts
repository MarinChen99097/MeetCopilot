/**
 * row↔domain 映射工具（CRM_SCHEMA §0/§10：snake_case↔camelCase、`_json` parse/serialize、null↔undefined）。
 * 用「欄位規格表」(FieldDef[]) 驅動 map/insert/update，取代逐欄手寫——減少樣板與打字錯、易被 read-back 驗證。
 * kind: 'scalar'＝字串/數字/0-1 布林直存；'json'＝陣列/物件 存 TEXT(JSON)。sys＝系統管理欄，patch 寫入時跳過。
 */
import type { DbPort } from "./ports.js";
import { uuidv7 } from "./uuid.js";

export type FieldKind = "scalar" | "json";

export interface FieldDef {
  /** DB 欄位（snake_case）。 */
  col: string;
  /** domain 欄位（camelCase）。 */
  key: string;
  /** 預設 'scalar'。 */
  kind?: FieldKind;
  /** 系統管理欄（id/org_id/created_at/…）：patch/insert-from-input 一律跳過，由 repo 明確設定。 */
  sys?: boolean;
}

/** DB row（snake_case，值可能為 null）→ typed domain 物件（null 欄位省略＝undefined）。 */
export function rowToDomain<T>(row: Record<string, unknown>, defs: FieldDef[]): T {
  const out: Record<string, unknown> = {};
  for (const d of defs) {
    const v = row[d.col];
    if (v === null || v === undefined) continue;
    out[d.key] = d.kind === "json" ? JSON.parse(v as string) : v;
  }
  return out as T;
}

/**
 * domain patch（camelCase）→ `{ col: value }` record（snake_case，值已序列化）。
 * 只含 patch 有帶且非 sys 的欄位；null/undefined→SQL NULL；json→JSON.stringify。
 */
export function patchToRecord(patch: Record<string, unknown>, defs: FieldDef[]): Record<string, unknown> {
  const rec: Record<string, unknown> = {};
  for (const d of defs) {
    if (d.sys) continue;
    if (!(d.key in patch)) continue;
    const v = patch[d.key];
    if (v === undefined || v === null) rec[d.col] = null;
    else rec[d.col] = d.kind === "json" ? JSON.stringify(v) : v;
  }
  return rec;
}

/** 由 `{ col: value }` record 組 INSERT（欄名已是可信的內部常量，非使用者輸入）。 */
export async function insertRow(db: DbPort, table: string, rec: Record<string, unknown>): Promise<void> {
  const cols = Object.keys(rec);
  const placeholders = cols.map(() => "?").join(", ");
  await db.run(
    `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${placeholders})`,
    cols.map((c) => rec[c] ?? null),
  );
}

/** 由 `{ col: value }` record 組 UPDATE（org-scoped + id）。cols 空則 no-op。 */
export async function updateRow(
  db: DbPort,
  table: string,
  orgId: string,
  id: string,
  rec: Record<string, unknown>,
): Promise<void> {
  const cols = Object.keys(rec);
  if (cols.length === 0) return;
  await db.run(
    `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
    [...cols.map((c) => rec[c] ?? null), orgId, id],
  );
}

/** JS 暴力 cosine（CRM_SCHEMA §9：v1 pattern）。長度不符/零向量回 -1。 */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] as number;
    const bi = b[i] as number;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export { uuidv7 };

// ─────────────────────────────────────────────────────────────
// 欄位規格表（每張表一份，欄名嚴格對齊 migrations 002-006）
// ─────────────────────────────────────────────────────────────

const J: FieldKind = "json";

/** companies（003_prospect.sql）。 */
export const COMPANY_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "name", key: "name" },
  { col: "legal_name", key: "legalName" },
  { col: "aka_json", key: "aka", kind: J },
  { col: "domain", key: "domain" },
  { col: "website_url", key: "websiteUrl" },
  { col: "logo_url", key: "logoUrl" },
  { col: "description", key: "description" },
  { col: "description_zh", key: "descriptionZh" },
  { col: "tagline", key: "tagline" },
  { col: "industry", key: "industry" },
  { col: "sub_industries_json", key: "subIndustries", kind: J },
  { col: "naics_sic_json", key: "naicsSic", kind: J },
  { col: "business_model", key: "businessModel" },
  { col: "keywords_json", key: "keywords", kind: J },
  { col: "founded_year", key: "foundedYear" },
  { col: "ownership_type", key: "ownershipType" },
  { col: "stock_ticker", key: "stockTicker" },
  { col: "employee_count", key: "employeeCount" },
  { col: "employee_range", key: "employeeRange" },
  { col: "employee_growth_yoy", key: "employeeGrowthYoy" },
  { col: "annual_revenue", key: "annualRevenue" },
  { col: "revenue_range", key: "revenueRange" },
  { col: "currency", key: "currency" },
  { col: "funding_total", key: "fundingTotal" },
  { col: "funding_stage", key: "fundingStage" },
  { col: "last_funding_at", key: "lastFundingAt" },
  { col: "last_funding_amount", key: "lastFundingAmount" },
  { col: "valuation", key: "valuation" },
  { col: "investors_json", key: "investors", kind: J },
  { col: "hq_country", key: "hqCountry" },
  { col: "hq_region", key: "hqRegion" },
  { col: "hq_city", key: "hqCity" },
  { col: "hq_address", key: "hqAddress" },
  { col: "timezone", key: "timezone" },
  { col: "phone_main", key: "phoneMain" },
  { col: "email_general", key: "emailGeneral" },
  { col: "social_linkedin", key: "socialLinkedin" },
  { col: "social_twitter", key: "socialTwitter" },
  { col: "social_facebook", key: "socialFacebook" },
  { col: "social_youtube", key: "socialYoutube" },
  { col: "social_crunchbase", key: "socialCrunchbase" },
  { col: "social_github", key: "socialGithub" },
  { col: "languages_json", key: "languages", kind: J },
  { col: "products_offered_json", key: "productsOffered", kind: J },
  { col: "key_customers_json", key: "keyCustomers", kind: J },
  { col: "certifications_json", key: "certifications", kind: J },
  { col: "awards_json", key: "awards", kind: J },
  { col: "hiring_signals_json", key: "hiringSignals", kind: J },
  { col: "recent_news_summary", key: "recentNewsSummary" },
  { col: "pain_points_json", key: "painPoints", kind: J },
  { col: "strategic_initiatives_json", key: "strategicInitiatives", kind: J },
  { col: "buying_triggers_json", key: "buyingTriggers", kind: J },
  { col: "current_vendors_json", key: "currentVendors", kind: J },
  { col: "fit_score", key: "fitScore" },
  { col: "fit_reasons_json", key: "fitReasons", kind: J },
  { col: "account_tier", key: "accountTier" },
  { col: "account_status", key: "accountStatus" },
  { col: "lifecycle_stage", key: "lifecycleStage" },
  { col: "lead_source", key: "leadSource" },
  { col: "owner_user_id", key: "ownerUserId" },
  { col: "source", key: "source" },
  { col: "crawl_confidence", key: "crawlConfidence" },
  { col: "last_crawled_at", key: "lastCrawledAt" },
  { col: "last_enriched_at", key: "lastEnrichedAt" },
  { col: "verified_status", key: "verifiedStatus", sys: true },
  { col: "verified_by", key: "verifiedBy" },
  { col: "verified_at", key: "verifiedAt" },
  { col: "raw_crawl_json", key: "rawCrawl", kind: J },
  { col: "custom_fields_json", key: "customFields", kind: J },
  { col: "created_at", key: "createdAt", sys: true },
  { col: "updated_at", key: "updatedAt", sys: true },
];

/** contacts（004_contacts.sql）。 */
export const CONTACT_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "full_name", key: "fullName" },
  { col: "first_name", key: "firstName" },
  { col: "last_name", key: "lastName" },
  { col: "preferred_name", key: "preferredName" },
  { col: "pronouns", key: "pronouns" },
  { col: "photo_url", key: "photoUrl" },
  { col: "title", key: "title" },
  { col: "title_zh", key: "titleZh" },
  { col: "title_normalized", key: "titleNormalized" },
  { col: "role_category", key: "roleCategory" },
  { col: "department", key: "department" },
  { col: "seniority", key: "seniority" },
  { col: "reports_to_contact_id", key: "reportsToContactId" },
  { col: "tenure_start_at", key: "tenureStartAt" },
  { col: "email", key: "email" },
  { col: "email_verified", key: "emailVerified" },
  { col: "phone", key: "phone" },
  { col: "location_country", key: "locationCountry" },
  { col: "location_city", key: "locationCity" },
  { col: "timezone", key: "timezone" },
  { col: "linkedin_url", key: "linkedinUrl" },
  { col: "twitter_url", key: "twitterUrl" },
  { col: "github_url", key: "githubUrl" },
  { col: "personal_website", key: "personalWebsite" },
  { col: "bio", key: "bio" },
  { col: "background_summary", key: "backgroundSummary" },
  { col: "background_summary_zh", key: "backgroundSummaryZh" },
  { col: "previous_companies_json", key: "previousCompanies", kind: J },
  { col: "education_json", key: "education", kind: J },
  { col: "skills_json", key: "skills", kind: J },
  { col: "certifications_json", key: "certifications", kind: J },
  { col: "publications_talks_json", key: "publicationsTalks", kind: J },
  { col: "interests_json", key: "interests", kind: J },
  { col: "known_priorities_json", key: "knownPriorities", kind: J },
  { col: "goals_kpis_json", key: "goalsKpis", kind: J },
  { col: "hot_buttons_json", key: "hotButtons", kind: J },
  { col: "pain_points_json", key: "painPoints", kind: J },
  { col: "objections_raised_json", key: "objectionsRaised", kind: J },
  { col: "communication_style", key: "communicationStyle" },
  { col: "comm_style_notes", key: "commStyleNotes" },
  { col: "decision_style", key: "decisionStyle" },
  { col: "preferred_channel", key: "preferredChannel" },
  { col: "personality_notes", key: "personalityNotes" },
  { col: "is_decision_maker", key: "isDecisionMaker" },
  { col: "decision_power", key: "decisionPower" },
  { col: "influence_level", key: "influenceLevel" },
  { col: "relationship_status", key: "relationshipStatus" },
  { col: "relationship_strength", key: "relationshipStrength" },
  { col: "sentiment", key: "sentiment" },
  { col: "personal_notes", key: "personalNotes" },
  { col: "next_step", key: "nextStep" },
  { col: "do_not_contact", key: "doNotContact" },
  { col: "last_interaction_at", key: "lastInteractionAt" },
  { col: "owner_user_id", key: "ownerUserId" },
  { col: "source", key: "source" },
  { col: "crawl_confidence", key: "crawlConfidence" },
  { col: "last_crawled_at", key: "lastCrawledAt" },
  { col: "verified_status", key: "verifiedStatus", sys: true },
  { col: "verified_by", key: "verifiedBy" },
  { col: "verified_at", key: "verifiedAt" },
  { col: "raw_crawl_json", key: "rawCrawl", kind: J },
  { col: "custom_fields_json", key: "customFields", kind: J },
  { col: "created_at", key: "createdAt", sys: true },
  { col: "updated_at", key: "updatedAt", sys: true },
];

/** company_products（003_prospect.sql）。 */
export const COMPANY_PRODUCT_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "name", key: "name" },
  { col: "category", key: "category" },
  { col: "one_liner", key: "oneLiner" },
  { col: "one_liner_zh", key: "oneLinerZh" },
  { col: "description", key: "description" },
  { col: "description_zh", key: "descriptionZh" },
  { col: "status", key: "status" },
  { col: "launched_year", key: "launchedYear" },
  { col: "product_url", key: "productUrl" },
  { col: "docs_url", key: "docsUrl" },
  { col: "pricing_model", key: "pricingModel" },
  { col: "price_from", key: "priceFrom" },
  { col: "currency", key: "currency" },
  { col: "pricing_notes", key: "pricingNotes" },
  { col: "key_features_json", key: "keyFeatures", kind: J },
  { col: "specs_json", key: "specs", kind: J },
  { col: "tech_stack_json", key: "techStack", kind: J },
  { col: "integrations_json", key: "integrations", kind: J },
  { col: "target_market", key: "targetMarket" },
  { col: "target_personas_json", key: "targetPersonas", kind: J },
  { col: "differentiators_json", key: "differentiators", kind: J },
  { col: "competitors_json", key: "competitors", kind: J },
  { col: "known_issues_json", key: "knownIssues", kind: J },
  { col: "roadmap_json", key: "roadmap", kind: J },
  { col: "media_urls_json", key: "mediaUrls", kind: J },
  { col: "notes", key: "notes" },
  { col: "source", key: "source" },
  { col: "crawl_confidence", key: "crawlConfidence" },
  { col: "last_crawled_at", key: "lastCrawledAt" },
  { col: "verified_status", key: "verifiedStatus", sys: true },
  { col: "verified_by", key: "verifiedBy" },
  { col: "verified_at", key: "verifiedAt" },
  { col: "raw_crawl_json", key: "rawCrawl", kind: J },
  { col: "custom_fields_json", key: "customFields", kind: J },
  { col: "created_at", key: "createdAt", sys: true },
  { col: "updated_at", key: "updatedAt", sys: true },
];

/** company_news（003_prospect.sql；子表，只有 created_at）。 */
export const COMPANY_NEWS_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "title", key: "title" },
  { col: "title_zh", key: "titleZh" },
  { col: "url", key: "url" },
  { col: "source", key: "source" },
  { col: "published_at", key: "publishedAt" },
  { col: "summary", key: "summary" },
  { col: "summary_zh", key: "summaryZh" },
  { col: "category", key: "category" },
  { col: "sentiment", key: "sentiment" },
  { col: "relevance", key: "relevance" },
  { col: "embedded", key: "embedded" },
  { col: "created_at", key: "createdAt", sys: true },
];

/** company_locations（003_prospect.sql）。 */
export const COMPANY_LOCATION_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "type", key: "type" },
  { col: "country", key: "country" },
  { col: "region", key: "region" },
  { col: "city", key: "city" },
  { col: "address", key: "address" },
  { col: "is_primary", key: "isPrimary" },
  { col: "created_at", key: "createdAt", sys: true },
];

/** company_funding_rounds（003_prospect.sql）。 */
export const COMPANY_FUNDING_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "round_type", key: "roundType" },
  { col: "amount", key: "amount" },
  { col: "currency", key: "currency" },
  { col: "announced_at", key: "announcedAt" },
  { col: "lead_investor", key: "leadInvestor" },
  { col: "investors_json", key: "investors", kind: J },
  { col: "source_url", key: "sourceUrl" },
  { col: "created_at", key: "createdAt", sys: true },
];

/** company_tech（003_prospect.sql）。 */
export const COMPANY_TECH_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "category", key: "category" },
  { col: "vendor", key: "vendor" },
  { col: "product", key: "product" },
  { col: "detected_from", key: "detectedFrom" },
  { col: "confidence", key: "confidence" },
  { col: "first_seen_at", key: "firstSeenAt" },
  { col: "last_seen_at", key: "lastSeenAt" },
  { col: "created_at", key: "createdAt", sys: true },
];

/** company_departments（003_prospect.sql；有 updated_at）。 */
export const COMPANY_DEPARTMENT_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "name", key: "name" },
  { col: "parent_department_id", key: "parentDepartmentId" },
  { col: "head_contact_id", key: "headContactId" },
  { col: "headcount_estimate", key: "headcountEstimate" },
  { col: "focus", key: "focus" },
  { col: "notes", key: "notes" },
  { col: "source", key: "source" },
  { col: "confidence", key: "confidence" },
  { col: "created_at", key: "createdAt", sys: true },
  { col: "updated_at", key: "updatedAt", sys: true },
];

/** company_product_people（003_prospect.sql；只有 created_at）。 */
export const PRODUCT_PERSON_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId", sys: true },
  { col: "product_id", key: "productId", sys: true },
  { col: "contact_id", key: "contactId" },
  { col: "role", key: "role" },
  { col: "title_on_product", key: "titleOnProduct" },
  { col: "is_current", key: "isCurrent" },
  { col: "source", key: "source" },
  { col: "confidence", key: "confidence" },
  { col: "notes", key: "notes" },
  { col: "created_at", key: "createdAt", sys: true },
];

/** deals（005_deals_meetings.sql）。 */
export const DEAL_DEFS: FieldDef[] = [
  { col: "id", key: "id", sys: true },
  { col: "org_id", key: "orgId", sys: true },
  { col: "company_id", key: "companyId" },
  { col: "name", key: "name" },
  { col: "stage", key: "stage" },
  { col: "status", key: "status" },
  { col: "amount", key: "amount" },
  { col: "currency", key: "currency" },
  { col: "probability", key: "probability" },
  { col: "forecast_category", key: "forecastCategory" },
  { col: "deal_type", key: "dealType" },
  { col: "expected_close_at", key: "expectedCloseAt" },
  { col: "actual_close_at", key: "actualCloseAt" },
  { col: "owner_user_id", key: "ownerUserId" },
  { col: "primary_contact_id", key: "primaryContactId" },
  { col: "economic_buyer_contact_id", key: "economicBuyerContactId" },
  { col: "champion_contact_id", key: "championContactId" },
  { col: "competitors_json", key: "competitors", kind: J },
  { col: "decision_criteria_json", key: "decisionCriteria", kind: J },
  { col: "decision_process", key: "decisionProcess" },
  { col: "pain", key: "pain" },
  { col: "budget", key: "budget" },
  { col: "timeline", key: "timeline" },
  { col: "next_step", key: "nextStep" },
  { col: "close_reason", key: "closeReason" },
  { col: "health_score", key: "healthScore" },
  { col: "risk_flags_json", key: "riskFlags", kind: J },
  { col: "created_at", key: "createdAt", sys: true },
  { col: "updated_at", key: "updatedAt", sys: true },
];
