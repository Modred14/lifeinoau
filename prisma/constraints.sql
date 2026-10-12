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