-- 010_deep_mode.sql (pg) — 放寬 crawl_jobs.mode 的 CHECK 以容納 'deep'（全網深度研究模式）。
-- Postgres 對表級 CHECK 自動命名 <table>_<col>_check；直接 DROP 舊約束再 ADD 新約束（含 'deep'）。
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_mode_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_mode_check CHECK (mode IN ('quick','detailed','deep'));
