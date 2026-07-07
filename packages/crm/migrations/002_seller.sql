-- 002_seller.sql — 賣方側（rep 自家公司/產品/競品；CRM_SCHEMA §3）。
-- §0：無 SQL FOREIGN KEY（完整性由 repository 層強制）；enum＝TEXT + CHECK(col IN(...))；時間 epoch-ms；布林 0/1；JSON 存 TEXT。
-- 順序：seller_companies 必先（product_card embedding 與 deal_products.product_id 依賴 products；見 §12）。

CREATE TABLE IF NOT EXISTS seller_companies (
  id                     TEXT PRIMARY KEY,          -- S  UUIDv7
  org_id                 TEXT NOT NULL,             -- S  FK orgs
  name                   TEXT NOT NULL,             -- C+H
  legal_name             TEXT,                      -- C+H
  domain                 TEXT,                      -- H
  description            TEXT,                      -- H
  elevator_pitch         TEXT,                      -- H  副駕可直接引用
  mission                TEXT,                      -- H
  industry               TEXT,                      -- H
  icp_description        TEXT,                      -- H  理想客戶輪廓
  target_personas_json   TEXT,                      -- H  [{persona,title,pains}]
  value_props_json       TEXT,                      -- H
  differentiators_json   TEXT,                      -- H
  pricing_model          TEXT,                      -- H  seat/usage/flat
  website_url            TEXT,                      -- H
  logo_url               TEXT,                      -- H
  default_language       TEXT,                      -- H
  created_at             INTEGER NOT NULL,          -- S
  updated_at             INTEGER NOT NULL           -- S
);
CREATE INDEX IF NOT EXISTS idx_seller_companies_org ON seller_companies(org_id);

CREATE TABLE IF NOT EXISTS products (
  id                     TEXT PRIMARY KEY,          -- S
  org_id                 TEXT NOT NULL,             -- S  FK orgs
  seller_company_id      TEXT NOT NULL,             -- S  FK seller_companies
  name                   TEXT NOT NULL,             -- H
  category               TEXT,                      -- H
  one_liner              TEXT,                      -- H
  description            TEXT,                      -- H
  key_features_json      TEXT,                      -- H  [{name,benefit}]
  value_props_json       TEXT,                      -- H
  differentiators_json   TEXT,                      -- H
  use_cases_json         TEXT,                      -- H
  target_personas_json   TEXT,                      -- H
  pricing_model          TEXT,                      -- H  seat/usage/flat
  price_from             REAL,                      -- H
  price_notes            TEXT,                      -- H
  objection_handlers_json TEXT,                     -- H  [{objection,response,proof}] — 會中副駕高價值
  proof_points_json      TEXT,                      -- H  案例/數字/logo
  competitor_ids_json    TEXT,                      -- H  FK → competitors
  status                 TEXT DEFAULT 'active',     -- H
  created_at             INTEGER NOT NULL,          -- S
  updated_at             INTEGER NOT NULL,          -- S
  CHECK (status IN ('active','deprecated'))
);
CREATE INDEX IF NOT EXISTS idx_products_org         ON products(org_id);
CREATE INDEX IF NOT EXISTS idx_products_org_seller  ON products(org_id, seller_company_id);

CREATE TABLE IF NOT EXISTS competitors (
  id                   TEXT PRIMARY KEY,            -- S
  org_id               TEXT NOT NULL,               -- S  FK orgs
  name                 TEXT NOT NULL,               -- C+H
  domain               TEXT,                        -- C+H
  positioning          TEXT,                        -- C+H
  strengths_json       TEXT,                        -- H
  weaknesses_json      TEXT,                        -- H
  our_advantages_json  TEXT,                        -- H  我們怎麼贏
  landmines_json       TEXT,                        -- H  對手設的陷阱
  pricing_notes        TEXT,                        -- C+H
  created_at           INTEGER NOT NULL,            -- S
  updated_at           INTEGER NOT NULL             -- S
);
CREATE INDEX IF NOT EXISTS idx_competitors_org ON competitors(org_id);
