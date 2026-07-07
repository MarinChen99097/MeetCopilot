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
}

// ─────────────────────────────────────────────────────────────
// CrmCore — A2 組裝好的核心（db + repositories + 生命週期）
// A3 的 server 只依賴此介面拿到 repositories，不碰 DbPort/SQL。
// ─────────────────────────────────────────────────────────────
export interface CrmCore {
  db: DbPort;
  orgs: OrgRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  /** 套用 /migrations/NNN_*.sql（schema_migrations runner，CRM_SCHEMA §11 尾）。 */
  migrate(): Promise<void>;
  /** 關閉底層連線（測試/優雅關機）。 */
  close(): void;
}

// A2 在 src/core.ts 實作下列工廠（ports.ts 只放型別，不放 runtime）：
//   export declare function createCrmCore(dbPath: string): Promise<CrmCore>;
