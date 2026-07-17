-- 013_social_notes.sql (Postgres) — SQLite migrations/013 的 pg 方言對映（語意相同）。
--  (a) companies.social_links：JSON {"youtube"?,"facebook"?,"instagram"?,"threads"?}（值＝完整 URL），TEXT、可 NULL。
--  (b) notes.note_type CHECK 放寬：新增 'narrative' / 'observations'。
-- pg 支援 ADD COLUMN IF NOT EXISTS（冪等）。放寬 CHECK：先動態 DROP 既有（005 內聯、自動命名）的 note_type CHECK，再 ADD 具名的放寬版。
-- runMigrationsPg 以整檔（simple protocol）在單一 tx 內執行，允許 DO 區塊 + 多語句。

ALTER TABLE companies ADD COLUMN IF NOT EXISTS social_links TEXT;

DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notes'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%note_type%'
  LOOP
    EXECUTE 'ALTER TABLE notes DROP CONSTRAINT ' || quote_ident(c);
  END LOOP;
  ALTER TABLE notes ADD CONSTRAINT notes_note_type_check
    CHECK (note_type IN ('general','call','email','research','narrative','observations'));
END $$;
