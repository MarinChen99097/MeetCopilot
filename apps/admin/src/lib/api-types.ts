/**
 * ADMIN_CONTRACT §4 — Admin API 回傳形狀（欄位名固定，實作不得自創）。
 *
 * 本檔＝契約的 TypeScript 鏡射。所有欄位名/巢狀結構逐欄對照 §4 表，**零漂移**。
 * 後端 (apps/server/src/admin-routes/) 尚未實作；前端以本契約為真相，用型別安全 fetch 層對接。
 *
 * 時間戳假設：契約未言明 epoch-ms vs ISO；本檔一律以 `number`（epoch ms）鏡射，
 * 與 apps/web 既有慣例（ResearchJob.startedAt: number、format.ts 吃 ms）一致。
 * 若後端最終回 ISO 字串，僅需改本檔型別＋formatter 已容錯（見 lib/format.ts）。→ 已列為 gap。
 */

// ── 共用列舉（與 packages/shared/src/crm-types.ts 同值，此處自持一份以維持 app 獨立） ──
export type OrgStatus = "active" | "suspended";
export type UserStatus = "active" | "suspended";
export type AdminJobStatus = "queued" | "running" | "done" | "failed";
/** 研究 job 模式（CrawlMode）。 */
export type AdminJobMode = "quick" | "detailed" | "deep";
/** 研究 job 目標型別（CrawlTargetType）。 */
export type AdminJobTargetType = "company" | "contact";
export type MembershipRole = "owner" | "admin" | "member";

/** usage 聚合維度（§4 #2 groupBy）。 */
export type UsageGroupBy = "org" | "kind" | "model" | "day";

// ── #1 GET /api/admin/overview ────────────────────────────────────────────────
export interface AdminOverview {
  costUsd: { today: number; last7d: number; last30d: number };
  orgs: { total: number; suspended: number };
  users: { total: number };
  jobs: { running: number; failedLast7d: number; doneLast7d: number };
  health: { ready: boolean };
}

// ── #2 GET /api/admin/usage?from&to&groupBy ──────────────────────────────────
export interface UsageRow {
  /** 聚合鍵：org→orgId、kind→kind、model→model、day→UTC YYYY-MM-DD。 */
  key: string;
  /** groupBy=org 時附。 */
  orgName?: string;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}
export interface UsageSummary {
  /** epoch-ms（server 回填查詢窗；admin-queries AdminUsage.from/to:number）。 */
  from: number;
  to: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  rows: UsageRow[];
}

// ── #3 GET /api/admin/usage/events?from&to&orgId?&kind?&limit&offset ──────────
export interface UsageEvent {
  id: string;
  orgId: string;
  orgName: string;
  /** 回填欄位（migration 012：usage_events.user_id nullable）。 */
  userId: string | null;
  userEmail?: string;
  kind: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estCostUsd: number;
  meetingId: string | null;
  createdAt: number;
}
export interface UsageEventsPage {
  total: number;
  items: UsageEvent[];
}

// ── #4 GET /api/admin/orgs?query?&status? ────────────────────────────────────
export interface OrgRow {
  id: string;
  name: string;
  status: OrgStatus;
  plan: string;
  createdAt: number;
  memberCount: number;
  costUsd30d: number;
}
export interface OrgsList {
  items: OrgRow[];
}

// ── #5 GET /api/admin/orgs/:id ───────────────────────────────────────────────
export interface OrgDetailOrg {
  id: string;
  name: string;
  status: OrgStatus;
  plan: string;
  createdAt: number;
}
export interface OrgMemberRow {
  userId: string;
  email: string;
  displayName: string;
  role: MembershipRole;
  status: UserStatus;
}
/** invite 明細——**不含 token**（A3：不回傳秘密）。 */
export interface OrgInviteRow {
  id: string;
  email: string;
  role: MembershipRole;
  acceptedAt: number | null;
  expiresAt: number | null;
}
/**
 * usage30d.byKind[] 元素形狀——契約僅寫 `byKind[]` 未定欄位；此處以最小自然分組
 * `{ kind, costUsd }` 鏡射。→ 已列為 gap（待後端定案）。
 */
export interface UsageByKind {
  kind: string;
  costUsd: number;
}
export interface OrgDetail {
  org: OrgDetailOrg;
  members: OrgMemberRow[];
  invites: OrgInviteRow[];
  usage30d: { costUsd: number; byKind: UsageByKind[] };
  /** ≤10 筆，形狀同 #7 item（JobRow）。 */
  recentJobs: JobRow[];
}

// ── #6 PATCH /api/admin/orgs/:id/status ＋ /api/admin/users/:id/status ─────────
export interface StatusPatchResult {
  id: string;
  status: OrgStatus; // 與 UserStatus 同值域
}

// ── #7 GET /api/admin/jobs?status?&mode?&orgId?&from&to&limit&offset ──────────
export interface JobRow {
  id: string;
  orgId: string;
  orgName: string;
  targetType: string;
  targetId: string;
  targetName?: string;
  mode: string;
  status: string;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** server 端算好（§7）。 */
  durationMs: number | null;
  queueMs: number | null;
}
export interface JobsPage {
  total: number;
  items: JobRow[];
}

// ── #8 GET /api/admin/jobs/stats?days=14 ─────────────────────────────────────
export interface JobStatsDay {
  date: string;
  queued: number;
  running: number;
  done: number;
  failed: number;
}
export interface JobTopError {
  error: string;
  count: number;
}
export interface JobStats {
  days: JobStatsDay[];
  failRatePct: number;
  avgDurationMs: number;
  /** ≤10，error 前 120 字元正規化分組。 */
  topErrors: JobTopError[];
}

// ── #9 GET /api/admin/health ─────────────────────────────────────────────────
export interface AdminHealth {
  ready: boolean;
  db: { driver: string; ok: boolean };
  /** 只回「已設 key」布林，不驗即時連通。 */
  providers: { gemini: boolean; openai: boolean };
  liveMeetings: number;
  uptimeSec: number;
  /** env K_REVISION 或 git sha，無則 "dev"。 */
  version: string;
}

// ── Auth（沿用既有 /api/auth/*，非 §4 admin 端點；shape 比照 apps/web）─────────
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}
export interface AuthOrg {
  id: string;
  name: string;
}
export interface AuthResponse {
  token: string;
  user: AuthUser;
  org: AuthOrg;
}
export interface MeResponse {
  user: AuthUser;
  org: AuthOrg;
  role: MembershipRole;
}
