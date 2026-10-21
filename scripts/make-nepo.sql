-- scripts/make-nepo.sql
-- Run in the Neon SQL editor (one go). Makes omirinfavour02@gmail.com a NEPO with the Daddy Benz,
-- tops his cash up to exactly ₦10,000,000,000, and keeps him off FORBES OAU.
-- The money goes through the ledger (from the WORLD account) so the admin balance audit still passes. Safe to run twice.
BEGIN;

ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hideFromForbes" BOOLEAN NOT NULL DEFAULT false;

DO $$
DECLARE
  who     text   := 'omirinfavour02@gmail.com';
  target  bigint := 1000000000000;   -- ₦10,000,000,000 in kobo
  cid text; aid text; wid text; cur bigint; wk int;
BEGIN
  SELECT c.id INTO cid FROM "Character" c JOIN "User" u ON u.id = c."userId" WHERE lower(u.email) = lower(who);
  IF cid IS NULL THEN RAISE EXCEPTION 'No character for % (he must have created one first)', who; END IF;

  UPDATE "Character" SET class = 'NEPO', transport = 'Daddy Benz', "activeCar" = '', "hideFromForbes" = true WHERE id = cid;

  SELECT id, balance INTO aid, cur FROM "Account" WHERE "characterId" = cid FOR UPDATE;
  SELECT id INTO wid FROM "Account" WHERE kind = 'SYSTEM' AND "systemName" = 'WORLD';
  IF aid IS NULL OR wid IS NULL THEN RAISE EXCEPTION 'Account or WORLD account missing'; END IF;
  SELECT COALESCE(MAX("gameWeek"), 1) INTO wk FROM "LedgerEntry";

  IF cur < target THEN
    INSERT INTO "LedgerEntry" ("idempotencyKey", "debitAccountId", "creditAccountId", amount, memo, "gameWeek")
    VALUES ('manual:nepo-grant:' || cid || ':' || extract(epoch FROM now())::bigint, wid, aid, target - cur, 'Admin adjustment: Nepo grant', wk);
    UPDATE "Account" SET balance = target WHERE id = aid;
  END IF;

  INSERT INTO "AuditLog" ("actorId", action, target, detail)
  VALUES ('SYSTEM', 'MAKE_NEPO', cid, jsonb_build_object('email', who, 'balanceKoboBefore', cur::text, 'balanceKoboAfter', GREATEST(cur, target)::text, 'hideFromForbes', true));
END $$;

COMMIT;

-- check: class, car, cash in naira, hidden flag
SELECT c.name, c.class, c.transport, c."hideFromForbes", a.balance / 100 AS naira
FROM "Character" c JOIN "User" u ON u.id = c."userId" JOIN "Account" a ON a."characterId" = c.id
WHERE lower(u.email) = 'omirinfavour02@gmail.com';