/**
 * packages/crm — 凍結的資料存取「接縫」（frozen seam）。
 * A2（core.ts / SqliteDbPort / repositories）與 A3（server auth/CRM 路由）都 **against 本檔的介面** 開發；
 * 本檔只放型別與介面，無 runtime 實作（見 CLAUDE.md 平行契約鎖定守則）。
 * 依據：CRM_SCHEMA §2（租戶身分表）、§10（DbPort async-first ＋ tx 陷阱、Repository 分層）。
 *
 * 分層原則：crm（持久層）**刻意不依賴 @meetcopilot/shared**（wire 契約層）——資料核心不該認得 API 契約。
 * 角色列舉在此本地定義，與 shared 的 `MembershipRole` 結構相同（'owner'|'admin'|'member'），跨接縫結構相容；
 * A2/A3 在 service/route 層對映兩者。
 */

// ─────────────────────────────────────────────────────────────
// Domain 型別來自 @meetcopilot/shared（B0 凍結）——**type-only import**：
// 型別限定引用不產生 runtime require / emit 耦合（tsconfig.base paths 於 typecheck 期解析到 shared/src）。
// crm 的持久層只認得 shared 的「資料實體」型別，不認得任何 wire/HTTP runtime。
// ─────────────────────────────────────────────────────────────
import type {
  Company,
  CompanySummary,
  NewCompany,
  CrawlPayload,
  Contact,
  ContactSummary,
  NewContact,
  ContactCrawlPayload,
  CompanyProduct,
  NewCompanyProduct,
  CompanyProductPerson,
  NewCompanyProductPerson,
  ProductPersonLink,
  CompanyNews,
  NewCompanyNews,
  CompanyLocation,
  NewCompanyLocation,
  CompanyFunding,
  NewCompanyFunding,
  CompanyTech,
  NewCompanyTech,
  CompanyDepartment,
  NewCompanyDepartment,
  Deal,
  NewDeal,
  DealContact,
  NewDealContact,
  DealStatus,
  Note,
  NewNote,
  NoteEntityType,
  FieldProvenance,
  NewProvenance,
  NewEmbedding,
  ProfileCard,
  NewProfileCard,
  // ── M2 Deck / DynamicSlide（B0 凍結；DeckRepository 實作＝M2 build agent）──
  Deck,
  DeckSummary,
  DeckSlide,
  NewDeck,
  ImageJob,
  NewImageJob,
  ImageJobUpdate,
  SlideSpec,
  // ── M4 語音模擬訓練（B0 凍結；TrainingRepository 實作＝M4 build agent）──
  TrainSession,
  NewTrainSession,
  TrainTurn,
  TrainReport,
  NewTrainReport,
  // ── M5 生產強化（本檔凍結；UsageRepository/InviteRepository/MemberRepository 實作＝M5 build agent）──
  NewUsageEvent,
  UsageRollup,
  Invite,
  NewInvite,
  OrgMember,
} from "@meetcopilot/shared";

/** 成員角色（memberships.role，CRM_SCHEMA §2）。結構等同 @meetcopilot/shared 的 MembershipRole。 */
export type Role = "owner" | "admin" | "member";

// ─────────────────────────────────────────────────────────────
// DbPort — 唯一知道資料庫引擎的東西（CRM_SCHEMA §10）
//
// **async-first**（2026-07-07 審查修正）：即便 SqliteDbPort 底層 better-sqlite3 是同步，
// 簽名一律回 Promise，如此日後換 pg 的 async driver **不動任何 repo / service**（「不動業務碼」的承諾）。
//  - SqliteDbPort：get/all/run 包同步呼叫後 `Promise.resolve`（零成本）。
//  - ⚠️ tx 陷阱：better-sqlite3 的 `db.transaction()` 是同步、內部不可 await——SqliteDbPort.tx 不要用它，
//    改手動 `BEGIN IMMEDIATE` → `await fn()` → `COMMIT`／出錯 `ROLLBACK`（單連線單進程下正確）。pg 版天然 async，同簽名成立。
// ─────────────────────────────────────────────────────────────
export interface DbPort {
  get<T>(sql: string, params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, params: unknown[]): Promise<T[]>;
  run(sql: string, params: unknown[]): Promise<{ changes: number }>;
  tx<T>(fn: () => Promise<T>): Promise<T>;
}

