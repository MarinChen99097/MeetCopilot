/**
 * SqliteDbPort — DbPort（ports.ts，凍結）的 better-sqlite3 實作。
 * CRM_SCHEMA §10：async-first 簽名（底層同步，回 Promise，日後換 pg 不動 repo/service）。
 *
 * ⚠️ tx 陷阱（§10）：better-sqlite3 的 `db.transaction()` 是同步、內部不可 await。
 * 本 port 的 tx **不用它**，改手動 `BEGIN IMMEDIATE` → `await fn()` → `COMMIT`／出錯 `ROLLBACK`
 * （單連線單進程下正確）。pg 版天然 async、同簽名成立。
 *
 * §0：`PRAGMA foreign_keys` 維持 OFF（完整性由 repository 層強制，非 SQL FK）。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { DbPort } from "./ports.js";

/** SqliteDbPort 的建立結果：對外的 DbPort、底層 raw Database（migrate 用）、close。 */
export interface SqliteHandle {
  port: DbPort;
  raw: Database.Database;
  close: () => void;
}

/**
 * 開啟（或建立）SQLite 資料庫並回傳 DbPort。
 * dbPath 為檔案路徑時自動 mkdir -p 其目錄；`:memory:` 則跳過。
 */
export function createSqliteDbPort(dbPath: string): SqliteHandle {
  const isMemory = dbPath === ":memory:";
  if (!isMemory) {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  }
  const raw = new Database(dbPath);
  if (!isMemory) {
    raw.pragma("journal_mode = WAL"); // 記憶體 DB 不支援 WAL，故僅檔案 DB 設定
  }
  raw.pragma("foreign_keys = OFF");

  const port: DbPort = {
    async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    async all<T>(sql: string, params: unknown[]): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async run(sql: string, params: unknown[]): Promise<{ changes: number }> {
      const info = raw.prepare(sql).run(...params);
      return { changes: info.changes };
    },
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn();
        raw.exec("COMMIT");
        return result;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };

  return { port, raw, close: () => raw.close() };
}
