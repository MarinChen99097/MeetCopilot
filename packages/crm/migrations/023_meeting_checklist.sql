-- 023_meeting_checklist.sql — 會中「待講清單」（Meeting Checklist；契約 docs/MEETING_CHECKLIST_CONTRACT.md §2）。
-- 會前依「會議目標＋簡報全文＋CRM 情報」生成必講/必問/必回應清單，會中隨對話與簡報進度自動劃掉。
--
-- 三段改動：
--  (1) meetings 加 deck_id / objective——修既有債：deck 綁定原本只在記憶體，會議目標無處存。
--      **刻意不改用既有 agenda 欄**（語意＝議程、且從未被寫入，混用製造歧義）。
--  (2) deck_slides 加 text_extract——C2（匯入 deck 逐頁純文字）預留，C1 不寫入；native deck 恆 NULL。
--  (3) 新表 meeting_checklist_items ＋ (org_id, meeting_id, idx) 索引。
--
-- 慣例同 019–022：SQLite 一欄一條 ALTER TABLE ADD COLUMN（SQLite 無 IF NOT EXISTS 語法）；
--   三欄皆 nullable 故不需 DEFAULT 回填。冪等由 migration runner 的 schema_migrations 版本表保證
--   （migrate.ts：已套用的 version 直接 skip），與 019/020/021 完全同模式。
-- §0：無 SQL FOREIGN KEY；enum＝TEXT + CHECK(col IN(...))；org_id 全帶；時間 epoch-ms（INTEGER）；JSON 存 TEXT。
-- 本表為**新表**，CHECK 直接寫在 CREATE 內（不像 meeting_signals 加值時要整表重建）。

ALTER TABLE meetings ADD COLUMN deck_id TEXT;    -- 本場綁哪份 deck（nullable；建會可留空）
ALTER TABLE meetings ADD COLUMN objective TEXT;  -- 本場會議目標（自由文字，一句話；nullable）

ALTER TABLE deck_slides ADD COLUMN text_extract TEXT; -- C2 預留：匯入 deck 的逐頁純文字（native deck 恆 NULL）

CREATE TABLE IF NOT EXISTS meeting_checklist_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,                     -- S  FK orgs（租戶隔離；每個 repo 方法都注入 WHERE）
  meeting_id    TEXT NOT NULL,                     -- S  FK meetings
  idx           INTEGER NOT NULL,                  -- 顯示順序，0 起
  category      TEXT NOT NULL,                     -- 'talk' | 'ask' | 'address'
  title         TEXT NOT NULL,                     -- HUD 顯示用，繁中 ≤24 全形字
  detail        TEXT,                              -- 展開才看：為什麼要講／講到什麼程度
  slide_idx     INTEGER,                           -- nullable；綁哪一頁（只有 talk 類可能有值）
  keywords_json TEXT NOT NULL DEFAULT '[]',        -- string[]，勾稽關鍵詞
  priority      TEXT NOT NULL DEFAULT 'must',      -- 'must' | 'nice'
  status        TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'covered' | 'skipped'
  covered_by    TEXT,                              -- nullable；'transcript' | 'slide' | 'manual'
  covered_at    INTEGER,                           -- nullable；epoch-ms
  evidence      TEXT,                              -- nullable；逐字稿片段（≤120 字）或「第 N 頁」
  created_at    INTEGER NOT NULL,                  -- S
  updated_at    INTEGER NOT NULL,                  -- S
  CHECK (category IN ('talk','ask','address')),
  CHECK (priority IN ('must','nice')),
  CHECK (status IN ('pending','covered','skipped')),
  CHECK (covered_by IN ('transcript','slide','manual') OR covered_by IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_meeting_checklist_org_meeting ON meeting_checklist_items(org_id, meeting_id, idx);
