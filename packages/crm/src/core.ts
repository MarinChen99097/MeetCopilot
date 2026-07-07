/**
 * createCrmCore — 組裝 CrmCore（ports.ts）：DbPort + repositories + migrate 生命週期。
 * A3 的 server 只依賴 CrmCore 介面拿 repositories，不碰 DbPort/SQL/raw Database。
 */
import type { CrmCore } from "./ports.js";
import { createSqliteDbPort } from "./sqlite-db.js";
import { runMigrations } from "./migrate.js";
import { SqliteOrgRepository, SqliteUserRepository, SqliteMembershipRepository } from "./repos.js";

/** 開啟 SQLite（`:memory:` 或檔案路徑）並回傳組裝好的 CrmCore。呼叫端負責 `await core.migrate()`。 */
export async function createCrmCore(dbPath: string): Promise<CrmCore> {
  const { port, raw, close } = createSqliteDbPort(dbPath);
  return {
    db: port,
    orgs: new SqliteOrgRepository(port),
    users: new SqliteUserRepository(port),
    memberships: new SqliteMembershipRepository(port),
    migrate: () => runMigrations(raw),
    close,
  };
}