// ─────────────────────────────────────────────────────────────
// Domain 型別（租戶身分；CRM_SCHEMA §2）
// Repo 擁有 row↔domain 映射：snake_case↔camelCase、epoch-ms、_json parse。Service 從不見 SQL/JSON 字串。
// ─────────────────────────────────────────────────────────────

/** orgs（CRM_SCHEMA §2）。 */
export interface Org {
  id: string;
  name: string;
  defaultLocale: string; // 預設 'zh-TW'
  plan?: string;
  createdAt: number; // epoch ms
}

/** users（CRM_SCHEMA §2）。全域實體（email 全域 UNIQUE）；org 歸屬走 memberships。 */
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  locale?: string;
  createdAt: number; // epoch ms
}

/** memberships（CRM_SCHEMA §2）：(user_id, org_id) 複合鍵 + 角色。 */
export interface Membership {
  userId: string;
  orgId: string;
  role: Role; // 'owner' | 'admin' | 'member'
}

/** 建立 org 的輸入（id/createdAt 由 repo 生成）。 */
export interface NewOrg {
  name: string;
  defaultLocale?: string; // 缺省 'zh-TW'
  plan?: string;
}

/** 建立 user 的輸入（id/createdAt 由 repo 生成；password 已在 service 層 hash）。 */
export interface NewUser {
  email: string;
  passwordHash: string;
  displayName: string;
  locale?: string;
}

// ─────────────────────────────────────────────────────────────
// Repository 介面（CRM_SCHEMA §10 分層）
// org-scoping 規則：凡與租戶資料相關的方法都收 `orgId` 並注入 `WHERE org_id = ?`。
// 例外：users 為全域實體（登入以 email 全域查找）；orgs 的 id 本身即租戶根。
// ─────────────────────────────────────────────────────────────

/** orgs 存取。org 是租戶根，其 id 即 scope，故 findById 收自身 id 即可。 */
export interface OrgRepository {
  create(input: NewOrg): Promise<Org>;
  findById(id: string): Promise<Org | null>;
}

/** users 存取。全域：登入用 email 全域查找、findById 全域（org 歸屬另問 memberships）。 */
export interface UserRepository {
  create(input: NewUser): Promise<User>;
  findByEmail(email: string): Promise<User | null>; // 全域（登入）
  findById(id: string): Promise<User | null>; // 全域
}

/** memberships 存取。每個方法都收 orgId（org-scoped join）。 */
export interface MembershipRepository {
  addMembership(orgId: string, userId: string, role: Role): Promise<Membership>;
  roleOf(orgId: string, userId: string): Promise<Role | null>;
  /**
   * 回使用者最早加入的 org（memberships.created_at ASC 第一筆）。全域查詢（不收 orgId）。
   * M0 seam gap 修復（M1_CONTRACT §1）：auth/routes.ts 的 findPrimaryMembership direct-SQL shim 改呼叫此方法。
   */
  findPrimaryOrgOf(userId: string): Promise<{ orgId: string; role: Role } | null>;
}

// ─────────────────────────────────────────────────────────────
// CRM domain repository 介面（M1_CONTRACT §1；CRM_SCHEMA §4-9）
// org-scoping 鐵律：每個方法第一參數 orgId（除 user 全域查詢），repo 注入 `WHERE org_id = ?`。
// row↔domain 映射（snake↔camel、_json parse、epoch-ms）住在 repo；service/route 只見 domain 型別。
// 實作＝B1（Sqlite*Repository）；本檔僅凍結介面。
// ─────────────────────────────────────────────────────────────

