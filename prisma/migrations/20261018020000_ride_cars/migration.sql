-- The Ride app and YK Autos: cars players buy, and which one they drive. Additive: no column or row is dropped.

ALTER TABLE "Character"
  ADD COLUMN "activeCar" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "activeCarColor" TEXT NOT NULL DEFAULT '';

CREATE TABLE "OwnedCar" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "color" TEXT NOT NULL DEFAULT '',
  "pricePaid" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnedCar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnedCar_characterId_modelId_key" ON "OwnedCar"("characterId", "modelId");
CREATE INDEX "OwnedCar_characterId_idx" ON "OwnedCar"("characterId");
ALTER TABLE "OwnedCar" ADD CONSTRAINT "OwnedCar_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;