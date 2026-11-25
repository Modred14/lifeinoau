-- Where each owned car was left in the home compound. All nullable / defaulted: existing cars keep being parked automatically until the player parks one.
ALTER TABLE "OwnedCar"
  ADD COLUMN "parked"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "parkX"    DOUBLE PRECISION,
  ADD COLUMN "parkZ"    DOUBLE PRECISION,
  ADD COLUMN "parkYaw"  DOUBLE PRECISION,
  ADD COLUMN "parkLot"  TEXT,
  ADD COLUMN "parkedAt" TIMESTAMP(3);

-- A saved pose is all or nothing: the three numbers and the lot signature are set together, or none of them is.
ALTER TABLE "OwnedCar" ADD CONSTRAINT "OwnedCar_park_all_or_nothing"
  CHECK (("parkX" IS NULL AND "parkZ" IS NULL AND "parkYaw" IS NULL AND "parkLot" IS NULL AND "parked" = false)
      OR ("parkX" IS NOT NULL AND "parkZ" IS NOT NULL AND "parkYaw" IS NOT NULL AND "parkLot" IS NOT NULL AND "parked" = true));
