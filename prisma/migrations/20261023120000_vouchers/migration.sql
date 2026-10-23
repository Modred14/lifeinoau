CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "rewardKobo" BIGINT NOT NULL,
    "totalPoolKobo" BIGINT NOT NULL,
    "remainingPoolKobo" BIGINT NOT NULL,
    "maxWinners" INTEGER NOT NULL,
    "claimedWinners" INTEGER NOT NULL DEFAULT 0,
    "maxPerPlayer" INTEGER,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "fundedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voucher_amounts_valid" CHECK ("rewardKobo" > 0 AND "totalPoolKobo" >= "rewardKobo" * "maxWinners" AND "remainingPoolKobo" >= 0 AND "remainingPoolKobo" <= "totalPoolKobo"),
    CONSTRAINT "voucher_winners_valid" CHECK ("maxWinners" > 0 AND "claimedWinners" >= 0 AND "claimedWinners" <= "maxWinners" AND ("maxPerPlayer" IS NULL OR "maxPerPlayer" > 0)),
    CONSTRAINT "voucher_dates_valid" CHECK ("endsAt" > "startsAt")
);

CREATE UNIQUE INDEX "Voucher_codeHash_key" ON "Voucher"("codeHash");
CREATE INDEX "Voucher_status_startsAt_endsAt_idx" ON "Voucher"("status", "startsAt", "endsAt");

CREATE TABLE "VoucherRedemption" (
    "id" BIGSERIAL NOT NULL,
    "voucherId" TEXT NOT NULL,
    "characterId" TEXT NOT NULL,
    "payoutKobo" BIGINT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "playerUse" INTEGER NOT NULL,
    "requestId" TEXT NOT NULL,
    "ledgerEntryId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "voucher_redemption_values_valid" CHECK ("payoutKobo" > 0 AND "ordinal" > 0 AND "playerUse" > 0)
);

CREATE UNIQUE INDEX "VoucherRedemption_requestId_key" ON "VoucherRedemption"("requestId");
CREATE UNIQUE INDEX "VoucherRedemption_ledgerEntryId_key" ON "VoucherRedemption"("ledgerEntryId");
CREATE UNIQUE INDEX "VoucherRedemption_voucherId_ordinal_key" ON "VoucherRedemption"("voucherId", "ordinal");
CREATE UNIQUE INDEX "VoucherRedemption_voucherId_characterId_playerUse_key" ON "VoucherRedemption"("voucherId", "characterId", "playerUse");
CREATE INDEX "VoucherRedemption_characterId_createdAt_idx" ON "VoucherRedemption"("characterId", "createdAt");

ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey"
  FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_ledgerEntryId_fkey"
  FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
