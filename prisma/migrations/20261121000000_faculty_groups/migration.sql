-- prisma/migrations/20261121000000_faculty_groups/migration.sql
-- Faculty groups: a community per faculty and its members.
-- Additive and safe for production: it only ADDS two tables and two triggers; the backfill at the end is idempotent (re-running changes nothing).
-- Faculty Representatives are NOT elected here: that is the SUG election's faculty races (20261120000000_sug_university_faculty_flyer).

-- CreateTable
CREATE TABLE "FacultyGroup" (
    "id" SERIAL NOT NULL,
    "facultyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FacultyGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FacultyGroupMember" (
    "id" SERIAL NOT NULL,
    "groupId" INTEGER NOT NULL,
    "characterId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FacultyGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacultyGroup_facultyId_key" ON "FacultyGroup"("facultyId");
CREATE UNIQUE INDEX "FacultyGroupMember_characterId_key" ON "FacultyGroupMember"("characterId");
CREATE INDEX "FacultyGroupMember_groupId_idx" ON "FacultyGroupMember"("groupId");

-- AddForeignKey
ALTER TABLE "FacultyGroup" ADD CONSTRAINT "FacultyGroup_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacultyGroupMember" ADD CONSTRAINT "FacultyGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FacultyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacultyGroupMember" ADD CONSTRAINT "FacultyGroupMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Membership is kept true by the database itself ----
-- 1. Every Faculty gets its one group the moment it exists.
CREATE OR REPLACE FUNCTION faculty_group_for_new_faculty() RETURNS trigger AS $$
BEGIN
  INSERT INTO "FacultyGroup" ("facultyId") VALUES (NEW."id") ON CONFLICT ("facultyId") DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER faculty_group_for_new_faculty AFTER INSERT ON "Faculty" FOR EACH ROW EXECUTE FUNCTION faculty_group_for_new_faculty();

-- 2. Every Character is a member of the group of its faculty: on creation, and again if its faculty ever changes (one membership row per player, always).
CREATE OR REPLACE FUNCTION faculty_group_sync_member() RETURNS trigger AS $$
DECLARE gid INTEGER;
BEGIN
  INSERT INTO "FacultyGroup" ("facultyId") VALUES (NEW."facultyId") ON CONFLICT ("facultyId") DO NOTHING;
  SELECT "id" INTO gid FROM "FacultyGroup" WHERE "facultyId" = NEW."facultyId";
  INSERT INTO "FacultyGroupMember" ("groupId", "characterId") VALUES (gid, NEW."id")
    ON CONFLICT ("characterId") DO UPDATE SET "groupId" = EXCLUDED."groupId", "joinedAt" = CURRENT_TIMESTAMP
    WHERE "FacultyGroupMember"."groupId" <> EXCLUDED."groupId";
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER faculty_group_sync_member AFTER INSERT OR UPDATE OF "facultyId" ON "Character" FOR EACH ROW EXECUTE FUNCTION faculty_group_sync_member();

-- ---- Backfill: existing faculties and existing players (idempotent) ----
INSERT INTO "FacultyGroup" ("facultyId") SELECT "id" FROM "Faculty" ON CONFLICT ("facultyId") DO NOTHING;
INSERT INTO "FacultyGroupMember" ("groupId", "characterId")
  SELECT g."id", c."id" FROM "Character" c JOIN "FacultyGroup" g ON g."facultyId" = c."facultyId"
  ON CONFLICT ("characterId") DO NOTHING;
