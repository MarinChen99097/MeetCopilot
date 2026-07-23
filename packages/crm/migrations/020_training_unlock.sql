-- 020_training_unlock.sql — 模擬訓練「手動解鎖對練」旗標（R4c）。
-- 使用者要求：已驗證改成手動點、不由 persona 欄位內容自動判定（否則很難測試）。
-- training_unlocked=1 → train-service 的信任閘放行該 contact（與逐欄 verified 狀態脫鉤）。
-- 慣例同 019：SQLite 一欄一條 ALTER；NOT NULL 附常數 DEFAULT 回填既有列（既有 contact 預設鎖住＝0）。
-- 刻意不走 field_provenance 信任層（避免把「可對練」與「欄位可信」綁定；見 CRM_SCHEMA §11 反模式警告）。

ALTER TABLE contacts ADD COLUMN training_unlocked INTEGER NOT NULL DEFAULT 0;
