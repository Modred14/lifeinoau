-- CreateEnum
CREATE TYPE "BillboardStatus" AS ENUM ('PENDING', 'PAID');

-- CreateTable
CREATE TABLE "BillboardSlot" (
    "id" SERIAL NOT NULL,
    "board" INTEGER NOT NULL,
    "slot" INTEGER NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SLOT',
    "status" "BillboardStatus" NOT NULL DEFAULT 'PENDING',
    "amountKobo" BIGINT NOT NULL,
    "orderKobo" BIGINT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "image" BYTEA,
    "imageMime" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "holdUntil" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "payRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillboardSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillboardSlot_board_slot_key" ON "BillboardSlot"("board", "slot");

-- CreateIndex
CREATE INDEX "BillboardSlot_ownerId_idx" ON "BillboardSlot"("ownerId");

-- CreateIndex
CREATE INDEX "BillboardSlot_orderId_idx" ON "BillboardSlot"("orderId");

-- CreateConstraint
ALTER TABLE "BillboardSlot" ADD CONSTRAINT billboardslot_bounds CHECK (board BETWEEN 1 AND 10 AND slot BETWEEN 1 AND 10 AND "amountKobo" > 0 AND "orderKobo" > 0);