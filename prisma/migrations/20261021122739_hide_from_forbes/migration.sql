-- DropForeignKey
ALTER TABLE "CampusAssessment" DROP CONSTRAINT "CampusAssessment_characterId_fkey";

-- DropForeignKey
ALTER TABLE "CampusLink" DROP CONSTRAINT "CampusLink_characterId_fkey";

-- DropForeignKey
ALTER TABLE "CampusLink" DROP CONSTRAINT "CampusLink_userId_fkey";

-- DropForeignKey
ALTER TABLE "ClassTest" DROP CONSTRAINT "ClassTest_characterId_fkey";

-- DropForeignKey
ALTER TABLE "HustleRun" DROP CONSTRAINT "HustleRun_characterId_fkey";

-- DropForeignKey
ALTER TABLE "JobShift" DROP CONSTRAINT "JobShift_characterId_fkey";

-- AddForeignKey
ALTER TABLE "JobShift" ADD CONSTRAINT "JobShift_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HustleRun" ADD CONSTRAINT "HustleRun_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTest" ADD CONSTRAINT "ClassTest_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "ClassTest_week" RENAME TO "ClassTest_characterId_gameWeek_key";

-- RenameIndex
ALTER INDEX "HustleRun_request" RENAME TO "HustleRun_characterId_requestId_key";

-- RenameIndex
ALTER INDEX "JobShift_one_per_day" RENAME TO "JobShift_characterId_gameDay_key";

-- RenameIndex
ALTER INDEX "JobShift_request" RENAME TO "JobShift_characterId_requestId_key";

-- RenameIndex
ALTER INDEX "JobShift_week" RENAME TO "JobShift_characterId_gameWeek_idx";
