-- prisma/migrations/20261021000000_multiplayer_games/migration.sql
-- prisma/migrations/20261019000000_multiplayer_games/migration.sql
-- The Games app: two-player matches with wagers. Additive only: three new tables, nothing is altered, dropped or rewritten.
-- Money never lives in these tables. Stakes and prizes move through the ledger (LedgerEntry) via the GAMES system account, which is created on first use.

CREATE TABLE "GameMatch" (
    "id" BIGSERIAL NOT NULL,
    "game" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "stakeKobo" BIGINT NOT NULL DEFAULT 0,
    "state" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "turnDeadline" TIMESTAMP(3),
    "winnerSeat" INTEGER,
    "result" TEXT,
    "reason" TEXT,
    "payoutKobo" BIGINT NOT NULL DEFAULT 0,
    "drawOffer" INTEGER,
    "rematch" JSONB,
    "rematchOfId" BIGINT,
    "rids" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameQueue" (
    "characterId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "stakeKobo" BIGINT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameQueue_pkey" PRIMARY KEY ("characterId")
);

CREATE TABLE "GameSeat" (
    "characterId" TEXT NOT NULL,
    "matchId" BIGINT NOT NULL,
    "seat" INTEGER NOT NULL,

    CONSTRAINT "GameSeat_pkey" PRIMARY KEY ("characterId")
);

CREATE INDEX "GameMatch_hostId_status_idx" ON "GameMatch"("hostId", "status");
CREATE INDEX "GameMatch_guestId_status_idx" ON "GameMatch"("guestId", "status");
CREATE INDEX "GameMatch_status_turnDeadline_idx" ON "GameMatch"("status", "turnDeadline");
CREATE INDEX "GameQueue_game_stakeKobo_joinedAt_idx" ON "GameQueue"("game", "stakeKobo", "joinedAt");
CREATE INDEX "GameSeat_matchId_idx" ON "GameSeat"("matchId");

-- Safety rules the database itself enforces, whatever the application does.
ALTER TABLE "GameMatch" ADD CONSTRAINT gamematch_bounds CHECK (
  "stakeKobo" >= 0 AND "payoutKobo" >= 0 AND "payoutKobo" <= "stakeKobo" * 2
  AND "hostId" <> "guestId"
  AND "turn" IN (0, 1) AND ("winnerSeat" IS NULL OR "winnerSeat" IN (0, 1))
  AND "status" IN ('INVITED', 'ACTIVE', 'FINISHED', 'CANCELLED', 'VOID')
);
ALTER TABLE "GameQueue" ADD CONSTRAINT gamequeue_bounds CHECK ("stakeKobo" >= 0);
ALTER TABLE "GameSeat" ADD CONSTRAINT gameseat_bounds CHECK ("seat" IN (0, 1));