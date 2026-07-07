/**
 * Seed demo data for the CRM (frontend + verify need real rows).
 *
 * Boots the CRM core directly (NOT via HTTP) against the SAME sqlite DB the server uses, so a running
 * `npm run dev` server serves this data. Creates: one org + owner user, two companies, contacts and a
 * product under the first company, and field_provenance rows — including crawler-filled (unverified,
 * with source_url + confidence) AND one human-verified field — so the "來源/信心/已驗?" badge and the
 * 確認/細填 flows have something to render.
 *
 * Requires @meetcopilot/crm to export a working createCrmCore + real repos (B1). Run AFTER integration.
 *
 * Usage (from apps/server):  node scripts/seed-demo.mjs
 * Honors DB_PATH from apps/server/.env (defaults to ./data/meetcopilot.db), matching src/config.ts.
 *
 * Demo login:  demo@meetcopilot.dev  /  demodemo12
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { createCrmCore } from "@meetcopilot/crm";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(SERVER_ROOT, ".env") });

const rawDbPath = process.env.DB_PATH ?? "./data/meetcopilot.db";
const dbPath = path.isAbsolute(rawDbPath) ? rawDbPath : path.join(SERVER_ROOT, rawDbPath);

const DEMO_EMAIL = "demo@meetcopilot.dev";
const DEMO_PASSWORD = "demodemo12";

const now = Date.now();

async function main() {
  const core = await createCrmCore(dbPath);
  await core.migrate();

  // Idempotency: if the demo user already exists, don't double-seed.
  const existing = await core.users.findByEmail(DEMO_EMAIL);
  if (existing) {
    console.log(`[seed] demo user ${DEMO_EMAIL} already exists — nothing to do.`);
    core.close();
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const { orgId, userId } = await core.db.tx(async () => {
    const org = await core.orgs.create({ name: "Demo Sales Co" });
    const user = await core.users.create({
      email: DEMO_EMAIL,
      passwordHash,
      displayName: "Demo Rep",
    });
    await core.memberships.addMembership(org.id, user.id, "owner");
    return { orgId: org.id, userId: user.id };
  });

  // ── Company A: Acme Analytics (crawler-heavy, one field human-verified) ──
  const acme = await core.companies.create(orgId, {
    name: "Acme Analytics",
    domain: "acme-analytics.example",
    websiteUrl: "https://acme-analytics.example",
    industry: "Data Analytics",
    description: "Self-serve product analytics for B2B SaaS teams.",
    employeeRange: "51-200",
    hqCity: "San Francisco",
    hqCountry: "USA",
    foundedYear: 2018,
    accountStatus: "prospect",
    source: "crawler",
    crawlConfidence: 0.72,
    lastCrawledAt: now,
  });

  // crawler-filled provenance (unverified) for several Acme fields + one human-verified field.
  await core.provenance.record(orgId, [
    {
      entityType: "company",
      entityId: acme.id,
      fieldName: "industry",
      valueSnapshot: "Data Analytics",
      filledBy: "crawler",
      sourceType: "company_website",
      sourceUrl: "https://acme-analytics.example/about",
      confidence: 0.72,
      model: "crawler-v1",
      verified: 0,
    },
    {
      entityType: "company",
      entityId: acme.id,
      fieldName: "description",
      valueSnapshot: "Self-serve product analytics for B2B SaaS teams.",
      filledBy: "crawler",
      sourceType: "company_website",
      sourceUrl: "https://acme-analytics.example/",
      confidence: 0.68,
      model: "crawler-v1",
      verified: 0,
    },
    {
      entityType: "company",
      entityId: acme.id,
      fieldName: "employeeRange",
      valueSnapshot: "51-200",
      filledBy: "crawler",
      sourceType: "linkedin",
      sourceUrl: "https://linkedin.com/company/acme-analytics",
      confidence: 0.6,
      model: "crawler-v1",
      verified: 0,
    },
  ]);
  // Human confirms the industry field → verified=1 (the "已驗" badge / confirm flow).
  await core.provenance.confirm(orgId, "company", acme.id, "industry", { userId });

  // Contacts under Acme.
  const jane = await core.contacts.create(orgId, acme.id, {
    fullName: "Jane Doe",
    title: "Chief Technology Officer",
    seniority: "c_level",
    decisionPower: "economic_buyer",
    email: "jane.doe@acme-analytics.example",
    source: "crawler",
    crawlConfidence: 0.55,
    lastCrawledAt: now,
  });
  await core.contacts.create(orgId, acme.id, {
    fullName: "John Smith",
    title: "VP Engineering",
    seniority: "vp",
    decisionPower: "champion",
    source: "crawler",
    crawlConfidence: 0.5,
    lastCrawledAt: now,
  });

  await core.provenance.record(orgId, [
    {
      entityType: "contact",
      entityId: jane.id,
      fieldName: "title",
      valueSnapshot: "Chief Technology Officer",
      filledBy: "crawler",
      sourceType: "linkedin",
      sourceUrl: "https://linkedin.com/in/jane-doe",
      confidence: 0.7,
      model: "crawler-v1",
      verified: 0,
    },
    {
      entityType: "contact",
      entityId: jane.id,
      fieldName: "email",
      valueSnapshot: "jane.doe@acme-analytics.example",
      filledBy: "crawler",
      sourceType: "inference",
      sourceDetail: "first.last@domain pattern (unverified)",
      confidence: 0.3,
      model: "crawler-v1",
      verified: 0,
    },
  ]);

  // Product under Acme.
  const product = await core.companyProducts.create(orgId, acme.id, {
    name: "Acme Insight",
    category: "Product Analytics",
    oneLiner: "Track, funnel and cohort your product usage in minutes.",
    status: "active",
    pricingModel: "tiered",
    productUrl: "https://acme-analytics.example/insight",
    source: "crawler",
    crawlConfidence: 0.65,
    lastCrawledAt: now,
  });
  await core.provenance.record(orgId, [
    {
      entityType: "company_product",
      entityId: product.id,
      fieldName: "pricingModel",
      valueSnapshot: "tiered",
      filledBy: "crawler",
      sourceType: "company_website",
      sourceUrl: "https://acme-analytics.example/pricing",
      confidence: 0.66,
      model: "crawler-v1",
      verified: 0,
    },
  ]);
  // Link Jane to the product (low-confidence crawler association).
  await core.companyProducts.addPerson(orgId, product.id, {
    contactId: jane.id,
    role: "exec_sponsor",
    titleOnProduct: "Executive Sponsor",
    confidence: 0.4,
    source: "team_page",
  });

  // ── Company B: Globex Cloud (manual, sparse) ──
  await core.companies.create(orgId, {
    name: "Globex Cloud",
    domain: "globex.example",
    websiteUrl: "https://globex.example",
    industry: "Cloud Infrastructure",
    accountStatus: "active",
    source: "manual",
  });

  core.close();
  console.log(
    `[seed] OK — org=${orgId}\n` +
      `       login: ${DEMO_EMAIL} / ${DEMO_PASSWORD}\n` +
      `       companies: Acme Analytics (crawler + 1 verified field), Globex Cloud\n` +
      `       DB: ${dbPath}`,
  );
}

main().catch((err) => {
  console.error("[seed] ERROR:", err);
  process.exit(1);
});
