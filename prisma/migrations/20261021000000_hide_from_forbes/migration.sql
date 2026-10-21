-- A player can be left off the FORBES OAU board.
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "hideFromForbes" BOOLEAN NOT NULL DEFAULT false;