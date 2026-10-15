-- prisma/migrations/20261014190000_love_bonds/migration.sql
-- CreateTable
CREATE TABLE "Bond" (
    "id" BIGSERIAL NOT NULL,
    "lowId" TEXT NOT NULL,
    "highId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TALKING',
    "prevKind" TEXT,
    "affection" INTEGER NOT NULL DEFAULT 0,
    "startedWeek" INTEGER NOT NULL,
    "kindWeek" INTEGER NOT NULL,
    "lastWeek" INTEGER NOT NULL,
    "dates" INTEGER NOT NULL DEFAULT 0,
    "meals" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "done" JSONB NOT NULL DEFAULT '{}',
    "everBabe" BOOLEAN NOT NULL DEFAULT false,
    "everEngaged" BOOLEAN NOT NULL DEFAULT false,
    "together" BOOLEAN NOT NULL DEFAULT false,
    "homeHostel" TEXT,
    "cheatedBy" TEXT,
    "cheatedWeek" INTEGER,
    "lastCheater" TEXT,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "endedWeek" INTEGER,
    "endedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bond_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoveRequest" (
    "id" BIGSERIAL NOT NULL,
    "bondId" BIGINT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "variant" TEXT,
    "gameWeek" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "LoveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BondEvent" (
    "id" BIGSERIAL NOT NULL,
    "bondId" BIGINT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BondEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bond_highId_idx" ON "Bond"("highId");

-- CreateIndex
CREATE UNIQUE INDEX "Bond_lowId_highId_key" ON "Bond"("lowId", "highId");

-- CreateIndex
CREATE INDEX "LoveRequest_toId_status_idx" ON "LoveRequest"("toId", "status");

-- CreateIndex
CREATE INDEX "LoveRequest_fromId_status_idx" ON "LoveRequest"("fromId", "status");

-- CreateIndex
CREATE INDEX "LoveRequest_bondId_idx" ON "LoveRequest"("bondId");

-- CreateIndex
CREATE INDEX "BondEvent_bondId_id_idx" ON "BondEvent"("bondId", "id");

-- Rules the database itself keeps, so a bug can never break them.
ALTER TABLE "Bond" ADD CONSTRAINT bond_pair_ordered CHECK ("lowId" < "highId");
ALTER TABLE "Bond" ADD CONSTRAINT bond_affection_range CHECK (affection BETWEEN 0 AND 100);
ALTER TABLE "Bond" ADD CONSTRAINT bond_kind_valid CHECK (kind IN ('TALKING','BESTIE','SNEAKY','BABE','ENGAGED','EX'));
ALTER TABLE "LoveRequest" ADD CONSTRAINT loverequest_status_valid CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED'));
-- only one open request of each kind per couple
CREATE UNIQUE INDEX one_pending_love_request ON "LoveRequest" ("bondId", kind) WHERE status = 'PENDING';