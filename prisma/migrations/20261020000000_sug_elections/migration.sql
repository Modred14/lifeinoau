-- prisma/migrations/20261020000000_sug_elections/migration.sql
-- SUG elections and student government (see lib/sugRules.js). Additive: no existing table or column is touched, one system account is added.
-- Everything that must hold even if application code is wrong is enforced here: ballots, results and legislative votes are append-only,
-- ballots and nominations are refused outside their windows, results cannot be written twice, the 30 seats and one-winner-per-post limits
-- hold, a candidate can never spend past the cap, and only one election cycle can be live at a time.

-- ---------------------------------------------------------------------------------------------------------------- tables
CREATE TABLE "SugCycle" (
  "id" SERIAL NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LIVE',
  "stage" TEXT NOT NULL DEFAULT 'ANNOUNCED',
  "announcedAt" TIMESTAMP(3) NOT NULL,
  "registrationOpensAt" TIMESTAMP(3) NOT NULL,
  "campaignStartsAt" TIMESTAMP(3) NOT NULL,
  "votingStartsAt" TIMESTAMP(3) NOT NULL,
  "votingEndsAt" TIMESTAMP(3) NOT NULL,
  "runoffStartsAt" TIMESTAMP(3),
  "runoffEndsAt" TIMESTAMP(3),
  "termStartsAt" TIMESTAMP(3) NOT NULL,
  "termEndsAt" TIMESTAMP(3) NOT NULL,
  "nominationFeeKobo" BIGINT NOT NULL,
  "spendCapExecKobo" BIGINT NOT NULL,
  "spendCapAssemblyKobo" BIGINT NOT NULL,
  "resultsAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugRace" (
  "id" SERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "position" TEXT NOT NULL,
  "seats" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "validVotes" INTEGER NOT NULL DEFAULT 0,
  "seatsFilled" INTEGER NOT NULL DEFAULT 0,
  "tieNote" TEXT,
  CONSTRAINT "SugRace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugCandidate" (
  "id" SERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "raceId" INTEGER NOT NULL,
  "characterId" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "slogan" TEXT NOT NULL,
  "intro" TEXT NOT NULL,
  "manifesto" TEXT NOT NULL,
  "promises" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "statusNote" TEXT,
  "feeKobo" BIGINT NOT NULL,
  "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugCandidate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugBallot" (
  "id" BIGSERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "raceId" INTEGER NOT NULL,
  "round" INTEGER NOT NULL DEFAULT 1,
  "voterId" TEXT NOT NULL,
  "candidateId" INTEGER NOT NULL,
  "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugBallot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugResult" (
  "id" BIGSERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "raceId" INTEGER NOT NULL,
  "candidateId" INTEGER NOT NULL,
  "votes" INTEGER NOT NULL,
  "runoffVotes" INTEGER,
  "percentBp" INTEGER NOT NULL,
  "rank" INTEGER NOT NULL,
  "outcome" TEXT NOT NULL,
  "seat" INTEGER,
  "tieBreak" TEXT,
  CONSTRAINT "SugResult_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugCampaignEvent" (
  "id" BIGSERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "candidateId" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "venue" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL DEFAULT '',
  "costKobo" BIGINT NOT NULL DEFAULT 0,
  "opponentId" INTEGER,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LIVE',
  "settledAt" TIMESTAMP(3),
  "attendees" INTEGER NOT NULL DEFAULT 0,
  "freshAudience" INTEGER NOT NULL DEFAULT 0,
  "momentum" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugCampaignEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugEventAttendance" (
  "id" BIGSERIAL NOT NULL,
  "eventId" BIGINT NOT NULL,
  "characterId" TEXT NOT NULL,
  "pledged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugEventAttendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugSupport" (
  "candidateId" INTEGER NOT NULL,
  "supporterId" TEXT NOT NULL,
  "pledged" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugSupport_pkey" PRIMARY KEY ("candidateId", "supporterId")
);

CREATE TABLE "SugExpense" (
  "id" BIGSERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "candidateId" INTEGER NOT NULL,
  "eventId" BIGINT,
  "kind" TEXT NOT NULL,
  "amountKobo" BIGINT NOT NULL,
  "ledgerKey" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugExpense_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugTerm" (
  "id" SERIAL NOT NULL,
  "cycleId" INTEGER NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugTerm_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugAppointment" (
  "id" SERIAL NOT NULL,
  "termId" INTEGER NOT NULL,
  "characterId" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "seat" INTEGER NOT NULL DEFAULT 1,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "appointedBy" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "SugAppointment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugAnnouncement" (
  "id" BIGSERIAL NOT NULL,
  "termId" INTEGER NOT NULL,
  "authorId" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugAnnouncement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugSession" (
  "id" SERIAL NOT NULL,
  "termId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "agenda" TEXT NOT NULL DEFAULT '',
  "scheduledAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "chairId" TEXT,
  "createdBy" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "floorItemId" BIGINT,
  "floorSpeakerId" TEXT,
  "minutes" TEXT,
  "minutesBy" TEXT,
  "minutesAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugAttendance" (
  "id" BIGSERIAL NOT NULL,
  "sessionId" INTEGER NOT NULL,
  "characterId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugAttendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugItem" (
  "id" BIGSERIAL NOT NULL,
  "termId" INTEGER NOT NULL,
  "sessionId" INTEGER,
  "kind" TEXT NOT NULL,
  "serial" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "authorId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
  "registeredBy" TEXT,
  "registeredAt" TIMESTAMP(3),
  "yes" INTEGER NOT NULL DEFAULT 0,
  "no" INTEGER NOT NULL DEFAULT 0,
  "abstain" INTEGER NOT NULL DEFAULT 0,
  "present" INTEGER,
  "quorum" INTEGER,
  "outcomeNote" TEXT,
  "votingOpenedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugDebate" (
  "id" BIGSERIAL NOT NULL,
  "itemId" BIGINT NOT NULL,
  "speakerId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugDebate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SugLegVote" (
  "id" BIGSERIAL NOT NULL,
  "itemId" BIGINT NOT NULL,
  "voterId" TEXT NOT NULL,
  "choice" TEXT NOT NULL,
  "castAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SugLegVote_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------------------------------------------- indexes
CREATE UNIQUE INDEX "SugCycle_number_key" ON "SugCycle"("number");
CREATE INDEX "SugCycle_status_stage_idx" ON "SugCycle"("status", "stage");
CREATE UNIQUE INDEX "SugRace_cycleId_position_key" ON "SugRace"("cycleId", "position");
CREATE UNIQUE INDEX "SugCandidate_cycleId_characterId_key" ON "SugCandidate"("cycleId", "characterId");
CREATE INDEX "SugCandidate_raceId_status_idx" ON "SugCandidate"("raceId", "status");
CREATE UNIQUE INDEX "SugBallot_raceId_round_voterId_key" ON "SugBallot"("raceId", "round", "voterId");
CREATE INDEX "SugBallot_raceId_round_candidateId_idx" ON "SugBallot"("raceId", "round", "candidateId");
CREATE UNIQUE INDEX "SugResult_raceId_candidateId_key" ON "SugResult"("raceId", "candidateId");
CREATE INDEX "SugResult_cycleId_idx" ON "SugResult"("cycleId");
CREATE UNIQUE INDEX "SugCampaignEvent_candidateId_requestId_key" ON "SugCampaignEvent"("candidateId", "requestId");
CREATE INDEX "SugCampaignEvent_cycleId_status_endsAt_idx" ON "SugCampaignEvent"("cycleId", "status", "endsAt");
CREATE INDEX "SugCampaignEvent_candidateId_createdAt_idx" ON "SugCampaignEvent"("candidateId", "createdAt");
CREATE UNIQUE INDEX "SugEventAttendance_eventId_characterId_key" ON "SugEventAttendance"("eventId", "characterId");
CREATE INDEX "SugEventAttendance_characterId_idx" ON "SugEventAttendance"("characterId");
CREATE UNIQUE INDEX "SugExpense_ledgerKey_key" ON "SugExpense"("ledgerKey");
CREATE UNIQUE INDEX "SugExpense_candidateId_requestId_key" ON "SugExpense"("candidateId", "requestId");
CREATE INDEX "SugExpense_cycleId_candidateId_idx" ON "SugExpense"("cycleId", "candidateId");
CREATE UNIQUE INDEX "SugTerm_cycleId_key" ON "SugTerm"("cycleId");
CREATE INDEX "SugAppointment_termId_status_idx" ON "SugAppointment"("termId", "status");
CREATE INDEX "SugAppointment_characterId_status_idx" ON "SugAppointment"("characterId", "status");
CREATE INDEX "SugAnnouncement_createdAt_idx" ON "SugAnnouncement"("createdAt");
CREATE INDEX "SugAnnouncement_termId_createdAt_idx" ON "SugAnnouncement"("termId", "createdAt");
CREATE INDEX "SugSession_termId_scheduledAt_idx" ON "SugSession"("termId", "scheduledAt");
CREATE UNIQUE INDEX "SugAttendance_sessionId_characterId_key" ON "SugAttendance"("sessionId", "characterId");
CREATE INDEX "SugItem_termId_status_idx" ON "SugItem"("termId", "status");
CREATE INDEX "SugItem_sessionId_idx" ON "SugItem"("sessionId");
CREATE INDEX "SugDebate_itemId_id_idx" ON "SugDebate"("itemId", "id");
CREATE UNIQUE INDEX "SugLegVote_itemId_voterId_key" ON "SugLegVote"("itemId", "voterId");

-- ---------------------------------------------------------------------------------------------------------------- foreign keys
ALTER TABLE "SugRace" ADD CONSTRAINT "SugRace_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "SugCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugCandidate" ADD CONSTRAINT "SugCandidate_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "SugRace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugBallot" ADD CONSTRAINT "SugBallot_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "SugRace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugBallot" ADD CONSTRAINT "SugBallot_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugResult" ADD CONSTRAINT "SugResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "SugRace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugResult" ADD CONSTRAINT "SugResult_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugCampaignEvent" ADD CONSTRAINT "SugCampaignEvent_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugEventAttendance" ADD CONSTRAINT "SugEventAttendance_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SugCampaignEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugSupport" ADD CONSTRAINT "SugSupport_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugExpense" ADD CONSTRAINT "SugExpense_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "SugCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugTerm" ADD CONSTRAINT "SugTerm_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "SugCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugAppointment" ADD CONSTRAINT "SugAppointment_termId_fkey" FOREIGN KEY ("termId") REFERENCES "SugTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugAnnouncement" ADD CONSTRAINT "SugAnnouncement_termId_fkey" FOREIGN KEY ("termId") REFERENCES "SugTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugSession" ADD CONSTRAINT "SugSession_termId_fkey" FOREIGN KEY ("termId") REFERENCES "SugTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugAttendance" ADD CONSTRAINT "SugAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SugSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugItem" ADD CONSTRAINT "SugItem_termId_fkey" FOREIGN KEY ("termId") REFERENCES "SugTerm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugItem" ADD CONSTRAINT "SugItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SugSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SugDebate" ADD CONSTRAINT "SugDebate_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SugItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SugLegVote" ADD CONSTRAINT "SugLegVote_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "SugItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------------------------- value checks
ALTER TABLE "SugCycle" ADD CONSTRAINT sugcycle_status_valid CHECK (status IN ('LIVE', 'DECIDED', 'CANCELLED'));
ALTER TABLE "SugCycle" ADD CONSTRAINT sugcycle_stage_valid CHECK (stage IN ('ANNOUNCED', 'REGISTRATION', 'CAMPAIGN', 'VOTING', 'RUNOFF', 'RESULTS', 'FORMATION', 'ACTIVE', 'COMPLETED', 'CANCELLED'));
ALTER TABLE "SugCycle" ADD CONSTRAINT sugcycle_timetable_ordered CHECK (
  "announcedAt" <= "registrationOpensAt" AND "registrationOpensAt" < "campaignStartsAt" AND "campaignStartsAt" < "votingStartsAt"
  AND "votingStartsAt" < "votingEndsAt" AND "votingEndsAt" <= "termStartsAt" AND "termStartsAt" < "termEndsAt"
  AND ("runoffStartsAt" IS NULL OR ("runoffStartsAt" >= "votingEndsAt" AND "runoffEndsAt" > "runoffStartsAt" AND "runoffEndsAt" <= "termStartsAt")));
ALTER TABLE "SugCycle" ADD CONSTRAINT sugcycle_money_valid CHECK ("nominationFeeKobo" >= 0 AND "spendCapExecKobo" >= 0 AND "spendCapAssemblyKobo" >= 0);
-- Only one election can be running at a time: a new cycle can start once the last one has been decided (its government may still be in office) or cancelled.
CREATE UNIQUE INDEX one_live_sug_cycle ON "SugCycle" ((1)) WHERE status = 'LIVE';

ALTER TABLE "SugRace" ADD CONSTRAINT sugrace_position_valid CHECK (position IN ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY_GENERAL', 'ASSISTANT_SECRETARY_GENERAL', 'PRO',
  'DIRECTOR_SOCIALS', 'DIRECTOR_SPORTS', 'FINANCIAL_SECRETARY', 'WELFARE_OFFICER', 'SPEAKER', 'DEPUTY_SPEAKER', 'HONOURABLE_MEMBER'));
-- exactly 30 Honourable Member seats, exactly 1 seat for every other elected post
ALTER TABLE "SugRace" ADD CONSTRAINT sugrace_seats_valid CHECK ((position = 'HONOURABLE_MEMBER' AND seats = 30) OR (position <> 'HONOURABLE_MEMBER' AND seats = 1));
ALTER TABLE "SugRace" ADD CONSTRAINT sugrace_status_valid CHECK (status IN ('OPEN', 'RUNOFF', 'CLOSED'));
ALTER TABLE "SugRace" ADD CONSTRAINT sugrace_filled_valid CHECK ("seatsFilled" >= 0 AND "seatsFilled" <= seats AND "validVotes" >= 0);

ALTER TABLE "SugCandidate" ADD CONSTRAINT sugcandidate_status_valid CHECK (status IN ('ACTIVE', 'WITHDRAWN', 'DISQUALIFIED', 'WON', 'LOST'));
ALTER TABLE "SugCandidate" ADD CONSTRAINT sugcandidate_fee_valid CHECK ("feeKobo" >= 0);
ALTER TABLE "SugBallot" ADD CONSTRAINT sugballot_round_valid CHECK (round IN (1, 2));
ALTER TABLE "SugResult" ADD CONSTRAINT sugresult_valid CHECK (outcome IN ('WON', 'LOST') AND "percentBp" BETWEEN 0 AND 10000 AND votes >= 0 AND rank >= 1
  AND ((outcome = 'WON' AND seat IS NOT NULL) OR (outcome = 'LOST' AND seat IS NULL)));
-- One winner per seat of a race. With the seat range checked by the trigger below, a single-seat post can have one winner and the
-- Assembly's Honourable Member race at most 30.
CREATE UNIQUE INDEX one_winner_per_seat ON "SugResult" ("raceId", seat) WHERE seat IS NOT NULL;

ALTER TABLE "SugCampaignEvent" ADD CONSTRAINT sugevent_kind_valid CHECK (kind IN ('SPEECH', 'RALLY', 'MEET', 'MESSAGE', 'POSTER', 'PUBLICITY', 'DEBATE'));
ALTER TABLE "SugCampaignEvent" ADD CONSTRAINT sugevent_status_valid CHECK (status IN ('LIVE', 'SUCCESS', 'FAILED'));
ALTER TABLE "SugCampaignEvent" ADD CONSTRAINT sugevent_money_valid CHECK ("costKobo" >= 0 AND momentum >= 0 AND attendees >= 0 AND "freshAudience" >= 0);
ALTER TABLE "SugExpense" ADD CONSTRAINT sugexpense_amount_positive CHECK ("amountKobo" > 0);

ALTER TABLE "SugTerm" ADD CONSTRAINT sugterm_status_valid CHECK (status IN ('SCHEDULED', 'ACTIVE', 'ENDED'));
ALTER TABLE "SugTerm" ADD CONSTRAINT sugterm_dates_ordered CHECK ("startsAt" < "endsAt");
ALTER TABLE "SugAppointment" ADD CONSTRAINT sugappointment_position_valid CHECK (position IN ('PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY_GENERAL', 'ASSISTANT_SECRETARY_GENERAL', 'PRO',
  'DIRECTOR_SOCIALS', 'DIRECTOR_SPORTS', 'FINANCIAL_SECRETARY', 'WELFARE_OFFICER', 'SPEAKER', 'DEPUTY_SPEAKER', 'HONOURABLE_MEMBER', 'CLERK'));
ALTER TABLE "SugAppointment" ADD CONSTRAINT sugappointment_kind_valid CHECK ((kind = 'ELECTED' AND position <> 'CLERK') OR (kind = 'APPOINTED' AND position = 'CLERK'));
ALTER TABLE "SugAppointment" ADD CONSTRAINT sugappointment_status_valid CHECK (status IN ('ACTIVE', 'REVOKED'));
-- seat numbers: 1..30 for Honourable Members, exactly 1 for every other post (the Clerk included)
ALTER TABLE "SugAppointment" ADD CONSTRAINT sugappointment_seat_valid CHECK ((position = 'HONOURABLE_MEMBER' AND seat BETWEEN 1 AND 30) OR (position <> 'HONOURABLE_MEMBER' AND seat = 1));
-- One ACTIVE holder per post and seat (so one President, one Speaker, one Clerk ... and at most 30 Honourable Members), and one office per person.
CREATE UNIQUE INDEX sug_one_holder_per_seat ON "SugAppointment" ("termId", position, seat) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX sug_one_office_per_person ON "SugAppointment" ("termId", "characterId") WHERE status = 'ACTIVE';

ALTER TABLE "SugAnnouncement" ADD CONSTRAINT sugannouncement_kind_valid CHECK (kind IN ('EVENT', 'PARTY', 'SPORTS', 'WELFARE', 'STATEMENT', 'MEETING', 'FINANCE', 'ASSEMBLY'));
ALTER TABLE "SugSession" ADD CONSTRAINT sugsession_status_valid CHECK (status IN ('SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED'));
ALTER TABLE "SugAttendance" ADD CONSTRAINT sugattendance_valid CHECK (status IN ('PRESENT', 'ABSENT', 'EXCUSED') AND source IN ('SELF', 'CLERK'));
ALTER TABLE "SugItem" ADD CONSTRAINT sugitem_valid CHECK (kind IN ('BILL', 'MOTION') AND status IN ('SUBMITTED', 'REGISTERED', 'LISTED', 'DEBATING', 'VOTING', 'PASSED', 'FAILED', 'WITHDRAWN')
  AND yes >= 0 AND no >= 0 AND abstain >= 0);
CREATE UNIQUE INDEX sug_item_serial ON "SugItem" ("termId", serial) WHERE serial IS NOT NULL;
ALTER TABLE "SugLegVote" ADD CONSTRAINT sugvote_choice_valid CHECK (choice IN ('YES', 'NO', 'ABSTAIN'));

-- ---------------------------------------------------------------------------------------------------------------- integrity triggers
-- Ballots, results and legislative votes are append-only: no UPDATE, no DELETE, from the application or anyone else using the same connection.
CREATE FUNCTION sug_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_ballot_append_only BEFORE UPDATE OR DELETE ON "SugBallot" FOR EACH ROW EXECUTE FUNCTION sug_append_only();
CREATE TRIGGER sug_result_append_only BEFORE UPDATE OR DELETE ON "SugResult" FOR EACH ROW EXECUTE FUNCTION sug_append_only();
CREATE TRIGGER sug_legvote_append_only BEFORE UPDATE OR DELETE ON "SugLegVote" FOR EACH ROW EXECUTE FUNCTION sug_append_only();

-- A ballot is accepted only inside its voting window, for a candidate still standing in that very race, in a cycle whose results are not final.
-- (All timestamps in this schema are UTC.)
CREATE FUNCTION sug_ballot_guard() RETURNS trigger AS $$
DECLARE c "SugCycle"%ROWTYPE; r "SugRace"%ROWTYPE; cand "SugCandidate"%ROWTYPE; t TIMESTAMP := (now() AT TIME ZONE 'UTC');
BEGIN
  SELECT * INTO r FROM "SugRace" WHERE id = NEW."raceId";
  IF NOT FOUND OR r."cycleId" <> NEW."cycleId" THEN RAISE EXCEPTION 'ballot: the race does not belong to that cycle'; END IF;
  SELECT * INTO c FROM "SugCycle" WHERE id = NEW."cycleId";
  IF c.status <> 'LIVE' OR c."resultsAt" IS NOT NULL THEN RAISE EXCEPTION 'ballot: this election is closed'; END IF;
  IF NEW.round = 1 AND NOT (t >= c."votingStartsAt" AND t < c."votingEndsAt") THEN RAISE EXCEPTION 'ballot: voting is not open'; END IF;
  IF NEW.round = 2 AND NOT (c."runoffStartsAt" IS NOT NULL AND t >= c."runoffStartsAt" AND t < c."runoffEndsAt") THEN RAISE EXCEPTION 'ballot: the runoff is not open'; END IF;
  SELECT * INTO cand FROM "SugCandidate" WHERE id = NEW."candidateId";
  IF NOT FOUND OR cand."raceId" <> NEW."raceId" OR cand.status <> 'ACTIVE' THEN RAISE EXCEPTION 'ballot: that candidate is not standing in this race'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_ballot_window BEFORE INSERT ON "SugBallot" FOR EACH ROW EXECUTE FUNCTION sug_ballot_guard();

-- A nomination is accepted only while registration is open, for the race it names.
CREATE FUNCTION sug_candidate_guard() RETURNS trigger AS $$
DECLARE c "SugCycle"%ROWTYPE; r "SugRace"%ROWTYPE; t TIMESTAMP := (now() AT TIME ZONE 'UTC');
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO r FROM "SugRace" WHERE id = NEW."raceId";
    IF NOT FOUND OR r."cycleId" <> NEW."cycleId" OR r.position <> NEW.position THEN RAISE EXCEPTION 'candidate: the race does not match'; END IF;
    SELECT * INTO c FROM "SugCycle" WHERE id = NEW."cycleId";
    IF c.status <> 'LIVE' OR NOT (t >= c."registrationOpensAt" AND t < c."campaignStartsAt") THEN RAISE EXCEPTION 'candidate: registration is not open'; END IF;
    RETURN NEW;
  END IF;
  -- UPDATE: who stands where never changes, and once the results are final nothing about a candidate changes
  IF NEW."cycleId" <> OLD."cycleId" OR NEW."raceId" <> OLD."raceId" OR NEW."characterId" <> OLD."characterId" OR NEW.position <> OLD.position THEN
    RAISE EXCEPTION 'candidate: identity cannot change'; END IF;
  IF EXISTS (SELECT 1 FROM "SugCycle" WHERE id = OLD."cycleId" AND "resultsAt" IS NOT NULL) THEN RAISE EXCEPTION 'candidate: the results are final'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_candidate_window BEFORE INSERT OR UPDATE ON "SugCandidate" FOR EACH ROW EXECUTE FUNCTION sug_candidate_guard();

-- Results can be written only while the cycle's results are not final, and only into a seat that exists in that race.
CREATE FUNCTION sug_result_guard() RETURNS trigger AS $$
DECLARE c "SugCycle"%ROWTYPE; r "SugRace"%ROWTYPE;
BEGIN
  SELECT * INTO r FROM "SugRace" WHERE id = NEW."raceId";
  IF NOT FOUND OR r."cycleId" <> NEW."cycleId" THEN RAISE EXCEPTION 'result: the race does not belong to that cycle'; END IF;
  SELECT * INTO c FROM "SugCycle" WHERE id = NEW."cycleId";
  IF c."resultsAt" IS NOT NULL THEN RAISE EXCEPTION 'result: the results are final'; END IF;
  IF NEW.seat IS NOT NULL AND (NEW.seat < 1 OR NEW.seat > r.seats) THEN RAISE EXCEPTION 'result: seat % does not exist in this race', NEW.seat; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_result_lock BEFORE INSERT ON "SugResult" FOR EACH ROW EXECUTE FUNCTION sug_result_guard();

-- Once results are final they cannot be unset or re-dated, and the voting window cannot be moved once voting has begun.
CREATE FUNCTION sug_cycle_guard() RETURNS trigger AS $$
DECLARE t TIMESTAMP := (now() AT TIME ZONE 'UTC');
BEGIN
  IF OLD."resultsAt" IS NOT NULL AND (NEW."resultsAt" IS DISTINCT FROM OLD."resultsAt" OR NEW."votingStartsAt" <> OLD."votingStartsAt" OR NEW."votingEndsAt" <> OLD."votingEndsAt"
     OR NEW."runoffStartsAt" IS DISTINCT FROM OLD."runoffStartsAt" OR NEW."runoffEndsAt" IS DISTINCT FROM OLD."runoffEndsAt") THEN
    RAISE EXCEPTION 'cycle: the results are final'; END IF;
  IF t >= OLD."votingStartsAt" AND (NEW."votingStartsAt" <> OLD."votingStartsAt" OR NEW."votingEndsAt" <> OLD."votingEndsAt") THEN
    RAISE EXCEPTION 'cycle: the voting window cannot change once voting has begun'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_cycle_lock BEFORE UPDATE ON "SugCycle" FOR EACH ROW EXECUTE FUNCTION sug_cycle_guard();

-- A candidate can never spend past the cap, however the request arrives. The candidate row is locked first, so two requests at once cannot both pass.
CREATE FUNCTION sug_expense_guard() RETURNS trigger AS $$
DECLARE c "SugCycle"%ROWTYPE; cand "SugCandidate"%ROWTYPE; cap BIGINT; spent BIGINT;
BEGIN
  SELECT * INTO cand FROM "SugCandidate" WHERE id = NEW."candidateId" FOR UPDATE;
  IF NOT FOUND OR cand."cycleId" <> NEW."cycleId" THEN RAISE EXCEPTION 'expense: unknown candidate'; END IF;
  SELECT * INTO c FROM "SugCycle" WHERE id = NEW."cycleId";
  cap := CASE WHEN cand.position IN ('SPEAKER', 'DEPUTY_SPEAKER', 'HONOURABLE_MEMBER') THEN c."spendCapAssemblyKobo" ELSE c."spendCapExecKobo" END;
  SELECT COALESCE(SUM("amountKobo"), 0) INTO spent FROM "SugExpense" WHERE "candidateId" = NEW."candidateId";
  IF spent + NEW."amountKobo" > cap THEN RAISE EXCEPTION 'expense: over the campaign spending limit'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_expense_cap BEFORE INSERT ON "SugExpense" FOR EACH ROW EXECUTE FUNCTION sug_expense_guard();

-- A legislative vote is accepted only while the item is open for voting, and only from a seated Honourable Member of the term the item belongs to.
CREATE FUNCTION sug_legvote_guard() RETURNS trigger AS $$
DECLARE it "SugItem"%ROWTYPE;
BEGIN
  SELECT * INTO it FROM "SugItem" WHERE id = NEW."itemId";
  IF NOT FOUND OR it.status <> 'VOTING' THEN RAISE EXCEPTION 'vote: this item is not open for voting'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "SugAppointment" a WHERE a."termId" = it."termId" AND a."characterId" = NEW."voterId" AND a.position = 'HONOURABLE_MEMBER' AND a.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'vote: only Honourable Members may vote'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER sug_legvote_open BEFORE INSERT ON "SugLegVote" FOR EACH ROW EXECUTE FUNCTION sug_legvote_guard();

-- ---------------------------------------------------------------------------------------------------------------- the SUG system account
-- Nomination fees and campaign spending are paid into it (a money sink, like the other system accounts). seed.js creates it on a fresh database too.
INSERT INTO "Account" ("id", "kind", "systemName", "balance") VALUES ('sys_sug', 'SYSTEM', 'SUG', 0) ON CONFLICT ("systemName") DO NOTHING;