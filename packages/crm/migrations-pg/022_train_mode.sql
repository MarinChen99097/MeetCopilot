-- 022_train_mode.sql（PG）— 語意同 SQLite 版：training_sessions 加對練情境模式旗標。
-- pg 支援 ADD COLUMN IF NOT EXISTS → runner 外亦可重跑不報錯。NOT NULL DEFAULT 'sales' 回填既有列。
-- mode 值域由 app 端 TRAIN_MODES_KEYS 驗證（不加 CHECK，方便日後擴充模式免改 schema）。

ALTER TABLE training_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'sales';
