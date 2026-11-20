-- prisma/migrations/20261120000000_sug_university_faculty_flyer/migration.sql
-- University administrative posts, faculty posts, and campaign photos for the flyer generator (see lib/sugRules.js, lib/sugFlyer.js).
-- Additive. No existing row is touched. Two CHECK constraints are widened so a race / an office may be one of the new posts, and one table is added.
--
--  * SUG posts keep their exact keys and rules.
--  * University posts (simulated political positions, not real appointments): VICE_CHANCELLOR, DEPUTY_VICE_CHANCELLOR, DEAN_STUDENT_AFFAIRS, REGISTRAR, STUDENT_AFFAIRS_REP.
--    A future university post is added by one more key in this list and one more entry in lib/sugRules.js UNIVERSITY_POSITIONS.
--  * Faculty posts: FACULTY_REP_<facultyId> and ASST_FACULTY_REP_<facultyId>, one pair per faculty (the id is the Faculty row's id).
-- Every one of them is a single seat; only HONOURABLE_MEMBER has 30, and the existing seats CHECKs already say so.

ALTER TABLE "SugRace" DROP CONSTRAINT sugrace_position_valid;
ALTER TABLE "SugRace" ADD CONSTRAINT sugrace_position_valid CHECK (
  position IN ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY_GENERAL', 'ASSISTANT_SECRETARY_GENERAL', 'PRO',
    'DIRECTOR_SOCIALS', 'DIRECTOR_SPORTS', 'FINANCIAL_SECRETARY', 'WELFARE_OFFICER', 'SPEAKER', 'DEPUTY_SPEAKER', 'HONOURABLE_MEMBER',
    'VICE_CHANCELLOR', 'DEPUTY_VICE_CHANCELLOR', 'DEAN_STUDENT_AFFAIRS', 'REGISTRAR', 'STUDENT_AFFAIRS_REP')
  OR position ~ '^(ASST_)?FACULTY_REP_[1-9][0-9]{0,8}$');

ALTER TABLE "SugAppointment" DROP CONSTRAINT sugappointment_position_valid;
ALTER TABLE "SugAppointment" ADD CONSTRAINT sugappointment_position_valid CHECK (
  position IN ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY_GENERAL', 'ASSISTANT_SECRETARY_GENERAL', 'PRO',
    'DIRECTOR_SOCIALS', 'DIRECTOR_SPORTS', 'FINANCIAL_SECRETARY', 'WELFARE_OFFICER', 'SPEAKER', 'DEPUTY_SPEAKER', 'HONOURABLE_MEMBER', 'CLERK',
    'VICE_CHANCELLOR', 'DEPUTY_VICE_CHANCELLOR', 'DEAN_STUDENT_AFFAIRS', 'REGISTRAR', 'STUDENT_AFFAIRS_REP')
  OR position ~ '^(ASST_)?FACULTY_REP_[1-9][0-9]{0,8}$');

-- The campaign photograph of a candidate, one per candidacy. It is stored already validated and re-encoded by the server (JPEG, longest side at most
-- 1600 px, no metadata), and is readable only by its owner and by the flyer renderer. Never served to anyone else.
CREATE TABLE "SugCandidatePhoto" (
  "candidateId" INTEGER NOT NULL,
  "characterId" TEXT NOT NULL,
  "mime" TEXT NOT NULL DEFAULT 'image/jpeg',
  "bytes" BYTEA NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugCandidatePhoto_pkey" PRIMARY KEY ("candidateId"),
  CONSTRAINT "SugCandidatePhoto_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT sugphoto_size_valid CHECK ("sizeBytes" BETWEEN 1 AND 4194304 AND width BETWEEN 1 AND 8000 AND height BETWEEN 1 AND 8000 AND mime = 'image/jpeg')
);
CREATE INDEX "SugCandidatePhoto_characterId_idx" ON "SugCandidatePhoto"("characterId");
