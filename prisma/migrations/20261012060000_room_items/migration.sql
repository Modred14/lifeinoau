-- CreateTable
CREATE TABLE "RoomItem" (
    "id" BIGSERIAL NOT NULL,
    "characterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "placed" BOOLEAN NOT NULL DEFAULT false,
    "x" INTEGER,
    "z" INTEGER,
    "rot" INTEGER NOT NULL DEFAULT 0,
    "paid" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoomItem_characterId_idx" ON "RoomItem"("characterId");

-- CreateConstraint
ALTER TABLE "RoomItem" ADD CONSTRAINT roomitem_bounds CHECK (rot BETWEEN 0 AND 3 AND paid >= 0);
