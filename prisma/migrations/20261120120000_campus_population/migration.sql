-- prisma/migrations/20261120120000_campus_population/migration.sql
-- The simulated campus population shown in the header (docs/CAMPUS-POPULATION.md). Additive: two new tables, nothing existing is changed or read.
--
--   * CampusArrivalDay  the simulated arrivals added on each calendar day (game time zone). A new day is a new row.
--   * CampusEntry       the last counted game entry of each player, for the once-per-cool-down rule.
--
-- These hold SIMULATED data only. They are never joined to, and never written into, the real account or analytics tables.

CREATE TABLE "CampusArrivalDay" (
    "day" VARCHAR(10) NOT NULL,
    "arrivals" INTEGER NOT NULL DEFAULT 0,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampusArrivalDay_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "CampusEntry" (
    "userId" TEXT NOT NULL,
    "lastEntryAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampusEntry_pkey" PRIMARY KEY ("userId")
);

-- The simulated counters can never go negative (the same rule is kept in prisma/constraints.sql).
ALTER TABLE "CampusArrivalDay" ADD CONSTRAINT campusarrivalday_nonneg CHECK ("arrivals" >= 0 AND "entries" >= 0);
