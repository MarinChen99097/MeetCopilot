-- 012_admin.sql — 平台管理後台（apps/admin）資料層：org/user 停權欄 + usage_events 使用者歸屬欄。
-- 依 ADMIN_CONTRACT §2。§0 慣例：無 SQL FOREIGN KEY（完整性由 repository 強制）；
--   enum＝TEXT + CHECK(col IN(...))；org_id 已全帶；時間 epoch-ms。
-- SQLite 對既有表加欄用 ALTER TABLE ADD COLUMN（CHECK 隨欄宣告即可，不必重建表；
--   NOT NULL 欄必附「非 NULL 常數 DEFAULT」以回填既有列）。SQLite 不支援單一 ALTER 多欄 → 每欄一條。

-- ── org 停權：orgs.status ──（active＝正常；suspended＝停權：該 org 全員 login/API 403）
ALTER TABLE orgs  ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));

-- ── user 停權：users.status ──（active＝正常；suspended＝停權：該 user login/API 403）
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended'));

-- ── 用量使用者歸屬：usage_events.user_id ──（nullable，無 FK，比照 org_id denormalize；
--    背景 job 無 request 脈絡時為 NULL）。既有列 ADD COLUMN 後回填 NULL。
ALTER TABLE usage_events ADD COLUMN user_id TEXT;
