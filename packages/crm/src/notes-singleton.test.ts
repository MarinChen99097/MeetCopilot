/**
 * WP2 §2 + migration 013：notes 單例 upsert 與放寬後的 note_type CHECK（narrative / observations）。
 *  - upsertSingletonNote：同 (org, entity, note_type) 冪等（跑兩次不重複建，只更新 body/pinned）。
 *  - migration 013 放寬 CHECK：'narrative'/'observations' 可落庫（否則 INSERT 會被 CHECK 擋）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { makeTestCore } from "./test-helpers.js";
import type { CrmCore } from "./ports.js";

let core: CrmCore;
const ORG = "org-notes";
const COMPANY = "co-notes-1";

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "Notes Seller",
    "zh-TW",
    Date.now(),
  ]);
});

describe("upsertSingletonNote (WP2 §2)", () => {
  it("is idempotent: same company + note_type twice → one row, body updated", async () => {
    const first = await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: COMPANY,
      noteType: "narrative",
      body: "## AI 敘事：公司型態與狀況\n\n第一版敘事。",
      pinned: true,
    });
    expect(first.noteType).toBe("narrative");
    expect(first.pinned).toBe(1);

    const second = await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: COMPANY,
      noteType: "narrative",
      body: "## AI 敘事：公司型態與狀況\n\n第二版敘事（更新）。",
      pinned: true,
    });

    // 同一列（id 不變）、body 已更新。
    expect(second.id).toBe(first.id);
    expect(second.body).toContain("第二版敘事");

    const all = await core.notes.list(ORG, "company", COMPANY);
    const narratives = all.filter((n) => (n.noteType as string) === "narrative");
    expect(narratives).toHaveLength(1); // 跑兩次仍只有一則
  });

  it("supports the widened note_type CHECK (narrative + observations) — migration 013", async () => {
    await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: COMPANY,
      noteType: "narrative",
      body: "敘事",
      pinned: true,
    });
    await core.notes.upsertSingletonNote(ORG, {
      entityType: "company",
      entityId: COMPANY,
      noteType: "observations",
      body: "- 事實 A（[來源](https://example.com/a)）",
    });
    const types = (await core.notes.list(ORG, "company", COMPANY)).map((n) => n.noteType).sort();
    expect(types).toEqual(["narrative", "observations"]);
  });

  it("keeps distinct note_types as distinct singletons (narrative vs observations)", async () => {
    await core.notes.upsertSingletonNote(ORG, { entityType: "company", entityId: COMPANY, noteType: "narrative", body: "n1" });
    await core.notes.upsertSingletonNote(ORG, { entityType: "company", entityId: COMPANY, noteType: "observations", body: "o1" });
    await core.notes.upsertSingletonNote(ORG, { entityType: "company", entityId: COMPANY, noteType: "narrative", body: "n2" });
    const all = await core.notes.list(ORG, "company", COMPANY);
    expect(all).toHaveLength(2); // 一則 narrative + 一則 observations（narrative 被更新非新增）
  });
});
