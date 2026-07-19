/**
 * 對方側 repositories（CRM_SCHEMA §4-5）：Company / Contact / CompanyProduct / CompanyChild。
 * 每個讀寫 org-scoped（WHERE org_id=?）；row↔domain 映射由 mappers 的 FieldDef 驅動；
 * upsertFromCrawl 於單一 tx 寫實體欄位 + provenance（值/來源永不漂移），並以 findByDomain/自然鍵 dedupe。
 */
import type { DbPort } from "./ports.js";
import type {
  CompanyRepository,
  ContactRepository,
  CompanyProductRepository,
  CompanyChildRepository,
  CompanyFilter,
  CrawlUpsertOptions,
  Page,
  Paged,
  ByUser,
  CompanyCounts,
} from "./ports.js";
import type {
  Company,
  CompanySummary,
  NewCompany,
  CrawlPayload,
  Contact,
  ContactSummary,
  NewContact,
  ContactCrawlPayload,
  CompanyProduct,
  NewCompanyProduct,
  CompanyProductPerson,
  NewCompanyProductPerson,
  ProductPersonLink,
  CompanyNews,
  NewCompanyNews,
  CompanyLocation,
  NewCompanyLocation,
  CompanyFunding,
  NewCompanyFunding,
  CompanyTech,
  NewCompanyTech,
  CompanyDepartment,
  NewCompanyDepartment,
  NewProvenance,
  VerifiedStatus,
  AccountStatus,
  Seniority,
  DecisionPower,
  ProductPersonRole,
} from "@meetcopilot/shared";
import {
  rowToDomain,
  patchToRecord,
  insertRow,
  uuidv7,
  COMPANY_DEFS,
  CONTACT_DEFS,
  COMPANY_PRODUCT_DEFS,
  COMPANY_NEWS_DEFS,
  COMPANY_LOCATION_DEFS,
  COMPANY_FUNDING_DEFS,
  COMPANY_TECH_DEFS,
  COMPANY_DEPARTMENT_DEFS,
  PRODUCT_PERSON_DEFS,
} from "./mappers.js";
import { applyHumanUpdate } from "./update-apply.js";
import { recordProvenanceRows, trustedFieldsOf } from "./provenance-write.js";
import { upsertChild, type ChildUpsertSpec } from "./child-upsert.js";
import { accumulateAndFillEmpty, CONTACT_KEY_TO_COL } from "./contact-merge.js";

// ── child upsert specs（自然鍵 dedupe；見 child-upsert.ts）──
const CONTACT_SPEC: ChildUpsertSpec = {
  table: "contacts",
  defs: CONTACT_DEFS,
  matchCols: ["full_name"],
  hasUpdatedAt: true,
  sysOnInsert: { verified_status: "none", source: "crawler" },
  // full_name 落空 → 以 full_name_zh 再配一次（fill-empty 合併）；title/title_zh 累加。
  fallbackMatchCols: ["full_name_zh"],
  accumulateCols: ["title", "title_zh"],
};
const PRODUCT_SPEC: ChildUpsertSpec = {
  table: "company_products",
  defs: COMPANY_PRODUCT_DEFS,
  matchCols: ["name"],
  hasUpdatedAt: true,
  sysOnInsert: { verified_status: "none", source: "crawler" },
};
const NEWS_SPEC: ChildUpsertSpec = {
  table: "company_news",
  defs: COMPANY_NEWS_DEFS,
  matchCols: ["title"],
  hasUpdatedAt: false,
};
const LOCATION_SPEC: ChildUpsertSpec = {
  table: "company_locations",
  defs: COMPANY_LOCATION_DEFS,
  matchCols: ["type", "city"],
  hasUpdatedAt: false,
};
const FUNDING_SPEC: ChildUpsertSpec = {
  table: "company_funding_rounds",
  defs: COMPANY_FUNDING_DEFS,
  matchCols: ["round_type", "announced_at"],
  hasUpdatedAt: false,
};
const TECH_SPEC: ChildUpsertSpec = {
  table: "company_tech",
  defs: COMPANY_TECH_DEFS,
  matchCols: ["vendor", "product"],
  hasUpdatedAt: false,
};
const DEPARTMENT_SPEC: ChildUpsertSpec = {
  table: "company_departments",
  defs: COMPANY_DEPARTMENT_DEFS,
  matchCols: ["name"],
  hasUpdatedAt: true,
  sysOnInsert: { source: "crawler" },
};

