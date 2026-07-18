-- 015_crm_quality.sql — CRM 品質欄（RESEARCH_UPGRADE 契約一）。
-- companies +industry_zh/+tagline_zh/+business_model_zh；company_products +model；contacts +full_name_zh。
-- 語意：*_zh 為繁中(zh-TW) gloss，不覆寫來源語言的主要欄（industry/tagline/business_model）；
--       company_products.model = 型號/SKU（如 CP1500PFCLCD），無則 NULL。皆 TEXT、可 NULL、無 CHECK。
-- SQLite 不支援單一 ALTER 多欄，也無 ADD COLUMN IF NOT EXISTS → 每欄一條 ALTER TABLE ADD COLUMN。

ALTER TABLE companies        ADD COLUMN industry_zh TEXT;
ALTER TABLE companies        ADD COLUMN tagline_zh TEXT;
ALTER TABLE companies        ADD COLUMN business_model_zh TEXT;
ALTER TABLE company_products ADD COLUMN model TEXT;
ALTER TABLE contacts         ADD COLUMN full_name_zh TEXT;
