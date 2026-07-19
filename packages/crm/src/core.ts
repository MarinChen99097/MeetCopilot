/**
 * createCrmCore — 組裝 CrmCore（ports.ts）：DbPort + repositories + migrate 生命週期。
 * A3 的 server 只依賴 CrmCore 介面拿 repositories，不碰 DbPort/SQL/raw Database。
 *
 * 驅動選擇（SQLite / Postgres）：
 *  - 既有呼叫端 `createCrmCore(dbPath)`（字串）→ SQLite（100% 向後相容，測試不動）。
 *  - 新 `createCrmCore({ driver, dbPath?, connString? })` 或環境變數 DB_DRIVER=sqlite|pg（+ DATABASE_URL）。
 *
 * 關鍵設計：repository 實作**只依賴 DbPort**（非 better-sqlite3），故同一組 Sqlite*Repository 類別
 * 直接跑在 PgDbPort 上——不需另寫 Pg*Repository（比 CRM_SCHEMA §10 原案更省；差異全鎖在 DbPort + 方言 SQL）。
 * 唯二依驅動而異：DbPort 建立、migrate()（挑對應 migrations 目錄）、close()。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CrmCore, DbPort } from "./ports.js";
import { createSqliteDbPort } from "./sqlite-db.js";
import { createPgDbPort, runMigrationsPg } from "./pg-db.js";
import { runMigrations } from "./migrate.js";
import { SqliteOrgRepository, SqliteUserRepository, SqliteMembershipRepository } from "./repos.js";
import { SqliteInviteRepository, SqliteMemberRepository } from "./repos-invites.js";
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
import { SqliteDeckAssetRepository } from "./repos-deck-assets.js";
import { SqliteImportJobRepository } from "./repos-import-jobs.js";
import { SqliteUsageRepository } from "./repos-ops.js";

/** Postgres migrations 目錄（Adapt 階段建立；與 SQLite migrations/ 平行、方言各異）。 */
const PG_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations-pg");

export type DbDriver = "sqlite" | "pg";

/** createCrmCore 的選項式呼叫。driver 缺省時讀環境變數 DB_DRIVER，再缺省 'sqlite'。 */
export interface CrmCoreOptions {
  /** 明確指定驅動；缺省 → env DB_DRIVER → 'sqlite'。 */
  driver?: DbDriver;
  /** SQLite 檔路徑或 ':memory:'（driver='sqlite'）。缺省 → env DB_PATH → ':memory:'。 */
  dbPath?: string;
  /** Postgres 連線字串（driver='pg'）。缺省 → env DATABASE_URL。 */
  connString?: string;
}

/** 由 DbPort 組裝完整 CrmCore（repositories 皆 port-agnostic，兩驅動共用）。 */
function assemble(
  port: DbPort,
  migrate: () => Promise<void>,
  close: () => void,
): CrmCore {
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
    // ── 018：匯入重構——deck_assets（原檔/逐頁圖 bytes）、import_jobs（轉檔 job）──
    deckAssets: new SqliteDeckAssetRepository(port),
    importJobs: new SqliteImportJobRepository(port),
    // ── M4：訓練 repo（008_training.sql）──
    training: new SqliteTrainingRepository(port),
    // ── M5：ops repos（009_ops.sql）──
    usage: new SqliteUsageRepository(port),
    invites: new SqliteInviteRepository(port),
    members: new SqliteMemberRepository(port),
    migrate,
    close,
  };
}

/**
 * 建立 CrmCore。
 * 向後相容多載：`createCrmCore(dbPath: string)` ＝ SQLite（既有測試/呼叫端不動）。
 * 新式：`createCrmCore({ driver, dbPath?, connString? })`；亦可全由環境變數驅動。
 * 呼叫端負責 `await core.migrate()`。
 */
export async function createCrmCore(dbPath: string): Promise<CrmCore>;
export async function createCrmCore(opts: CrmCoreOptions): Promise<CrmCore>;
export async function createCrmCore(arg: string | CrmCoreOptions): Promise<CrmCore> {
  const opts: CrmCoreOptions = typeof arg === "string" ? { driver: "sqlite", dbPath: arg } : arg;
  const driver: DbDriver =
    opts.driver ?? (process.env.DB_DRIVER as DbDriver | undefined) ?? "sqlite";

  if (driver === "pg") {
    const connString = opts.connString ?? process.env.DATABASE_URL;
    if (!connString) {
      throw new Error("[crm] driver='pg' 需要 connString 或環境變數 DATABASE_URL。");
    }
    const { port, pool, close } = await createPgDbPort(connString);
    return assemble(port, () => runMigrationsPg(pool, PG_MIGRATIONS_DIR), close);
  }

  // driver === 'sqlite'
  const dbPath = opts.dbPath ?? process.env.DB_PATH ?? ":memory:";
  const { port, raw, close } = createSqliteDbPort(dbPath);
  return assemble(port, () => runMigrations(raw), close);
}
