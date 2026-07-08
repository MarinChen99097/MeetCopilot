-- 010_deep_mode.sql — 放寬 crawl_jobs.mode 的 CHECK 以容納 'deep'（全網深度研究模式）。
-- 依 §0 慣例：enum＝TEXT + CHECK(col IN(...))。SQLite 無法 ALTER CHECK，故以「建新表→複製→換名」重建。
-- 重建保留既有 quick/detailed job 列（研究執行簿記，非業務資料；重建只是換 CHECK 定義）。

CREATE TABLE IF NOT EXISTS crawl_jobs_new (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL,
  target_type    TEXT NOT NULL,
  target_id      TEXT NOT NULL,
  target_domain  TEXT,
  mode           TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued',
  requested_by   TEXT,
  started_at     INTEGER,
  finished_at    INTEGER,
  sources_json   TEXT,
  fields_filled  INTEGER,
  error          TEXT,
  raw_result_ref TEXT,
  created_at     INTEGER NOT NULL,
  CHECK (target_type IN ('company','contact')),
  CHECK (mode IN ('quick','detailed','deep')),
  CHECK (status IN ('queued','running','done','failed'))
);

INSERT INTO crawl_jobs_new
  (id, org_id, target_type, target_id, target_domain, mode, status, requested_by,
   started_at, finished_at, sources_json, fields_filled, error, raw_result_ref, created_at)
SELECT
   id, org_id, target_type, target_id, target_domain, mode, status, requested_by,
   started_at, finished_at, sources_json, fields_filled, error, raw_result_ref, created_at
FROM crawl_jobs;

DROP TABLE crawl_jobs;
ALTER TABLE crawl_jobs_new RENAME TO crawl_jobs;
CREATE INDEX IF NOT EXISTS idx_crawl_jobs_org_target ON crawl_jobs(org_id, target_id);
