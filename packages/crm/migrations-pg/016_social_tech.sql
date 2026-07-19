-- 016_social_tech.sql (Postgres) — SQLite migrations/016 的 pg 方言對映（語意相同）。
--  (a) company_tech +note_zh：一句 zh-TW 技術棧說明；TEXT、可 NULL。
--  (b) company_social_posts：社群結構化貼文；epoch-ms 欄用 BIGINT（對齊 pg 慣例）；UNIQUE 自然鍵同 SQLite。
-- pg 支援 ADD COLUMN IF NOT EXISTS 與 CREATE TABLE IF NOT EXISTS（重跑安全、冪等）。

ALTER TABLE company_tech ADD COLUMN IF NOT EXISTS note_zh TEXT;

CREATE TABLE IF NOT EXISTS company_social_posts (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,
  company_id   TEXT NOT NULL,
  platform     TEXT,
  url          TEXT,
  title        TEXT,
  content      TEXT,
  published_at BIGINT,
  metrics_json TEXT,
  created_at   BIGINT NOT NULL,
  UNIQUE (org_id, company_id, platform, url)
);
CREATE INDEX IF NOT EXISTS idx_company_social_posts_org_company ON company_social_posts(org_id, company_id);
