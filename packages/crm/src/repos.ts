/**
 * 租戶身分表的 Sqlite repository 實作（CRM_SCHEMA §2/§10）。
 * 分層：service 只依賴 ports.ts 的 repository 介面 + domain 型別；repo 擁有 row↔domain 映射
 * （snake_case↔camelCase、epoch-ms、null↔undefined）。org-scoped 讀一律注入 `WHERE org_id = ?`。
 */
import type {
  DbPort,
  Org,
  NewOrg,
  User,
  NewUser,
  Membership,
  Role,
  OrgRepository,
  UserRepository,
  MembershipRepository,
} from "./ports.js";
import { uuidv7 } from "./uuid.js";

const DEFAULT_LOCALE = "zh-TW";

// ── row 型別（DB 邊界，snake_case） ──
interface OrgRow {
  id: string;
  name: string;
  default_locale: string;
  plan: string | null;
  created_at: number;
}
interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  locale: string | null;
  created_at: number;
}

function mapOrg(r: OrgRow): Org {
  return {
    id: r.id,
    name: r.name,
    defaultLocale: r.default_locale,
    plan: r.plan ?? undefined,
    createdAt: r.created_at,
  };
}

function mapUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    passwordHash: r.password_hash,
    displayName: r.display_name,
    locale: r.locale ?? undefined,
    createdAt: r.created_at,
  };
}

/** orgs：org 是租戶根，其 id 即 scope，findById 收自身 id。 */
export class SqliteOrgRepository implements OrgRepository {
  constructor(private readonly db: DbPort) {}

  async create(input: NewOrg): Promise<Org> {
    const org: Org = {
      id: uuidv7(),
      name: input.name,
      defaultLocale: input.defaultLocale ?? DEFAULT_LOCALE,
      plan: input.plan,
      createdAt: Date.now(),
    };
    await this.db.run(
      "INSERT INTO orgs (id, name, default_locale, plan, created_at) VALUES (?, ?, ?, ?, ?)",
      [org.id, org.name, org.defaultLocale, org.plan ?? null, org.createdAt],
    );
    return org;
  }

  async findById(id: string): Promise<Org | null> {
    const row = await this.db.get<OrgRow>("SELECT * FROM orgs WHERE id = ?", [id]);
    return row ? mapOrg(row) : null;
  }
}

/** users：全域實體。email 全域 UNIQUE，findByEmail/findById 皆全域（org 歸屬另問 memberships）。 */
export class SqliteUserRepository implements UserRepository {
  constructor(private readonly db: DbPort) {}

  async create(input: NewUser): Promise<User> {
    const user: User = {
      id: uuidv7(),
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName,
      locale: input.locale,
      createdAt: Date.now(),
    };
    await this.db.run(
      "INSERT INTO users (id, email, password_hash, display_name, locale, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [user.id, user.email, user.passwordHash, user.displayName, user.locale ?? null, user.createdAt],
    );
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE email = ?", [email]);
    return row ? mapUser(row) : null;
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    return row ? mapUser(row) : null;
  }
}

/** memberships：org-scoped。每個方法收 orgId 並注入 `WHERE org_id = ?`（跨租戶洩漏在結構上不可能）。 */
export class SqliteMembershipRepository implements MembershipRepository {
  constructor(private readonly db: DbPort) {}

  async addMembership(orgId: string, userId: string, role: Role): Promise<Membership> {
    await this.db.run(
      "INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)",
      [userId, orgId, role, Date.now()],
    );
    return { userId, orgId, role };
  }

  async roleOf(orgId: string, userId: string): Promise<Role | null> {
    const row = await this.db.get<{ role: Role }>(
      "SELECT role FROM memberships WHERE org_id = ? AND user_id = ?",
      [orgId, userId],
    );
    return row ? row.role : null;
  }
}
