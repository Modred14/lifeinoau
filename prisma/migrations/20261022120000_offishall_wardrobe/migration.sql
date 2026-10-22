-- The Offishall Store: clothes players buy (lib/wardrobe.js). Additive: no column or row is dropped or changed.

CREATE TABLE "WardrobeItem" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "pricePaid" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WardrobeItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WardrobeItem_characterId_itemId_key" ON "WardrobeItem"("characterId", "itemId");
CREATE INDEX "WardrobeItem_characterId_idx" ON "WardrobeItem"("characterId");
ALTER TABLE "WardrobeItem" ADD CONSTRAINT "WardrobeItem_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Store payments are collected by the RETAIL system account (the service also creates it on first use, so this is only a head start).
INSERT INTO "Account" ("id", "kind", "systemName", "balance") VALUES ('sys_retail', 'SYSTEM', 'RETAIL', 0) ON CONFLICT ("systemName") DO NOTHING;
