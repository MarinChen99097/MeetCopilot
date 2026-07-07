/**
 * InviteRepository + MemberRepository 的 SQLite 實作（009_ops.sql: invites；memberships ⨝ users）。
 * M5_CONTRACT §D（決策 20：無計費、邀請制）。org-scoped（每查詢 WHERE org_id = ?）、no SQL FK、tx=手動 BEGIN IMMEDIATE。
 *
 * 兩條鐵律的權威落點：
 *  - **findByToken 為全域查詢**（token UNIQUE，跨 org）：接受邀請時登入者尚不在該 org，故不收 orgId。
 *    其餘 invite 方法一律 org-scoped（跨租戶洩漏在結構上不可能）。
 *  - **last-owner 守則**：MemberRepository.updateRole 降級「唯一 owner」、或 remove「唯一 owner」→ 在同一 tx 內
 *    統計 org 內 role='owner' 數，若將使 owner 數歸零則擲 LastOwnerError（route 對映成 409）。
 */
import { randomBytes } from "node:crypto";
import type { DbPort, Role, InviteRepository, MemberRepository } from "./ports.js";
import type { Invite, InviteRole, NewInvite, OrgMember } from "@meetcopilot/shared";
import { uuidv7 } from "./uuid.js";

/**
 * 違反 last-owner 守則：試圖降級或移除 org 內唯一的 owner。
 * route 層捕捉此型別 → 回 409（每個 org 永遠至少一名 owner 的守門）。
 */
export class LastOwnerError extends Error {
  constructor() {
    super("cannot remove or demote the last owner of the organization");
    this.name = "LastOwnerError";
  }
}

/** 找不到指定成員（org 內無此 membership）。route 對映成 404。 */
export class MemberNotFoundError extends Error {
  constructor() {
    super("member not found in this organization");
    this.name = "MemberNotFoundError";
  }
}

// ─────────────────────────────────────────────────────────────
// row → domain 映射（DB 邊界 snake_case → camelCase；null → undefined）
// ─────────────────────────────────────────────────────────────
interface InviteRow {
  id: string;
  org_id: string;
  email: string;
  role: string;
  token: string;
  invited_by: string | null;
  accepted_at: number | null;
  expires_at: number | null;
  created_at: number;
}

function mapInvite(r: InviteRow): Invite {
  return {
    id: r.id,
    orgId: r.org_id,
    email: r.email,
    role: r.role as InviteRole,
    token: r.token,
    invitedBy: r.invited_by ?? undefined,
    acceptedAt: r.accepted_at ?? undefined,
    expiresAt: r.expires_at ?? undefined,
    createdAt: r.created_at,
  };
}

/** 密碼學隨機、URL 安全的邀請 token（32 bytes → 43 字元 base64url，無填充）。 */
function mintToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * invites 存取。create 生成 UUIDv7 id + 密碼學隨機 UNIQUE token；findByToken 全域（token UNIQUE）；
 * 其餘方法 org-scoped。
 */
export class SqliteInviteRepository implements InviteRepository {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, input: NewInvite): Promise<Invite> {
    const invite: Invite = {
      id: uuidv7(),
      orgId,
      email: input.email,
      role: input.role,
      token: mintToken(),
      invitedBy: input.invitedBy,
      acceptedAt: undefined,
      expiresAt: input.expiresAt,
      createdAt: Date.now(),
    };
    await this.db.run(
      `INSERT INTO invites (id, org_id, email, role, token, invited_by, accepted_at, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invite.id,
        invite.orgId,
        invite.email,
        invite.role,
        invite.token,
        invite.invitedBy ?? null,
        null,
        invite.expiresAt ?? null,
        invite.createdAt,
      ],
    );
    return invite;
  }

  async list(orgId: string): Promise<Invite[]> {
    const rows = await this.db.all<InviteRow>(
      "SELECT * FROM invites WHERE org_id = ? ORDER BY created_at DESC",
      [orgId],
    );
    return rows.map(mapInvite);
  }

  async findByToken(token: string): Promise<Invite | null> {
    const row = await this.db.get<InviteRow>("SELECT * FROM invites WHERE token = ?", [token]);
    return row ? mapInvite(row) : null;
  }

  async accept(orgId: string, inviteId: string, at: number): Promise<void> {
    await this.db.run("UPDATE invites SET accepted_at = ? WHERE org_id = ? AND id = ?", [
      at,
      orgId,
      inviteId,
    ]);
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM invites WHERE org_id = ? AND id = ?", [orgId, id]);
  }
}

// ─────────────────────────────────────────────────────────────
// members（memberships ⨝ users）：list / updateRole / remove
// last-owner 守則在 updateRole/remove 的 tx 內強制。
// ─────────────────────────────────────────────────────────────
interface MemberRow {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  created_at: number;
}

export class SqliteMemberRepository implements MemberRepository {
  constructor(private readonly db: DbPort) {}

  async list(orgId: string): Promise<OrgMember[]> {
    const rows = await this.db.all<MemberRow>(
      `SELECT m.user_id, u.email, u.display_name, m.role, m.created_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.org_id = ?
        ORDER BY m.created_at ASC`,
      [orgId],
    );
    return rows.map((r) => ({
      userId: r.user_id,
      email: r.email,
      displayName: r.display_name,
      role: r.role as OrgMember["role"],
      createdAt: r.created_at,
    }));
  }

  /**
   * 改成員角色。降級唯一 owner（目前 owner → 非 owner 且該 org 只剩一名 owner）→ 擲 LastOwnerError。
   * 找不到成員 → 擲 MemberNotFoundError。整段在一個 tx 內（count 與 update 之間不容並發插隊）。
   */
  async updateRole(orgId: string, userId: string, role: Role): Promise<void> {
    await this.db.tx(async () => {
      const current = await this.currentRole(orgId, userId);
      if (current === null) throw new MemberNotFoundError();
      // 降級唯一 owner 的守門：只在「目前是 owner 且改成非 owner」時檢查。
      if (current === "owner" && role !== "owner" && (await this.ownerCount(orgId)) <= 1) {
        throw new LastOwnerError();
      }
      await this.db.run("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?", [
        role,
        orgId,
        userId,
      ]);
    });
  }

  /**
   * 移除成員（刪 membership）。移除唯一 owner → 擲 LastOwnerError。找不到成員 → 擲 MemberNotFoundError。
   */
  async remove(orgId: string, userId: string): Promise<void> {
    await this.db.tx(async () => {
      const current = await this.currentRole(orgId, userId);
      if (current === null) throw new MemberNotFoundError();
      if (current === "owner" && (await this.ownerCount(orgId)) <= 1) {
        throw new LastOwnerError();
      }
      await this.db.run("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", [orgId, userId]);
    });
  }

  private async currentRole(orgId: string, userId: string): Promise<Role | null> {
    const row = await this.db.get<{ role: Role }>(
      "SELECT role FROM memberships WHERE org_id = ? AND user_id = ?",
      [orgId, userId],
    );
    return row ? row.role : null;
  }

  private async ownerCount(orgId: string): Promise<number> {
    const row = await this.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'owner'",
      [orgId],
    );
    return row?.n ?? 0;
  }
}
