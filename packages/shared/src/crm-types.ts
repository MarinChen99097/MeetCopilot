/**
 * CRM 契約型別（前端 ↔ 後端交界）＋ M1 完整 domain 實體。
 * 唯一真相來源＝API_CONTRACT §1-3（wire 形狀）與 CRM_SCHEMA §2-9（DDL）。
 * 命名：DB snake_case ↔ 此處 camelCase（repo 在邊界轉）；`*_json` 欄 → typed 陣列/物件；時間 epoch ms（number）；布林 0/1。
 * enum 一律 string-literal union，值對齊 CRM_SCHEMA 的 CHECK(col IN (...))。
 * crm/ports.ts 以 `import type` 引用本檔（型別限定，不產生 runtime/emit 耦合）。
 */

// ─────────────────────────────────────────────────────────────
// Enums（string-literal union，對齊 CRM_SCHEMA CHECK 值）
// ─────────────────────────────────────────────────────────────

/** 實體整列驗證 rollup（CRM_SCHEMA：`verified_status`）。逐欄把關仍看 field_provenance。 */
export type VerifiedStatus = "none" | "partial" | "verified";

/** provenance 一列的填寫者（CRM_SCHEMA §8 `field_provenance.filled_by`）。 */
export type FilledBy = "crawler" | "human" | "llm" | "import";

/** SQLite 布林（0/1）。provenance.verified、email_verified 等共用。 */
export type Bool01 = 0 | 1;

/** 帳戶狀態（companies.account_status，CRM_SCHEMA §4）。 */
export type AccountStatus = "prospect" | "active" | "customer" | "churned";

/** 主管資歷（contacts.seniority，CRM_SCHEMA §5）。 */
export type Seniority = "c_level" | "vp" | "director" | "manager" | "ic" | "founder" | "board";

/** 採購決策角色（contacts.decision_power / deal_contacts.role，CRM_SCHEMA §5/§6）。 */
export type DecisionPower =
  | "economic_buyer"
  | "champion"
  | "influencer"
  | "gatekeeper"
  | "user"
  | "blocker"
  | "unknown";

/** 據點類型（company_locations.type，CRM_SCHEMA §4）。 */
export type CompanyLocationType = "hq" | "office" | "branch" | "remote";

/** 新聞分類（company_news.category，CRM_SCHEMA §4）。 */
export type CompanyNewsCategory =
  | "funding"
  | "product"
  | "exec_change"
  | "mna"
  | "partnership"
  | "legal"
  | "financial"
  | "other";

/** 對方產品狀態（company_products.status，CRM_SCHEMA §4）。 */
export type CompanyProductStatus = "active" | "beta" | "deprecated" | "rumored";

/** 產品↔人 角色（company_product_people.role，CRM_SCHEMA §4）。 */
export type ProductPersonRole =
  | "developer"
  | "engineer"
  | "pm"
  | "product_owner"
  | "designer"
  | "architect"
  | "sales"
  | "support"
  | "exec_sponsor"
  | "other";

/** 商機階段（deals.stage，CRM_SCHEMA §6）。 */
export type DealStage =
  | "prospect"
  | "discovery"
  | "demo"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

/** 商機狀態（deals.status，CRM_SCHEMA §6）。 */
export type DealStatus = "open" | "won" | "lost";

/** 商機類型（deals.deal_type，CRM_SCHEMA §6）。 */
export type DealType = "new" | "expansion" | "renewal";

/** 採購委員會成員立場（deal_contacts.stance，CRM_SCHEMA §6）。 */
export type DealContactStance = "supporter" | "neutral" | "detractor";

/** 筆記所屬實體（notes.entity_type，CRM_SCHEMA §8）。 */
export type NoteEntityType = "company" | "contact" | "deal" | "meeting";

/**
 * 筆記類型（notes.note_type，CRM_SCHEMA §8）。
 * general/call/email/research＝使用者可經 API 建立；narrative/observations＝研究引擎產出的單例 AI 筆記
 * （migration 013 已放寬 CHECK；orchestrator writeSingletonNotes 落庫），非 API 可建，但讀取端需辨識。
 */
