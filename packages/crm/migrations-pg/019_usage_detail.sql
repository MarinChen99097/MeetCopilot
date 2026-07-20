-- 019_usage_detail.sql（PG）— 語意同 SQLite 版：usage_events 加 reasoning/cached token 分桶、
--   retry_count、cost_tax_multiplier（每列稅率快照）。est_cost_usd 語意不變＝稅前估算值。
-- pg 支援 ADD COLUMN IF NOT EXISTS → runner 外亦可重跑不報錯。token 欄用 BIGINT、稅率用 DOUBLE PRECISION（對齊 009）。

ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS reasoning_tokens BIGINT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE usage_events ADD COLUMN IF NOT EXISTS cost_tax_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.25;
