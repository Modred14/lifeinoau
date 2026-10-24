-- Admin console. Additive only: nothing is dropped or rewritten, every existing account keeps working.

-- Account standing, enforced on every request (lib/accountGate.js). Existing accounts start ACTIVE.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusReason" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "statusBy" TEXT;
-- Activity tracking from now on. History before this migration was never recorded per account: the dashboard falls back to
-- the older signals (Presence, map pings, the action log) and says so.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastActiveAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_status_check";
ALTER TABLE "User" ADD CONSTRAINT "User_status_check" CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'DELETED'));
CREATE INDEX IF NOT EXISTS "User_status_idx" ON "User"("status");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX IF NOT EXISTS "User_lastActiveAt_idx" ON "User"("lastActiveAt");

-- The audit log also keeps refused and failed operations, and makes a repeated request harmless.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'OK';
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "error" TEXT;
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_target_createdAt_idx" ON "AuditLog"("target", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");
-- One successful operation per administrator and request id: a double click or a retry cannot do the same thing twice.
CREATE UNIQUE INDEX IF NOT EXISTS "AuditLog_actor_request_ok_key" ON "AuditLog"("actorId", "requestId") WHERE "requestId" IS NOT NULL AND "status" = 'OK';

-- Players kept off FORBES OAU by an administrator. Character."hideFromForbes" stays the flag the ranking reads.
CREATE TABLE IF NOT EXISTS "ForbesExclusion" (
  "characterId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "byAdminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForbesExclusion_pkey" PRIMARY KEY ("characterId")
);
-- Anyone the owner already hid directly in the database keeps that, with a note saying so.
INSERT INTO "ForbesExclusion" ("characterId", "reason", "byAdminId")
SELECT c."id", 'Hidden directly in the database before the admin dashboard existed', 'SYSTEM' FROM "Character" c WHERE c."hideFromForbes" = true
ON CONFLICT ("characterId") DO NOTHING;
