-- 011_i18n_children.sql — 為 news/products/companies/contacts 各加 zh-TW 簡介子欄（*_zh）。
-- 語意：主要欄位（title/summary/one_liner/description/background_summary）保留來源語言逐字；
--       *_zh 欄另存精簡繁體中文(zh-TW)簡介（擷取階段產出）。TEXT、可為 NULL、無 CHECK。
-- SQLite 不支援「ADD COLUMN IF NOT EXISTS」，也不支援單一 ALTER 多欄 → 每欄一條 ALTER TABLE ADD COLUMN。
-- 技術棧 company_tech 與 部門 company_departments 兩表已於 003_prospect.sql 建立，本次不新增 DDL。

ALTER TABLE company_news     ADD COLUMN title_zh TEXT;
ALTER TABLE company_news     ADD COLUMN summary_zh TEXT;
ALTER TABLE company_products ADD COLUMN one_liner_zh TEXT;
ALTER TABLE company_products ADD COLUMN description_zh TEXT;
ALTER TABLE companies        ADD COLUMN description_zh TEXT;
ALTER TABLE contacts         ADD COLUMN title_zh TEXT;
ALTER TABLE contacts         ADD COLUMN background_summary_zh TEXT;
