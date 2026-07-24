-- 021_synthetic_contact.sql（PG）— 語意同 SQLite 版：contacts 加「AI 虛擬人物」旗標。
-- pg 支援 ADD COLUMN IF NOT EXISTS → runner 外亦可重跑不報錯。NOT NULL DEFAULT 0 回填既有列（既有真人 contact 預設 0）。

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_synthetic INTEGER NOT NULL DEFAULT 0;
