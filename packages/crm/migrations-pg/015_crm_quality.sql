-- 015_crm_quality.sql (Postgres) — SQLite migrations/015 的 pg 方言對映。語意同 SQLite 版：
--   *_zh 為繁中(zh-TW) gloss，不覆寫來源語言主要欄；company_products.model = 型號/SKU，無則 NULL。TEXT、可 NULL。
-- pg 支援 ADD COLUMN IF NOT EXISTS 且可於單一 ALTER TABLE 內多欄一次加（重跑安全、冪等）。

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS industry_zh TEXT,
  ADD COLUMN IF NOT EXISTS tagline_zh TEXT,
  ADD COLUMN IF NOT EXISTS business_model_zh TEXT;

ALTER TABLE company_products
  ADD COLUMN IF NOT EXISTS model TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS full_name_zh TEXT;
