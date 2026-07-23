-- 020_training_unlock.sql（PG）— 語意同 SQLite 版：contacts 加手動「解鎖對練」旗標。
-- pg 支援 ADD COLUMN IF NOT EXISTS → runner 外亦可重跑不報錯。NOT NULL DEFAULT 0 回填既有列（預設鎖住）。

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS training_unlocked INTEGER NOT NULL DEFAULT 0;
