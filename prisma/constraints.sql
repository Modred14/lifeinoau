-- prisma/constraints.sql
-- Run once after the first migration:
--   npx prisma migrate dev --create-only --name constraints   (paste this in, then migrate dev again)
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_amount_positive CHECK (amount > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT ledger_no_self_transfer CHECK ("debitAccountId" <> "creditAccountId");
ALTER TABLE "Account" ADD CONSTRAINT account_player_not_negative CHECK (kind = 'SYSTEM' OR balance >= 0);
ALTER TABLE "Character" ADD CONSTRAINT stats_in_range CHECK (
  health BETWEEN 0 AND 100 AND energy BETWEEN 0 AND 100 AND happiness BETWEEN 0 AND 100 AND
  academics BETWEEN 0 AND 100 AND popularity BETWEEN 0 AND 100 AND suspicion BETWEEN 0 AND 100);
-- Ledger rows are append-only: block edits and deletes at the database level.
CREATE FUNCTION ledger_immutable() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'LedgerEntry is append-only'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_no_update BEFORE UPDATE OR DELETE ON "LedgerEntry" FOR EACH ROW EXECUTE FUNCTION ledger_immutable();

-- One ACTIVE relationship per player, enforced by the database (safe under double-clicks).
CREATE UNIQUE INDEX one_active_relationship ON "Relationship" ("characterId") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX one_pending_pregnancy ON "Pregnancy" ("characterId") WHERE status = 'PENDING';

ALTER TABLE "Business" ADD CONSTRAINT business_capital_nonneg CHECK (capital >= 0);
ALTER TABLE "Business" ADD CONSTRAINT business_bounds CHECK (level BETWEEN 1 AND 5 AND employees BETWEEN 0 AND 8);

ALTER TABLE "Holding" ADD CONSTRAINT holding_nonneg CHECK ("unitsMicro" >= 0 AND "costKobo" >= 0);

ALTER TABLE "RoomItem" ADD CONSTRAINT roomitem_bounds CHECK (rot BETWEEN 0 AND 3 AND paid >= 0);

ALTER TABLE "BillboardSlot" ADD CONSTRAINT billboardslot_bounds CHECK (board BETWEEN 1 AND 10 AND slot BETWEEN 1 AND 10 AND "amountKobo" > 0 AND "orderKobo" > 0);
ALTER TABLE "BetSlip" ADD CONSTRAINT betslip_bounds CHECK ("stakeKobo" > 0 AND "potentialKobo" > 0 AND "payoutKobo" >= 0);
ALTER TABLE "CasinoRound" ADD CONSTRAINT casinoround_bounds CHECK ("stakeKobo" > 0 AND "payoutKobo" >= 0);

-- The Love app (see migration 20261014190000_love_bonds): a pair exists once, affection stays 0-100, one open request of each kind per couple.
ALTER TABLE "Bond" ADD CONSTRAINT bond_pair_ordered CHECK ("lowId" < "highId");
ALTER TABLE "Bond" ADD CONSTRAINT bond_affection_range CHECK (affection BETWEEN 0 AND 100);
ALTER TABLE "Bond" ADD CONSTRAINT bond_kind_valid CHECK (kind IN ('TALKING','BESTIE','SNEAKY','BABE','ENGAGED','EX'));
ALTER TABLE "LoveRequest" ADD CONSTRAINT loverequest_status_valid CHECK (status IN ('PENDING','ACCEPTED','DECLINED','CANCELLED','EXPIRED'));
CREATE UNIQUE INDEX one_pending_love_request ON "LoveRequest" ("bondId", kind) WHERE status = 'PENDING';
-- Lecturer encounters (see migration 20261018000000_lecture_encounters): one open encounter per player, one running N-QRS response per lecture room.
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_status_valid CHECK (status IN ('OPEN', 'SETTLED', 'EXPIRED'));
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_outcome_valid CHECK (outcome IS NULL OR outcome IN ('LOST', 'ESCAPED', 'ARRESTED'));
ALTER TABLE "LectureEncounter" ADD CONSTRAINT lectureencounter_response_state_valid CHECK ("responseState" IS NULL OR "responseState" IN ('ACTIVE', 'DONE'));
CREATE UNIQUE INDEX one_open_lecture_encounter ON "LectureEncounter" ("characterId") WHERE status = 'OPEN';
CREATE UNIQUE INDEX one_active_lecture_response ON "LectureEncounter" ("venueId", "roomId") WHERE "responseState" = 'ACTIVE';