-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "look" JSONB;

-- AlterTable
ALTER TABLE "ExamResult" ADD COLUMN     "detail" JSONB;

-- CreateTable
CREATE TABLE "CourseProgress" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "sessionStartWeek" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "attended" INTEGER NOT NULL DEFAULT 0,
    "prep" INTEGER NOT NULL DEFAULT 0,
    "lastAttendWeek" INTEGER,
    "lastStudyWeek" INTEGER,

    CONSTRAINT "CourseProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CourseProgress_characterId_sessionStartWeek_idx" ON "CourseProgress"("characterId", "sessionStartWeek");

-- CreateIndex
CREATE UNIQUE INDEX "CourseProgress_characterId_sessionStartWeek_code_key" ON "CourseProgress"("characterId", "sessionStartWeek", "code");
