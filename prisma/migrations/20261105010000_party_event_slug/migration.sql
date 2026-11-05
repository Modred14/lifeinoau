-- prisma/migrations/20261105010000_party_event_slug/migration.sql
-- A permanent link name for every event, used by shared links (/home?event=welcome-back-party). Existing events are given one from their name:
-- "Welcome Back Party" -> welcome-back-party, a second one with the same name -> welcome-back-party-2. Additive: nothing is dropped or changed.

ALTER TABLE "PartyEvent" ADD COLUMN "slug" TEXT;

DO $$
DECLARE
  r RECORD;
  base TEXT;
  cand TEXT;
  n INT;
BEGIN
  FOR r IN SELECT "id", "name" FROM "PartyEvent" ORDER BY "id" LOOP
    base := trim(both '-' from regexp_replace(lower("left"(r."name", 60)), '[^a-z0-9]+', '-', 'g'));
    IF base IS NULL OR base = '' THEN base := 'event'; END IF;
    cand := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM "PartyEvent" WHERE "slug" = cand) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;
    UPDATE "PartyEvent" SET "slug" = cand WHERE "id" = r."id";
  END LOOP;
END $$;

ALTER TABLE "PartyEvent" ALTER COLUMN "slug" SET NOT NULL;
CREATE UNIQUE INDEX "PartyEvent_slug_key" ON "PartyEvent"("slug");
