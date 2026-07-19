/**
 * A2 驗收測試（vitest, in-memory DB）：
 *  (a) migrate 建出 3 張租戶表；
 *  (b) org-scoping：org A 的成員無法經 org B scope 讀到（攻擊者式斷言）；
 *  (c) tx：tx(fn) 內丟例外 → 寫入 rollback。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeTestCore, listTableNames } from "../src/test-helpers.js";
import type { CrmCore } from "../src/ports.js";

let core: CrmCore;

/**
 * 列出目前驅動對應的 migration 檔版本號（sqlite→migrations/、pg→migrations-pg/），解析 NNN_ 前綴。
 * 與 migrate runner 的 MIGRATION_FILE_RE 同義，供「每支 migration 檔恰對一個 applied 版本」斷言。
 */
function listMigrationFileVersions(): number[] {
  const driver = process.env.TEST_DB_DRIVER ?? "sqlite";
  const dirName = driver === "pg" ? "migrations-pg" : "migrations";
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", dirName);
  return fs
    .readdirSync(dir)
    .map((f) => /^(\d+)_.*\.sql$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]));
}

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
});

afterEach(() => {
  core.close();
});

describe("migrate", () => {
  it("creates the 3 tenancy tables", async () => {
    const names = await listTableNames(core);
    expect(names).toContain("orgs");
    expect(names).toContain("users");
    expect(names).toContain("memberships");
  });

  it("is idempotent (re-running applies nothing; gap-tolerant)", async () => {
    // 平行分支合法產生版本間隙：例如主樹先佔用 016/017，本支「deck 匯入」migration 用 018，
    // 於本 worktree 的版本序即為 …015,018（缺 016/017）。真正的不變量 ＝ 版本唯一 ＋ 嚴格遞增 ＋
    // 重跑穩定（第二次 migrate 不重複套用），而非「1..N 連續」——後者在平行分支會脆裂誤報。
    const readVersions = async (): Promise<number[]> =>
      (
        await core.db.all<{ version: number }>(
          "SELECT version FROM schema_migrations ORDER BY version",
          [],
        )
      ).map((r) => r.version);

    const before = await readVersions(); // beforeEach 已 migrate 一次
    await core.migrate(); // 第二次 migrate 不得 throw / 重複套用
    const after = await readVersions();

    // 冪等：二次 migrate 後 applied 版本集完全不變（重跑穩定）。
    expect(after).toEqual(before);
    // 無重複套用：每個版本至多一列。
    expect(new Set(after).size).toBe(after.length);
    // 嚴格遞增（不要求連續；只要求唯一且有序遞增）。
    for (let i = 1; i < after.length; i++) {
      expect(after[i]).toBeGreaterThan(after[i - 1]);
    }
    // 每支 migration 檔恰對一個 applied 版本（不漏套、不多套），即使版本序有間隙亦然。
    const fileVersions = listMigrationFileVersions();
    expect(after.length).toBe(fileVersions.length);
    expect(new Set(after)).toEqual(new Set(fileVersions));
  });
});

describe("org-scoping (tenant isolation)", () => {
  it("a membership in org A cannot be read via org B scope", async () => {
    const orgA = await core.orgs.create({ name: "Org A" });
    const orgB = await core.orgs.create({ name: "Org B" });
    const user = await core.users.create({
      email: "victim@example.com",
      passwordHash: "hash",
      displayName: "Victim",
    });
    await core.memberships.addMembership(orgA.id, user.id, "member");

    // legitimate read via the owning org scope
    expect(await core.memberships.roleOf(orgA.id, user.id)).toBe("member");

    // attacker: same user id, wrong (org B) scope → must be null
    expect(await core.memberships.roleOf(orgB.id, user.id)).toBeNull();
  });

  it("orgs.findById returns the persisted org", async () => {
    const created = await core.orgs.create({ name: "Acme", plan: "pro" });
    const found = await core.orgs.findById(created.id);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("Acme");
    expect(found?.defaultLocale).toBe("zh-TW");
    expect(found?.plan).toBe("pro");
  });

  it("users.findByEmail is a global lookup", async () => {
    const u = await core.users.create({
      email: "u@example.com",
      passwordHash: "h",
      displayName: "U",
    });
    const found = await core.users.findByEmail("u@example.com");
    expect(found?.id).toBe(u.id);
    expect(await core.users.findByEmail("nobody@example.com")).toBeNull();
  });
});

describe("tx rollback", () => {
  it("throwing inside tx(fn) rolls back the write", async () => {
    const bogusId = "rollback-victim";
    await expect(
      core.db.tx(async () => {
        await core.db.run(
          "INSERT INTO orgs (id, name, default_locale, plan, created_at) VALUES (?, ?, ?, ?, ?)",
          [bogusId, "Should Vanish", "zh-TW", null, Date.now()],
        );
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // the insert must not have survived the rollback
    const found = await core.orgs.findById(bogusId);
    expect(found).toBeNull();
  });

  it("tx(fn) commits when fn succeeds", async () => {
    const id = "commit-ok";
    await core.db.tx(async () => {
      await core.db.run(
        "INSERT INTO orgs (id, name, default_locale, plan, created_at) VALUES (?, ?, ?, ?, ?)",
        [id, "Persisted", "zh-TW", null, Date.now()],
      );
    });
    const found = await core.orgs.findById(id);
    expect(found?.name).toBe("Persisted");
  });
});
