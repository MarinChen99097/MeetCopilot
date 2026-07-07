/**
 * createCrmCore — 組裝 CrmCore（ports.ts）：DbPort + repositories + migrate 生命週期。
 * A3 的 server 只依賴 CrmCore 介面拿 repositories，不碰 DbPort/SQL/raw Database。
 * B1：以真正的 Sqlite*Repository 取代 B0 的 throwing stub，migrate 現跑 001-006。
 */
import type { CrmCore } from "./ports.js";
import { createSqliteDbPort } from "./sqlite-db.js";
import { runMigrations } from "./migrate.js";
import { SqliteOrgRepository, SqliteUserRepository, SqliteMembershipRepository } from "./repos.js";
import {
  SqliteCompanyRepository,
  SqliteContactRepository,
  SqliteCompanyProductRepository,
  SqliteCompanyChildRepository,
} from "./repos-prospect.js";
import { SqliteDealRepository, SqliteNoteRepository } from "./repos-pipeline.js";
import {
  SqliteProvenanceRepository,
  SqliteEmbeddingRepository,
  SqliteProfileCardRepository,
} from "./repos-retrieval.js";
import { SqliteTrainingRepository } from "./repos-training.js";
import { SqliteDeckRepository } from "./repos-decks.js";

/** 開啟 SQLite（`:memory:` 或檔案路徑）並回傳組裝好的 CrmCore。呼叫端負責 `await core.migrate()`。 */
export async function createCrmCore(dbPath: string): Promise<CrmCore> {
  const { port, raw, close } = createSqliteDbPort(dbPath);
  return {
    db: port,
    // ── 租戶身分（M0）──
    orgs: new SqliteOrgRepository(port),
    users: new SqliteUserRepository(port),
    memberships: new SqliteMembershipRepository(port),
    // ── CRM domain（M1）──
    companies: new SqliteCompanyRepository(port),
    contacts: new SqliteContactRepository(port),
    companyProducts: new SqliteCompanyProductRepository(port),
    companyChildren: new SqliteCompanyChildRepository(port),
    deals: new SqliteDealRepository(port),
    notes: new SqliteNoteRepository(port),
    provenance: new SqliteProvenanceRepository(port),
    embeddings: new SqliteEmbeddingRepository(port),
    profileCards: new SqliteProfileCardRepository(port),
    // ── M2：DynamicSlide repo（007_decks.sql；appendSlide/updateSlide 守 I1）──
    decks: new SqliteDeckRepository(port),
    // ── M4：訓練 repo（008_training.sql）──
    training: new SqliteTrainingRepository(port),
    migrate: () => runMigrations(raw),
    close,
  };
}
