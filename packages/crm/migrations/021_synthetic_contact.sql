-- 021_synthetic_contact.sql — 「AI 虛擬人物」旗標（R5／train 頁自助建對象 #4）。
-- 使用者要求：模擬對練對象不必是真人，可在 train 頁直接建一個設計出來的角色（配對方公司的 CRM 內容）。
-- is_synthetic=1 → 該 contact 是使用者/AI 設計的虛擬角色（非爬蟲/真人），CRM 人物清單以「虛擬」badge 標示。
-- 慣例同 020：SQLite 一欄一條 ALTER；NOT NULL 附常數 DEFAULT 回填既有列（既有真人 contact 預設 0）。
-- 虛擬角色的 persona 欄位由使用者創作、以 human provenance 寫入（非臆測真人，標人工合法；不違反 CRM_SCHEMA §11）。

ALTER TABLE contacts ADD COLUMN is_synthetic INTEGER NOT NULL DEFAULT 0;
