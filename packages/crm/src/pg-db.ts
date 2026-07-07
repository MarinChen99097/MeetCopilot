/**
 * PgDbPort — DbPort（ports.ts，凍結）的 node-postgres（`pg`）實作。
 * CRM_SCHEMA §10：async-first 簽名；repo/service 不因換引擎而改。與 SqliteDbPort 對外行為對齊：
 *  - get/all 回同形狀 row（欄名照 SQL 原樣、皆 lowercase snake_case；repo 自行 snake→camel 映射）。
 *  - run() 回 { changes: rowCount }（對齊 better-sqlite3 的 info.changes）。
 *  - tx() 於**單一 pooled client** 上 BEGIN/COMMIT/ROLLBACK（天然 async；同 §10 簽名）。
 *
 * ── 兩個關鍵接縫（讓 repo 零改動即可跑 pg）──
 * (1) **Placeholder 轉譯**：repo 一律發 SQLite 的 `?`；本 port 在邊界把 `?`→`$1,$2,…`（依序編號），
 *     並跳過單引號字串字面量內的 `?`（repo 目前無字面 `?`，此為防禦）。
 * (2) **tx 內語句路由**：repo 於 `tx(fn)` 內仍呼叫**同一個** `this.db.get/all/run`；PgDbPort 用
 *     AsyncLocalStorage 把「當前 tx 的 client」帶進這些呼叫——否則它們會各自從 pool 取不同連線、
 *     使 BEGIN 與後續語句不在同一交易（SqliteDbPort 因單連線天然無此問題）。
 *
 * ── 型別/依賴策略 ──
 * 本檔**不 static import `pg`**（改 runtime dynamic import）、亦不需 `@types/pg` 即可 typecheck：
 * pg 的最小介面於本檔本地宣告。故 sqlite-only 部署不需安裝 `pg`；只有實際呼叫 createPgDbPort 才載入。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import type { DbPort } from "./ports.js";

// ─────────────────────────────────────────────────────────────
// pg 的最小本地型別（避免對 @types/pg 的編譯期依賴）
// ─────────────────────────────────────────────────────────────
interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}
interface PgClient {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(): void;
}
interface PgPool {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgClient>;
  end(): Promise<void>;
}
interface PgTypes {
  setTypeParser(oid: number, parseFn: (val: string) => unknown): void;
}
interface PgModule {
  Pool: new (config: { connectionString: string }) => PgPool;
  types?: PgTypes;
}

/** createPgDbPort 的結果：對外 DbPort、底層 Pool（migrate 用）、close。 */
export interface PgHandle {
  port: DbPort;
  pool: PgPool;
  /** 關閉連線池（fire-and-forget，符合 CrmCore.close(): void）。 */
  close: () => void;
}

/** int8（bigint / COUNT(*) / SUM(int)）OID。node-postgres 預設把 int8 回成字串。 */
const OID_INT8 = 20;
let int8ParserInstalled = false;

/**
 * 把 SQLite 風格的 `?` 佔位符轉成 pg 的 `$1,$2,…`（依出現序編號）。
 * 跳過單引號字串字面量內的字元（含 SQL 標準的 `''` 逸出）——repo 目前無字面 `?`，此為防禦性保險。
 */
