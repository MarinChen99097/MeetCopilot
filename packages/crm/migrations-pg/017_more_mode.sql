-- 017_more_mode.sql (pg) — 放寬 crawl_jobs.mode 的 CHECK 以容納 'more'（「研究更多」補缺升級模式；RESEARCH_UPGRADE v2）。
-- Postgres 對表級 CHECK 自動命名 <table>_<col>_check（見 010 pg 版）；直接 DROP 舊約束再 ADD 新約束（含 'more'）。
-- 用 IF EXISTS 防呆：舊約束不存在（如純新庫走 head）亦不報錯。
ALTER TABLE crawl_jobs DROP CONSTRAINT IF EXISTS crawl_jobs_mode_check;
ALTER TABLE crawl_jobs ADD CONSTRAINT crawl_jobs_mode_check CHECK (mode IN ('quick','detailed','deep','more'));
