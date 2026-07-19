/**
 * WS-A 資料層測試（vitest）：
 *  - mergeTitle：切段/去重/上限4/串接。
 *  - contacts upsert fullNameZh fallback 鍵（company-crawl CONTACT_SPEC 路徑 ＋ 深度路徑）命中/不命中＋title 累加＋fill-empty。
 *  - dedupeCompanyContacts：2 重複列合併（join 引用 re-point、deal_contacts PK 撞、provenance 併入、fill-empty、title 累加）
 *    ＋survivor 選擇（最舊）＋verified 保護（≥2 human-verified 跳過）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore } from "./test-helpers.js";
import type { CrmCore } from "./ports.js";
import type { CrawlPayload } from "@meetcopilot/shared";
import { mergeTitle, dedupeCompanyContacts } from "./contact-merge.js";

let core: CrmCore;
const ORG = "org-A";

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "Seller",
    "zh-TW",
    Date.now(),
  ]);
});

afterEach(() => core.close());

// ── helpers ──────────────────────────────────────────────────
async function insertContact(
  id: string,
  companyId: string,
  opts: {
    fullName: string;
    fullNameZh?: string;
    title?: string;
    titleZh?: string;
    bio?: string;
    photoUrl?: string;
    verifiedStatus?: string;
    createdAt: number;
  },
): Promise<void> {
  await core.db.run(
    `INSERT INTO contacts (id, org_id, company_id, full_name, full_name_zh, title, title_zh, bio, photo_url, verified_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      ORG,
      companyId,
      opts.fullName,
      opts.fullNameZh ?? null,
      opts.title ?? null,
      opts.titleZh ?? null,
      opts.bio ?? null,
      opts.photoUrl ?? null,
      opts.verifiedStatus ?? "none",
      opts.createdAt,
      opts.createdAt,
    ],
  );
}

async function contactIds(companyId: string): Promise<string[]> {
  const rows = await core.db.all<{ id: string }>(
    "SELECT id FROM contacts WHERE org_id = ? AND company_id = ? ORDER BY created_at ASC",
    [ORG, companyId],
  );
  return rows.map((r) => r.id);
}

// ── mergeTitle ───────────────────────────────────────────────
describe("mergeTitle", () => {
  it("回傳單邊、去重（大小寫不敏感）、上限 4 段、以「 · 」串接", () => {
    expect(mergeTitle(undefined, "PM")).toBe("PM");
    expect(mergeTitle("CEO", undefined)).toBe("CEO");
    expect(mergeTitle(null, null)).toBeUndefined();
    expect(mergeTitle("", "  ")).toBeUndefined();
    // 大小寫不敏感去重（保留 existing 顯示形）。
    expect(mergeTitle("CEO", "ceo")).toBe("CEO");
    // 分隔符：頓號/間隔號/全半形斜線；existing 在前、incoming 在後、去重。
    expect(mergeTitle("研發副總 · CTO", "CTO ／ 技術長")).toBe("研發副總 · CTO · 技術長");
    // 內部空白收斂。
    expect(mergeTitle("  Head   of  Sales ", "")).toBe("Head of Sales");
    // 上限 4 段。
    expect(mergeTitle("a、b", "c/d/e/f")).toBe("a · b · c · d");
  });
});

// ── company-crawl CONTACT_SPEC 路徑（fullNameZh fallback）──────
describe("company crawl contacts fullNameZh fallback", () => {
  function payload(contact: Record<string, unknown>): CrawlPayload {
    return { company: { name: "Acme" }, contacts: [contact], provenance: [] };
  }

  it("full_name 不同但 full_name_zh 相同 → 命中同一人，fill-empty＋title 累加，不新增列", async () => {
    const c1 = await core.companies.upsertFromCrawl(
      ORG,
      "acme.com",
      payload({ fullName: "Wang Ming", fullNameZh: "王明", title: "PM", bio: "first bio" }),
    );
    let ids = await contactIds(c1.id);
    expect(ids).toHaveLength(1);

    // 第二次爬：full_name 換寫法（不精配），full_name_zh 同 → fallback 命中。
    await core.companies.upsertFromCrawl(
      ORG,
      "acme.com",
      payload({ fullName: "Ming Wang", fullNameZh: "王明", title: "工程副總", bio: "second bio" }),
    );
    ids = await contactIds(c1.id);
    expect(ids).toHaveLength(1); // 未新增重複列

    const row = await core.db.get<{ full_name: string; title: string; bio: string }>(
      "SELECT full_name, title, bio FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, ids[0]],
    );
    expect(row?.full_name).toBe("Wang Ming"); // fill-empty：既有非空不被覆寫
    expect(row?.title).toBe("PM · 工程副總"); // 累加
    expect(row?.bio).toBe("first bio"); // fill-empty：既有非空保留
  });

  it("full_name_zh 不同 → 不命中，建立第二列", async () => {
    const c1 = await core.companies.upsertFromCrawl(
      ORG,
      "acme.com",
      payload({ fullName: "Wang Ming", fullNameZh: "王明", title: "PM" }),
    );
    await core.companies.upsertFromCrawl(
      ORG,
      "acme.com",
      payload({ fullName: "Li Si", fullNameZh: "李四", title: "CFO" }),
    );
    const ids = await contactIds(c1.id);
    expect(ids).toHaveLength(2);
  });
});

// ── 深度路徑（ContactRepository.upsertFromCrawl）fallback ──────
describe("deep contact upsert fullNameZh fallback", () => {
  it("fallback 命中：fill-empty＋title 累加＋provenance 只寫實際落庫欄且快照對齊", async () => {
    const company = await core.companies.create(ORG, { name: "Acme", domain: "acme.com" });

    await core.contacts.upsertFromCrawl(ORG, company.id, {
      contact: { fullName: "Wang Ming", fullNameZh: "王明", title: "PM", bio: "keep me" },
      provenance: [
        { fieldName: "title", value: "PM", sourceUrl: "https://a.com" },
        { fieldName: "bio", value: "keep me", sourceUrl: "https://a.com" },
      ],
    });

    await core.contacts.upsertFromCrawl(ORG, company.id, {
      contact: { fullName: "Ming Wang", fullNameZh: "王明", title: "技術長", bio: "should not overwrite" },
      provenance: [
        { fieldName: "title", value: "技術長", sourceUrl: "https://b.com" },
        { fieldName: "bio", value: "should not overwrite", sourceUrl: "https://b.com" },
      ],
    });

    const ids = await contactIds(company.id);
    expect(ids).toHaveLength(1);
    const row = await core.db.get<{ full_name: string; title: string; bio: string }>(
      "SELECT full_name, title, bio FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, ids[0]],
    );
    expect(row?.full_name).toBe("Wang Ming");
    expect(row?.title).toBe("PM · 技術長"); // 累加
    expect(row?.bio).toBe("keep me"); // fill-empty 保留

    // provenance：title 快照＝合併後值；bio（fill-empty 略過）不應被第二次來源 supersede。
    const titleProv = await core.db.get<{ value_snapshot: string; source_url: string }>(
      `SELECT value_snapshot, source_url FROM field_provenance
       WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND field_name = 'title' AND superseded_by IS NULL`,
      [ORG, ids[0]],
    );
    expect(titleProv?.value_snapshot).toBe("PM · 技術長"); // 與欄位一致，不漂移

    const bioProv = await core.db.get<{ value_snapshot: string; source_url: string }>(
      `SELECT value_snapshot, source_url FROM field_provenance
       WHERE org_id = ? AND entity_type = 'contact' AND entity_id = ? AND field_name = 'bio' AND superseded_by IS NULL`,
      [ORG, ids[0]],
    );
    expect(bioProv?.value_snapshot).toBe("keep me"); // 未被第二次覆寫
    expect(bioProv?.source_url).toBe("https://a.com");
  });
});

// ── dedupeCompanyContacts ────────────────────────────────────
describe("dedupeCompanyContacts", () => {
  const COMPANY = "co-1";

  it("合併重複列：survivor＝最舊，fill-empty＋title 累加＋join re-point＋deal_contacts PK 撞", async () => {
    // survivor（最舊）：有 title、無 photo。victim（較新）：無 title 但有 photo、有 bio。
    await insertContact("c-old", COMPANY, {
      fullName: "Wang Ming",
      fullNameZh: "王明",
      title: "PM",
      createdAt: 100,
    });
    await insertContact("c-new", COMPANY, {
      fullName: "Ming Wang",
      fullNameZh: "王明",
      title: "工程師",
      bio: "victim bio",
      photoUrl: "https://p/x.jpg",
      createdAt: 200,
    });

    // join 引用指向 victim。
    await core.db.run(
      `INSERT INTO company_product_people (id, org_id, company_id, product_id, contact_id, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["pp1", ORG, COMPANY, "prod-1", "c-new", "pm", Date.now()],
    );
    // deals：primary_contact_id 指向 victim。
    await core.db.run(
      `INSERT INTO deals (id, org_id, company_id, name, primary_contact_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["d1", ORG, COMPANY, "Deal 1", "c-new", Date.now(), Date.now()],
    );
    // deal_contacts：survivor 與 victim 同在 d1（PK 撞）；victim 另在 d2。
    for (const [deal, contact] of [
      ["d1", "c-old"],
      ["d1", "c-new"],
      ["d2", "c-new"],
    ] as const) {
      await core.db.run(
        "INSERT INTO deal_contacts (deal_id, contact_id, org_id, role) VALUES (?, ?, ?, ?)",
        [deal, contact, ORG, "champion"],
      );
    }
    // provenance：victim 有 bio（survivor 沒有）→ 應 re-point 到 survivor。
    await core.provenance.record(ORG, [
      { entityType: "contact", entityId: "c-new", fieldName: "bio", valueSnapshot: "victim bio", filledBy: "crawler" },
    ]);

    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    expect(res.contactsRemoved).toBe(1);
    expect(res.groupsSkipped).toBe(0);

    const ids = await contactIds(COMPANY);
    expect(ids).toEqual(["c-old"]); // survivor 保留、victim 刪除

    const row = await core.db.get<{ title: string; bio: string; photo_url: string }>(
      "SELECT title, bio, photo_url FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, "c-old"],
    );
    expect(row?.title).toBe("PM · 工程師"); // 累加
    expect(row?.bio).toBe("victim bio"); // fill-empty（survivor 空→取 victim）
    expect(row?.photo_url).toBe("https://p/x.jpg"); // fill-empty

    // join re-point。
    const pp = await core.db.get<{ contact_id: string }>(
      "SELECT contact_id FROM company_product_people WHERE org_id = ? AND id = 'pp1'",
      [ORG],
    );
    expect(pp?.contact_id).toBe("c-old");
    const deal = await core.db.get<{ primary_contact_id: string }>(
      "SELECT primary_contact_id FROM deals WHERE org_id = ? AND id = 'd1'",
      [ORG],
    );
    expect(deal?.primary_contact_id).toBe("c-old");

    // deal_contacts：PK 撞的 (d1,c-new) 被刪；(d2,c-new)→(d2,c-old)。最終 (d1,c-old)＋(d2,c-old)。
    const dcRows = await core.db.all<{ deal_id: string; contact_id: string }>(
      "SELECT deal_id, contact_id FROM deal_contacts WHERE org_id = ? ORDER BY deal_id",
      [ORG],
    );
    expect(dcRows).toEqual([
      { deal_id: "d1", contact_id: "c-old" },
      { deal_id: "d2", contact_id: "c-old" },
    ]);

    // provenance bio 併到 survivor。
    const bioProv = await core.db.get<{ value_snapshot: string }>(
      `SELECT value_snapshot FROM field_provenance
       WHERE org_id = ? AND entity_type = 'contact' AND entity_id = 'c-old' AND field_name = 'bio' AND superseded_by IS NULL`,
      [ORG],
    );
    expect(bioProv?.value_snapshot).toBe("victim bio");
    // victim 不再有 provenance。
    const leftover = await core.db.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM field_provenance WHERE org_id = ? AND entity_id = 'c-new'",
      [ORG],
    );
    expect(leftover?.n).toBe(0);
  });

  it("群內 ≥2 human-verified → 跳過該群，不刪任何列", async () => {
    await insertContact("v1", COMPANY, {
      fullName: "A One",
      fullNameZh: "同名",
      verifiedStatus: "verified",
      createdAt: 100,
    });
    await insertContact("v2", COMPANY, {
      fullName: "A Two",
      fullNameZh: "同名",
      verifiedStatus: "verified",
      createdAt: 200,
    });

    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsSkipped).toBe(1);
    expect(res.groupsMerged).toBe(0);
    const ids = await contactIds(COMPANY);
    expect(ids.sort()).toEqual(["v1", "v2"]);
  });

  it("唯一 human-verified 列即為 survivor（即使不是最舊）", async () => {
    await insertContact("older", COMPANY, { fullName: "X A", fullNameZh: "同人", createdAt: 100 });
    await insertContact("verified-new", COMPANY, {
      fullName: "X B",
      fullNameZh: "同人",
      verifiedStatus: "verified",
      createdAt: 300,
    });

    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    const ids = await contactIds(COMPANY);
    expect(ids).toEqual(["verified-new"]); // human-verified 勝過「最舊」
  });

  it("無重複（每個 full_name_zh 僅一列）→ 不動任何列", async () => {
    await insertContact("s1", COMPANY, { fullName: "P One", fullNameZh: "甲", createdAt: 100 });
    await insertContact("s2", COMPANY, { fullName: "P Two", fullNameZh: "乙", createdAt: 200 });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(0);
    expect(res.contactsRemoved).toBe(0);
    expect((await contactIds(COMPANY)).sort()).toEqual(["s1", "s2"]);
  });

  // ── 真實 E2E 變體：Connact AI 殘餘 3 列程峻宏（3→1）───────────────
  it("程峻宏三變體收斂（CJK 內嵌抽取＋羅馬拼音等值橋接）：3→1、full_name_zh 保留、頭銜累加", async () => {
    // (A) full_name_zh 已填（zh 鍵直接命中）＝ survivor（最舊）。
    await insertContact("cheng-A", COMPANY, {
      fullName: "Troy Cheng",
      fullNameZh: "程峻宏",
      title: "理事長",
      createdAt: 100,
    });
    // (B) full_name_zh 空、full_name 內嵌 CJK「(程峻宏)」→ 抽出後入 程峻宏 群。
    await insertContact("cheng-B", COMPANY, {
      fullName: "Cheng Chun-hung (程峻宏)",
      title: "秘書長",
      createdAt: 200,
    });
    // (C) full_name_zh 空、full_name 無 CJK；正規化 chengchunhung == B 去括號後 chengchunhung → 橋接入群。
    await insertContact("cheng-C", COMPANY, {
      fullName: "Cheng Chun-Hung",
      title: "顧問",
      createdAt: 300,
    });

    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    expect(res.contactsRemoved).toBe(2);
    expect(res.groupsSkipped).toBe(0);

    const ids = await contactIds(COMPANY);
    expect(ids).toEqual(["cheng-A"]); // 3→1，survivor＝最舊

    const row = await core.db.get<{ full_name: string; full_name_zh: string; title: string }>(
      "SELECT full_name, full_name_zh, title FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, "cheng-A"],
    );
    expect(row?.full_name).toBe("Troy Cheng"); // survivor 非空 full_name 不被覆寫
    expect(row?.full_name_zh).toBe("程峻宏"); // full_name_zh 保留（survivor 已有）
    expect(row?.title).toBe("理事長 · 秘書長 · 顧問"); // 頭銜累加（A→B→C 依 created_at）
  });

  it("CJK 內嵌抽取＋回填：survivor 無 full_name_zh 時，用抽出的中文名回填", async () => {
    // survivor（最舊）full_name_zh 空、但 full_name 內嵌「(王大明)」。
    await insertContact("wang-A", COMPANY, {
      fullName: "Wang Da-ming (王大明)",
      title: "總經理",
      createdAt: 100,
    });
    // 羅馬變體 wangdaming == 去括號後相等 → 橋接入群。
    await insertContact("wang-B", COMPANY, {
      fullName: "Wang Daming",
      title: "創辦人",
      createdAt: 200,
    });

    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    expect(res.contactsRemoved).toBe(1);

    const ids = await contactIds(COMPANY);
    expect(ids).toEqual(["wang-A"]);
    const row = await core.db.get<{ full_name: string; full_name_zh: string; title: string }>(
      "SELECT full_name, full_name_zh, title FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, "wang-A"],
    );
    expect(row?.full_name_zh).toBe("王大明"); // 抽出的中文名回填到原本空的 full_name_zh
    expect(row?.title).toBe("總經理 · 創辦人");
  });

  it("羅馬拼音嚴格全等：David Chen ≠ David Cheng（同公司不同人不併）", async () => {
    await insertContact("david-chen", COMPANY, { fullName: "David Chen", createdAt: 100 });
    await insertContact("david-cheng", COMPANY, { fullName: "David Cheng", createdAt: 200 });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(0); // davidchen ≠ davidcheng，不橋接
    expect(res.contactsRemoved).toBe(0);
    expect((await contactIds(COMPANY)).sort()).toEqual(["david-chen", "david-cheng"]);
  });

  it("CJK 內嵌護欄：地名 stoplist「台北」不當人名鍵——John (台北) 與 Mary (台北) 不同組", async () => {
    // 舊版：full_name 內嵌 CJK「台北」被抽為 zh 鍵 → 兩位不同的人誤併。
    // 護欄(b)：「台北」在 stoplist → 不當鍵；兩列各自羅馬正規化（john≠mary）→ 落單、不併。
    await insertContact("john-tp", COMPANY, { fullName: "John (台北)", title: "Sales", createdAt: 100 });
    await insertContact("mary-tp", COMPANY, { fullName: "Mary (台北)", title: "Marketing", createdAt: 200 });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(0);
    expect(res.contactsRemoved).toBe(0);
    expect((await contactIds(COMPANY)).sort()).toEqual(["john-tp", "mary-tp"]);
  });

  it("CJK 內嵌護欄：≥5 字段（辦公室/描述）不當人名鍵——兩列不同組", async () => {
    // 「台北辦公室」5 字 → 護欄(a) 略過；roman(annchen)≠roman(bobwang) → 不併。
    await insertContact("ann-5", COMPANY, { fullName: "Ann Chen 台北辦公室", createdAt: 100 });
    await insertContact("bob-5", COMPANY, { fullName: "Bob Wang 台北辦公室", createdAt: 200 });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(0);
    expect((await contactIds(COMPANY)).sort()).toEqual(["ann-5", "bob-5"]);
  });

  it("CJK 內嵌護欄 regression：合法中文名（程峻宏，3 字非 stoplist）照常入組", async () => {
    // 護欄不得誤傷正常人名：3 字、不在 stoplist → 仍抽為 zh 鍵，B/C 收斂進 A。
    await insertContact("cheng-A", COMPANY, {
      fullName: "Troy Cheng",
      fullNameZh: "程峻宏",
      title: "理事長",
      createdAt: 100,
    });
    await insertContact("cheng-B", COMPANY, {
      fullName: "Cheng Chun-hung (程峻宏)",
      title: "秘書長",
      createdAt: 200,
    });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    expect(res.contactsRemoved).toBe(1);
    expect(await contactIds(COMPANY)).toEqual(["cheng-A"]);
    const row = await core.db.get<{ full_name_zh: string; title: string }>(
      "SELECT full_name_zh, title FROM contacts WHERE org_id = ? AND id = ?",
      [ORG, "cheng-A"],
    );
    expect(row?.full_name_zh).toBe("程峻宏");
    expect(row?.title).toBe("理事長 · 秘書長");
  });

  it("契約既知風險不變：同公司兩位不同的陳志明（zh 鍵同名）仍會併", async () => {
    // 無英文名可辨、full_name_zh 同名 → zh 鍵分組必然同群（維持既有契約風險，未改變）。
    await insertContact("ming-1", COMPANY, { fullName: "陳志明", fullNameZh: "陳志明", createdAt: 100 });
    await insertContact("ming-2", COMPANY, { fullName: "陳志明", fullNameZh: "陳志明", createdAt: 200 });
    const res = await dedupeCompanyContacts(core.db, ORG, COMPANY);
    expect(res.groupsMerged).toBe(1);
    expect(res.contactsRemoved).toBe(1);
    expect(await contactIds(COMPANY)).toEqual(["ming-1"]);
  });
});
