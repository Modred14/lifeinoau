-- Lecturer encounters in the lecture room, and the N-QRS response to them. Additive: nothing existing is changed or dropped.
-- Back the database up before applying, as with every migration.

CREATE TABLE "LectureEncounter" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "lecturerKey" TEXT NOT NULL,
    "lecturerName" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "npcIndex" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "qrsArriveAt" TIMESTAMP(3),
    "responseEndsAt" TIMESTAMP(3),
    "responseState" TEXT,
    "floorZeroId" BIGINT,
    "result" JSONB,

    CONSTRAINT "LectureEncounter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LectureEncounter_characterId_requestId_key" ON "LectureEncounter"("characterId", "requestId");
CREATE INDEX "LectureEncounter_characterId_status_idx" ON "LectureEncounter"("characterId", "status");
CREATE INDEX "LectureEncounter_venueId_roomId_responseState_idx" ON "LectureEncounter"("venueId", "roomId", "responseState");

-- The rules the service relies on, enforced by the database too, so two requests at the same moment can never break them:
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_status_valid CHECK (status IN ('OPEN', 'SETTLED', 'EXPIRED'));
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_outcome_valid CHECK (outcome IS NULL OR outcome IN ('LOST', 'ESCAPED', 'ARRESTED'));
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_response_state_valid CHECK ("responseState" IS NULL OR "responseState" IN ('ACTIVE', 'DONE'));
-- A player has one open encounter at a time.
CREATE UNIQUE INDEX one_open_lecture_encounter ON "LectureEncounter" ("characterId") WHERE status = 'OPEN';
-- One N-QRS response at a time in a lecture room: a second one cannot start while the first is still running (no duplicate N-QRS at the same scene).
CREATE UNIQUE INDEX one_active_lecture_response ON "LectureEncounter" ("venueId", "roomId") WHERE "responseState" = 'ACTIVE';