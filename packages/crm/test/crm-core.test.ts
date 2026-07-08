/**
 * A2 驗收測試（vitest, in-memory DB）：
 *  (a) migrate 建出 3 張租戶表；
 *  (b) org-scoping：org A 的成員無法經 org B scope 讀到（攻擊者式斷言）；
 *  (c) tx：tx(fn) 內丟例外 → 寫入 rollback。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore, listTableNames } from "../src/test-helpers.js";
import type { CrmCore } from "../src/ports.js";

let core: CrmCore;

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

  it("is idempotent (re-running applies nothing)", async () => {
    await core.migrate(); // second run must not throw / re-apply
    const applied = await core.db.all<{ version: number }>(
      "SELECT version FROM schema_migrations ORDER BY version",
      [],
    );
    // idempotency＝二次 migrate 不重複套用：版本集為 1..N 連續且無重複（不隨新增 migration 脆裂）。
    const versions = applied.map((r) => r.version);
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));
    expect(new Set(versions).size).toBe(versions.length); // 無重複套用
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
