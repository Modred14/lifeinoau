-- scripts/hide-faiq-from-forbes.sql
-- Run in the Neon SQL editor (one go). Takes the player with username "Faiq" off the FORBES OAU board.
-- Only the board is affected: cash, business and investments are untouched. Safe to run twice.
-- To put him back on the board, run the UNDO line at the bottom.
BEGIN;

ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hideFromForbes" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  uname text := 'Faiq';
  cid   text;
BEGIN
  SELECT id INTO cid FROM "Character" WHERE lower(name) = lower(uname);
  IF cid IS NULL THEN RAISE EXCEPTION 'No character with username %', uname; END IF;

  UPDATE "Character" SET "hideFromForbes" = true WHERE id = cid;

  INSERT INTO "AuditLog" ("actorId", action, target, detail)
  VALUES ('SYSTEM', 'HIDE_FROM_FORBES', cid, jsonb_build_object('username', uname, 'hideFromForbes', true));
END $$;

COMMIT;

-- check: should show hideFromForbes = true
SELECT name, class, "hideFromForbes" FROM "Character" WHERE lower(name) = 'faiq';

-- UNDO: UPDATE "Character" SET "hideFromForbes" = false WHERE lower(name) = 'faiq';