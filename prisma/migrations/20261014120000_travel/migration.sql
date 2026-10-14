-- prisma/migrations/20261014120000_travel/migration.sql: Travel: where a player is on the map, and the driver hired from the Hire app.
ALTER TABLE "Character" ADD COLUMN "placeId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Character" ADD COLUMN "placeAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "driverName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Character" ADD COLUMN "driverUntilWeek" INTEGER NOT NULL DEFAULT 0;

-- Who is at a place right now (the people list inside a building).
CREATE INDEX "Character_placeId_placeAt_idx" ON "Character"("placeId", "placeAt");

-- Players on the road: their last position, so other players see them pass.
ALTER TABLE "Character" ADD COLUMN "tripX" DOUBLE PRECISION;
ALTER TABLE "Character" ADD COLUMN "tripZ" DOUBLE PRECISION;
ALTER TABLE "Character" ADD COLUMN "tripH" DOUBLE PRECISION;
ALTER TABLE "Character" ADD COLUMN "tripMode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Character" ADD COLUMN "tripAt" TIMESTAMP(3);
CREATE INDEX "Character_tripAt_idx" ON "Character"("tripAt");
