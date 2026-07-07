/**
 * CRM 契約型別（前端 ↔ 後端交界）。**M0 範圍**：只放 auth / CRM 清單摘要 / provenance 徽章需要的型別；
 * 完整實體（Company、Contact 全欄位…）在 M1 隨 CRM_SCHEMA 落地。
 * 唯一真相來源＝API_CONTRACT §2；enum 值對齊 CRM_SCHEMA（§4/§5/§8）。
 */

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

/** 採購決策角色（contacts.decision_power，CRM_SCHEMA §5）。 */
export type DecisionPower =
  | "economic_buyer"
  | "champion"
  | "influencer"
  | "gatekeeper"
  | "user"
  | "blocker"
  | "unknown";

/** 公司清單摘要（API_CONTRACT §2：GET /api/crm/companies）。 */
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

/** 主管清單摘要（API_CONTRACT §2：GET /api/crm/companies/:id/contacts）。 */
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

/** 欄位溯源（API_CONTRACT §2 Provenance：GET /api/crm/provenance）。每欄取未 superseded 最新一筆。 */
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

/** 成員角色（memberships.role，CRM_SCHEMA §2；API_CONTRACT §1 /api/auth/me `role`）。 */
export type MembershipRole = "owner" | "admin" | "member";