export function toPgPlaceholders(sql: string): string {
  let out = "";
  let n = 0;
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (inStr) {
      out += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          out += "'"; // 逸出的 '' → 一併輸出、仍在字串內
          i++;
        } else {
          inStr = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === "?") {
      n++;
      out += "$" + n;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * 建立 PgDbPort。connString＝標準 `postgres://user:pass@host:port/db`（Cloud SQL 走 socket 亦可）。
 * 動態載入 `pg`（未安裝則於此拋錯，指示部署補依賴）。
 */
export async function createPgDbPort(connString: string): Promise<PgHandle> {
  // 以 string-typed specifier 迴避 TS 對 import() 的靜態模組解析（無 @types/pg 亦 typecheck 綠）。
  const specifier: string = "pg";
  let pgMod: PgModule;
  try {
    pgMod = (await import(specifier)) as unknown as PgModule;
  } catch {
    throw new Error(
      "[crm] createPgDbPort 需要 'pg' 套件；請於部署安裝（npm i pg，DB_DRIVER=pg 時才需要）。",
    );
  }

  // bigint / COUNT(*) / SUM(int) 回 number（對齊 SQLite 的 number），使 repo 映射零改動。
  // epoch-ms（~1.7e12）與計數都 < 2^53，Number 無精度損失。全域一次性安裝。
  if (!int8ParserInstalled && pgMod.types) {
    pgMod.types.setTypeParser(OID_INT8, (v: string) => (v === null ? null : Number(v)));
    int8ParserInstalled = true;
  }

  const pool = new pgMod.Pool({ connectionString: connString });

  // 當前交易的 client（若在 tx 內）。無則各語句自 pool 取連線。
  const txClient = new AsyncLocalStorage<PgClient>();
  const executor = (): Pick<PgPool, "query"> => txClient.getStore() ?? pool;

  const port: DbPort = {
    async get<T>(sql: string, params: unknown[]): Promise<T | undefined> {
      const res = await executor().query(toPgPlaceholders(sql), params);
      return res.rows[0] as T | undefined;
    },
    async all<T>(sql: string, params: unknown[]): Promise<T[]> {
      const res = await executor().query(toPgPlaceholders(sql), params);
      return res.rows as T[];
    },
    async run(sql: string, params: unknown[]): Promise<{ changes: number }> {
      const res = await executor().query(toPgPlaceholders(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async tx<T>(fn: () => Promise<T>): Promise<T> {
      // 已在 tx 內（理論上無巢狀，但防禦）：直接 join，不再開新 BEGIN。
      const existing = txClient.getStore();
      if (existing) return fn();

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await txClient.run(client, () => fn());
        await client.query("COMMIT");
        return result;
      } catch (err) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* rollback 失敗不遮蔽原錯 */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };

  return {
    port,
    pool,
    close: () => {
      void pool.end();
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Postgres migration runner（對應 SqliteDbPort 的 migrate.ts）
// migrations-pg/NNN_*.sql（Adapt 階段建立）——與 SQLite migrations/ 平行、方言各異但版本號共用語意。
// 每支 .sql 於獨立 tx 內以 client.query(整檔)（無 params → simple protocol，允許多語句）套用並記錄。
// ─────────────────────────────────────────────────────────────
const MIGRATION_FILE_RE = /^(\d+)_.*\.sql$/;

/** schema_migrations（pg：applied_at 用 BIGINT 存 epoch-ms；version 小整數用 INTEGER）。 */
const SCHEMA_MIGRATIONS_DDL_PG = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at BIGINT NOT NULL
);`;

export async function runMigrationsPg(pool: PgPool, migrationsDir: string): Promise<void> {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(
      `[crm] pg migrations 目錄不存在：${migrationsDir}（Adapt 階段須建立 migrations-pg/ 並放 NNN_*.sql）。`,
    );
  }
  await pool.query(SCHEMA_MIGRATIONS_DDL_PG);

  const appliedRes = await pool.query("SELECT version FROM schema_migrations", []);
  const applied = new Set<number>(appliedRes.rows.map((r) => Number(r.version)));

  const files = fs
    .readdirSync(migrationsDir)
    .map((f): { version: number; name: string } | null => {
      const m = MIGRATION_FILE_RE.exec(f);
      return m ? { version: Number(m[1]), name: f } : null;
    })
    .filter((x): x is { version: number; name: string } => x !== null)
    .sort((a, b) => a.version - b.version);

  for (const mig of files) {
    if (applied.has(mig.version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, mig.name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql); // 無 params → simple protocol，允許整檔多語句
      await client.query("INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)", [
        mig.version,
        mig.name,
        Date.now(),
      ]);
      await client.query("COMMIT");
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }
}
