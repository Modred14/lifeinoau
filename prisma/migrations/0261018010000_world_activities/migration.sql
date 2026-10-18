-- On-site hustles (Oduduwa Hall event crew, SUB backstairs runs): a timed run at a building. The outcome is rolled and the energy taken at the
-- start; the pay (or the QRS arrest) is applied once, when the run is finished at the same place.
CREATE TABLE "HustleRun" (
  "id" BIGSERIAL PRIMARY KEY,
  "characterId" TEXT NOT NULL REFERENCES "Character"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('crew','backstairs')),
  "placeId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "energyCost" INTEGER NOT NULL,
  "caught" BOOLEAN NOT NULL DEFAULT false,
  "payKobo" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE','DONE','ABANDONED')),
  "finishedAt" TIMESTAMP(3),
  "requestId" TEXT NOT NULL
);
CREATE UNIQUE INDEX "HustleRun_one_active" ON "HustleRun"("characterId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "HustleRun_request" ON "HustleRun"("characterId", "requestId");

-- A lecturer's surprise test now waits for the student at their own faculty. One per player per game week.
CREATE TABLE "ClassTest" (
  "id" BIGSERIAL PRIMARY KEY,
  "characterId" TEXT NOT NULL REFERENCES "Character"("id") ON DELETE CASCADE,
  "sessionStartWeek" INTEGER NOT NULL,
  "gameWeek" INTEGER NOT NULL,
  "code" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING','TAKEN','MISSED')),
  "score" INTEGER,
  "takenAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ClassTest_week" ON "ClassTest"("characterId", "gameWeek");