export type NoteType = "general" | "call" | "email" | "research" | "narrative" | "observations";

/** 活動類型（activities.type，CRM_SCHEMA §8）。 */
export type ActivityType = "email" | "call" | "meeting" | "linkedin" | "task" | "note" | "crawl";

/** 活動方向（activities.direction，CRM_SCHEMA §8）。 */
export type ActivityDirection = "inbound" | "outbound" | "internal";

/** enrichment 目標（crawl_jobs.target_type，CRM_SCHEMA §8）。 */
export type CrawlTargetType = "company" | "contact";

/**
 * 爬蟲/研究模式（crawl_jobs.mode，CRM_SCHEMA §8）：
 *  - quick＝會中單頁；detailed＝會前爬官網＋子頁；
 *  - deep＝全網深度研究（Google-Search grounding 扇出 + 讀取新聞/維基/公開檔 + 官網爬蟲），不鎖官網。
 */
export type CrawlMode = "quick" | "detailed" | "deep";

/** enrichment job 狀態（crawl_jobs.status，CRM_SCHEMA §8；同 API_CONTRACT §3）。 */
export type CrawlJobStatus = "queued" | "running" | "done" | "failed";

/** 成員角色（memberships.role，CRM_SCHEMA §2；API_CONTRACT §1 /api/auth/me `role`）。 */
export type MembershipRole = "owner" | "admin" | "member";

// ─────────────────────────────────────────────────────────────
// 半結構化 JSON 子形狀（repo 在邊界 parse `*_json` 欄）
// ─────────────────────────────────────────────────────────────

/** 任意 JSON 物件（rawCrawl / customFields / specs / decisionCriteria 等自由欄）。 */
export type JsonObject = Record<string, unknown>;

/** 功能項（company_products.key_features_json / products.key_features_json）。名稱避開 slide-spec 的 FeatureItem。 */
export interface ProductFeature {
  name: string;
  detail?: string;
  benefit?: string;
}

/** 前職經歷（contacts.previous_companies_json）。 */
export interface PreviousCompany {
  company?: string;
  title?: string;
  years?: string;
}

/** 已提出的異議（contacts.objections_raised_json，多半來自會議）。 */
export interface ObjectionRaised {
  objection: string;
  context?: string;
  meetingId?: string;
  status?: string;
}

// ─────────────────────────────────────────────────────────────
// 對方公司 — companies（CRM_SCHEMA §4）
// ─────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  orgId: string;
  // ── 身分 ──
  name: string;
  legalName?: string;
  aka?: string[];
  domain?: string;
  websiteUrl?: string;
  logoUrl?: string;
  description?: string;
  /** 繁中(zh-TW)精簡簡介（擷取時另產；不覆寫來源語言的 description）。 */
  descriptionZh?: string;
  tagline?: string;
  // ── 分類 ──
  industry?: string;
  subIndustries?: string[];
  naicsSic?: string[];
  businessModel?: string;
  keywords?: string[];
  // ── 規模/財務 ──
  foundedYear?: number;
  ownershipType?: string;
  stockTicker?: string;
  employeeCount?: number;
  employeeRange?: string;
  employeeGrowthYoy?: number;
  annualRevenue?: number;
  revenueRange?: string;
  currency?: string;
  fundingTotal?: number;
  fundingStage?: string;
  lastFundingAt?: number;
  lastFundingAmount?: number;
  valuation?: number;
  investors?: string[];
  // ── 聯絡/社群 ──
  hqCountry?: string;
  hqRegion?: string;
  hqCity?: string;
  hqAddress?: string;
  timezone?: string;
  phoneMain?: string;
  emailGeneral?: string;
  socialLinkedin?: string;
  socialTwitter?: string;
  socialFacebook?: string;
  socialYoutube?: string;
  socialCrunchbase?: string;
  socialGithub?: string;
  languages?: string[];
  // ── 副駕會浮出的公開情報 ──
  productsOffered?: string[];
  keyCustomers?: string[];
  certifications?: string[];
  awards?: string[];
  hiringSignals?: string[];
  recentNewsSummary?: string;
  // ── 銷售情報 ──
  painPoints?: string[];
  strategicInitiatives?: string[];
  buyingTriggers?: string[];
  currentVendors?: string[];
  // ── 帳戶管理 ──
  fitScore?: number;
  fitReasons?: string[];
  accountTier?: string;
  accountStatus?: AccountStatus;
  lifecycleStage?: string;
  leadSource?: string;
  ownerUserId?: string;
  // ── 爬蟲簿記 + 驗證 ──
  source?: string;
  crawlConfidence?: number;
  lastCrawledAt?: number;
  lastEnrichedAt?: number;
  verifiedStatus: VerifiedStatus;
  verifiedBy?: string;
  verifiedAt?: number;
  rawCrawl?: JsonObject;
  customFields?: JsonObject;
  createdAt: number;
  updatedAt: number;
}

