-- 008_training.sql — 語音模擬訓練：training_sessions / training_reports（M234_CONTRACT §M4；API_CONTRACT §7）。
-- §0：無 SQL FOREIGN KEY；enum＝TEXT + CHECK(col IN(...))；org_id 全帶(scope filter 強制)；時間 epoch-ms；JSON 存 TEXT。

-- ── training_sessions（一場對練；語音經 ephemeral token 直連 Gemini Live，不落我方 server）──
CREATE TABLE IF NOT EXISTS training_sessions (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,                         -- S
  contact_id      TEXT NOT NULL,                         -- S/H  FK contacts（扮演對象）
  deal_id         TEXT,                                  -- H    FK deals（nullable）
  difficulty      TEXT NOT NULL DEFAULT 'neutral',       -- H    friendly/neutral/hostile
  started_at      INTEGER,                               -- S
  ended_at        INTEGER,                               -- S
  transcript_json TEXT,                                  -- S    雙向逐字稿 TrainTurn[]
  created_at      INTEGER NOT NULL,                      -- S
  CHECK (difficulty IN ('friendly','neutral','hostile'))
);
CREATE INDEX IF NOT EXISTS idx_training_sessions_org_contact ON training_sessions(org_id, contact_id);

-- ── training_reports（課後四維評分報告；finish 觸發評分後寫入）──
CREATE TABLE IF NOT EXISTS training_reports (
  id              TEXT PRIMARY KEY,
  org_id          TEXT NOT NULL,                         -- S
  session_id      TEXT NOT NULL,                         -- S  FK training_sessions
  scores_json     TEXT NOT NULL,                         -- S  {objectionHandling,discovery,clarity,closing}:0-100
  highlights_json TEXT,                                  -- S  {quote,comment,kind:'good'|'improve'}[]
  summary         TEXT,                                  -- S
  created_at      INTEGER NOT NULL,                      -- S
  UNIQUE (org_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_training_reports_org_session ON training_reports(org_id, session_id);
