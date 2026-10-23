-- The SUG election calendar (see ELECTION_SCHEDULE in lib/sugRules.js). All times are game time, Africa/Lagos (West Africa Time, UTC+1, no daylight saving);
-- the columns hold UTC, so each is written here an hour earlier than the wall-clock time:
--   registration opens  Thu 22 Oct 2026 00:00:00 WAT  = 2026-10-21 23:00:00 UTC
--   registration closes Sun 25 Oct 2026 23:59:59 WAT  = 2026-10-25 22:59:59 UTC   (this is the cycle's "campaignStartsAt": the first instant a nomination is refused)
--   voting opens        Tue 27 Oct 2026 00:00:00 WAT  = 2026-10-26 23:00:00 UTC   (two calendar days after registration closes)
--   voting closes       Wed 28 Oct 2026 00:00:00 WAT  = 2026-10-27 23:00:00 UTC   (24 hours of voting)
--   term                starts 8 hours later (results 1h + runoff 6h + formation 1h) and lasts 14 days
-- Only the running, automatically started election is moved, and only while its voting has not begun: the trigger sug_cycle_lock already refuses to move a voting
-- window once voting has started, and an election with a runoff or results, or one an administrator started with dates of their own, is left as it is.
-- The nomination and ballot triggers (sug_candidate_guard, sug_ballot_guard) read these same columns, so after this the database itself refuses a nomination from the
-- closing instant on and refuses a ballot before voting opens. (Running this again, or on a database that already has these dates, changes nothing.)
UPDATE "SugCycle"
SET "announcedAt"         = LEAST("announcedAt", TIMESTAMP '2026-10-21 23:00:00'),
    "registrationOpensAt" = TIMESTAMP '2026-10-21 23:00:00',
    "campaignStartsAt"    = TIMESTAMP '2026-10-25 22:59:59',
    "votingStartsAt"      = TIMESTAMP '2026-10-26 23:00:00',
    "votingEndsAt"        = TIMESTAMP '2026-10-27 23:00:00',
    "termStartsAt"        = TIMESTAMP '2026-10-28 07:00:00',
    "termEndsAt"          = TIMESTAMP '2026-11-11 07:00:00',
    "stage"               = CASE
                              WHEN (now() AT TIME ZONE 'UTC') < TIMESTAMP '2026-10-25 22:59:59' THEN 'REGISTRATION'
                              ELSE 'CAMPAIGN'
                            END
WHERE "status" = 'LIVE'
  AND "createdBy" = 'SYSTEM'
  AND "resultsAt" IS NULL
  AND "runoffStartsAt" IS NULL
  AND (now() AT TIME ZONE 'UTC') < "votingStartsAt"
  AND (now() AT TIME ZONE 'UTC') < TIMESTAMP '2026-10-26 23:00:00';
