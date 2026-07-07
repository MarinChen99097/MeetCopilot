/**
 * Migration runner（CRM_SCHEMA §11 尾）。
 * 掃 migrations/NNN_*.sql → 比對 schema_migrations 已套用的 version → 缺的按序各自在一個 tx 內套用並記錄。
 * 直接對 raw Database 操作（migration 讀 .sql 檔、是引擎相關的 adapter 細節；pg 版另有自己的 runner）。
 * 套用本身全同步（讀檔→exec→insert），故手動 BEGIN/COMMIT 無 async——不觸發 §10 的 tx 陷阱。
 */
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 套件隨附的 migrations 目錄。src/migrate.ts 與 dist/migrate.js 皆解析到 packages/crm/migrations。 */
const DEFAULT_MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const MIGRATION_FILE_RE = /^(\d+)_.*\.sql$/;

interface MigrationFile {
  version: number;
  name: string;
}

/** schema_migrations 最小 DDL（CRM_SCHEMA §11 尾，照抄）。 */
const SCHEMA_MIGRATIONS_DDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);`;

export async function runMigrations(
  raw: Database.Database,
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<void> {
  raw.exec(SCHEMA_MIGRATIONS_DDL);

  const appliedRows = raw.prepare("SELECT version FROM schema_migrations").all() as Array<{ version: number }>;
  const applied = new Set<number>(appliedRows.map((r) => r.version));

  const files: MigrationFile[] = fs
    .readdirSync(migrationsDir)
    .map((f): MigrationFile | null => {
      const m = MIGRATION_FILE_RE.exec(f);
      return m ? { version: Number(m[1]), name: f } : null;
    })
    .filter((x): x is MigrationFile => x !== null)
    .sort((a, b) => a.version - b.version);

  for (const mig of files) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, mig.name), "utf8");
    raw.exec("BEGIN IMMEDIATE");
    try {
      raw.exec(sql);
      raw
        .prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
        .run(mig.version, mig.name, Date.now());
      raw.exec("COMMIT");
    } catch (err) {
      raw.exec("ROLLBACK");
      throw err;
    }
  }
}
