-- 007_decks.sql (Postgres) — DynamicSlide：decks / deck_slides / image_jobs（M234_CONTRACT §M2；API_CONTRACT §4）。SQLite migrations/007 的 pg 方言對映。
-- §0/§10：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms（bigint）；JSON 存 text。
-- 型別對映：INTEGER → bigint；TEXT/_json → text。committed_index DEFAULT -1（bigint，I1 guard）。

-- ── decks（一份簡報）──
CREATE TABLE IF NOT EXISTS decks (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,                         -- S
  title           TEXT NOT NULL,                         -- H
  language        TEXT NOT NULL DEFAULT 'zh-TW',         -- H  zh-TW/en
  source          TEXT NOT NULL,                         -- S  ai/pptx/pdf（deck 來源管線）
  committed_index BIGINT NOT NULL DEFAULT -1,            -- S  已播到第幾頁（I1 guard；-1=未開播）
  company_id      TEXT,                                  -- H  FK companies（nullable；供 grounding）
  theme_json      TEXT,                                  -- S  SlideTheme（deck 級預設）
  created_at      BIGINT NOT NULL,                       -- S
  updated_at      BIGINT NOT NULL,                       -- S
  CHECK (language IN ('zh-TW','en')),
  CHECK (source IN ('ai','pptx','pdf'))
);
CREATE INDEX IF NOT EXISTS idx_decks_org_updated ON decks(org_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_decks_org_company ON decks(org_id, company_id);

-- ── deck_slides（deck 內一張頁；idx 為序，append 即 max(idx)+1）──
CREATE TABLE IF NOT EXISTS deck_slides (
  id         TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL,                              -- S
  deck_id    TEXT NOT NULL,                              -- S  FK decks
  idx        BIGINT NOT NULL,                            -- S  0-based 序位
  spec_json  TEXT NOT NULL,                              -- S  SlideSpec（渲染唯一格式）
  created_at BIGINT NOT NULL,                            -- S
  UNIQUE (org_id, deck_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_deck_slides_deck ON deck_slides(org_id, deck_id, idx);

-- ── image_jobs（pre-meeting AI 生圖；job 化，~10–80s）──
CREATE TABLE IF NOT EXISTS image_jobs (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL,                             -- S
  deck_id     TEXT NOT NULL,                             -- S  FK decks
  slide_idx   BIGINT NOT NULL,                           -- S  作用的頁序
  kind        TEXT NOT NULL,                             -- S  background/full
  status      TEXT NOT NULL DEFAULT 'queued',            -- S  queued/running/done/failed/refused
  prompt      TEXT,                                      -- S
  data_uri    TEXT,                                      -- S  done 時的 base64 png data: URI
  error       TEXT,                                      -- S
  created_at  BIGINT NOT NULL,                           -- S
  finished_at BIGINT,                                    -- S
  CHECK (kind IN ('background','full')),
  CHECK (status IN ('queued','running','done','failed','refused'))
);
CREATE INDEX IF NOT EXISTS idx_image_jobs_org_deck ON image_jobs(org_id, deck_id);