/** 分頁請求（1-based page）。 */
export interface Page {
  page: number;
  pageSize: number;
}
/** 分頁結果。 */
export interface Paged<T> {
  items: T[];
  total: number;
}
/** 細填/確認的操作者背書（provenance filled_by='human' 的來源）。 */
export interface ByUser {
  userId: string;
  /**
   * Provenance 來源覆寫（皆可選，向後相容）。預設 update() 記 `source_type='manual'`（UI 細填），
   * `source_detail` 為 NULL。會後訊號**批准回寫**（CRM_SCHEMA §7）改帶 `sourceType='meeting'` ＋
   * `sourceDetail=<meetingId>`，使副駕/trainer 能辨識該值源自會議且可追出處。既有呼叫端只傳 `{userId}`，
   * 兩欄留 undefined → 行為與過去完全一致。
   */
  sourceType?: string;
  sourceDetail?: string;
}
/** 公司清單過濾。 */
export interface CompanyFilter {
  query?: string;
  status?: string;
  ownerUserId?: string;
}
/** 公司子計數（GET /api/crm/companies/:id counts）。 */
export interface CompanyCounts {
  contacts: number;
  products: number;
  news: number;
  deals: number;
}
/** 商機清單過濾。 */
export interface DealFilter {
  companyId?: string;
  stage?: string;
  status?: DealStatus;
  ownerUserId?: string;
}
/** EmbeddingRepository.search 的相似度命中。 */
export interface EmbeddingSearchHit {
  entityType: string;
  entityId: string;
  content: string;
  score: number;
}

/** upsertFromCrawl 的可選定位參數。 */
export interface CrawlUpsertOptions {
  /**
   * enrich 指名的既有列 id（來自 targetId）。給了就**優先以 id 命中該列**，避免既有列 domain 為 NULL 時
   * domain-dedupe 找不到而新建重複列（M1 verify 的 duplicate bug）。命中後若該列尚無 domain，會用 domain 回填。
   */
  targetId?: string;
}

/** companies 存取（英雄表；含爬蟲 dedupe 與 upsertFromCrawl 值+provenance 同 tx）。 */
export interface CompanyRepository {
  create(orgId: string, input: NewCompany): Promise<Company>;
  findById(orgId: string, id: string): Promise<Company | null>;
  findByDomain(orgId: string, domain: string): Promise<Company | null>; // 爬蟲 dedupe
  list(orgId: string, filter: CompanyFilter, page: Page): Promise<Paged<CompanySummary>>;
  update(orgId: string, id: string, patch: Partial<Company>, by: ByUser): Promise<Company>; // 細填：見 M1_CONTRACT §3
  delete(orgId: string, id: string): Promise<void>;
  // 值+provenance 同一 tx。opts.targetId＝enrich 指名的既有列（見 CrawlUpsertOptions）。
  upsertFromCrawl(orgId: string, domain: string, crawled: CrawlPayload, opts?: CrawlUpsertOptions): Promise<Company>;
  counts(orgId: string, id: string): Promise<CompanyCounts>;
}

/** contacts 存取（list 以 companyId scope；upsertFromCrawl 單一主管值+provenance 同 tx）。 */
export interface ContactRepository {
  create(orgId: string, companyId: string, input: NewContact): Promise<Contact>;
  findById(orgId: string, id: string): Promise<Contact | null>;
  list(orgId: string, companyId: string): Promise<ContactSummary[]>;
  update(orgId: string, id: string, patch: Partial<Contact>, by: ByUser): Promise<Contact>;
  delete(orgId: string, id: string): Promise<void>;
  upsertFromCrawl(orgId: string, companyId: string, crawled: ContactCrawlPayload): Promise<Contact>;
}

