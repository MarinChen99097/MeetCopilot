/**
 * M5 生產強化契約型別（成本記帳 usage_events、邀請制成員 invites/members）。
 * 唯一真相來源＝M5_CONTRACT §B（usage）／§D（invites/members）與 009_ops.sql DDL。
 * 命名：DB snake_case ↔ 此處 camelCase（repo 在邊界轉）；時間 epoch ms（number）；布林 0/1。
 * enum 一律 string-literal union，值對齊 009_ops.sql 的 CHECK(col IN (...))。
 * crm/ports.ts 以 `import type` 引用本檔（型別限定，不產生 runtime/emit 耦合）。
 */

// ─────────────────────────────────────────────────────────────
// 成本記帳（usage_events；M5_CONTRACT §B）
// ─────────────────────────────────────────────────────────────

/** 用量種類（usage_events.kind，CHECK）。對齊每種計費呼叫。 */
export const USAGE_KINDS = [
  "gemini_text",
  "gemini_extract",
  "gemini_live",
  "openai_image",
  "embedding",
  "asr",
] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** usage_events 一列（domain）。model/token 欄可空（API 無回報時估算或省略）。 */
export interface UsageEvent {
  id: string;
  orgId: string;
  userId?: string; // 012_admin：發起使用者歸屬（nullable；背景 job 無 request 脈絡時省略）
  kind: UsageKind;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd: number;
  meetingId?: string;
  idempotencyKey: string;
  createdAt: number; // epoch ms
}

/**
 * 記一筆用量的輸入（id/createdAt 由 repo 生成）。
 * idempotencyKey 由呼叫端決定；(orgId, idempotencyKey) 唯一 → 重試不重複計費。
 */
export interface NewUsageEvent {
  kind: UsageKind;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estCostUsd: number;
  meetingId?: string;
  userId?: string; // 012_admin：可選使用者歸屬（Meter.meter 擴充後由 request-scoped 寫入點帶入）
  idempotencyKey: string;
}

/** rollup 內單一 kind 的加總。 */
export interface UsageRollupRow {
  kind: UsageKind;
  events: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** GET /api/usage?from=&to= 的 per-org rollup（kind 分組＋總成本）。 */
export interface UsageRollup {
  from: number; // epoch ms（查詢窗起，含）
  to: number; // epoch ms（查詢窗迄，含）
  totalCostUsd: number;
  byKind: UsageRollupRow[];
}

// ─────────────────────────────────────────────────────────────
// 邀請制成員管理（invites / members；M5_CONTRACT §D）
// ─────────────────────────────────────────────────────────────

/** 可被邀請的角色（invites.role，CHECK）。owner 不經邀請產生（建 org 者即 owner）。 */
export const INVITE_ROLES = ["admin", "member"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** invites 一列（domain）。acceptedAt 為 NULL＝未接受；token 為邀請連結識別碼。 */
export interface Invite {
  id: string;
  orgId: string;
  email: string;
  role: InviteRole;
  token: string;
  invitedBy?: string;
  acceptedAt?: number; // epoch ms（未接受＝undefined）
  expiresAt?: number; // epoch ms（不逾期＝undefined）
  createdAt: number; // epoch ms
}

/**
 * 發邀請的輸入（id/token/createdAt 由 repo 生成）。
 * token 由 repo 以密碼學隨機生成並保證 UNIQUE。
 */
export interface NewInvite {
  email: string;
  role: InviteRole;
  invitedBy?: string;
  expiresAt?: number; // epoch ms（省略＝不逾期）
}

/** 成員清單一列（memberships ⨝ users）。GET /api/org/members。 */
export interface OrgMember {
  userId: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  createdAt: number; // membership.created_at，epoch ms
}
