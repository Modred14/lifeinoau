-- prisma/migrations/20261019000000_club_spending/migration.sql
-- Nightclub spending: the transactions behind the Spending History, the floor events other players see, club buyouts and VIP status.
-- Additive: no existing column, table or row is changed. Money itself still moves only through LedgerEntry.

CREATE TABLE "ClubTransaction" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'COMPLETED',
  "recipientId" TEXT,
  "recipientName" TEXT,
  "requestId" TEXT NOT NULL,
  "gameWeek" INTEGER NOT NULL,
  "delta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubTransaction_pkey" PRIMARY KEY ("id"),
  -- the database refuses what the rules would refuse: nothing under N10,000 (1,000,000 kobo) and nothing over N10,000,000 (1,000,000,000 kobo)
  CONSTRAINT "ClubTransaction_amount_range" CHECK ("amount" >= 1000000 AND "amount" <= 1000000000),
  CONSTRAINT "ClubTransaction_status_known" CHECK ("status" IN ('COMPLETED', 'FAILED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "ClubTransaction_characterId_requestId_key" ON "ClubTransaction"("characterId", "requestId");
CREATE INDEX "ClubTransaction_characterId_createdAt_idx" ON "ClubTransaction"("characterId", "createdAt");
CREATE INDEX "ClubTransaction_characterId_clubId_idx" ON "ClubTransaction"("characterId", "clubId");
CREATE INDEX "ClubTransaction_characterId_kind_idx" ON "ClubTransaction"("characterId", "kind");

CREATE TABLE "ClubEvent" (
  "id" BIGSERIAL NOT NULL,
  "clubId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "fx" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "targetName" TEXT,
  "title" TEXT NOT NULL,
  "data" JSONB,
  "x" DOUBLE PRECISION,
  "z" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClubEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClubEvent_clubId_id_idx" ON "ClubEvent"("clubId", "id");
CREATE INDEX "ClubEvent_clubId_expiresAt_idx" ON "ClubEvent"("clubId", "expiresAt");

CREATE TABLE "ClubBuyout" (
  "id" BIGSERIAL NOT NULL,
  "clubId" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "hostName" TEXT NOT NULL,
  "tierId" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubBuyout_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClubBuyout_clubId_endsAt_idx" ON "ClubBuyout"("clubId", "endsAt");

CREATE TABLE "ClubVip" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "clubId" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "until" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClubVip_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ClubVip_characterId_clubId_key" ON "ClubVip"("characterId", "clubId");
CREATE INDEX "ClubVip_clubId_until_idx" ON "ClubVip"("clubId", "until");