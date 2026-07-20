-- 019_usage_detail.sql — AI 記帳細化（對齊 ezpage 底層 per-call ledger）。
-- usage_events 加：reasoning/cached token 分桶（差別計價用）、retry_count（重試折進單列）、
--   cost_tax_multiplier（每列稅率快照；含稅＝est_cost_usd × 此值，改預設不回溯既有列）。
-- est_cost_usd 語意不變＝**稅前**估算值（admin 既有查詢/測試不受影響）；含稅由查詢/顯示層 × 每列稅率算出。
-- 慣例同 009/012：SQLite 一欄一條 ALTER；NOT NULL 附非 NULL 常數 DEFAULT 回填既有列（既有列稅率＝1.25）。

ALTER TABLE usage_events ADD COLUMN reasoning_tokens INTEGER;              -- thinking/thoughts tokens（算 output 價）
ALTER TABLE usage_events ADD COLUMN cached_input_tokens INTEGER;           -- cached input tokens（較便宜計價）
ALTER TABLE usage_events ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;-- 該邏輯呼叫的重試次數（折進單列）
ALTER TABLE usage_events ADD COLUMN cost_tax_multiplier REAL NOT NULL DEFAULT 1.25; -- 每列稅率快照（含稅=稅前×此值）
