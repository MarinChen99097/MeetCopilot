-- 018_deck_import.sql (Postgres) — DynamicSlide 匯入重構：原簡報視覺原封保存＋原始頁鎖定。
-- SQLite migrations/018 的 pg 方言對映。§0：無 SQL FK；enum＝TEXT+CHECK；org_id 全帶（scope filter）；
-- 時間 epoch-ms（BIGINT，對齊既有 007/015 慣例，非 TIMESTAMPTZ）；二進位＝BYTEA。
-- 相容：既有 deck 靠 DEFAULT 一律 source_kind='native'/import_status='ready'/original_count=0；所有 slide kind='spec'。
-- （本 worktree 最高為 015；主樹另有 016_social_tech＋017_more_mode，故 deck 匯入支用 018 避免撞號。）

-- ── deck_assets（原檔 pptx/pdf bytes + 逐頁 page_image PNG bytes）──
CREATE TABLE IF NOT EXISTS deck_assets (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL,                    -- FK decks（無 SQL FK；級聯刪由 repo.delete 手動處理）
  org_id      TEXT NOT NULL,                    -- 租戶隔離
  kind        TEXT NOT NULL,                    -- 'source_pptx' | 'source_pdf' | 'page_image'
  page_index  INTEGER,                          -- kind=page_image 時 0-based；否則 NULL
  mime        TEXT NOT NULL,                    -- application/vnd...pptx | application/pdf | image/png
  bytes       BYTEA NOT NULL,
  byte_size   INTEGER NOT NULL,
  created_at  BIGINT NOT NULL,
  CHECK (kind IN ('source_pptx','source_pdf','page_image'))
);
CREATE INDEX IF NOT EXISTS idx_deck_assets_deck_kind ON deck_assets(deck_id, kind, page_index);

-- ── decks 加欄（既有列靠 DEFAULT 補齊：native/ready/0，不破舊資料）──
ALTER TABLE decks
  ADD COLUMN IF NOT EXISTS source_kind     TEXT NOT NULL DEFAULT 'native',  -- 'pptx' | 'pdf' | 'native'
  ADD COLUMN IF NOT EXISTS source_asset_id TEXT,                            -- 指向 deck_assets 原檔；native 為 NULL
  ADD COLUMN IF NOT EXISTS original_count  INTEGER NOT NULL DEFAULT 0,      -- 前段鎖定的原始頁數
  ADD COLUMN IF NOT EXISTS import_status   TEXT NOT NULL DEFAULT 'ready',   -- 'processing' | 'ready' | 'failed'
  ADD COLUMN IF NOT EXISTS import_error    TEXT;                            -- failed 時人話錯誤

-- ── deck_slides 加欄（既有列靠 DEFAULT 補 kind='spec'）──
ALTER TABLE deck_slides
  ADD COLUMN IF NOT EXISTS kind     TEXT NOT NULL DEFAULT 'spec',  -- 'original' | 'spec'
  ADD COLUMN IF NOT EXISTS asset_id TEXT;                          -- kind=original 時指向該頁 page_image asset

-- ── import_jobs（轉檔背景 job；複用 image_jobs 範式；boot reaper 清殘留 queued/running）──
CREATE TABLE IF NOT EXISTS import_jobs (
  id          TEXT PRIMARY KEY,
  deck_id     TEXT NOT NULL,
  org_id      TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'queued',   -- 'queued' | 'running' | 'done' | 'failed'
  error       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL,
  CHECK (status IN ('queued','running','done','failed'))
);
CREATE INDEX IF NOT EXISTS idx_import_jobs_org_deck ON import_jobs(org_id, deck_id);
