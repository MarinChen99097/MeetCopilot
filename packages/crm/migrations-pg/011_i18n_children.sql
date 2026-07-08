-- 011_i18n_children.sql (Postgres) — SQLite migrations/011 的 pg 方言對映。
-- 語意同 SQLite 版：主要欄位保留來源語言逐字；*_zh 欄另存精簡繁中(zh-TW)簡介。TEXT、可為 NULL。
-- pg 支援 ADD COLUMN IF NOT EXISTS，並可於單一 ALTER TABLE 內多欄一次加（重跑安全、冪等）。
-- 技術棧 company_tech 與 部門 company_departments 兩表已於 003_prospect.sql 建立，本次不新增 DDL。

ALTER TABLE company_news
  ADD COLUMN IF NOT EXISTS title_zh TEXT,
  ADD COLUMN IF NOT EXISTS summary_zh TEXT;

ALTER TABLE company_products
  ADD COLUMN IF NOT EXISTS one_liner_zh TEXT,
  ADD COLUMN IF NOT EXISTS description_zh TEXT;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS description_zh TEXT;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS title_zh TEXT,
  ADD COLUMN IF NOT EXISTS background_summary_zh TEXT;
