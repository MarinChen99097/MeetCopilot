-- 009_ops.sql (Postgres) — M5 生產強化：成本記帳（usage_events）、邀請制成員（invites）、逐字稿隱私欄（meetings ALTER）。SQLite migrations/009 的 pg 方言對映。
-- §0/§10：無 SQL FOREIGN KEY；enum＝TEXT + CHECK；org_id 全帶；時間 epoch-ms（bigint）；布林 0/1（bigint）；JSON 存 text。
-- 型別對映：INTEGER → bigint；REAL → double precision；TEXT → text。
-- 註：pg 的 ALTER TABLE ADD COLUMN ... NOT NULL DEFAULT 0 於 PG 11+ 以常數預設回填既有列（安全）；
--     加 IF NOT EXISTS（PG 9.6+）使本檔於 runner 外亦可重跑而不報錯。

-- ── §B 成本記帳：usage_events ──
-- 冪等鍵：UNIQUE(org_id, idempotency_key) → 重試同一呼叫不重複計費。
-- 註：repo 端的 SQLite `INSERT OR IGNORE` 於 pg 對應 `INSERT ... ON CONFLICT (org_id, idempotency_key) DO NOTHING`
--     （PORT 稽核 A1；此 UNIQUE 即該 ON CONFLICT 的目標）。
CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT PRIMARY KEY,            -- UUIDv7
  org_id          TEXT NOT NULL,               -- S  FK orgs（denormalized 租戶鍵）
  kind            TEXT NOT NULL,               -- S  用量種類，見 CHECK
  model           TEXT,                        -- S  實際 model id（如 gemini-3.1-flash / gpt-image-2）
  input_tokens    BIGINT,                      -- S  取 API usage 欄，無則估（nullable）
  output_tokens   BIGINT,                      -- S  同上
  est_cost_usd    DOUBLE PRECISION NOT NULL DEFAULT 0, -- S  依定價常數估算的成本（USD）
  meeting_id      TEXT,                        -- S  歸屬會議（nullable；非會議情境為 NULL）
  idempotency_key TEXT NOT NULL,               -- S  冪等鍵（呼叫端決定；同 org 內唯一）
  created_at      BIGINT NOT NULL,             -- S  epoch ms
  CHECK (kind IN ('gemini_text','gemini_extract','gemini_live','openai_image','embedding','asr')),
  UNIQUE (org_id, idempotency_key)
);
-- rollup(orgId, from, to) 走此 index（org + 時間窗掃描、依 kind 分組）。
CREATE INDEX IF NOT EXISTS idx_usage_events_org_created ON usage_events(org_id, created_at);

-- ── §D 邀請制成員管理：invites ──
-- role 僅 admin/member（owner 不經邀請產生；建 org 者為 owner）。
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,                -- UUIDv7
  org_id      TEXT NOT NULL,                   -- S  FK orgs
  email       TEXT NOT NULL,                   -- H  受邀者 email
  role        TEXT NOT NULL,                   -- H  受邀角色，見 CHECK
  token       TEXT NOT NULL UNIQUE,            -- S  邀請連結 token（全域唯一；findByToken 全域查）
  invited_by  TEXT,                            -- S  發邀者 user id（FK users，nullable）
  accepted_at BIGINT,                          -- S  接受時間（NULL＝未接受）epoch ms
  expires_at  BIGINT,                          -- S  逾期時間 epoch ms（nullable＝不逾期）
  created_at  BIGINT NOT NULL,                 -- S  epoch ms
  CHECK (role IN ('admin','member'))
);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id, created_at);

-- ── §A 逐字稿隱私：meetings 新增 persist/retention 欄 ──
-- persist_transcript=0（預設）→ 逐字稿只在 SessionRuntime 記憶體、不落 DB；=1 才落 DB。
-- retention_days（nullable；NULL→服務層預設 30）驅動 TTL purge。
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS persist_transcript BIGINT NOT NULL DEFAULT 0;  -- 0/1
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS retention_days     BIGINT;                     -- nullable；NULL→服務層預設 30
