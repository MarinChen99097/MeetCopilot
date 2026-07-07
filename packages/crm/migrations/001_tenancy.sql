-- 001_tenancy.sql — 租戶與身分表（CRM_SCHEMA §2，沿用 v1）。
-- §0：刻意不宣告 SQL FOREIGN KEY（完整性由 repository 層強制）；enum 用 TEXT + CHECK；時間為 epoch-ms。

CREATE TABLE IF NOT EXISTS orgs (
  id             TEXT PRIMARY KEY,           -- UUIDv7
  name           TEXT NOT NULL,
  default_locale TEXT NOT NULL DEFAULT 'zh-TW',
  plan           TEXT,
  created_at     INTEGER NOT NULL            -- epoch ms
);

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,            -- UUIDv7
  email         TEXT NOT NULL UNIQUE,        -- 全域唯一（登入以 email 全域查找）
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  locale        TEXT,
  created_at    INTEGER NOT NULL             -- epoch ms
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','member')),
  created_at INTEGER NOT NULL,               -- epoch ms
  PRIMARY KEY (user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(org_id);
