-- prisma/migrations/20261105000000_party_events/migration.sql
-- Real events for the Parties app, added by administrators. Additive: PartyNight and PartyTicket are left as they are.

CREATE TABLE "PartyEvent" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "host" TEXT NOT NULL,
  "priceKobo" BIGINT NOT NULL DEFAULT 0,
  "eventDate" TIMESTAMP(3) NOT NULL,
  "ticketUrl" TEXT NOT NULL,
  "flyer" BYTEA NOT NULL,
  "flyerMime" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartyEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PartyEvent_price_nonneg" CHECK ("priceKobo" >= 0)
);
CREATE INDEX "PartyEvent_eventDate_idx" ON "PartyEvent"("eventDate");
