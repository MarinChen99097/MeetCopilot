-- 013_social_notes.sql — WP1 社群來源層 + WP2 筆記區（RESEARCH_UPGRADE_CONTRACT §1.2 / §2）。
--  (a) companies.social_links：官網/grounding 發現的社群帳號，JSON {"youtube"?,"facebook"?,"instagram"?,"threads"?}（值＝完整 URL）。
--  (b) notes.note_type CHECK 放寬：新增 'narrative'（AI 敘事單例，pinned）與 'observations'（未歸類情報單例）。
-- SQLite 不支援 ALTER CHECK / DROP CONSTRAINT → 以「新表 + 複製 + 換名」重建 notes 以放寬 note_type CHECK
-- （欄位/預設/索引逐字保留自 005_deals_meetings.sql；notes 無 FK 指向它，重建安全）。migrate.ts 已把整檔包在單一 tx 內。

ALTER TABLE companies ADD COLUMN social_links TEXT;

CREATE TABLE notes_new (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  author_user_id TEXT,
  body           TEXT NOT NULL,
  note_type      TEXT DEFAULT 'general',
  pinned         INTEGER DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  CHECK (entity_type IN ('company','contact','deal','meeting')),
  CHECK (note_type IN ('general','call','email','research','narrative','observations'))
);
INSERT INTO notes_new (id, org_id, entity_type, entity_id, author_user_id, body, note_type, pinned, created_at, updated_at)
  SELECT id, org_id, entity_type, entity_id, author_user_id, body, note_type, pinned, created_at, updated_at FROM notes;
DROP TABLE notes;
ALTER TABLE notes_new RENAME TO notes;
CREATE INDEX IF NOT EXISTS idx_notes_org_entity ON notes(org_id, entity_type, entity_id);
