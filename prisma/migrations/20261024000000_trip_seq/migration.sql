-- prisma/migrations/20261024000000_trip_seq/migration.sql
-- The newest road report (or trip end) stored for a player, so reports that overtake each other on the way never put an older spot over a newer one.
ALTER TABLE "Character" ADD COLUMN "tripSeq" DOUBLE PRECISION;
