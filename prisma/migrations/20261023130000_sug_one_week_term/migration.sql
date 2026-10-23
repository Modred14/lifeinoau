-- A SUG government's term is now ONE WEEK (it was 14 days), and office pays a stipend (see STIPEND in lib/sugRules.js and lib/sugPay.js).
--
-- 1. "stipendsSettledAt" marks a term whose stipends have all been paid, so lib/sugPay.js stops looking at it.
ALTER TABLE "SugTerm" ADD COLUMN "stipendsSettledAt" TIMESTAMP(3);
-- Terms that had already finished were never promised a stipend: close them so nothing is paid back-dated.
UPDATE "SugTerm" SET "stipendsSettledAt" = now() WHERE "endsAt" <= (now() AT TIME ZONE 'UTC');

-- 2. Shorten the terms that are still to come or still running. Only a term that is exactly 14 days long is touched (an administrator's own dates are left alone),
--    and only while it has not ended. A term that now falls in the past is closed by the server on its next request.
UPDATE "SugCycle"
SET "termEndsAt" = "termStartsAt" + INTERVAL '7 days'
WHERE "termEndsAt" - "termStartsAt" = INTERVAL '14 days'
  AND "termEndsAt" > (now() AT TIME ZONE 'UTC');

UPDATE "SugTerm"
SET "endsAt" = "startsAt" + INTERVAL '7 days'
WHERE "endsAt" - "startsAt" = INTERVAL '14 days'
  AND "status" <> 'ENDED'
  AND "endsAt" > (now() AT TIME ZONE 'UTC');