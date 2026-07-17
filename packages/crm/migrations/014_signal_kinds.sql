-- 014_signal_kinds.sql — 放寬 meeting_signals.type CHECK：新增 'person_mention'、'topic_shift'（RESEARCH_UPGRADE_CONTRACT §4.2）。
-- packages/shared/src/signals.ts 已把 SIGNAL_KINDS 擴到 11 類；005 的 CHECK 只列 9 類 → saveSignal 對新兩類會靜默失敗。
-- SQLite 不支援 ALTER CHECK → 以「新表 + 複製 + 換名」重建 meeting_signals（欄位/索引逐字保留自 005）。migrate.ts 整檔單一 tx。

CREATE TABLE meeting_signals_new (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,
  meeting_id      TEXT NOT NULL,
  segment_id      TEXT,
  type            TEXT NOT NULL,
  label           TEXT,
  payload_json    TEXT,
  entity_ref_json TEXT,
  confidence      REAL,
  created_at      INTEGER NOT NULL,
  CHECK (type IN ('interest','objection','pain','competitor_mention','buying_signal','risk','pricing','next_step','landmine','person_mention','topic_shift'))
);
INSERT INTO meeting_signals_new (id, org_id, meeting_id, segment_id, type, label, payload_json, entity_ref_json, confidence, created_at)
  SELECT id, org_id, meeting_id, segment_id, type, label, payload_json, entity_ref_json, confidence, created_at FROM meeting_signals;
DROP TABLE meeting_signals;
ALTER TABLE meeting_signals_new RENAME TO meeting_signals;
CREATE INDEX IF NOT EXISTS idx_meeting_signals_org_meeting ON meeting_signals(org_id, meeting_id);
