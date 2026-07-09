-- 012_admin.sql (Postgres) — SQLite migrations/012 的 pg 方言對映。平台管理後台（apps/admin）資料層。
-- 語意同 SQLite 版：orgs/users 加 status 停權欄、usage_events 加 user_id 使用者歸屬欄。
-- §0/§10：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms。
-- pg 支援 ADD COLUMN IF NOT EXISTS（PG 9.6+）→ 本檔於 runner 外亦可重跑而不報錯。
--   NOT NULL DEFAULT 'active' 於 PG 11+ 以常數預設回填既有列（安全）；欄級 CHECK 由 PG 自動命名 <table>_<col>_check。
-- 型別對映：TEXT → text。

ALTER TABLE orgs  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));

ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS user_id TEXT;
