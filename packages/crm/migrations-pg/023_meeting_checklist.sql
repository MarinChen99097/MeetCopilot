-- 023_meeting_checklist.sql (Postgres) — 會中「待講清單」（契約 docs/MEETING_CHECKLIST_CONTRACT.md §2）。
-- SQLite migrations/023 的 pg 方言對映，**語意等價**。
-- §0/§10 + 018 慣例：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms（BIGINT，非 TIMESTAMPTZ）。
-- 型別對映：SQLite INTEGER → BIGINT（epoch-ms / 序號）；TEXT/_json → TEXT。
-- pg 支援 ADD COLUMN IF NOT EXISTS → runner 外亦可重跑不報錯（照 018/021/022 慣例）。
--
-- 三段改動同 SQLite 版：
--  (1) meetings 加 deck_id / objective（**不改用既有 agenda 欄**）。
--  (2) deck_slides 加 text_extract（C2 預留，C1 不寫入；native deck 恆 NULL）。
--  (3) 新表 meeting_checklist_items ＋ (org_id, meeting_id, idx) 索引。

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS deck_id   TEXT,        -- 本場綁哪份 deck（nullable）
  ADD COLUMN IF NOT EXISTS objective TEXT;        -- 本場會議目標（自由文字，一句話；nullable）

ALTER TABLE deck_slides
  ADD COLUMN IF NOT EXISTS text_extract TEXT;     -- C2 預留：匯入 deck 的逐頁純文字（native deck 恆 NULL）

CREATE TABLE IF NOT EXISTS meeting_checklist_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL,                     -- S  FK orgs（租戶隔離；每個 repo 方法都注入 WHERE）
  meeting_id    TEXT NOT NULL,                     -- S  FK meetings
  idx           BIGINT NOT NULL,                   -- 顯示順序，0 起
  category      TEXT NOT NULL,                     -- 'talk' | 'ask' | 'address'
  title         TEXT NOT NULL,                     -- HUD 顯示用，繁中 ≤24 全形字
  detail        TEXT,                              -- 展開才看：為什麼要講／講到什麼程度
  slide_idx     BIGINT,                            -- nullable；綁哪一頁（只有 talk 類可能有值）
  keywords_json TEXT NOT NULL DEFAULT '[]',        -- string[]，勾稽關鍵詞
  priority      TEXT NOT NULL DEFAULT 'must',      -- 'must' | 'nice'
  status        TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'covered' | 'skipped'
  covered_by    TEXT,                              -- nullable；'transcript' | 'slide' | 'manual'
  covered_at    BIGINT,                            -- nullable；epoch-ms
  evidence      TEXT,                              -- nullable；逐字稿片段（≤120 字）或「第 N 頁」
  created_at    BIGINT NOT NULL,                   -- S
  updated_at    BIGINT NOT NULL,                   -- S
  CHECK (category IN ('talk','ask','address')),
  CHECK (priority IN ('must','nice')),
  CHECK (status IN ('pending','covered','skipped')),
  CHECK (covered_by IN ('transcript','slide','manual') OR covered_by IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_meeting_checklist_org_meeting ON meeting_checklist_items(org_id, meeting_id, idx);
