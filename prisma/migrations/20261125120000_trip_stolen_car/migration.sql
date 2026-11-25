-- A player driving a car taken from an NPC driver is shown to others in that car. Defaulted: existing rows are unaffected.
ALTER TABLE "Character" ADD COLUMN "tripVeh" TEXT NOT NULL DEFAULT '';
