-- 016_social_tech.sql — 社群貼文層 ＋ 技術棧 zh 說明（RESEARCH_UPGRADE v2 / WS-A 契約）。
--  (a) company_tech +note_zh：一句 zh-TW「這是什麼＋該公司怎麼用」；來源沒有就 NULL。TEXT、可 NULL、無 CHECK。
--  (b) company_social_posts：社群 fetcher（youtube/threads/…）產出的結構化頻道統計/影片/貼文。
--      自然鍵 UNIQUE(org_id, company_id, platform, url)：重抓同一貼文 upsert 更新、不產生重複列。
-- SQLite 不支援 ADD COLUMN IF NOT EXISTS，且一句一欄；新表用 CREATE TABLE IF NOT EXISTS（冪等）。

ALTER TABLE company_tech ADD COLUMN note_zh TEXT;

CREATE TABLE IF NOT EXISTS company_social_posts (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL,                          -- S  FK orgs
  company_id   TEXT NOT NULL,                          -- S  FK companies
  platform     TEXT,                                   -- youtube/facebook/instagram/threads/…
  url          TEXT,                                   -- 貼文/影片/頻道 URL（自然鍵之一）
  title        TEXT,                                   -- 標題（影片/貼文）
  content      TEXT,                                   -- 內文/描述
  published_at INTEGER,                                -- epoch ms（發布時間，可 NULL）
  metrics_json TEXT,                                   -- JSON：views/subscribers/likes/…（各平台不同）
  created_at   INTEGER NOT NULL,                       -- S
  UNIQUE (org_id, company_id, platform, url)
);
CREATE INDEX IF NOT EXISTS idx_company_social_posts_org_company ON company_social_posts(org_id, company_id);
