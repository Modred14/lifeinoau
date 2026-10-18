-- Job shifts: one row per clocked-in shift. The pay is rolled and the energy taken when the shift starts; the pay is released once, on claim.
CREATE TABLE "JobShift" (
  "id" BIGSERIAL PRIMARY KEY,
  "characterId" TEXT NOT NULL REFERENCES "Character"("id") ON DELETE CASCADE,
  "jobKey" TEXT NOT NULL,
  "shiftKey" TEXT NOT NULL CHECK ("shiftKey" IN ('morning','night')),
  "gameDay" INTEGER NOT NULL,
  "gameWeek" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "energyCost" INTEGER NOT NULL CHECK ("energyCost" >= 0),
  "payKobo" BIGINT NOT NULL CHECK ("payKobo" >= 0),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','CLAIMED','ABANDONED')),
  "claimedAt" TIMESTAMP(3),
  "requestId" TEXT NOT NULL
);
-- Never two shifts at once, never two shifts on the same in-game day, and a request id can only start one shift.
CREATE UNIQUE INDEX "JobShift_one_active" ON "JobShift"("characterId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "JobShift_one_per_day" ON "JobShift"("characterId", "gameDay");
CREATE UNIQUE INDEX "JobShift_request" ON "JobShift"("characterId", "requestId");
CREATE INDEX "JobShift_week" ON "JobShift"("characterId", "gameWeek");

-- Sleep: the moment the player lay down (null = awake). Energy is worked out from this on the server when they wake.
ALTER TABLE "Character" ADD COLUMN "sleepingSince" TIMESTAMP(3);
-- the bed (RoomItem id) the server put the player in: the wake-up rate comes from this bed, never from anything the browser says when waking
ALTER TABLE "Character" ADD COLUMN "sleepingBed" TEXT;
-- when the player last ARRIVED at placeId (set by travel). A trip cannot be faster than walking or driving the distance, so a browser cannot teleport.
ALTER TABLE "Character" ADD COLUMN "arrivedAt" TIMESTAMP(3);