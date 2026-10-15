-- prisma/migrations/20261014200000_realtime_chat/migration.sql
-- Realtime chat: a slimmer, self-pruning message store.
--
--   * Chat      one row per pair of players: read/delivered watermarks, unread counters, preview line
--   * Message   rebuilt thin (no per-message read flag, no two 25-character player ids, one index)
--   * Presence  "last seen", written once when a player goes offline
--   * Report.evidence  a copy of the last messages, taken when a report is made
--
-- Existing messages are carried over (newest 150 per conversation) together with who has read what.

-- 1. Put the old table aside. Its constraint and sequence names are freed for the new table.
ALTER TABLE "Message" RENAME TO "Message_legacy";
ALTER INDEX "Message_pkey" RENAME TO "Message_legacy_pkey";
ALTER SEQUENCE "Message_id_seq" RENAME TO "Message_legacy_id_seq";

-- 2. New tables
CREATE TABLE "Chat" (
    "id" SERIAL NOT NULL,
    "aId" TEXT NOT NULL,
    "bId" TEXT NOT NULL,
    "lastId" BIGINT NOT NULL DEFAULT 0,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastBody" TEXT NOT NULL DEFAULT '',
    "lastKind" SMALLINT NOT NULL DEFAULT 0,
    "lastFromA" BOOLEAN NOT NULL DEFAULT true,
    "aRead" BIGINT NOT NULL DEFAULT 0,
    "bRead" BIGINT NOT NULL DEFAULT 0,
    "aDel" BIGINT NOT NULL DEFAULT 0,
    "bDel" BIGINT NOT NULL DEFAULT 0,
    "aUnread" INTEGER NOT NULL DEFAULT 0,
    "bUnread" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Chat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
    "id" BIGSERIAL NOT NULL,
    "chatId" INTEGER NOT NULL,
    "fromA" BOOLEAN NOT NULL,
    "kind" SMALLINT NOT NULL DEFAULT 0,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("chatId","id")
);

CREATE TABLE "Presence" (
    "characterId" TEXT NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("characterId")
);

CREATE UNIQUE INDEX "Chat_aId_bId_key" ON "Chat"("aId", "bId");
CREATE INDEX "Chat_bId_idx" ON "Chat"("bId");

ALTER TABLE "Report" ADD COLUMN "evidence" JSONB;

-- 3. Carry the old conversations over. "A" is the smaller id compared as plain text (the same rule the app uses).
INSERT INTO "Chat" ("aId", "bId")
SELECT DISTINCT
  CASE WHEN "fromId" COLLATE "C" < "toId" COLLATE "C" THEN "fromId" ELSE "toId" END,
  CASE WHEN "fromId" COLLATE "C" < "toId" COLLATE "C" THEN "toId" ELSE "fromId" END
FROM "Message_legacy";

-- the newest 150 per conversation, numbered oldest first so the new ids keep the original order
CREATE TEMP TABLE _kept AS
SELECT row_number() OVER (ORDER BY x."createdAt", x."id") AS nid, x."chatId", x."fromA", x."body", x."createdAt", x."unread"
FROM (
  SELECT l."id", l."createdAt", l."body", c."id" AS "chatId",
         (l."fromId" COLLATE "C" = c."aId") AS "fromA",
         (l."readAt" IS NULL) AS "unread",
         row_number() OVER (PARTITION BY c."id" ORDER BY l."createdAt" DESC, l."id" DESC) AS rn
  FROM "Message_legacy" l
  JOIN "Chat" c
    ON c."aId" = CASE WHEN l."fromId" COLLATE "C" < l."toId" COLLATE "C" THEN l."fromId" ELSE l."toId" END
   AND c."bId" = CASE WHEN l."fromId" COLLATE "C" < l."toId" COLLATE "C" THEN l."toId" ELSE l."fromId" END
) x
WHERE x.rn <= 150;

INSERT INTO "Message" ("id", "chatId", "fromA", "kind", "body", "createdAt")
SELECT nid, "chatId", "fromA", 0, "body", "createdAt" FROM _kept ORDER BY nid;
SELECT setval(pg_get_serial_sequence('"Message"', 'id'), COALESCE(MAX("id"), 1), MAX("id") IS NOT NULL) FROM "Message";

-- preview line, watermarks and unread counters. Everything that was already stored counts as delivered.
-- "Read up to" is the id just before the first unread message from the other side (or everything, if none is unread).
UPDATE "Chat" c SET
  "lastId"    = s."lastId",
  "lastAt"    = s."lastAt",
  "lastBody"  = left(s."lastBody", 60),
  "lastFromA" = s."lastFromA",
  "aDel"      = s."lastId",
  "bDel"      = s."lastId",
  "aRead"     = COALESCE(s."aFirstUnread" - 1, s."lastId"),
  "bRead"     = COALESCE(s."bFirstUnread" - 1, s."lastId"),
  "aUnread"   = s."aUnread",
  "bUnread"   = s."bUnread"
FROM (
  SELECT k."chatId",
         MAX(k.nid) AS "lastId",
         (ARRAY_AGG(k."createdAt" ORDER BY k.nid DESC))[1] AS "lastAt",
         (ARRAY_AGG(k."body" ORDER BY k.nid DESC))[1] AS "lastBody",
         (ARRAY_AGG(k."fromA" ORDER BY k.nid DESC))[1] AS "lastFromA",
         MIN(k.nid) FILTER (WHERE k."unread" AND NOT k."fromA") AS "aFirstUnread",
         MIN(k.nid) FILTER (WHERE k."unread" AND k."fromA") AS "bFirstUnread",
         COUNT(*) FILTER (WHERE k."unread" AND NOT k."fromA")::int AS "aUnread",
         COUNT(*) FILTER (WHERE k."unread" AND k."fromA")::int AS "bUnread"
  FROM _kept k GROUP BY k."chatId"
) s
WHERE c."id" = s."chatId";

DROP TABLE _kept;
DROP TABLE "Message_legacy";