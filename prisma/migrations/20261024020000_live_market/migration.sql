-- The live investment market (see lib/marketEngine.js, lib/marketLive.js, lib/investService.js).
-- Prices are a pure function of a secret key and the time; only the market's first moment and one checkpoint an hour are stored.

ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "realisedKobo" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "Holding" ADD COLUMN IF NOT EXISTS "feesKobo" BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "MarketGenesis" (
  "id"        INTEGER      NOT NULL,
  "data"      JSONB        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketGenesis_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_genesis_single" CHECK ("id" = 1)
);

CREATE TABLE IF NOT EXISTS "MarketCheckpoint" (
  "block"     BIGINT       NOT NULL,
  "state"     JSONB        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketCheckpoint_pkey" PRIMARY KEY ("block")
);

CREATE TABLE IF NOT EXISTS "MarketTrade" (
  "id"           BIGSERIAL    NOT NULL,
  "characterId"  TEXT         NOT NULL,
  "product"      TEXT         NOT NULL,
  "side"         TEXT         NOT NULL,
  "unitsMicro"   BIGINT       NOT NULL,
  "priceKobo"    BIGINT       NOT NULL,
  "grossKobo"    BIGINT       NOT NULL,
  "feeKobo"      BIGINT       NOT NULL,
  "penaltyKobo"  BIGINT       NOT NULL DEFAULT 0,
  "realisedKobo" BIGINT       NOT NULL DEFAULT 0,
  "requestId"    TEXT         NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketTrade_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "market_trade_valid" CHECK ("side" IN ('BUY','SELL') AND "unitsMicro" > 0 AND "priceKobo" > 0 AND "grossKobo" >= 0 AND "feeKobo" >= 0 AND "penaltyKobo" >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS "MarketTrade_characterId_requestId_key" ON "MarketTrade"("characterId", "requestId");
CREATE INDEX IF NOT EXISTS "MarketTrade_characterId_createdAt_idx" ON "MarketTrade"("characterId", "createdAt");
