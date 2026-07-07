-- 009_ops.sql — M5 生產強化：成本記帳（usage_events）、邀請制成員（invites）、逐字稿隱私欄（meetings ALTER）。
-- 依 M5_CONTRACT §A/§B/§D。§0 慣例：無 SQL FOREIGN KEY（完整性由 repository 強制）；
--   enum＝TEXT + CHECK(col IN(...))；org_id 全帶；時間 epoch-ms；布林 0/1；JSON 存 TEXT。
-- 註：SQLite 的 ALTER TABLE ADD COLUMN 對既有列以 DEFAULT/NULL 回填，安全冪等於本 runner（每版只跑一次）。

-- ── §B 成本記帳：usage_events ──
-- 每筆 LLM/生圖/embedding/ASR 呼叫經 meter(orgId, kind, fn, idemKey) 包裝冪等記一筆。
-- 冪等鍵：UNIQUE(org_id, idempotency_key) → 重試同一呼叫不重複計費（INSERT OR IGNORE）。
CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT PRIMARY KEY,            -- UUIDv7
  org_id          TEXT NOT NULL,               -- S  FK orgs（denormalized 租戶鍵）
  kind            TEXT NOT NULL,               -- S  用量種類，見 CHECK
  model           TEXT,                        -- S  實際 model id（如 gemini-3.1-flash / gpt-image-2）
  input_tokens    INTEGER,                     -- S  取 API usage 欄，無則估（nullable）
  output_tokens   INTEGER,                     -- S  同上
  est_cost_usd    REAL NOT NULL DEFAULT 0,     -- S  依定價常數估算的成本（USD）
  meeting_id      TEXT,                        -- S  歸屬會議（nullable；非會議情境為 NULL）
  idempotency_key TEXT NOT NULL,               -- S  冪等鍵（呼叫端決定；同 org 內唯一）
  created_at      INTEGER NOT NULL,            -- S  epoch ms
  CHECK (kind IN ('gemini_text','gemini_extract','gemini_live','openai_image','embedding','asr')),
  UNIQUE (org_id, idempotency_key)
);
-- rollup(orgId, from, to) 走此 index（org + 時間窗掃描、依 kind 分組）。
CREATE INDEX IF NOT EXISTS idx_usage_events_org_created ON usage_events(org_id, created_at);

-- ── §D 邀請制成員管理：invites ──
-- POST /api/org/invites 發（owner/admin）→ 回 invite 連結（帶 token）；accept 建 membership。
-- role 僅 admin/member（owner 不經邀請產生；建 org 者為 owner）。
CREATE TABLE IF NOT EXISTS invites (
  id          TEXT PRIMARY KEY,                -- UUIDv7
  org_id      TEXT NOT NULL,                   -- S  FK orgs
  email       TEXT NOT NULL,                   -- H  受邀者 email
  role        TEXT NOT NULL,                   -- H  受邀角色，見 CHECK
  token       TEXT NOT NULL UNIQUE,            -- S  邀請連結 token（全域唯一；findByToken 全域查）
  invited_by  TEXT,                            -- S  發邀者 user id（FK users，nullable）
  accepted_at INTEGER,                         -- S  接受時間（NULL＝未接受）epoch ms
  expires_at  INTEGER,                         -- S  逾期時間 epoch ms（nullable＝不逾期）
  created_at  INTEGER NOT NULL,                -- S  epoch ms
  CHECK (role IN ('admin','member'))
);
CREATE INDEX IF NOT EXISTS idx_invites_org ON invites(org_id, created_at);

-- ── §A 逐字稿隱私：meetings 新增 persist/retention 欄 ──
-- persist_transcript=0（預設）→ 逐字稿只在 SessionRuntime 記憶體、不寫 meeting_transcript_segments；會後即棄。
-- persist_transcript=1 → 才落 DB；retention_days（預設由服務層帶 30）驅動 TTL purge。
ALTER TABLE meetings ADD COLUMN persist_transcript INTEGER NOT NULL DEFAULT 0;  -- 0/1
ALTER TABLE meetings ADD COLUMN retention_days     INTEGER;                     -- nullable；NULL→服務層預設 30
