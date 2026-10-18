-- Real-time clock, real-time academic discipline, and Floor O (N-QRS Custody) location.
-- Additive: no column or row is dropped. Back the database up before applying, as with every migration.

ALTER TABLE "Character"
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "suspendedUntil" TIMESTAMP(3),
  ADD COLUMN "expelledAt" TIMESTAMP(3),
  ADD COLUMN "expelledUntil" TIMESTAMP(3),
  ADD COLUMN "restartWeek" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "energyRefilledAt" TIMESTAMP(3);

ALTER TABLE "FloorZero" ADD COLUMN "location" TEXT NOT NULL DEFAULT 'floor0';

-- Penalties that are running now become real-time penalties starting now: 2 hours for a suspension, 5 hours for an expulsion.
-- (They are worked out BEFORE the clock is rebased below, so "running now" still means what it meant under the old clock.)
UPDATE "Character" c SET "suspendedAt" = CURRENT_TIMESTAMP, "suspendedUntil" = CURRENT_TIMESTAMP + INTERVAL '2 hours'
FROM "GameClock" g
WHERE g.id = 1 AND c."suspendedUntilWeek" > (
  CASE WHEN g."campusEpoch" IS NOT NULL AND g."campusStartWeek" IS NOT NULL
    THEN g."campusStartWeek" + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - g."campusEpoch")) / (2 * 10080)))::INTEGER
    ELSE FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - g."startedAt")) / 604800)::INTEGER + 1 END);
UPDATE "Character" SET "suspendedUntilWeek" = 0 WHERE "suspendedUntilWeek" <> 0;
UPDATE "Character" SET "expelledAt" = CURRENT_TIMESTAMP, "expelledUntil" = CURRENT_TIMESTAMP + INTERVAL '5 hours' WHERE "expelled" = true;

-- Anyone serving a sentence now is held at Floor O.
UPDATE "Character" SET "placeId" = 'floor0', "placeAt" = CURRENT_TIMESTAMP, "tripAt" = NULL, "tripMode" = '' WHERE "jailedUntil" IS NOT NULL AND "jailedUntil" > CURRENT_TIMESTAMP;

-- Rebase the clock from 2 real seconds per game minute to 1:1, keeping the current game week AND how far into it we are
-- (the fraction of the week already elapsed is carried over, so nobody's week suddenly restarts or ends early).
UPDATE "GameClock" g SET
  "campusStartWeek" = w.week,
  "campusEpoch" = CURRENT_TIMESTAMP - (w.frac * INTERVAL '7 days')
FROM (
  SELECT id,
    CASE WHEN "campusEpoch" IS NOT NULL AND "campusStartWeek" IS NOT NULL
      THEN "campusStartWeek" + GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "campusEpoch")) / (2 * 10080)))::INTEGER
      ELSE FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) / 604800)::INTEGER + 1 END AS week,
    CASE WHEN "campusEpoch" IS NOT NULL AND "campusStartWeek" IS NOT NULL
      THEN (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "campusEpoch")) - FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "campusEpoch")) / (2 * 10080)) * (2 * 10080)) / (2 * 10080)
      ELSE (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) - FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "startedAt")) / 604800) * 604800) / 604800 END AS frac
  FROM "GameClock" WHERE id = 1
) w
WHERE g.id = 1;