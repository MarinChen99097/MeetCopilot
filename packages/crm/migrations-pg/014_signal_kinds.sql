-- 014_signal_kinds.sql (Postgres) — 放寬 meeting_signals.type CHECK：新增 'person_mention'、'topic_shift'（§4.2）。
-- pg 可 DROP/ADD CONSTRAINT：先動態 DROP 既有（005 內聯、自動命名）的 type CHECK，再 ADD 具名的放寬版。
-- runMigrationsPg 以整檔（simple protocol）在單一 tx 內執行，允許 DO 區塊。

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'meeting_signals'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%type%'
  LOOP
    EXECUTE 'ALTER TABLE meeting_signals DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
  ALTER TABLE meeting_signals ADD CONSTRAINT meeting_signals_type_check
    CHECK (type IN ('interest','objection','pain','competitor_mention','buying_signal','risk','pricing','next_step','landmine','person_mention','topic_shift'));
END $$;