/** company_products 存取（+ 產品↔人 join：listPeople/addPerson/removePerson）。 */
export interface CompanyProductRepository {
  create(orgId: string, companyId: string, input: NewCompanyProduct): Promise<CompanyProduct>;
  findById(orgId: string, id: string): Promise<CompanyProduct | null>;
  list(orgId: string, companyId: string): Promise<CompanyProduct[]>;
  update(orgId: string, id: string, patch: Partial<CompanyProduct>, by: ByUser): Promise<CompanyProduct>;
  delete(orgId: string, id: string): Promise<void>;
  listPeople(orgId: string, productId: string): Promise<ProductPersonLink[]>;
  addPerson(orgId: string, productId: string, input: NewCompanyProductPerson): Promise<CompanyProductPerson>;
  removePerson(orgId: string, productId: string, contactId: string): Promise<void>;
}

/** 對方子表（news/locations/funding/tech/departments）list + bulkUpsert（爬蟲寫入）。 */
export interface CompanyChildRepository {
  listNews(orgId: string, companyId: string): Promise<CompanyNews[]>;
  listLocations(orgId: string, companyId: string): Promise<CompanyLocation[]>;
  listFunding(orgId: string, companyId: string): Promise<CompanyFunding[]>;
  listTech(orgId: string, companyId: string): Promise<CompanyTech[]>;
  listDepartments(orgId: string, companyId: string): Promise<CompanyDepartment[]>;
  bulkUpsertNews(orgId: string, companyId: string, rows: NewCompanyNews[]): Promise<void>;
  bulkUpsertLocations(orgId: string, companyId: string, rows: NewCompanyLocation[]): Promise<void>;
  bulkUpsertFunding(orgId: string, companyId: string, rows: NewCompanyFunding[]): Promise<void>;
  bulkUpsertTech(orgId: string, companyId: string, rows: NewCompanyTech[]): Promise<void>;
  bulkUpsertDepartments(orgId: string, companyId: string, rows: NewCompanyDepartment[]): Promise<void>;
}

/** deals 存取（+ 採購委員會 join：listContacts/addContact）。 */
export interface DealRepository {
  create(orgId: string, input: NewDeal): Promise<Deal>;
  findById(orgId: string, id: string): Promise<Deal | null>;
  list(orgId: string, filter: DealFilter, page: Page): Promise<Paged<Deal>>;
  update(orgId: string, id: string, patch: Partial<Deal>, by: ByUser): Promise<Deal>;
  delete(orgId: string, id: string): Promise<void>;
  listContacts(orgId: string, dealId: string): Promise<DealContact[]>;
  addContact(orgId: string, dealId: string, input: NewDealContact): Promise<DealContact>;
}

/** notes 存取（多型 entityType+entityId）。 */
export interface NoteRepository {
  list(orgId: string, entityType: NoteEntityType, entityId: string): Promise<Note[]>;
  create(orgId: string, input: NewNote): Promise<Note>;
  update(orgId: string, id: string, patch: Partial<Note>): Promise<Note>;
  delete(orgId: string, id: string): Promise<void>;
}

/** field_provenance 存取（信任層；listForEntity 每欄取未 superseded 最新一筆）。 */
export interface ProvenanceRepository {
  listForEntity(orgId: string, entityType: string, entityId: string): Promise<FieldProvenance[]>;
  confirm(orgId: string, entityType: string, entityId: string, fieldName: string, by: ByUser): Promise<void>; // verified=1
  record(orgId: string, rows: NewProvenance[]): Promise<void>; // 內部：crawl/human 寫入
}

/** embeddings 存取（v1 pattern：TEXT JSON + JS 暴力 cosine；search 過 org_id + 白名單）。 */
export interface EmbeddingRepository {
  upsert(orgId: string, rows: NewEmbedding[]): Promise<void>; // content_hash 去重
  search(
    orgId: string,
    queryVec: number[],
    filter: { entityTypes?: string[]; entityIds?: string[] },
    k: number,
  ): Promise<EmbeddingSearchHit[]>;
}