/** 系統欄之外的 patch 鍵（upsertFromCrawl 用來擋掉不可由爬蟲覆寫的系統/驗證欄）。 */
const CRAWL_SKIP_KEYS = new Set(["id", "orgId", "companyId", "createdAt", "updatedAt", "verifiedStatus"]);

// ─────────────────────────────────────────────────────────────
// CompanyRepository
// ─────────────────────────────────────────────────────────────
export class SqliteCompanyRepository implements CompanyRepository {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, input: NewCompany): Promise<Company> {
    const now = Date.now();
    const id = uuidv7();
    const rec = patchToRecord(input as Record<string, unknown>, COMPANY_DEFS);
    rec.id = id;
    rec.org_id = orgId;
    rec.verified_status = "none";
    rec.created_at = now;
    rec.updated_at = now;
    await insertRow(this.db, "companies", rec);
    return (await this.findById(orgId, id))!;
  }

  async findById(orgId: string, id: string): Promise<Company | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM companies WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? rowToDomain<Company>(row, COMPANY_DEFS) : null;
  }

  async findByDomain(orgId: string, domain: string): Promise<Company | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM companies WHERE org_id = ? AND domain = ?",
      [orgId, domain],
    );
    return row ? rowToDomain<Company>(row, COMPANY_DEFS) : null;
  }

  async list(orgId: string, filter: CompanyFilter, page: Page): Promise<Paged<CompanySummary>> {
    const where = ["org_id = ?"];
    const params: unknown[] = [orgId];
    if (filter.query) {
      // LOWER(col) LIKE LOWER(?)：SQLite 的 LIKE 對 ASCII 預設不分大小寫，Postgres 的 LIKE 分大小寫；
      // 兩邊都 LOWER() 讓搜尋在兩種 driver 上行為一致（避免移植後 CRM 搜尋靜默改變結果）。
      where.push("(LOWER(name) LIKE LOWER(?) OR LOWER(domain) LIKE LOWER(?))");
      const like = `%${filter.query}%`;
      params.push(like, like);
    }
    if (filter.status) {
      where.push("account_status = ?");
      params.push(filter.status);
    }
    if (filter.ownerUserId) {
      where.push("owner_user_id = ?");
      params.push(filter.ownerUserId);
    }
    const whereSql = where.join(" AND ");

    const totalRow = await this.db.get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM companies WHERE ${whereSql}`,
      params,
    );
    const limit = Math.max(1, page.pageSize);
    const offset = Math.max(0, (page.page - 1) * page.pageSize);
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT id, name, domain, industry, logo_url, account_status, verified_status,
              crawl_confidence, last_crawled_at, owner_user_id
       FROM companies WHERE ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    return { items: rows.map(mapCompanySummary), total: totalRow?.n ?? 0 };
  }

  async update(orgId: string, id: string, patch: Partial<Company>, by: ByUser): Promise<Company> {
    await applyHumanUpdate(this.db, "companies", "company", orgId, id, patch as Record<string, unknown>, COMPANY_DEFS, by, {
      bumpVerified: true,
    });
    return (await this.findById(orgId, id))!;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM companies WHERE org_id = ? AND id = ?", [orgId, id]);
  }

  async upsertFromCrawl(
    orgId: string,
    domain: string,
    crawled: CrawlPayload,
    opts: CrawlUpsertOptions = {},
  ): Promise<Company> {
    const companyId = await this.db.tx(async () => {
      const now = Date.now();
      const hasDomain = typeof domain === "string" && domain.length > 0;

      // 1) enrich 指名了既有列 id → 優先以 id 命中該列（避免 domain=NULL 時 domain-dedupe 落空而新建重複列）。
      let existing: { id: string; domain: string | null } | undefined;
      if (opts.targetId) {
        existing = await this.db.get<{ id: string; domain: string | null }>(
          "SELECT id, domain FROM companies WHERE org_id = ? AND id = ?",
          [orgId, opts.targetId],
        );
      }
      // 2) 沒指名或指名列不存在 → 退回 domain-dedupe（僅在 domain 非空時；空 domain 不當 dedupe key）。
      if (!existing && hasDomain) {
        existing = await this.db.get<{ id: string; domain: string | null }>(
          "SELECT id, domain FROM companies WHERE org_id = ? AND domain = ?",
          [orgId, domain],
        );
      }

      let id: string;
      if (existing) {
        id = existing.id;
        // 命中列尚無 domain 且此次有 domain：回填 domain（前提是沒有別列已占用該 domain，避免 UNIQUE(org_id,domain) 衝突）。
        if (hasDomain && !existing.domain) {
          const clash = await this.db.get<{ id: string }>(
            "SELECT id FROM companies WHERE org_id = ? AND domain = ? AND id != ?",
            [orgId, domain, id],
          );
          if (!clash) {
            await this.db.run("UPDATE companies SET domain = ?, updated_at = ? WHERE org_id = ? AND id = ?", [
              domain,
              now,
              orgId,
              id,
            ]);
          }
        }
      } else {
        id = uuidv7();
        // 空 domain 存 NULL（非空字串，避免多列同吃 domain='' 觸發 UNIQUE 衝突）。
        await this.db.run(
          "INSERT INTO companies (id, org_id, name, domain, source, verified_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [
            id,
            orgId,
            crawled.company.name ?? (hasDomain ? domain : "(unknown company)"),
            hasDomain ? domain : null,
            crawled.company.source ?? "crawler",
            "none",
            now,
            now,
          ],
        );
      }

      // 人已細填/驗證的欄位不可被爬蟲覆寫（信任規則）。
      const trusted = await trustedFieldsOf(this.db, orgId, "company", id);

      // 實體欄位（跳過 trusted 與系統欄；domain 保持不變＝dedupe key）。
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(crawled.company)) {
        if (CRAWL_SKIP_KEYS.has(k) || k === "domain") continue;
        if (trusted.has(k)) continue;
        patch[k] = v;
      }
      const rec = patchToRecord(patch, COMPANY_DEFS);
      rec.last_crawled_at = now;
      rec.updated_at = now;
      const cols = Object.keys(rec);
      if (cols.length > 0) {
        await this.db.run(
          `UPDATE companies SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
          [...cols.map((c) => rec[c] ?? null), orgId, id],
        );
      }

      // provenance（filled_by='crawler'；擋掉 trusted 欄）。
      const provRows: NewProvenance[] = crawled.provenance
        .filter((p) => !trusted.has(p.fieldName))
        .map((p) => ({
          entityType: "company",
          entityId: id,
          fieldName: p.fieldName,
          valueSnapshot: p.value,
          filledBy: "crawler" as const,
          // deep（全網研究）帶 sourceType（'wikipedia'/'news'/'web'…）＝真實外部來源分類；
          // detailed/quick 不帶 → 沿用預設 'company_website'（官網）。source_url 一律是實際來源。
          sourceType: p.sourceType ?? "company_website",
          sourceUrl: p.sourceUrl,
          confidence: p.confidence,
          verified: 0 as const,
        }));
      await recordProvenanceRows(this.db, orgId, provRows);

      // children（dedupe，不刪除既有）。
      for (const c of crawled.contacts ?? []) {
        if (!c.fullName) continue;
        await upsertChild(this.db, CONTACT_SPEC, orgId, id, c as Record<string, unknown>);
      }
      for (const p of crawled.products ?? []) {
        if (!p.name) continue;
        await upsertChild(this.db, PRODUCT_SPEC, orgId, id, p as Record<string, unknown>);
      }
      for (const n of crawled.news ?? []) {
        if (!n.title) continue;
        await upsertChild(this.db, NEWS_SPEC, orgId, id, n as Record<string, unknown>);
      }

      return id;
    });
    return (await this.findById(orgId, companyId))!;
  }

  async counts(orgId: string, id: string): Promise<CompanyCounts> {
    const one = async (sql: string): Promise<number> =>
      (await this.db.get<{ n: number }>(sql, [orgId, id]))?.n ?? 0;
    return {
      contacts: await one("SELECT COUNT(*) AS n FROM contacts WHERE org_id = ? AND company_id = ?"),
      products: await one("SELECT COUNT(*) AS n FROM company_products WHERE org_id = ? AND company_id = ?"),
      news: await one("SELECT COUNT(*) AS n FROM company_news WHERE org_id = ? AND company_id = ?"),
      deals: await one("SELECT COUNT(*) AS n FROM deals WHERE org_id = ? AND company_id = ?"),
    };
  }
}