// ── 對方子表 ──

/** company_locations（CRM_SCHEMA §4）。 */
export interface CompanyLocation {
  id: string;
  orgId: string;
  companyId: string;
  type?: CompanyLocationType;
  country?: string;
  region?: string;
  city?: string;
  address?: string;
  isPrimary?: Bool01;
  createdAt: number;
}

/** company_news（CRM_SCHEMA §4；副駕最佳訊號之一）。 */
export interface CompanyNews {
  id: string;
  orgId: string;
  companyId: string;
  title: string;
  /** 繁中(zh-TW)精簡標題（擷取時另產；不覆寫來源語言的 title）。 */
  titleZh?: string;
  url?: string;
  source?: string;
  publishedAt?: number;
  summary?: string;
  /** 繁中(zh-TW)精簡摘要（擷取時另產；不覆寫來源語言的 summary）。 */
  summaryZh?: string;
  category?: CompanyNewsCategory;
  sentiment?: number;
  relevance?: number;
  embedded?: Bool01;
  createdAt: number;
}

/** company_funding_rounds（CRM_SCHEMA §4）。 */
export interface CompanyFunding {
  id: string;
  orgId: string;
  companyId: string;
  roundType?: string;
  amount?: number;
  currency?: string;
  announcedAt?: number;
  leadInvestor?: string;
  investors?: string[];
  sourceUrl?: string;
  createdAt: number;
}

/** company_tech（CRM_SCHEMA §4；BuiltWith/Wappalyzer 風）。 */
export interface CompanyTech {
  id: string;
  orgId: string;
  companyId: string;
  category?: string;
  vendor?: string;
  product?: string;
  detectedFrom?: string;
  confidence?: number;
  firstSeenAt?: number;
  lastSeenAt?: number;
  createdAt: number;
}

/** company_products（CRM_SCHEMA §4；crawler-heavy 對方產品深檔）。 */
export interface CompanyProduct {
  id: string;
  orgId: string;
  companyId: string;
  // ── 身分/分類 ──
  name: string;
  category?: string;
  oneLiner?: string;
  /** 繁中(zh-TW)一句話定位（擷取時另產；不覆寫來源語言的 oneLiner）。 */
  oneLinerZh?: string;
  description?: string;
  /** 繁中(zh-TW)精簡描述（擷取時另產；不覆寫來源語言的 description）。 */
  descriptionZh?: string;
  status?: CompanyProductStatus;
  launchedYear?: number;
  productUrl?: string;
  docsUrl?: string;
  // ── 定價 ──
  pricingModel?: string;
  priceFrom?: number;
  currency?: string;
  pricingNotes?: string;
  // ── 產品細節 ──
  keyFeatures?: ProductFeature[];
  specs?: JsonObject;
  techStack?: string[];
  integrations?: string[];
  targetMarket?: string;
  targetPersonas?: string[];
  differentiators?: string[];
  competitors?: string[];
  knownIssues?: string[];
  roadmap?: unknown[];
  mediaUrls?: string[];
  notes?: string;
  // ── 爬蟲簿記 + 驗證 ──
  source?: string;
  crawlConfidence?: number;
  lastCrawledAt?: number;
  verifiedStatus: VerifiedStatus;
  verifiedBy?: string;
  verifiedAt?: number;
  rawCrawl?: JsonObject;
  customFields?: JsonObject;
  createdAt: number;
  updatedAt: number;
}

