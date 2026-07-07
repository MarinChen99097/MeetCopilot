/**
 * B1 CRM repository 測試（vitest）。驗收接縫行為（M1_CONTRACT §1/§3、CRM_SCHEMA §8-9）：
 *  - migrate 建齊所有表
 *  - upsertFromCrawl：值+provenance 同 tx；重爬同 domain 更新不重複
 *  - update()：human provenance + supersede 舊列；confirm → verified=1
 *  - cosine search：org-scoped + entityTypes/entityIds 白名單（他 org 向量絕不外洩）
 *  - 信任整合：human 值壓過爬蟲（重爬不覆寫已細填欄）
 *  - findPrimaryOrgOf：最早加入的 org
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTestCore, listTableNames } from "./test-helpers.js";
import type { CrmCore } from "./ports.js";
import type { CrawlPayload } from "@meetcopilot/shared";

let core: CrmCore;
const ORG = "org-A";
const USER = "user-1";

beforeEach(async () => {
  core = await makeTestCore();
  await core.migrate();
  // 直接種 org（repo.create 會生 uuid，但測試想用固定 org id 便於斷言）。
  await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
    ORG,
    "Acme Seller",
    "zh-TW",
    Date.now(),
  ]);
});

afterEach(() => core.close());

describe("migrate", () => {
  it("creates all core tables", async () => {
    const names = new Set(await listTableNames(core));
    for (const t of [
      "companies",
      "contacts",
      "company_products",
      "company_product_people",
      "company_news",
      "company_departments",
      "deals",
      "deal_contacts",
      "notes",
      "field_provenance",
      "embeddings",
      "profile_cards",
      "crawl_jobs",
      "schema_migrations",
    ]) {
      expect(names.has(t)).toBe(true);
    }
  });
});

describe("CompanyRepository CRUD + list", () => {
  it("creates, finds, lists with filter+pagination", async () => {
    const a = await core.companies.create(ORG, { name: "Acme", domain: "acme.com", industry: "SaaS" });
    await core.companies.create(ORG, { name: "Globex", domain: "globex.com", industry: "Fintech" });
    expect(a.verifiedStatus).toBe("none");

    const found = await core.companies.findById(ORG, a.id);
    expect(found?.name).toBe("Acme");
    expect(found?.industry).toBe("SaaS");

    const byDomain = await core.companies.findByDomain(ORG, "acme.com");
    expect(byDomain?.id).toBe(a.id);

    const page = await core.companies.list(ORG, { query: "Acme" }, { page: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.items[0]?.name).toBe("Acme");

    const all = await core.companies.list(ORG, {}, { page: 1, pageSize: 1 });
    expect(all.total).toBe(2);
    expect(all.items.length).toBe(1); // pagination
  });

  it("counts children", async () => {
    const c = await core.companies.create(ORG, { name: "Acme", domain: "acme.com" });
    await core.contacts.create(ORG, c.id, { fullName: "Jane Doe" });
    await core.companyProducts.create(ORG, c.id, { name: "Widget" });
    const counts = await core.companies.counts(ORG, c.id);
    expect(counts.contacts).toBe(1);
    expect(counts.products).toBe(1);
    expect(counts.news).toBe(0);
    expect(counts.deals).toBe(0);
  });
});

describe("upsertFromCrawl", () => {
  const payload = (industry: string): CrawlPayload => ({
    company: { name: "Acme", industry },
    provenance: [{ fieldName: "industry", value: industry, sourceUrl: "https://acme.com/about", confidence: 0.8 }],
    contacts: [{ fullName: "Jane Doe", title: "CTO" }],
    news: [{ title: "Acme raises Series B", url: "https://news/1" }],
  });

  it("writes entity cols + crawler provenance in one tx", async () => {
    const c = await core.companies.upsertFromCrawl(ORG, "acme.com", payload("SaaS"));
    expect(c.industry).toBe("SaaS");
    expect(c.domain).toBe("acme.com");

    const prov = await core.provenance.listForEntity(ORG, "company", c.id);
    const ind = prov.find((p) => p.fieldName === "industry");
    expect(ind?.filledBy).toBe("crawler");
    expect(ind?.verified).toBe(0);
    expect(ind?.sourceUrl).toBe("https://acme.com/about");

    // children written
    const contacts = await core.contacts.list(ORG, c.id);
    expect(contacts.length).toBe(1);
    const news = await core.companyChildren.listNews(ORG, c.id);
    expect(news.length).toBe(1);
  });

  it("second crawl of same domain updates, not duplicates", async () => {
    const first = await core.companies.upsertFromCrawl(ORG, "acme.com", payload("SaaS"));
    const second = await core.companies.upsertFromCrawl(ORG, "acme.com", payload("Fintech"));
    expect(second.id).toBe(first.id);
    expect(second.industry).toBe("Fintech");

    const companyRows = await core.db.all<{ n: number }>(
      "SELECT COUNT(*) AS n FROM companies WHERE org_id = ? AND domain = ?",
      [ORG, "acme.com"],
    );
    expect(companyRows[0]?.n).toBe(1);

    // provenance: only one non-superseded industry row
    const live = await core.provenance.listForEntity(ORG, "company", first.id);
    const indRows = live.filter((p) => p.fieldName === "industry");
    expect(indRows.length).toBe(1);
    expect(indRows[0]?.valueSnapshot).toBe("Fintech");

    // children not duplicated
    const contacts = await core.contacts.list(ORG, first.id);
    expect(contacts.length).toBe(1);
    const news = await core.companyChildren.listNews(ORG, first.id);
    expect(news.length).toBe(1);
  });

  it("opts.targetId updates the named domain-less row and backfills its domain (no duplicate)", async () => {
    // Reproduces the enrich duplicate bug: a company created with NO domain (only name+websiteUrl).
    const target = await core.companies.create(ORG, { name: "Ghost", websiteUrl: "https://ghost.org" });
    expect(target.domain).toBeUndefined();

    // Enrich resolves domain from the URL host but the target row still has domain=NULL. Without targetId
    // the domain-dedupe would miss it and INSERT a second row; with targetId it must hit THIS row.
    const result = await core.companies.upsertFromCrawl(ORG, "ghost.org", payload("Publishing"), {
      targetId: target.id,
    });
    expect(result.id).toBe(target.id);
    expect(result.industry).toBe("Publishing");
    expect(result.domain).toBe("ghost.org"); // backfilled so future domain-dedupe works too

    // Exactly one company — no duplicate.
    const all = await core.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM companies WHERE org_id = ?", [ORG]);
    expect(all[0]?.n).toBe(1);

    // A second enrich (re-run) still updates the same row, never creates a second.
    const rerun = await core.companies.upsertFromCrawl(ORG, "ghost.org", payload("SaaS"), { targetId: target.id });
    expect(rerun.id).toBe(target.id);
    const after = await core.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM companies WHERE org_id = ?", [ORG]);
    expect(after[0]?.n).toBe(1);
  });
});

describe("update() human-override provenance", () => {
  it("creates human provenance and supersedes old", async () => {
    const c = await core.companies.upsertFromCrawl(ORG, "acme.com", {
      company: { name: "Acme", industry: "SaaS" },
      provenance: [{ fieldName: "industry", value: "SaaS", confidence: 0.7 }],
    });

    await core.companies.update(ORG, c.id, { industry: "Enterprise SaaS" }, { userId: USER });
    const after = await core.companies.findById(ORG, c.id);
    expect(after?.industry).toBe("Enterprise SaaS");
    expect(after?.verifiedStatus).toBe("partial");

    const prov = await core.provenance.listForEntity(ORG, "company", c.id);
    const ind = prov.find((p) => p.fieldName === "industry");
    expect(ind?.filledBy).toBe("human");
    expect(ind?.verified).toBe(1);
    expect(ind?.valueSnapshot).toBe("Enterprise SaaS");

    // raw: old crawler row superseded, exactly 2 rows for the field
    const raw = await core.db.all<{ superseded_by: string | null; filled_by: string }>(
      "SELECT superseded_by, filled_by FROM field_provenance WHERE org_id = ? AND entity_type = 'company' AND entity_id = ? AND field_name = 'industry' ORDER BY created_at ASC",
      [ORG, c.id],
    );
    expect(raw.length).toBe(2);
    expect(raw[0]?.filled_by).toBe("crawler");
    expect(raw[0]?.superseded_by).not.toBeNull();
    expect(raw[1]?.superseded_by).toBeNull();
  });

  it("confirm sets verified=1 without changing value", async () => {
    const c = await core.companies.upsertFromCrawl(ORG, "acme.com", {
      company: { name: "Acme", industry: "SaaS" },
      provenance: [{ fieldName: "industry", value: "SaaS", confidence: 0.7 }],
    });
    await core.provenance.confirm(ORG, "company", c.id, "industry", { userId: USER });
    const prov = await core.provenance.listForEntity(ORG, "company", c.id);
    const ind = prov.find((p) => p.fieldName === "industry");
    expect(ind?.verified).toBe(1);
    expect(ind?.valueSnapshot).toBe("SaaS");
    expect(ind?.filledBy).toBe("crawler"); // filled_by unchanged
  });
});

describe("trust integration: human value beats crawler", () => {
  it("re-crawl does not overwrite a human-filled field", async () => {
    const c = await core.companies.upsertFromCrawl(ORG, "acme.com", {
      company: { name: "Acme", industry: "SaaS" },
      provenance: [{ fieldName: "industry", value: "SaaS", confidence: 0.7 }],
    });
    // human overrides industry
    await core.companies.update(ORG, c.id, { industry: "Enterprise SaaS" }, { userId: USER });

    // crawler tries to overwrite with Fintech
    await core.companies.upsertFromCrawl(ORG, "acme.com", {
      company: { name: "Acme", industry: "Fintech" },
      provenance: [{ fieldName: "industry", value: "Fintech", confidence: 0.9 }],
    });

    const after = await core.companies.findById(ORG, c.id);
    expect(after?.industry).toBe("Enterprise SaaS"); // human wins

    const prov = await core.provenance.listForEntity(ORG, "company", c.id);
    const ind = prov.find((p) => p.fieldName === "industry");
    expect(ind?.filledBy).toBe("human"); // no crawler row superseded the human one
    expect(ind?.valueSnapshot).toBe("Enterprise SaaS");
  });
});

describe("EmbeddingRepository cosine search (org-scoped + whitelist)", () => {
  const vec = (x: number, y: number, z: number): number[] => [x, y, z];

  it("returns only org-scoped + whitelisted rows; never another org's", async () => {
    // seed a second org
    await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
      "org-B",
      "Attacker Org",
      "zh-TW",
      Date.now(),
    ]);

    await core.embeddings.upsert(ORG, [
      { entityType: "company_card", entityId: "co-1", content: "our company", contentHash: "h1", embedding: vec(1, 0, 0), dims: 3, model: "test" },
      { entityType: "contact_card", entityId: "ct-1", content: "our contact", contentHash: "h2", embedding: vec(0, 1, 0), dims: 3, model: "test" },
    ]);
    // Attacker org B has an embedding with the SAME entityId + a vector closer to the query.
    await core.embeddings.upsert("org-B", [
      { entityType: "company_card", entityId: "co-1", content: "SECRET other-org", contentHash: "h3", embedding: vec(1, 0, 0), dims: 3, model: "test" },
    ]);

    const hits = await core.embeddings.search(ORG, vec(1, 0, 0), { entityTypes: ["company_card"] }, 5);
    expect(hits.length).toBe(1);
    expect(hits[0]?.entityId).toBe("co-1");
    expect(hits[0]?.content).toBe("our company"); // never the org-B secret
    expect(hits.some((h) => h.content.includes("SECRET"))).toBe(false);

    // entityIds whitelist excludes the contact card
    const idFiltered = await core.embeddings.search(ORG, vec(0, 1, 0), { entityIds: ["co-1"] }, 5);
    expect(idFiltered.every((h) => h.entityId === "co-1")).toBe(true);
  });

  it("upsert dedupes by content_hash (no re-embed when unchanged)", async () => {
    await core.embeddings.upsert(ORG, [
      { entityType: "note", entityId: "n1", content: "x", contentHash: "same", embedding: [1, 2, 3], dims: 3, model: "test" },
    ]);
    await core.embeddings.upsert(ORG, [
      { entityType: "note", entityId: "n1", content: "x", contentHash: "same", embedding: [9, 9, 9], dims: 3, model: "test" },
    ]);
    const rows = await core.db.all<{ embedding: string; n: number }>(
      "SELECT embedding FROM embeddings WHERE org_id = ? AND entity_id = 'n1'",
      [ORG],
    );
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0]!.embedding)).toEqual([1, 2, 3]); // unchanged
  });
});

describe("DealRepository + committee", () => {
  it("creates deal with defaults and adds committee contacts", async () => {
    const co = await core.companies.create(ORG, { name: "Acme", domain: "acme.com" });
    const deal = await core.deals.create(ORG, { name: "Acme Q3", companyId: co.id });
    expect(deal.stage).toBe("prospect");
    expect(deal.status).toBe("open");

    const contact = await core.contacts.create(ORG, co.id, { fullName: "Jane Doe" });
    await core.deals.addContact(ORG, deal.id, { contactId: contact.id, role: "economic_buyer", stance: "supporter" });
    const committee = await core.deals.listContacts(ORG, deal.id);
    expect(committee.length).toBe(1);
    expect(committee[0]?.role).toBe("economic_buyer");

    const list = await core.deals.list(ORG, { companyId: co.id }, { page: 1, pageSize: 10 });
    expect(list.total).toBe(1);
  });
});

describe("NoteRepository (polymorphic)", () => {
  it("creates, lists by entity, updates, deletes", async () => {
    const co = await core.companies.create(ORG, { name: "Acme", domain: "acme.com" });
    const n = await core.notes.create(ORG, { entityType: "company", entityId: co.id, body: "hello", pinned: 1 });
    const list = await core.notes.list(ORG, "company", co.id);
    expect(list.length).toBe(1);
    expect(list[0]?.body).toBe("hello");

    await core.notes.update(ORG, n.id, { body: "updated" });
    const after = await core.notes.list(ORG, "company", co.id);
    expect(after[0]?.body).toBe("updated");

    await core.notes.delete(ORG, n.id);
    expect((await core.notes.list(ORG, "company", co.id)).length).toBe(0);
  });
});

describe("CompanyProduct people join", () => {
  it("adds and lists product people, then removes", async () => {
    const co = await core.companies.create(ORG, { name: "Acme", domain: "acme.com" });
    const prod = await core.companyProducts.create(ORG, co.id, { name: "Widget" });
    const person = await core.contacts.create(ORG, co.id, { fullName: "Jane Doe", title: "PM" });
    await core.companyProducts.addPerson(ORG, prod.id, { contactId: person.id, role: "pm", titleOnProduct: "Lead PM" });

    const people = await core.companyProducts.listPeople(ORG, prod.id);
    expect(people.length).toBe(1);
    expect(people[0]?.contact.fullName).toBe("Jane Doe");
    expect(people[0]?.role).toBe("pm");
    expect(people[0]?.titleOnProduct).toBe("Lead PM");

    await core.companyProducts.removePerson(ORG, prod.id, person.id);
    expect((await core.companyProducts.listPeople(ORG, prod.id)).length).toBe(0);
  });
});

describe("ProfileCardRepository", () => {
  it("upserts by (org, entityType, entityId)", async () => {
    await core.profileCards.upsert(ORG, { entityType: "company_card", entityId: "co-1", cardMarkdown: "v1", builtFromHash: "h1" });
    const got = await core.profileCards.get(ORG, "company_card", "co-1");
    expect(got?.cardMarkdown).toBe("v1");
    await core.profileCards.upsert(ORG, { entityType: "company_card", entityId: "co-1", cardMarkdown: "v2", builtFromHash: "h2" });
    const got2 = await core.profileCards.get(ORG, "company_card", "co-1");
    expect(got2?.cardMarkdown).toBe("v2");
    const rows = await core.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM profile_cards WHERE org_id = ?", [ORG]);
    expect(rows[0]?.n).toBe(1);
  });
});

describe("MembershipRepository.findPrimaryOrgOf", () => {
  it("returns earliest-joined org", async () => {
    await core.db.run("INSERT INTO orgs (id, name, default_locale, created_at) VALUES (?, ?, ?, ?)", [
      "org-B",
      "Second Org",
      "zh-TW",
      Date.now(),
    ]);
    await core.db.run("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)", [
      USER,
      "org-B",
      "member",
      2000,
    ]);
    await core.db.run("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)", [
      USER,
      ORG,
      "owner",
      1000,
    ]);
    const primary = await core.memberships.findPrimaryOrgOf(USER);
    expect(primary?.orgId).toBe(ORG); // created_at 1000 < 2000
    expect(primary?.role).toBe("owner");
    expect(await core.memberships.findPrimaryOrgOf("nobody")).toBeNull();
  });
});