function mapCompanySummary(r: Record<string, unknown>): CompanySummary {
  return {
    id: r.id as string,
    name: r.name as string,
    domain: (r.domain as string | null) ?? undefined,
    industry: (r.industry as string | null) ?? undefined,
    logoUrl: (r.logo_url as string | null) ?? undefined,
    accountStatus: (r.account_status as AccountStatus | null) ?? undefined,
    verifiedStatus: r.verified_status as VerifiedStatus,
    crawlConfidence: (r.crawl_confidence as number | null) ?? undefined,
    lastCrawledAt: (r.last_crawled_at as number | null) ?? undefined,
    ownerUserId: (r.owner_user_id as string | null) ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// ContactRepository
// ─────────────────────────────────────────────────────────────
export class SqliteContactRepository implements ContactRepository {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, companyId: string, input: NewContact): Promise<Contact> {
    const now = Date.now();
    const id = uuidv7();
    const rec = patchToRecord(input as Record<string, unknown>, CONTACT_DEFS);
    rec.id = id;
    rec.org_id = orgId;
    rec.company_id = companyId;
    rec.verified_status = "none";
    rec.created_at = now;
    rec.updated_at = now;
    await insertRow(this.db, "contacts", rec);
    return (await this.findById(orgId, id))!;
  }

  async findById(orgId: string, id: string): Promise<Contact | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM contacts WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? rowToDomain<Contact>(row, CONTACT_DEFS) : null;
  }

  async list(orgId: string, companyId: string): Promise<ContactSummary[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT id, company_id, full_name, full_name_zh, title, title_zh, seniority, decision_power, verified_status, photo_url
       FROM contacts WHERE org_id = ? AND company_id = ? ORDER BY created_at DESC`,
      [orgId, companyId],
    );
    return rows.map(mapContactSummary);
  }

  async update(orgId: string, id: string, patch: Partial<Contact>, by: ByUser): Promise<Contact> {
    await applyHumanUpdate(this.db, "contacts", "contact", orgId, id, patch as Record<string, unknown>, CONTACT_DEFS, by, {
      bumpVerified: true,
    });
    return (await this.findById(orgId, id))!;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM contacts WHERE org_id = ? AND id = ?", [orgId, id]);
  }

  async upsertFromCrawl(orgId: string, companyId: string, crawled: ContactCrawlPayload): Promise<Contact> {
    const contactId = await this.db.tx(async () => {
      const now = Date.now();
      const fullName = crawled.contact.fullName;
      const fullNameZh = crawled.contact.fullNameZh;

      // primary：full_name 精配；落空且 incoming fullNameZh 非空 → full_name_zh 再配一次（同一人，fill-empty）。
      let existingRow: Record<string, unknown> | undefined;
      let matchedByFallback = false;
      if (fullName) {
        existingRow = await this.db.get<Record<string, unknown>>(
          "SELECT * FROM contacts WHERE org_id = ? AND company_id = ? AND full_name = ?",
          [orgId, companyId, fullName],
        );
      }
      if (!existingRow && typeof fullNameZh === "string" && fullNameZh.trim() !== "") {
        existingRow = await this.db.get<Record<string, unknown>>(
          "SELECT * FROM contacts WHERE org_id = ? AND company_id = ? AND full_name_zh = ?",
          [orgId, companyId, fullNameZh],
        );
        if (existingRow) matchedByFallback = true;
      }

      let id: string;
      if (existingRow) {
        id = existingRow.id as string;
      } else {
        id = uuidv7();
        await this.db.run(
          "INSERT INTO contacts (id, org_id, company_id, full_name, source, verified_status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [id, orgId, companyId, fullName ?? "(unknown)", crawled.contact.source ?? "crawler", "none", now, now],
        );
      }

      const trusted = await trustedFieldsOf(this.db, orgId, "contact", id);
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(crawled.contact)) {
        if (CRAWL_SKIP_KEYS.has(k)) continue;
        if (trusted.has(k)) continue;
        patch[k] = v;
      }
      const rec = patchToRecord(patch, CONTACT_DEFS);
      // 命中既有列：title/title_zh 累加；fallback 命中則 fill-empty（不覆寫既有非空欄）。
      if (existingRow) {
        accumulateAndFillEmpty(rec, existingRow, {
          accumulateCols: ["title", "title_zh"],
          fillEmpty: matchedByFallback,
        });
      }
      rec.last_crawled_at = now;
      rec.updated_at = now;
      const cols = Object.keys(rec);
      if (cols.length > 0) {
        await this.db.run(
          `UPDATE contacts SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE org_id = ? AND id = ?`,
          [...cols.map((c) => rec[c] ?? null), orgId, id],
        );
      }

      // provenance 只寫實際落庫的欄（fill-empty 略過者不寫，避免值/來源漂移）；title/title_zh 快照對齊合併後值。
      const provRows: NewProvenance[] = crawled.provenance
        .filter((p) => {
          if (trusted.has(p.fieldName)) return false;
          if (!existingRow) return true; // 新建：patch 全數落庫。
          const col = CONTACT_KEY_TO_COL.get(p.fieldName);
          return col !== undefined && col in rec; // 命中：只保留 rec 仍帶（實際寫入）的欄。
        })
        .map((p) => {
          const col = CONTACT_KEY_TO_COL.get(p.fieldName);
          const isAcc = existingRow !== undefined && (col === "title" || col === "title_zh");
          return {
            entityType: "contact",
            entityId: id,
            fieldName: p.fieldName,
            // 累加欄用合併後的值當快照（與欄位一致）；其餘沿用爬蟲原值。
            valueSnapshot: isAcc && col !== undefined && rec[col] != null ? String(rec[col]) : p.value,
            filledBy: "crawler" as const,
            // deep 研究的主管來自新聞/維基/公開檔 → 帶真實 sourceType；detailed/quick 不帶 → 預設 'linkedin'。
            sourceType: p.sourceType ?? "linkedin",
            sourceUrl: p.sourceUrl,
            confidence: p.confidence,
            verified: 0 as const,
          };
        });
      await recordProvenanceRows(this.db, orgId, provRows);
      return id;
    });
    return (await this.findById(orgId, contactId))!;
  }
}

function mapContactSummary(r: Record<string, unknown>): ContactSummary {
  return {
    id: r.id as string,
    companyId: r.company_id as string,
    fullName: r.full_name as string,
    fullNameZh: (r.full_name_zh as string | null) ?? undefined,
    title: (r.title as string | null) ?? undefined,
    titleZh: (r.title_zh as string | null) ?? undefined,
    seniority: (r.seniority as Seniority | null) ?? undefined,
    decisionPower: (r.decision_power as DecisionPower | null) ?? undefined,
    verifiedStatus: r.verified_status as VerifiedStatus,
    photoUrl: (r.photo_url as string | null) ?? undefined,
  };
}

// ─────────────────────────────────────────────────────────────
// CompanyProductRepository（+ product↔people join）
// ─────────────────────────────────────────────────────────────
export class SqliteCompanyProductRepository implements CompanyProductRepository {
  constructor(private readonly db: DbPort) {}

  async create(orgId: string, companyId: string, input: NewCompanyProduct): Promise<CompanyProduct> {
    const now = Date.now();
    const id = uuidv7();
    const rec = patchToRecord(input as Record<string, unknown>, COMPANY_PRODUCT_DEFS);
    rec.id = id;
    rec.org_id = orgId;
    rec.company_id = companyId;
    rec.verified_status = "none";
    rec.created_at = now;
    rec.updated_at = now;
    await insertRow(this.db, "company_products", rec);
    return (await this.findById(orgId, id))!;
  }

  async findById(orgId: string, id: string): Promise<CompanyProduct | null> {
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM company_products WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return row ? rowToDomain<CompanyProduct>(row, COMPANY_PRODUCT_DEFS) : null;
  }

  async list(orgId: string, companyId: string): Promise<CompanyProduct[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      "SELECT * FROM company_products WHERE org_id = ? AND company_id = ? ORDER BY created_at DESC",
      [orgId, companyId],
    );
    return rows.map((r) => rowToDomain<CompanyProduct>(r, COMPANY_PRODUCT_DEFS));
  }

  async update(orgId: string, id: string, patch: Partial<CompanyProduct>, by: ByUser): Promise<CompanyProduct> {
    await applyHumanUpdate(
      this.db,
      "company_products",
      "company_product",
      orgId,
      id,
      patch as Record<string, unknown>,
      COMPANY_PRODUCT_DEFS,
      by,
      { bumpVerified: true },
    );
    return (await this.findById(orgId, id))!;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.db.run("DELETE FROM company_products WHERE org_id = ? AND id = ?", [orgId, id]);
  }

  async listPeople(orgId: string, productId: string): Promise<ProductPersonLink[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT pp.role AS pp_role, pp.title_on_product AS pp_title, pp.confidence AS pp_confidence,
              c.id AS id, c.company_id AS company_id, c.full_name AS full_name, c.full_name_zh AS full_name_zh,
              c.title AS title, c.title_zh AS title_zh,
              c.seniority AS seniority, c.decision_power AS decision_power,
              c.verified_status AS verified_status, c.photo_url AS photo_url
       FROM company_product_people pp
       JOIN contacts c ON c.id = pp.contact_id AND c.org_id = pp.org_id
       WHERE pp.org_id = ? AND pp.product_id = ?
       ORDER BY pp.created_at ASC`,
      [orgId, productId],
    );
    return rows.map((r) => ({
      contact: mapContactSummary(r),
      role: r.pp_role as ProductPersonRole,
      titleOnProduct: (r.pp_title as string | null) ?? undefined,
      confidence: (r.pp_confidence as number | null) ?? undefined,
    }));
  }

  async addPerson(
    orgId: string,
    productId: string,
    input: NewCompanyProductPerson,
  ): Promise<CompanyProductPerson> {
    const now = Date.now();
    const id = uuidv7();
    // company_id 由 product 推導（維持 (org, product) 一致）。
    const prod = await this.db.get<{ company_id: string }>(
      "SELECT company_id FROM company_products WHERE org_id = ? AND id = ?",
      [orgId, productId],
    );
    if (!prod) throw new Error(`[crm] product not found: ${productId}`);
    const rec = patchToRecord(input as unknown as Record<string, unknown>, PRODUCT_PERSON_DEFS);
    rec.id = id;
    rec.org_id = orgId;
    rec.company_id = prod.company_id;
    rec.product_id = productId;
    rec.created_at = now;
    await insertRow(this.db, "company_product_people", rec);
    const row = await this.db.get<Record<string, unknown>>(
      "SELECT * FROM company_product_people WHERE org_id = ? AND id = ?",
      [orgId, id],
    );
    return rowToDomain<CompanyProductPerson>(row!, PRODUCT_PERSON_DEFS);
  }

  async removePerson(orgId: string, productId: string, contactId: string): Promise<void> {
    await this.db.run(
      "DELETE FROM company_product_people WHERE org_id = ? AND product_id = ? AND contact_id = ?",
      [orgId, productId, contactId],
    );
  }
}

