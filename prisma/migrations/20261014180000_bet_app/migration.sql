-- prisma/migrations/20261014180000_bet_app/migration.sql: Bet app, sports slips and casino rounds (Aviator, roulette)
CREATE TABLE "BetSlip" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "stakeKobo" BIGINT NOT NULL,
    "oddsText" TEXT NOT NULL,
    "potentialKobo" BIGINT NOT NULL,
    "legs" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "payoutKobo" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "BetSlip_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CasinoRound" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "game" TEXT NOT NULL,
    "stakeKobo" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'FLYING',
    "crashCenti" INTEGER NOT NULL DEFAULT 0,
    "autoCenti" INTEGER,
    "cashCenti" INTEGER,
    "payoutKobo" BIGINT NOT NULL DEFAULT 0,
    "data" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CasinoRound_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetSlip_characterId_status_idx" ON "BetSlip"("characterId", "status");
CREATE INDEX "BetSlip_characterId_createdAt_idx" ON "BetSlip"("characterId", "createdAt");
CREATE INDEX "CasinoRound_characterId_game_startedAt_idx" ON "CasinoRound"("characterId", "game", "startedAt");
CREATE INDEX "CasinoRound_characterId_status_idx" ON "CasinoRound"("characterId", "status");

ALTER TABLE "BetSlip" ADD CONSTRAINT betslip_bounds CHECK ("stakeKobo" > 0 AND "potentialKobo" > 0 AND "payoutKobo" >= 0);
ALTER TABLE "CasinoRound" ADD CONSTRAINT casinoround_bounds CHECK ("stakeKobo" > 0 AND "payoutKobo" >= 0);