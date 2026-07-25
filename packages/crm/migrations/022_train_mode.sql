-- 022_train_mode.sql — 對練「情境模式」（sales/partnership/government/interview…可擴充）。
-- 使用者要求：對練對象/情境可切換——不只銷售，還要「尋求合作簡報」「政府簡報」「面試」等模式。
-- mode 決定 persona 框架（AI 扮誰）＋評分維度（各模式 rubric 不同）；預設 'sales' 回填既有列（行為不變）。
-- 慣例同 020/021：SQLite 一欄一條 ALTER；NOT NULL 附常數 DEFAULT。mode 值域由 app 端 TRAIN_MODES_KEYS 驗證（不加 CHECK，方便日後擴充模式免改 schema）。

ALTER TABLE training_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'sales';