/** profile_cards 存取（副駕與 UI 共用；built_from_hash 守重生）。 */
export interface ProfileCardRepository {
  get(orgId: string, entityType: string, entityId: string): Promise<ProfileCard | null>;
  upsert(orgId: string, input: NewProfileCard): Promise<ProfileCard>;
}

// ─────────────────────────────────────────────────────────────
// M2 Deck / DynamicSlide 存取（007_decks.sql；M234_CONTRACT §M2）
// 實作＝M2 build agent（core.ts 目前為 throwing stub）。
// I1（append-only）鐵律：appendSlide 只加到尾端；updateSlide 僅允許 idx > committedIndex——
//   guard（idx ≤ committedIndex → 409）在 route/realtime 層，repo 只負責寫入。image_jobs 亦掛此 repo（deck-scoped）。
// ─────────────────────────────────────────────────────────────
export interface DeckRepository {
  // ── decks ──
  create(orgId: string, input: NewDeck): Promise<Deck>; // generate/import 可一次帶入整份 slides
  list(orgId: string): Promise<DeckSummary[]>;
  findById(orgId: string, id: string): Promise<Deck | null>;
  /** deck 頭 + 依 idx 排序的完整 slides（GET /api/decks/:id 用）。 */
  findWithSlides(orgId: string, id: string): Promise<{ deck: Deck; slides: DeckSlide[] } | null>;
  delete(orgId: string, id: string): Promise<void>;
  /** present 的 page_commit 推進 committed_index（單調遞增；I1 guard 依它）。 */
  setCommittedIndex(orgId: string, deckId: string, index: number): Promise<void>;
  // ── slides（append-only I1）──
  appendSlide(orgId: string, deckId: string, spec: SlideSpec): Promise<DeckSlide>; // idx = max(idx)+1
  updateSlide(orgId: string, deckId: string, idx: number, spec: SlideSpec): Promise<DeckSlide>; // 會前/pending 編輯
  // ── image_jobs（pre-meeting AI 生圖）──
  createImageJob(orgId: string, input: NewImageJob): Promise<ImageJob>;
  findImageJob(orgId: string, id: string): Promise<ImageJob | null>;
  updateImageJob(orgId: string, id: string, patch: ImageJobUpdate): Promise<ImageJob>;
}

// ─────────────────────────────────────────────────────────────
// M4 語音模擬訓練 存取（008_training.sql；M234_CONTRACT §M4）
// 實作＝M4 build agent（core.ts 目前為 throwing stub）。
// ─────────────────────────────────────────────────────────────
export interface TrainingRepository {
  createSession(orgId: string, input: NewTrainSession): Promise<TrainSession>;
  findSession(orgId: string, id: string): Promise<TrainSession | null>;
  saveTranscript(orgId: string, sessionId: string, turns: TrainTurn[]): Promise<void>;
  /** 設 ended_at（掛斷/結束）。 */
  finishSession(orgId: string, sessionId: string): Promise<void>;
  /** finish 觸發評分後寫入報告，回 reportId。 */
  createReport(orgId: string, input: NewTrainReport): Promise<{ reportId: string }>;
  findReport(orgId: string, reportId: string): Promise<TrainReport | null>;
}

// ─────────────────────────────────────────────────────────────
// M5 成本記帳 存取（009_ops.sql: usage_events；M5_CONTRACT §B）
// 實作＝M5 build agent（core.ts 目前為 throwing stub）。
// 冪等鐵律：record 以 (org_id, idempotency_key) UNIQUE 去重（INSERT OR IGNORE）——
//   同一計費呼叫重試不重複記帳。est_cost_usd 由呼叫端（Meter）依定價常數估算後帶入。
// ─────────────────────────────────────────────────────────────
export interface UsageRepository {
  /** 冪等記一筆用量（(orgId, idempotencyKey) 已存在則忽略，不拋錯）。 */
  record(orgId: string, event: NewUsageEvent): Promise<void>;
  /** per-org rollup：[from, to] 窗內依 kind 分組加總＋總成本（GET /api/usage）。 */
  rollup(orgId: string, from: number, to: number): Promise<UsageRollup>;
}

