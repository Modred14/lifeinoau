-- prisma/migrations/20261024030000_bank_calls/migration.sql
-- The Bank app (savings, savings goals) and the Calls app (calling home, calling players for money).
-- Additive: no column or row that exists is changed. Money still moves ONLY through LedgerEntry: savings sit in the SAVINGS system account.

CREATE TABLE "SavingsAccount" (
  "characterId" TEXT NOT NULL,
  "balance" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SavingsAccount_pkey" PRIMARY KEY ("characterId"),
  CONSTRAINT "SavingsAccount_balance_nonneg" CHECK ("balance" >= 0)
);

CREATE TABLE "SavingsGoal" (
  "id" BIGSERIAL NOT NULL,
  "characterId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "targetKobo" BIGINT NOT NULL,
  "savedKobo" BIGINT NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "achievedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "SavingsGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SavingsGoal_target_positive" CHECK ("targetKobo" > 0),
  CONSTRAINT "SavingsGoal_saved_range" CHECK ("savedKobo" >= 0 AND "savedKobo" <= "targetKobo"),
  CONSTRAINT "SavingsGoal_status_known" CHECK ("status" IN ('ACTIVE', 'ACHIEVED', 'CLOSED'))
);
CREATE INDEX "SavingsGoal_characterId_status_idx" ON "SavingsGoal"("characterId", "status");

-- Goals only ever set aside money that is really in the savings balance. Checked at commit, whichever table changed last.
CREATE FUNCTION savings_goals_within_balance() RETURNS trigger AS $$
DECLARE cid TEXT; earmarked BIGINT; bal BIGINT;
BEGIN
  cid := COALESCE(NEW."characterId", OLD."characterId");
  SELECT COALESCE(SUM("savedKobo"), 0) INTO earmarked FROM "SavingsGoal" WHERE "characterId" = cid AND "status" <> 'CLOSED';
  SELECT COALESCE((SELECT "balance" FROM "SavingsAccount" WHERE "characterId" = cid), 0) INTO bal;
  IF earmarked > bal THEN RAISE EXCEPTION 'savings goals hold more than the savings balance'; END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER savings_goal_within_balance AFTER INSERT OR UPDATE ON "SavingsGoal"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION savings_goals_within_balance();
CREATE CONSTRAINT TRIGGER savings_balance_covers_goals AFTER UPDATE ON "SavingsAccount"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION savings_goals_within_balance();

CREATE TABLE "PhoneCall" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "callerId" TEXT NOT NULL,
  "callerName" TEXT NOT NULL,
  "calleeId" TEXT,
  "calleeName" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "endReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ringingAt" TIMESTAMP(3),
  "ringUntil" TIMESTAMP(3) NOT NULL,
  "answeredAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "idleUntil" TIMESTAMP(3),
  "gameWeek" INTEGER NOT NULL,
  "askKobo" BIGINT,
  "askStatus" TEXT NOT NULL DEFAULT 'NONE',
  "askAt" TIMESTAMP(3),
  "askUntil" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "paidKobo" BIGINT,
  "feeKobo" BIGINT,
  "outcome" TEXT,
  "line" TEXT,
  CONSTRAINT "PhoneCall_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PhoneCall_kind_known" CHECK ("kind" IN ('PLAYER', 'PARENT')),
  CONSTRAINT "PhoneCall_status_known" CHECK ("status" IN ('RINGING', 'ANSWERED', 'DECLINED', 'MISSED', 'CANCELLED', 'ENDED')),
  CONSTRAINT "PhoneCall_ask_known" CHECK ("askStatus" IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'FAILED')),
  CONSTRAINT "PhoneCall_ask_positive" CHECK ("askKobo" IS NULL OR "askKobo" > 0),
  CONSTRAINT "PhoneCall_paid_nonneg" CHECK (("paidKobo" IS NULL OR "paidKobo" >= 0) AND ("feeKobo" IS NULL OR "feeKobo" >= 0)),
  CONSTRAINT "PhoneCall_parties" CHECK (("kind" = 'PARENT' AND "calleeId" IS NULL) OR ("kind" = 'PLAYER' AND "calleeId" IS NOT NULL AND "calleeId" <> "callerId")),
  -- between players, money is recorded as paid only for an approved ask, and it is exactly what was asked
  CONSTRAINT "PhoneCall_paid_only_if_approved" CHECK ("kind" = 'PARENT' OR "paidKobo" IS NULL OR ("askStatus" = 'APPROVED' AND "paidKobo" = "askKobo"))
);
CREATE UNIQUE INDEX "PhoneCall_callerId_requestId_key" ON "PhoneCall"("callerId", "requestId");
CREATE INDEX "PhoneCall_calleeId_status_idx" ON "PhoneCall"("calleeId", "status");
CREATE INDEX "PhoneCall_callerId_status_idx" ON "PhoneCall"("callerId", "status");
CREATE INDEX "PhoneCall_callerId_createdAt_idx" ON "PhoneCall"("callerId", "createdAt");
CREATE INDEX "PhoneCall_calleeId_createdAt_idx" ON "PhoneCall"("calleeId", "createdAt");
-- A player is on one call at a time as caller and as callee: the database refuses a second live call, so two simultaneous dials cannot both get through.
CREATE UNIQUE INDEX one_live_call_per_caller ON "PhoneCall"("callerId") WHERE "kind" = 'PLAYER' AND "status" IN ('RINGING', 'ANSWERED');
CREATE UNIQUE INDEX one_live_call_per_callee ON "PhoneCall"("calleeId") WHERE "kind" = 'PLAYER' AND "status" IN ('RINGING', 'ANSWERED');

CREATE TABLE "PhoneLine" (
  "characterId" TEXT NOT NULL,
  "seenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PhoneLine_pkey" PRIMARY KEY ("characterId")
);

-- Savings are held by the SAVINGS system account (the service also creates it on first use, so this is only a head start).
INSERT INTO "Account" ("id", "kind", "systemName", "balance") VALUES ('sys_savings', 'SYSTEM', 'SAVINGS', 0) ON CONFLICT ("systemName") DO NOTHING;
