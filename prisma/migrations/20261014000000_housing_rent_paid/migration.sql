-- Housing app: rent paid up front when a player moves home (last game week covered; 0 = none)
ALTER TABLE "Character" ADD COLUMN "rentPaidUntilWeek" INTEGER NOT NULL DEFAULT 0;