/** company_product_people（CRM_SCHEMA §4；產品↔人 join，低信心、需人驗）。 */
export interface CompanyProductPerson {
  id: string;
  orgId: string;
  companyId: string;
  productId: string;
  contactId: string;
  role: ProductPersonRole;
  titleOnProduct?: string;
  isCurrent?: Bool01;
  source?: string;
  confidence?: number;
  notes?: string;
  createdAt: number;
}

/** company_departments（CRM_SCHEMA §4；parent_department_id 自參照撐組織樹）。 */
export interface CompanyDepartment {
  id: string;
  orgId: string;
  companyId: string;
  name: string;
  parentDepartmentId?: string;
  headContactId?: string;
  headcountEstimate?: number;
  focus?: string;
  notes?: string;
  source?: string;
  confidence?: number;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// 對方主管 — contacts（CRM_SCHEMA §5）
// ─────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  orgId: string;
  companyId: string;
  // ── 身分 ──
  fullName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  pronouns?: string;
  photoUrl?: string;
  // ── 角色 ──
  title?: string;
  /** 繁中(zh-TW)精簡頭銜（擷取時另產；不覆寫來源語言的 title）。 */
  titleZh?: string;
  titleNormalized?: string;
  roleCategory?: string;
  department?: string;
  seniority?: Seniority;
  reportsToContactId?: string;
  tenureStartAt?: number;
  // ── 觸達 ──
  email?: string;
  emailVerified?: Bool01;
  phone?: string;
  locationCountry?: string;
  locationCity?: string;
  timezone?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  githubUrl?: string;
  personalWebsite?: string;
  // ── 背景 ──
  bio?: string;
  backgroundSummary?: string;
  /** 繁中(zh-TW)精簡背景簡介（擷取時另產；不覆寫來源語言的 backgroundSummary）。 */
  backgroundSummaryZh?: string;
  previousCompanies?: PreviousCompany[];
  education?: unknown[];
  skills?: string[];
  certifications?: string[];
  publicationsTalks?: unknown[];
  interests?: string[];
  // ── PERSONA（副駕高價值；多半 human + 會議衍生）──
  knownPriorities?: string[];
  goalsKpis?: string[];
  hotButtons?: string[];
  painPoints?: string[];
  objectionsRaised?: ObjectionRaised[];
  communicationStyle?: string;
  commStyleNotes?: string;
  decisionStyle?: string;
  preferredChannel?: string;
  personalityNotes?: string;
  // ── 關係 / 採購角色 ──
  isDecisionMaker?: Bool01;
  decisionPower?: DecisionPower;
  influenceLevel?: number;
  relationshipStatus?: string;
  relationshipStrength?: number;
  sentiment?: number;
  personalNotes?: string;
  nextStep?: string;
  doNotContact?: Bool01;
  lastInteractionAt?: number;
  ownerUserId?: string;
  // ── 爬蟲簿記 + 驗證 ──
  source?: string;
  crawlConfidence?: number;
  lastCrawledAt?: number;
  verifiedStatus: VerifiedStatus;
  verifiedBy?: string;
  verifiedAt?: number;
  rawCrawl?: JsonObject;
  customFields?: JsonObject;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────
// Deals / 商機（CRM_SCHEMA §6）
// ─────────────────────────────────────────────────────────────

export interface Deal {
  id: string;
  orgId: string;
  companyId: string;
  name: string;
  stage: DealStage;
  status: DealStatus;
  amount?: number;
  currency?: string;
  probability?: number;
  forecastCategory?: string;
  dealType?: DealType;
  expectedCloseAt?: number;
  actualCloseAt?: number;
  ownerUserId?: string;
  primaryContactId?: string;
  economicBuyerContactId?: string;
  championContactId?: string;
  competitors?: string[];
  decisionCriteria?: string[];
  decisionProcess?: string;
  pain?: string;
  budget?: string;
  timeline?: string;
  nextStep?: string;
  closeReason?: string;
  healthScore?: number;
  riskFlags?: string[];
  createdAt: number;
  updatedAt: number;
}

/** deal_contacts（CRM_SCHEMA §6；採購委員會 join，(deal_id, contact_id) 複合鍵）。 */
export interface DealContact {
  orgId: string;
  dealId: string;
  contactId: string;
  role?: DecisionPower;
  stance?: DealContactStance;
  influence?: number;
  notes?: string;
}

// ─────────────────────────────────────────────────────────────
// 橫切：notes / activities（CRM_SCHEMA §8）
// ─────────────────────────────────────────────────────────────

/** notes（多型自由筆記）。 */
export interface Note {
  id: string;
  orgId: string;
  entityType: NoteEntityType;
  entityId: string;
  authorUserId?: string;
  body: string;
  noteType?: NoteType;
  pinned?: Bool01;
  createdAt: number;
  updatedAt: number;
}

/** activities（時間軸/觸點；撐 last_interaction_at）。 */
export interface Activity {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  dealId?: string;
  contactId?: string;
  type: ActivityType;
  direction?: ActivityDirection;
  subject?: string;
  bodySummary?: string;
  occurredAt?: number;
  userId?: string;
  outcome?: string;
  createdAt: number;
}

// ─────────────────────────────────────────────────────────────
// 信任層 — field_provenance（CRM_SCHEMA §8）
// ─────────────────────────────────────────────────────────────

/**
 * 欄位溯源讀取形狀（API_CONTRACT §2 Provenance：GET /api/crm/provenance）。
 * 每欄取未 superseded 最新一筆——供 UI「確認/細填」徽章與副駕逐欄信任判準。
 */
export interface FieldProvenance {
  fieldName: string;
  valueSnapshot: string; // scalar 或 JSON 字串快照
  filledBy: FilledBy;
  sourceType?: string;
  sourceUrl?: string;
  confidence?: number; // 0..1（human 填則常為 undefined＝隱含權威）
  verified: Bool01;
  createdAt: number; // epoch ms
}

/**
 * provenance 寫入輸入（ProvenanceRepository.record；crawl/human/會議衍生）。
 * value_snapshot 存寫入的值；filled_by 決定信任；superseded_by 由 repo 於覆寫時填。
 */
export interface NewProvenance {
  entityType: string; // company/contact/deal/company_news/…（多型）
  entityId: string;
  fieldName: string;
  valueSnapshot?: string;
  filledBy: FilledBy;
  sourceType?: string;
  sourceUrl?: string;
  sourceDetail?: string;
  confidence?: number;
  model?: string;
  verified?: Bool01;
  verifiedBy?: string;
  verifiedAt?: number;
}

// ─────────────────────────────────────────────────────────────
// 檢索層 — embeddings / profile_cards（CRM_SCHEMA §9）
// ─────────────────────────────────────────────────────────────

/** embeddings 一列（向量索引；embedding 為 number[]，repo 在邊界 parse JSON）。 */
export interface Embedding {
  id: string;
  orgId: string;
  entityType: string; // company_card/contact_card/company_news/transcript_chunk/…
  entityId: string;
  chunkIndex: number;
  content: string;
  contentHash: string;
  embedding: number[];
  dims: number;
  model: string;
  tokenCount?: number;
  createdAt: number;
  updatedAt: number;
}

/** embeddings 寫入輸入（EmbeddingRepository.upsert；content_hash 去重）。 */
export interface NewEmbedding {
  entityType: string;
  entityId: string;
  chunkIndex?: number; // 缺省 0
  content: string;
  contentHash: string;
  embedding: number[];
  dims: number;
  model: string;
  tokenCount?: number;
}

/** profile_cards（副駕與 UI 共用的衍生卡片文字；built_from_hash 守重生）。 */
export interface ProfileCard {
  id: string;
  orgId: string;
  entityType: string;
  entityId: string;
  cardMarkdown: string;
  builtFromHash: string;
  modelVersion?: string;
  createdAt: number;
  updatedAt: number;
}

/** profile_cards 寫入輸入（ProfileCardRepository.upsert）。 */
export interface NewProfileCard {
  entityType: string;
  entityId: string;
  cardMarkdown: string;
  builtFromHash: string;
  modelVersion?: string;
}

// ─────────────────────────────────────────────────────────────
// enrichment 執行追蹤 — crawl_jobs（CRM_SCHEMA §8）
// ─────────────────────────────────────────────────────────────

export interface CrawlJob {
  id: string;
  orgId: string;
  targetType: CrawlTargetType;
  targetId: string;
  targetDomain?: string;
  mode: CrawlMode;
  status: CrawlJobStatus;
  requestedBy?: string;
  startedAt?: number;
  finishedAt?: number;
  sources?: string[]; // 打過的 URLs
  fieldsFilled?: number;
  error?: string;
  rawResultRef?: string;
  createdAt: number;
}

/** crawl_jobs 建立輸入（研究引擎編排 POST /api/research/enrich）。 */
export interface NewCrawlJob {
  targetType: CrawlTargetType;
  targetId: string;
  targetDomain?: string;
  mode: CrawlMode;
  requestedBy?: string;
}

// ─────────────────────────────────────────────────────────────
// 清單摘要形狀（API_CONTRACT §2）
// ─────────────────────────────────────────────────────────────

/** 公司清單摘要（GET /api/crm/companies）。 */
export interface CompanySummary {
  id: string;
  name: string;
  domain?: string;
  industry?: string;
  logoUrl?: string;
  accountStatus?: AccountStatus;
  verifiedStatus: VerifiedStatus;
  crawlConfidence?: number; // 0..1
  lastCrawledAt?: number; // epoch ms
  ownerUserId?: string;
}

/** 主管清單摘要（GET /api/crm/companies/:id/contacts）。 */
export interface ContactSummary {
  id: string;
  companyId: string;
  fullName: string;
  title?: string;
  seniority?: Seniority;
  decisionPower?: DecisionPower;
  verifiedStatus: VerifiedStatus;
  photoUrl?: string;
}

/** 產品↔人 展開（GET /api/crm/products/:id/people）。 */
export interface ProductPersonLink {
  contact: ContactSummary;
  role: ProductPersonRole;
  titleOnProduct?: string;
  confidence?: number;
}

// ─────────────────────────────────────────────────────────────
// 建立輸入（New*）— id/orgId/系統簿記由 repo 生成
// ─────────────────────────────────────────────────────────────

/** 系統管理欄位（repo 生成，建立輸入一律 Omit）。 */
type SystemFields = "id" | "orgId" | "createdAt" | "updatedAt" | "verifiedStatus";

/** 建立公司（companyId 由 repo 生成；name 必填，其餘可選）。API POST 只給 {name,domain?,websiteUrl?}。 */
export type NewCompany = Partial<Omit<Company, SystemFields>> & { name: string };

/** 建立主管（companyId 由方法參數帶入，不在 input）。 */
export type NewContact = Partial<Omit<Contact, SystemFields | "companyId">> & { fullName: string };

/** 建立對方產品（companyId 由方法參數帶入）。 */
export type NewCompanyProduct = Partial<Omit<CompanyProduct, SystemFields | "companyId">> & {
  name: string;
};

/** 產品↔人 關聯建立（productId/companyId 由方法參數帶入）。 */
export interface NewCompanyProductPerson {
  contactId: string;
  role: ProductPersonRole;
  titleOnProduct?: string;
  isCurrent?: Bool01;
  source?: string;
  confidence?: number;
  notes?: string;
}

/** 建立部門（companyId 由方法參數帶入）。 */
export type NewCompanyDepartment = Partial<
  Omit<CompanyDepartment, "id" | "orgId" | "companyId" | "createdAt" | "updatedAt">
> & { name: string };

/** 子表 bulkUpsert 輸入（爬蟲寫入用；companyId 由方法參數帶入）。 */
export type NewCompanyNews = Partial<Omit<CompanyNews, "id" | "orgId" | "companyId" | "createdAt">> & {
  title: string;
};
export type NewCompanyLocation = Partial<
  Omit<CompanyLocation, "id" | "orgId" | "companyId" | "createdAt">
>;
export type NewCompanyFunding = Partial<
  Omit<CompanyFunding, "id" | "orgId" | "companyId" | "createdAt">
>;
export type NewCompanyTech = Partial<Omit<CompanyTech, "id" | "orgId" | "companyId" | "createdAt">>;

/** 建立商機（stage/status 可省，repo 帶預設）。 */
export type NewDeal = Partial<Omit<Deal, SystemFields>> & { name: string };

/** 採購委員會成員建立（dealId 由方法參數帶入）。 */
export interface NewDealContact {
  contactId: string;
  role?: DecisionPower;
  stance?: DealContactStance;
  influence?: number;
  notes?: string;
}

/** 建立筆記（多型 entityType+entityId）。 */
export interface NewNote {
  entityType: NoteEntityType;
  entityId: string;
  body: string;
  authorUserId?: string;
  noteType?: NoteType;
  pinned?: Bool01;
}

// ─────────────────────────────────────────────────────────────
// 爬蟲 → CRM 寫入 payload（upsertFromCrawl）
// ─────────────────────────────────────────────────────────────

/** 單欄 provenance 輸入（爬蟲填的每個值帶來源＋信心）。 */
export interface ProvenanceInput {
  fieldName: string;
  value: string;
  sourceUrl?: string;
  confidence?: number;
  /**
   * 來源類型（field_provenance.source_type）。可選、向後相容：detailed/quick 不帶 → repo 沿用預設
   * （company='company_website'、contact='linkedin'）。deep（全網研究）帶入真實來源分類
   * （'wikipedia'/'news'/'web'…），使 UI 徽章能標示「此資訊來自 <該外部來源>」而非官網。
   */
  sourceType?: string;
}

/**
 * 爬蟲→CRM 的公司級寫入 payload（CompanyRepository.upsertFromCrawl）。
 * 值與 provenance 於同一 tx 寫入（永不漂移）。
 */
export interface CrawlPayload {
  company: Partial<Company>;
  contacts?: Partial<Contact>[];
  products?: Partial<CompanyProduct>[];
  news?: Partial<CompanyNews>[];
  /**
   * 對方技術棧（company_tech 子表；deep/detailed 研究產）。型別對映 bulkUpsertTech 的入參
   * （NewCompanyTech＝Omit 系統欄後的 CompanyTech）。orchestrator 落庫時走 companyChildren.bulkUpsertTech。
   */
  techStack?: NewCompanyTech[];
  /**
   * 對方部門（company_departments 子表；deep/detailed 研究產）。型別對映 bulkUpsertDepartments 的入參
   * （NewCompanyDepartment）。orchestrator 落庫時走 companyChildren.bulkUpsertDepartments。
   */
  departments?: NewCompanyDepartment[];
  provenance: ProvenanceInput[];
}

/** 爬蟲→CRM 的單一主管寫入 payload（ContactRepository.upsertFromCrawl）。 */
export interface ContactCrawlPayload {
  contact: Partial<Contact>;
  provenance: ProvenanceInput[];
}