// ─────────────────────────────────────────────────────────────
// M5 邀請制成員管理 存取（009_ops.sql: invites；M5_CONTRACT §D；決策 20：無計費、邀請制）
// 實作＝M5 build agent（core.ts 目前為 throwing stub）。
// findByToken 為**全域查詢**（token UNIQUE，跨 org）：接受邀請時登入者尚不在該 org。
// accept 由 service 在同一 tx 內：findByToken → 建 membership → 標記 accepted_at。
// ─────────────────────────────────────────────────────────────
export interface InviteRepository {
  /** 發邀請：repo 生成 UUIDv7 id、密碼學隨機 UNIQUE token、created_at。 */
  create(orgId: string, input: NewInvite): Promise<Invite>;
  /** org 內邀請清單（含未接受/已接受）。 */
  list(orgId: string): Promise<Invite[]>;
  /** 依 token 全域查（token UNIQUE）；未命中回 null。 */
  findByToken(token: string): Promise<Invite | null>;
  /** 標記已接受（設 accepted_at=at）。org-scoped：呼叫前已由 findByToken 取得 orgId。 */
  accept(orgId: string, inviteId: string, at: number): Promise<void>;
  /** 撤銷邀請（org-scoped）。 */
  delete(orgId: string, id: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// M5 成員角色管理 存取（memberships ⨝ users；M5_CONTRACT §D）
// 實作＝M5 build agent（core.ts 目前為 throwing stub）。
// **last-owner 守則（鐵律）**：updateRole 降級唯一 owner、或 remove 唯一 owner → 實作須在 tx 內
//   統計 org 內 role='owner' 數，若將使 owner 數歸零則**拋錯**（route 層對映為 409/400），
//   確保每個 org 永遠至少一名 owner。
// ─────────────────────────────────────────────────────────────
export interface MemberRepository {
  /** org 成員清單（memberships join users：userId/email/displayName/role/createdAt）。 */
  list(orgId: string): Promise<OrgMember[]>;
  /** 改成員角色。降級唯一 owner → 拋錯（last-owner 守則）。 */
  updateRole(orgId: string, userId: string, role: Role): Promise<void>;
  /** 移除成員（刪 membership）。移除唯一 owner → 拋錯（last-owner 守則）。 */
  remove(orgId: string, userId: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────
// CrmCore — A2 組裝好的核心（db + repositories + 生命週期）
// A3 的 server 只依賴此介面拿到 repositories，不碰 DbPort/SQL。
// ─────────────────────────────────────────────────────────────
export interface CrmCore {
  db: DbPort;
  // ── 租戶身分（M0）──
  orgs: OrgRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  // ── CRM domain（M1；B1 實作）──
  companies: CompanyRepository;
  contacts: ContactRepository;
  companyProducts: CompanyProductRepository;
  companyChildren: CompanyChildRepository;
  deals: DealRepository;
  notes: NoteRepository;
  provenance: ProvenanceRepository;
  embeddings: EmbeddingRepository;
  profileCards: ProfileCardRepository;
  // ── M2/M4（B0 凍結介面；core.ts 目前為 throwing stub，build agent 實作）──
  decks: DeckRepository;
  training: TrainingRepository;
  // ── M5（本檔凍結介面；core.ts 目前為 throwing stub，M5 build agent 實作）──
  usage: UsageRepository;
  invites: InviteRepository;
  members: MemberRepository;
  /** 套用 /migrations/NNN_*.sql（schema_migrations runner，CRM_SCHEMA §11 尾）。 */
  migrate(): Promise<void>;
  /** 關閉底層連線（測試/優雅關機）。 */
  close(): void;
}

// A2 在 src/core.ts 實作下列工廠（ports.ts 只放型別，不放 runtime）：
//   export declare function createCrmCore(dbPath: string): Promise<CrmCore>;
