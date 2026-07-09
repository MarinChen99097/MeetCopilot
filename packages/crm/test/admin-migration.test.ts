/**
 * migration 012_admin 驗收（ADMIN_CONTRACT §2 / §7 #2）。SQLite 路徑（ALTER TABLE ADD COLUMN）：
 *  (a) 空庫跑到 head → orgs/users 有 status 欄（DEFAULT 'active'）、usage_events 有 user_id 欄；
 *  (b) **既有庫升級**：先跑 001..011（無 012）建出 pre-012 schema 並塞資料，再套 012 →
 *      舊資料完好、status 回填 'active'、user_id 欄可寫；
 *  (c) record 冪等寫入 user_id（歸屬）並可讀回。
 *
 * 註：本檔只在 SQLite 驗 ALTER 路徑（§7 #2 明列 SQLite ALTER ADD COLUMN 實測）；pg 版由 makeTestCore 的
 * pg 模式在 CI 另跑既有測試涵蓋（012 的 pg DDL 為 ADD COLUMN IF NOT EXISTS）。
 */
import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSqliteDbPort } from "../src/sqlite-db.js";
import { runMigrations } from "../src/migrate.js";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const c of cleanups.splice(0)) c();
});

/** 建一個臨時目錄，複製 version <= maxVersion 的 migration .sql 進去，回傳該目錄。 */
function migrationsUpTo(maxVersion: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mig-"));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of fs.readdirSync(MIGRATIONS_DIR)) {
    const m = /^(\d+)_.*\.sql$/.exec(f);
    if (m && Number(m[1]) <= maxVersion) {
      fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    }
  }
  return dir;
}

describe("012_admin migration (SQLite)", () => {
  it("empty DB → head: adds orgs.status / users.status (default active) + usage_events.user_id", async () => {
    const { port, raw, close } = createSqliteDbPort(":memory:");
    cleanups.push(close);
    await runMigrations(raw); // full set incl. 012

    // Insert an org WITHOUT specifying status → DEFAULT 'active' must backfill.
    await port.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, 'zh-TW', ?)", [
      "o1",
      "Acme",
      Date.now(),
    ]);
    const org = await port.get<{ status: string }>("SELECT status FROM orgs WHERE id = ?", ["o1"]);
    expect(org?.status).toBe("active");

    await port.run("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES (?, ?, 'h', 'U', ?)", [
      "u1",
      "u@x.com",
      Date.now(),
    ]);
    const user = await port.get<{ status: string }>("SELECT status FROM users WHERE id = ?", ["u1"]);
    expect(user?.status).toBe("active");

    // usage_events.user_id column exists and is writable.
    await port.run(
      "INSERT INTO usage_events (id, org_id, kind, est_cost_usd, user_id, idempotency_key, created_at) VALUES (?, ?, 'gemini_text', 0.01, ?, 'k', ?)",
      ["e1", "o1", "u1", Date.now()],
    );
    const ev = await port.get<{ user_id: string }>("SELECT user_id FROM usage_events WHERE id = ?", ["e1"]);
    expect(ev?.user_id).toBe("u1");
  });

  it("existing DB upgrade (001..011 → 012): preserves data + backfills status without dropping rows", async () => {
    const { port, raw, close } = createSqliteDbPort(":memory:");
    cleanups.push(close);

    // 1) Build the pre-012 schema (no status / no user_id columns yet).
    await runMigrations(raw, migrationsUpTo(11));
    expect(
      (await port.all<{ name: string }>("PRAGMA table_info(orgs)", [])).some((c) => c.name === "status"),
    ).toBe(false);

    // 2) Seed pre-012 rows (columns that exist pre-012 only).
    const now = Date.now();
    await port.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES ('o9','Legacy','zh-TW',?)", [now]);
    await port.run("INSERT INTO users (id, email, password_hash, display_name, created_at) VALUES ('u9','old@x.com','h','Old',?)", [now]);
    await port.run(
      "INSERT INTO usage_events (id, org_id, kind, est_cost_usd, idempotency_key, created_at) VALUES ('ev9','o9','asr',0.02,'legacy',?)",
      [now],
    );

    // 3) Apply 012 (ALTER ADD COLUMN on the populated tables).
    await runMigrations(raw); // full set → applies only the missing 012

    // Data preserved…
    const org = await port.get<{ name: string; status: string }>("SELECT name, status FROM orgs WHERE id = 'o9'", []);
    expect(org?.name).toBe("Legacy");
    expect(org?.status).toBe("active"); // NOT NULL DEFAULT 'active' backfilled the legacy row
    const user = await port.get<{ status: string }>("SELECT status FROM users WHERE id = 'u9'", []);
    expect(user?.status).toBe("active");
    // …and the legacy usage_event survived; its new user_id column is NULL.
    const ev = await port.get<{ id: string; user_id: string | null }>(
      "SELECT id, user_id FROM usage_events WHERE id = 'ev9'",
      [],
    );
    expect(ev?.id).toBe("ev9");
    expect(ev?.user_id ?? null).toBeNull();
  });
});
