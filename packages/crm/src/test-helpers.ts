/**
 * makeTestCore — 測試專用的 CrmCore 工廠，讓「同一套測試、同一組斷言」能在 SQLite 與 Postgres 兩驅動上跑。
 *
 * 選擇：環境變數 TEST_DB_DRIVER=sqlite|pg（預設 sqlite）。
 *  - sqlite：一如既往 createCrmCore(":memory:")，每次全新記憶體庫（完全隔離）。
 *  - pg：DATABASE_URL 指向真實 Postgres。為了對齊「每個 :memory: 都是全新空庫」的隔離語意，
 *        每次呼叫都建立一個**唯一 schema**，用連線字串的 `options=-c search_path=<schema>` 讓該 core 的
 *        所有 pooled 連線都只在此 schema 內建表/查詢——彼此（含平行 worker）零碰撞。
 *        schema 不主動清除：測試容器用完即 docker rm，殘留 schema 無害。
 *
 * 不弱化任何斷言：core 的行為與回傳形狀完全來自正式 createCrmCore + 正式 repositories，
 * 這裡只決定「連哪個庫、放哪個 schema」。
 */
import { createCrmCore } from "./core.js";
import type { CrmCore } from "./ports.js";

let counter = 0;

/**
 * rejectionName — 等一個必定 reject 的 promise，回傳它那個錯誤的 `name`，供 `toBe("XxxError")` 斷言。
 *
 * 用途：取代 `await expect(p).rejects.toBeInstanceOf(XxxError)`。**不是為了放寬斷言，是為了讓斷言穩定**——
 * Windows 上 vitest/vite 偶爾把同一個檔案以不同磁碟機代號大小寫（同一份失敗 log 內同時出現 `c:\…` 與
 * `C:\…`）視為兩個模組各求值一次，於是「測試檔 import 進來的 class 物件」與「產線程式碼實際 new 出來的」
 * 不是同一個，`instanceof` 就隨機判偽。`name` 由各 error class 的 constructor 寫死且彼此唯一，判別力與
 * `instanceof` 相同，卻完全不依賴模組身分。
 *
 * 嚴格度保留：promise 若 resolve、或 reject 的東西不是 Error，都會回傳一個**不可能與任何 error name 相等**
 * 的哨兵字串，斷言照樣失敗，且訊息直接說明是哪一種情況。刻意不 import vitest（本檔會被編進 dist）。
 */
export async function rejectionName(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "<resolved: expected a rejection>";
  } catch (e) {
    return e instanceof Error ? e.name : `<non-Error rejection: ${typeof e}>`;
  }
}

/** 建一個測試用 CrmCore（尚未 migrate；呼叫端負責 await core.migrate()，與既有測試相同）。 */
export async function makeTestCore(): Promise<CrmCore> {
  const driver = process.env.TEST_DB_DRIVER ?? "sqlite";
  if (driver !== "pg") {
    return createCrmCore(":memory:");
  }

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error("[crm/test] TEST_DB_DRIVER=pg 需要 DATABASE_URL。");
  }

  const worker = process.env.VITEST_WORKER_ID ?? process.env.VITEST_POOL_ID ?? "0";
  const schema = `t_${worker}_${Date.now().toString(36)}_${(counter++).toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;

  // 以 string-typed specifier 迴避 TS 對 import() 的靜態解析（與 pg-db.ts 一致）。
  const specifier: string = "pg";
  const pg = (await import(specifier)) as unknown as {
    Client: new (cfg: { connectionString: string }) => {
      connect(): Promise<void>;
      query(text: string): Promise<unknown>;
      end(): Promise<void>;
    };
  };
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await admin.end();

  const sep = base.includes("?") ? "&" : "?";
  const url = `${base}${sep}options=${encodeURIComponent(`-c search_path=${schema}`)}`;
  return createCrmCore({ driver: "pg", connString: url });
}

/**
 * 列出目前庫（測試 schema）內所有 table 名——驅動感知：
 *  - sqlite：sqlite_master（type='table'）。
 *  - pg：information_schema.tables 且 table_schema=current_schema()（即本測試的隔離 schema）。
 * 供「migrate 是否建出預期表」的斷言使用；斷言本身（toContain / has）在兩驅動完全相同、不弱化。
 */
export async function listTableNames(core: CrmCore): Promise<string[]> {
  const driver = process.env.TEST_DB_DRIVER ?? "sqlite";
  if (driver === "pg") {
    const rows = await core.db.all<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()",
      [],
    );
    return rows.map((r) => r.name);
  }
  const rows = await core.db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
    [],
  );
  return rows.map((r) => r.name);
}
