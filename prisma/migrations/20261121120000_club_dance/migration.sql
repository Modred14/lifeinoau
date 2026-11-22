-- Club dancing: the dance style a player is doing right now, so other players in the club see it.
-- Additive and safe for production: it only ADDS two nullable columns (no default, no rewrite of existing rows). Re-running is guarded by IF NOT EXISTS.
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "danceStyle" TEXT;
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "danceUntil" TIMESTAMP(3);
