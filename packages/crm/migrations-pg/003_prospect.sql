-- 003_prospect.sql (Postgres) — 對方公司英雄表 companies ＋ 可爬子表（CRM_SCHEMA §4）。SQLite migrations/003 的 pg 方言對映。
-- §0/§10：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms（bigint）；布林 0/1（bigint）；JSON 存 text。
-- 型別對映：INTEGER → bigint；REAL → double precision；TEXT/_json → text。
-- UNIQUE(org_id, domain)：pg 唯一索引預設 NULL 互不相等（同 SQLite）→ 無 domain 列不受限，dedupe parity 成立。

CREATE TABLE IF NOT EXISTS companies (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                    -- S  FK orgs
  -- ── 身分 (C+H) ──
  name               TEXT NOT NULL,                    -- C+H 顯示名
  legal_name         TEXT,                             -- C
  aka_json           TEXT,                             -- C  舊名/別名 []
  domain             TEXT,                             -- C+H 主網域 (dedupe key)
  website_url        TEXT,                             -- C
  logo_url           TEXT,                             -- C
  description        TEXT,                             -- C+H 他們做什麼
  tagline            TEXT,                             -- C
  -- ── 分類 (C+H) ──
  industry           TEXT,                             -- C+H 主要垂直
  sub_industries_json TEXT,                            -- C
  naics_sic_json     TEXT,                             -- C  官方代碼
  business_model     TEXT,                             -- C+H B2B SaaS / marketplace / services
  keywords_json      TEXT,                             -- C  網站定位關鍵字
  -- ── 規模/財務 (C, 估計) ──
  founded_year       BIGINT,                           -- C
  ownership_type     TEXT,                             -- C+H public/private/pe/nonprofit/gov
  stock_ticker       TEXT,                             -- C
  employee_count     BIGINT,                           -- C  已知才填精確值
  employee_range     TEXT,                             -- C+H "51-200"
  employee_growth_yoy DOUBLE PRECISION,                -- C  %
  annual_revenue     DOUBLE PRECISION,                 -- C+H 估計
  revenue_range      TEXT,                             -- C+H
  currency           TEXT,                             -- C
  funding_total      DOUBLE PRECISION,                 -- C
  funding_stage      TEXT,                             -- C  Seed/Series A/…/Public
  last_funding_at    BIGINT,                           -- C
  last_funding_amount DOUBLE PRECISION,                -- C
  valuation          DOUBLE PRECISION,                 -- C
  investors_json     TEXT,                             -- C  (另見 funding_rounds 子表)
  -- ── 聯絡/社群 (C) ──
  hq_country TEXT, hq_region TEXT, hq_city TEXT, hq_address TEXT,  -- C (另見 company_locations)
  timezone           TEXT,                             -- C
  phone_main         TEXT,                             -- C
  email_general      TEXT,                             -- C  info@…
  social_linkedin TEXT, social_twitter TEXT, social_facebook TEXT,
  social_youtube TEXT, social_crunchbase TEXT, social_github TEXT, -- C
  languages_json     TEXT,                             -- C
  -- ── 副駕會浮出的公開情報 (C) ──
  products_offered_json TEXT,                          -- C  他們的產品/服務
  key_customers_json TEXT,                             -- C  官網上的客戶 logo
  certifications_json TEXT,                            -- C  SOC2/ISO/HIPAA
  awards_json        TEXT,                             -- C
  hiring_signals_json TEXT,                            -- C  在徵的職缺/部門 → 意向訊號
  recent_news_summary TEXT,                            -- C+H 從 company_news 匯總
  -- ── 銷售情報 (多半 H / 會議衍生) ──
  pain_points_json   TEXT,                             -- H (弱 C) 推測+確認
  strategic_initiatives_json TEXT,                     -- H/C  如「APAC 擴張」
  buying_triggers_json TEXT,                           -- H/C
  current_vendors_json TEXT,                           -- C+H 現有供應商(部分來自 tech)
  -- ── 帳戶管理 (H / S) ──
  fit_score          BIGINT,                           -- S/H  0-100 ICP fit
  fit_reasons_json   TEXT,                             -- S/H
  account_tier       TEXT,                             -- H  A/B/C
  account_status     TEXT,                             -- H  prospect/active/customer/churned
  lifecycle_stage    TEXT,                             -- H
  lead_source        TEXT,                             -- H
  owner_user_id      TEXT,                             -- H  FK users (帳戶負責人)
  -- ── 爬蟲簿記 (S) + 驗證 (H) ──
  source             TEXT,                             -- C+H crawler/import/manual
  crawl_confidence   DOUBLE PRECISION,                 -- S   粗略 rollup 0-1
  last_crawled_at    BIGINT,                           -- S
  last_enriched_at   BIGINT,                           -- S
  verified_status    TEXT DEFAULT 'none',              -- H   none/partial/verified
  verified_by        TEXT,                             -- H   FK users
  verified_at        BIGINT,                           -- H
  raw_crawl_json     TEXT,                             -- S   最近一次原始爬蟲 payload(可重處理)
  custom_fields_json TEXT,                             -- H   租戶自訂
  created_at         BIGINT NOT NULL,                  -- S
  updated_at         BIGINT NOT NULL,                  -- S
  CHECK (account_status IN ('prospect','active','customer','churned') OR account_status IS NULL),
  CHECK (verified_status IN ('none','partial','verified'))
);
CREATE INDEX IF NOT EXISTS idx_companies_org        ON companies(org_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_org_domain ON companies(org_id, domain);
CREATE INDEX IF NOT EXISTS idx_companies_org_owner  ON companies(org_id, owner_user_id);

-- ── 對方子表（皆可爬、皆可查）──

CREATE TABLE IF NOT EXISTS company_locations (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,                           -- S  FK orgs
  company_id  TEXT NOT NULL,                           -- C  FK companies
  type        TEXT,                                    -- C  hq/office/branch/remote
  country     TEXT,                                    -- C
  region      TEXT,                                    -- C
  city        TEXT,                                    -- C
  address     TEXT,                                    -- C
  is_primary  BIGINT DEFAULT 0,                        -- C  0/1
  created_at  BIGINT NOT NULL,                         -- S
  CHECK (type IN ('hq','office','branch','remote') OR type IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_company_locations_org_company ON company_locations(org_id, company_id);

CREATE TABLE IF NOT EXISTS company_news (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                          -- S  FK orgs
  company_id   TEXT NOT NULL,                          -- C  FK companies
  title        TEXT NOT NULL,                          -- C
  url          TEXT,                                   -- C
  source       TEXT,                                   -- C
  published_at BIGINT,                                 -- C
  summary      TEXT,                                   -- C  embedded for RAG
  category     TEXT,                                   -- C  見 CHECK
  sentiment    DOUBLE PRECISION,                       -- C
  relevance    DOUBLE PRECISION,                       -- C
  embedded     BIGINT DEFAULT 0,                       -- S  0/1 已嵌入
  created_at   BIGINT NOT NULL,                        -- S
  CHECK (category IN ('funding','product','exec_change','mna','partnership','legal','financial','other') OR category IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_company_news_org_company ON company_news(org_id, company_id, published_at DESC);

CREATE TABLE IF NOT EXISTS company_funding_rounds (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,                        -- S  FK orgs
  company_id     TEXT NOT NULL,                        -- C  FK companies
  round_type     TEXT,                                 -- C
  amount         DOUBLE PRECISION,                     -- C
  currency       TEXT,                                 -- C
  announced_at   BIGINT,                               -- C
  lead_investor  TEXT,                                 -- C
  investors_json TEXT,                                 -- C
  source_url     TEXT,                                 -- C
  created_at     BIGINT NOT NULL                       -- S
);
CREATE INDEX IF NOT EXISTS idx_company_funding_org_company ON company_funding_rounds(org_id, company_id);

CREATE TABLE IF NOT EXISTS company_tech (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,                         -- S  FK orgs
  company_id    TEXT NOT NULL,                         -- C  FK companies
  category      TEXT,                                  -- C
  vendor        TEXT,                                  -- C
  product       TEXT,                                  -- C
  detected_from TEXT,                                  -- C  headers/scripts/…
  confidence    DOUBLE PRECISION,                      -- S  0-1
  first_seen_at BIGINT,                                -- C
  last_seen_at  BIGINT,                                -- C
  created_at    BIGINT NOT NULL                        -- S
);
CREATE INDEX IF NOT EXISTS idx_company_tech_org_company ON company_tech(org_id, company_id);

-- ── 對方產品深檔（company_products ＋ 關聯）──

CREATE TABLE IF NOT EXISTS company_products (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,                    -- S   FK orgs
  company_id         TEXT NOT NULL,                    -- C+H FK companies
  -- ── 身分/分類 (C, 官網爬) ──
  name               TEXT NOT NULL,                    -- C+H 產品名
  category           TEXT,                             -- C+H 類別/產品線
  one_liner          TEXT,                             -- C   一句話定位
  description        TEXT,                             -- C+H 長描述(官網/docs 匯總)
  status             TEXT,                             -- C+H active/beta/deprecated/rumored
  launched_year      BIGINT,                           -- C   推出年
  product_url        TEXT,                             -- C   產品頁
  docs_url           TEXT,                             -- C   文件/開發者站
  -- ── 定價 (C, 定價頁) ──
  pricing_model      TEXT,                             -- C+H seat/usage/flat/tiered/quote
  price_from         DOUBLE PRECISION,                 -- C   最低起價(揭露才有)
  currency           TEXT,                             -- C
  pricing_notes      TEXT,                             -- C+H 方案/級距/隱藏條件
  -- ── 產品細節 (C, crawler-heavy) ──
  key_features_json  TEXT,                             -- C   [{name,detail}]
  specs_json         TEXT,                             -- C   規格 key-value 細節
  tech_stack_json    TEXT,                             -- C   實作技術(公開/推斷)
  integrations_json  TEXT,                             -- C   可整合的第三方
  target_market      TEXT,                             -- C+H 目標市場(SMB/enterprise/垂直)
  target_personas_json TEXT,                           -- C+H 目標使用者角色
  differentiators_json TEXT,                           -- C+H 賣點/差異化
  competitors_json   TEXT,                             -- C   對打的競品
  known_issues_json  TEXT,                             -- H (弱C) 公開抱怨/評測缺點
  roadmap_json       TEXT,                             -- C   公開路線圖/公告
  media_urls_json    TEXT,                             -- C   截圖/影片
  notes              TEXT,                             -- H   rep 自由補充
  -- ── 爬蟲簿記 (S) + 驗證 (H) ──
  source             TEXT,                             -- C+H crawler/import/manual
  crawl_confidence   DOUBLE PRECISION,                 -- S   粗略 rollup 0-1
  last_crawled_at    BIGINT,                           -- S
  verified_status    TEXT DEFAULT 'none',              -- H   none/partial/verified
  verified_by        TEXT,                             -- H   FK users
  verified_at        BIGINT,                           -- H
  raw_crawl_json     TEXT,                             -- S   最近一次原始爬蟲 payload(可重處理)
  custom_fields_json TEXT,                             -- H   租戶自訂
  created_at         BIGINT NOT NULL,                  -- S
  updated_at         BIGINT NOT NULL,                  -- S
  CHECK (status IN ('active','beta','deprecated','rumored') OR status IS NULL),
  CHECK (verified_status IN ('none','partial','verified'))
);
CREATE INDEX IF NOT EXISTS idx_company_products_org         ON company_products(org_id);
CREATE INDEX IF NOT EXISTS idx_company_products_org_company ON company_products(org_id, company_id);

CREATE TABLE IF NOT EXISTS company_product_people (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL,                      -- S   FK orgs
  company_id       TEXT NOT NULL,                      -- C+H FK companies
  product_id       TEXT NOT NULL,                      -- C+H FK company_products
  contact_id       TEXT NOT NULL,                      -- C+H FK contacts (該人的檔)
  role             TEXT NOT NULL,                      -- C(弱)+H 見 CHECK
  title_on_product TEXT,                               -- C   在此產品上的頭銜(e.g. "Lead PM")
  is_current       BIGINT DEFAULT 1,                   -- C+H 0/1 是否現任
  source           TEXT,                               -- C+H team_page/talk/news/manual
  confidence       DOUBLE PRECISION,                   -- S   0-1 (關聯多為推測)
  notes            TEXT,                               -- H
  created_at       BIGINT NOT NULL,                    -- S
  CHECK (role IN ('developer','engineer','pm','product_owner','designer','architect','sales','support','exec_sponsor','other'))
);
CREATE INDEX IF NOT EXISTS idx_product_people_org_product ON company_product_people(org_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_people_org_contact ON company_product_people(org_id, contact_id);

CREATE TABLE IF NOT EXISTS company_departments (
  id                   TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL,                  -- S   FK orgs
  company_id           TEXT NOT NULL,                  -- C+H FK companies
  name                 TEXT NOT NULL,                  -- C+H 部門名(e.g. "Platform Engineering")
  parent_department_id TEXT,                           -- C+H self-ref FK (nullable, 組織樹)
  head_contact_id      TEXT,                           -- C+H FK contacts (部門主管, nullable)
  headcount_estimate   BIGINT,                         -- C   估計人數
  focus                TEXT,                           -- C+H 該部門負責什麼
  notes                TEXT,                           -- H
  source               TEXT,                           -- C+H crawler/import/manual
  confidence           DOUBLE PRECISION,               -- S   0-1
  created_at           BIGINT NOT NULL,                -- S
  updated_at           BIGINT NOT NULL                 -- S
);
CREATE INDEX IF NOT EXISTS idx_company_departments_org_company ON company_departments(org_id, company_id);
