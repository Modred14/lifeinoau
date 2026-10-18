-- prisma/migrations/20261018000000_building_activities/migration.sql
-- Building activities: where a player stands inside a building, and one row per use of an activity.
-- Additive: no column or row is dropped. Back the database up before applying, as with every migration.

ALTER TABLE "Character"
  ADD COLUMN "inPlace" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "inX" DOUBLE PRECISION,
  ADD COLUMN "inZ" DOUBLE PRECISION,
  ADD COLUMN "inFloor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inAt" TIMESTAMP(3);

CREATE TABLE "ActivityRun" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "hubId" TEXT NOT NULL,
  "placeId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "gameWeek" INTEGER NOT NULL,
  "param" TEXT,
  "delta" JSONB,
  CONSTRAINT "ActivityRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActivityRun_characterId_requestId_key" ON "ActivityRun"("characterId", "requestId");
CREATE INDEX "ActivityRun_characterId_activityId_startedAt_idx" ON "ActivityRun"("characterId", "activityId", "startedAt");
CREATE INDEX "ActivityRun_characterId_status_idx" ON "ActivityRun"("characterId", "status");