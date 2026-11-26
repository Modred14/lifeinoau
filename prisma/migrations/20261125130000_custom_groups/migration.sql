-- Custom groups (made by players) and the discussion of faculty and custom groups.
-- Additive and safe for production: new tables, one new column with a default, and one trigger on a new table. No existing row is changed
-- except by the faculty-membership repair at the end, which only ADDS missing rows or moves a row that points at the wrong faculty.

ALTER TABLE "FacultyGroupMember" ADD COLUMN "lastReadId" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE "CustomGroup" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "privacy" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomGroup_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CustomGroup_privacy_check" CHECK ("privacy" IN ('PUBLIC', 'PRIVATE'))
);

CREATE TABLE "CustomGroupMember" (
    "groupId" INTEGER NOT NULL,
    "characterId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadId" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "CustomGroupMember_pkey" PRIMARY KEY ("groupId", "characterId"),
    CONSTRAINT "CustomGroupMember_role_check" CHECK ("role" IN ('OWNER', 'ADMIN', 'MEMBER'))
);

CREATE TABLE "CustomGroupAccess" (
    "groupId" INTEGER NOT NULL,
    "characterId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomGroupAccess_pkey" PRIMARY KEY ("groupId", "characterId"),
    CONSTRAINT "CustomGroupAccess_status_check" CHECK ("status" IN ('INVITED', 'REQUESTED', 'REMOVED'))
);

CREATE TABLE "GroupMessage" (
    "id" BIGSERIAL NOT NULL,
    "facultyGroupId" INTEGER,
    "customGroupId" INTEGER,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "GroupMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GroupMessage_one_group_check" CHECK (("facultyGroupId" IS NULL) <> ("customGroupId" IS NULL))
);

CREATE UNIQUE INDEX "CustomGroup_name_lower_key" ON "CustomGroup"(lower("name"));
CREATE UNIQUE INDEX "CustomGroupMember_one_owner_key" ON "CustomGroupMember"("groupId") WHERE "role" = 'OWNER';
CREATE INDEX "CustomGroupMember_characterId_idx" ON "CustomGroupMember"("characterId");
CREATE INDEX "CustomGroupAccess_characterId_status_idx" ON "CustomGroupAccess"("characterId", "status");
CREATE INDEX "GroupMessage_facultyGroupId_id_idx" ON "GroupMessage"("facultyGroupId", "id");
CREATE INDEX "GroupMessage_customGroupId_id_idx" ON "GroupMessage"("customGroupId", "id");
CREATE INDEX "GroupMessage_senderId_idx" ON "GroupMessage"("senderId");

ALTER TABLE "CustomGroupMember" ADD CONSTRAINT "CustomGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomGroupMember" ADD CONSTRAINT "CustomGroupMember_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomGroupAccess" ADD CONSTRAINT "CustomGroupAccess_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomGroupAccess" ADD CONSTRAINT "CustomGroupAccess_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_facultyGroupId_fkey" FOREIGN KEY ("facultyGroupId") REFERENCES "FacultyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_customGroupId_fkey" FOREIGN KEY ("customGroupId") REFERENCES "CustomGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GroupMessage" ADD CONSTRAINT "GroupMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A group never stays without an owner: if the owner's character is ever erased, the longest-serving administrator (else member) takes over,
-- and a group with nobody left is removed. (Leaving through the app already asks the owner to hand over first.)
CREATE OR REPLACE FUNCTION custom_group_owner_succession() RETURNS trigger AS $$
DECLARE heir TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "CustomGroup" WHERE "id" = OLD."groupId") THEN RETURN OLD; END IF;
  SELECT "characterId" INTO heir FROM "CustomGroupMember" WHERE "groupId" = OLD."groupId"
    ORDER BY ("role" = 'ADMIN') DESC, "joinedAt", "characterId" LIMIT 1;
  IF heir IS NULL THEN DELETE FROM "CustomGroup" WHERE "id" = OLD."groupId";
  ELSE UPDATE "CustomGroupMember" SET "role" = 'OWNER' WHERE "groupId" = OLD."groupId" AND "characterId" = heir;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER custom_group_owner_succession AFTER DELETE ON "CustomGroupMember" FOR EACH ROW WHEN (OLD."role" = 'OWNER') EXECUTE FUNCTION custom_group_owner_succession();

-- Repair pass for faculty membership (idempotent): anyone without a group, or in the wrong one, is put in the group of Character.facultyId.
INSERT INTO "FacultyGroup" ("facultyId") SELECT "id" FROM "Faculty" ON CONFLICT ("facultyId") DO NOTHING;
INSERT INTO "FacultyGroupMember" ("groupId", "characterId")
  SELECT g."id", c."id" FROM "Character" c JOIN "FacultyGroup" g ON g."facultyId" = c."facultyId"
  ON CONFLICT ("characterId") DO UPDATE SET "groupId" = EXCLUDED."groupId", "joinedAt" = CURRENT_TIMESTAMP
  WHERE "FacultyGroupMember"."groupId" <> EXCLUDED."groupId";