// ─────────────────────────────────────────────────────────────
// CompanyChildRepository（news/locations/funding/tech/departments）
// ─────────────────────────────────────────────────────────────
export class SqliteCompanyChildRepository implements CompanyChildRepository {
  constructor(private readonly db: DbPort) {}

  private async listChild<T>(table: string, defs: typeof COMPANY_NEWS_DEFS, orgId: string, companyId: string, orderBy: string): Promise<T[]> {
    const rows = await this.db.all<Record<string, unknown>>(
      `SELECT * FROM ${table} WHERE org_id = ? AND company_id = ? ORDER BY ${orderBy}`,
      [orgId, companyId],
    );
    return rows.map((r) => rowToDomain<T>(r, defs));
  }

  private async bulkUpsert(
    spec: ChildUpsertSpec,
    orgId: string,
    companyId: string,
    rows: Record<string, unknown>[],
  ): Promise<void> {
    await this.db.tx(async () => {
      for (const row of rows) {
        await upsertChild(this.db, spec, orgId, companyId, row);
      }
    });
  }

  listNews(orgId: string, companyId: string): Promise<CompanyNews[]> {
    return this.listChild<CompanyNews>("company_news", COMPANY_NEWS_DEFS, orgId, companyId, "published_at DESC, created_at DESC");
  }
  listLocations(orgId: string, companyId: string): Promise<CompanyLocation[]> {
    return this.listChild<CompanyLocation>("company_locations", COMPANY_LOCATION_DEFS, orgId, companyId, "created_at ASC");
  }
  listFunding(orgId: string, companyId: string): Promise<CompanyFunding[]> {
    return this.listChild<CompanyFunding>("company_funding_rounds", COMPANY_FUNDING_DEFS, orgId, companyId, "announced_at DESC, created_at DESC");
  }
  listTech(orgId: string, companyId: string): Promise<CompanyTech[]> {
    return this.listChild<CompanyTech>("company_tech", COMPANY_TECH_DEFS, orgId, companyId, "created_at ASC");
  }
  listDepartments(orgId: string, companyId: string): Promise<CompanyDepartment[]> {
    return this.listChild<CompanyDepartment>("company_departments", COMPANY_DEPARTMENT_DEFS, orgId, companyId, "created_at ASC");
  }

  bulkUpsertNews(orgId: string, companyId: string, rows: NewCompanyNews[]): Promise<void> {
    return this.bulkUpsert(NEWS_SPEC, orgId, companyId, rows as Record<string, unknown>[]);
  }
  bulkUpsertLocations(orgId: string, companyId: string, rows: NewCompanyLocation[]): Promise<void> {
    return this.bulkUpsert(LOCATION_SPEC, orgId, companyId, rows as Record<string, unknown>[]);
  }
  bulkUpsertFunding(orgId: string, companyId: string, rows: NewCompanyFunding[]): Promise<void> {
    return this.bulkUpsert(FUNDING_SPEC, orgId, companyId, rows as Record<string, unknown>[]);
  }
  bulkUpsertTech(orgId: string, companyId: string, rows: NewCompanyTech[]): Promise<void> {
    return this.bulkUpsert(TECH_SPEC, orgId, companyId, rows as Record<string, unknown>[]);
  }
  bulkUpsertDepartments(orgId: string, companyId: string, rows: NewCompanyDepartment[]): Promise<void> {
    return this.bulkUpsert(DEPARTMENT_SPEC, orgId, companyId, rows as Record<string, unknown>[]);
  }
}
