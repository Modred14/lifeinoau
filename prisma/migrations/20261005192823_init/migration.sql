-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('M', 'F');

-- CreateEnum
CREATE TYPE "Class" AS ENUM ('NEPO', 'MAPO', 'LAPO');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('PLAYER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JailStatus" AS ENUM ('JAILED', 'PAID', 'SERVED');

-- CreateEnum
CREATE TYPE "RelStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "PregStatus" AS ENUM ('PENDING', 'KEPT', 'ENDED', 'UNRESOLVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isAdult" BOOLEAN NOT NULL,
    "adultAckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faculty" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "difficulty" DECIMAL(3,2) NOT NULL DEFAULT 1.00,
    "verified" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" SERIAL NOT NULL,
    "facultyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" "Gender" NOT NULL,
    "class" "Class" NOT NULL,
    "personalities" TEXT[],
    "facultyId" INTEGER NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 100,
    "hostel" TEXT NOT NULL DEFAULT '',
    "transport" TEXT NOT NULL DEFAULT 'Trek',
    "health" INTEGER NOT NULL DEFAULT 80,
    "energy" INTEGER NOT NULL DEFAULT 90,
    "happiness" INTEGER NOT NULL DEFAULT 60,
    "academics" INTEGER NOT NULL DEFAULT 40,
    "popularity" INTEGER NOT NULL DEFAULT 10,
    "suspicion" INTEGER NOT NULL DEFAULT 0,
    "luck" INTEGER NOT NULL,
    "riskTolerance" INTEGER NOT NULL,
    "lastTickWeek" INTEGER NOT NULL DEFAULT 0,
    "missedCallStreak" INTEGER NOT NULL DEFAULT 0,
    "lastParentCallWeek" INTEGER NOT NULL DEFAULT 0,
    "jailedUntil" TIMESTAMP(3),
    "joinedWeek" INTEGER NOT NULL DEFAULT 1,
    "strikes" INTEGER NOT NULL DEFAULT 0,
    "suspendedUntilWeek" INTEGER NOT NULL DEFAULT 0,
    "expelled" BOOLEAN NOT NULL DEFAULT false,
    "sessionStartWeek" INTEGER NOT NULL DEFAULT 1,
    "failedSessions" INTEGER NOT NULL DEFAULT 0,
    "graduated" BOOLEAN NOT NULL DEFAULT false,
    "graduatedWeek" INTEGER,
    "finalCgpaX100" INTEGER,
    "classification" TEXT,
    "dependents" INTEGER NOT NULL DEFAULT 0,
    "jobKey" TEXT,
    "jobXp" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "systemName" TEXT,
    "characterId" TEXT,
    "balance" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" BIGSERIAL NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "debitAccountId" TEXT NOT NULL,
    "creditAccountId" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "memo" TEXT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameClock" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionLog" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorZero" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releaseAt" TIMESTAMP(3) NOT NULL,
    "bill" BIGINT NOT NULL,
    "status" "JailStatus" NOT NULL DEFAULT 'JAILED',

    CONSTRAINT "FloorZero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResult" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "gradePoint" INTEGER NOT NULL,
    "cheated" BOOLEAN NOT NULL DEFAULT false,
    "caught" BOOLEAN NOT NULL DEFAULT false,
    "missed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" BIGSERIAL NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" BIGSERIAL NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" BIGSERIAL NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "PartyNight" (
    "venue" TEXT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "attendees" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PartyNight_pkey" PRIMARY KEY ("venue","gameWeek")
);

-- CreateTable
CREATE TABLE "PartyTicket" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "gameWeek" INTEGER NOT NULL,
    "pricePaid" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "npcName" TEXT NOT NULL,
    "npcTrait" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'STRANGER',
    "affection" INTEGER NOT NULL DEFAULT 0,
    "lastWeek" INTEGER NOT NULL,
    "lastGiftWeek" INTEGER,
    "lastDateWeek" INTEGER,
    "startedWeek" INTEGER NOT NULL,
    "endedWeek" INTEGER,
    "status" "RelStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pregnancy" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "relationshipId" BIGINT NOT NULL,
    "startedWeek" INTEGER NOT NULL,
    "decideBy" INTEGER NOT NULL,
    "status" "PregStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "Pregnancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Achievement" (
    "characterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "earnedWeek" INTEGER NOT NULL,

    CONSTRAINT "Achievement_pkey" PRIMARY KEY ("characterId","key")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "employees" INTEGER NOT NULL DEFAULT 0,
    "reputation" INTEGER NOT NULL DEFAULT 50,
    "capital" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedWeek" INTEGER NOT NULL,
    "lastWeek" INTEGER NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holding" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "unitsMicro" BIGINT NOT NULL,
    "costKobo" BIGINT NOT NULL,
    "valueKobo" BIGINT NOT NULL DEFAULT 0,
    "lastBuyWeek" INTEGER NOT NULL,

    CONSTRAINT "Holding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_name_key" ON "Faculty"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Department_facultyId_name_key" ON "Department"("facultyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Character_userId_key" ON "Character"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_name_key" ON "Character"("name");

-- CreateIndex
CREATE INDEX "Character_facultyId_idx" ON "Character"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_systemName_key" ON "Account"("systemName");

-- CreateIndex
CREATE UNIQUE INDEX "Account_characterId_key" ON "Account"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_idempotencyKey_key" ON "LedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "LedgerEntry_debitAccountId_createdAt_idx" ON "LedgerEntry"("debitAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_creditAccountId_createdAt_idx" ON "LedgerEntry"("creditAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_memo_creditAccountId_idx" ON "LedgerEntry"("memo", "creditAccountId");

-- CreateIndex
CREATE INDEX "Notification_characterId_createdAt_idx" ON "Notification"("characterId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActionLog_characterId_requestId_key" ON "ActionLog"("characterId", "requestId");

-- CreateIndex
CREATE INDEX "FloorZero_characterId_status_idx" ON "FloorZero"("characterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResult_characterId_gameWeek_key" ON "ExamResult"("characterId", "gameWeek");

-- CreateIndex
CREATE INDEX "Message_toId_readAt_idx" ON "Message"("toId", "readAt");

-- CreateIndex
CREATE INDEX "Message_fromId_toId_createdAt_idx" ON "Message"("fromId", "toId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PartyTicket_characterId_idx" ON "PartyTicket"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "PartyTicket_characterId_gameWeek_key" ON "PartyTicket"("characterId", "gameWeek");

-- CreateIndex
CREATE INDEX "Relationship_characterId_status_idx" ON "Relationship"("characterId", "status");

-- CreateIndex
CREATE INDEX "Pregnancy_characterId_status_idx" ON "Pregnancy"("characterId", "status");

-- CreateIndex
CREATE INDEX "Business_characterId_status_idx" ON "Business"("characterId", "status");

-- CreateIndex
CREATE INDEX "Business_status_capital_idx" ON "Business"("status", "capital");

-- CreateIndex
CREATE INDEX "Holding_characterId_idx" ON "Holding"("characterId");

-- CreateIndex
CREATE UNIQUE INDEX "Holding_characterId_product_key" ON "Holding"("characterId", "product");

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_debitAccountId_fkey" FOREIGN KEY ("debitAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_creditAccountId_fkey" FOREIGN KEY ("creditAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
