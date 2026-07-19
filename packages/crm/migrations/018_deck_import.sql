-- 018_deck_import.sql (SQLite) — DynamicSlide 匯入重構：原簡報視覺原封保存＋原始頁鎖定。
-- 新表 deck_assets/import_jobs；decks/deck_slides 加欄。§0：無 SQL FK；enum＝TEXT+CHECK；
-- 時間 epoch-ms（INTEGER，對齊既有 007/015 慣例）；二進位＝BLOB。
-- 相容：既有 deck 靠 DEFAULT 一律 native/ready/0；所有 slide kind='spec'。
-- SQLite 無 ADD COLUMN IF NOT EXISTS、無多欄 ALTER → 每欄一條（migration runner 每版本只跑一次，不需冪等）。

-- ── deck_assets（原檔 pptx/pdf bytes + 逐頁 page_image PNG bytes）──
CREATE TABLE IF NOT EXISTS deck_assets (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL,                    -- FK decks（無 SQL FK；級聯刪由 repo.delete 手動處理）
  org_id      TEXT NOT NULL,                    -- 租戶隔離
  kind        TEXT NOT NULL,                    -- 'source_pptx' | 'source_pdf' | 'page_image'
  page_index  INTEGER,                          -- kind=page_image 時 0-based；否則 NULL
  mime        TEXT NOT NULL,                    -- application/vnd...pptx | application/pdf | image/png
  bytes       BLOB NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  CHECK (kind IN ('source_pptx','source_pdf','page_image'))
);
CREATE INDEX IF NOT EXISTS idx_deck_assets_deck_kind ON deck_assets(deck_id, kind, page_index);

-- ── decks 加欄（既有列靠 DEFAULT 補齊：native/ready/0，不破舊資料）──
ALTER TABLE decks ADD COLUMN source_kind     TEXT NOT NULL DEFAULT 'native';  -- 'pptx' | 'pdf' | 'native'
ALTER TABLE decks ADD COLUMN source_asset_id TEXT;                            -- 指向 deck_assets 原檔；native 為 NULL
ALTER TABLE decks ADD COLUMN original_count  INTEGER NOT NULL DEFAULT 0;      -- 前段鎖定的原始頁數
ALTER TABLE decks ADD COLUMN import_status   TEXT NOT NULL DEFAULT 'ready';   -- 'processing' | 'ready' | 'failed'
ALTER TABLE decks ADD COLUMN import_error    TEXT;                            -- failed 時人話錯誤

-- ── deck_slides 加欄（既有列靠 DEFAULT 補 kind='spec'）──
ALTER TABLE deck_slides ADD COLUMN kind     TEXT NOT NULL DEFAULT 'spec';  -- 'original' | 'spec'
ALTER TABLE deck_slides ADD COLUMN asset_id TEXT;                          -- kind=original 時指向該頁 page_image asset

-- ── import_jobs（轉檔背景 job；複用 image_jobs 範式；boot reaper 清殘留 queued/running）──
CREATE TABLE IF NOT EXISTS import_jobs (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL,
  org_id      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'running' | 'done' | 'failed'
  error       TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  CHECK (status IN ('queued','running','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_org_deck ON import_jobs(org_id, deck_id);
