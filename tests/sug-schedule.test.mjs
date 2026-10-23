// tests/sug-schedule.test.mjs
// The SUG election calendar: registration closes on 25 October 2026 and voting opens on 27 October 2026, in the game's own time zone (Africa/Lagos, UTC+1).
// Checks the rules at the exact boundaries, that a new cycle is created with the calendar, that a running election that predates it is moved onto it (and
// nothing else is), that the countdown labels agree, and that the SQL migration carries the very same instants. Pure Node: a small in-memory stand-in for the database.
import { readFileSync } from "node:fs";
import * as R from "../lib/sugRules.js";
import { createCycle, advance, cycleView } from "../lib/sugService.js";
import { GAME_TIME_ZONE } from "../lib/campus-clock.js";

let bad = 0; const chk = (l, c, extra) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && extra !== undefined ? "  -> " + extra : "")); };
const WAT = (iso) => Date.parse(iso + "+01:00"); // a game-clock time written as West Africa Time
const day = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: GAME_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));

// ---- the calendar itself ----
const S = R.ELECTION_SCHEDULE;
chk("the game's time zone is Africa/Lagos", GAME_TIME_ZONE === "Africa/Lagos");
chk("registration closes on 25 October 2026 (game time), at the very end of the day", S.registrationClosesAt === WAT("2026-10-25T23:59:59") && day(S.registrationClosesAt) === "2026-10-25");
chk("voting opens on 27 October 2026 at midnight (game time), two days after registration closes", S.votingStartsAt === WAT("2026-10-27T00:00:00") && day(S.votingStartsAt) === "2026-10-27");
chk("voting opens exactly two calendar days after the closing day", (Date.parse(day(S.votingStartsAt)) - Date.parse(day(S.registrationClosesAt))) / 86_400_000 === 2);
{ const t = R.scheduledTimetable(WAT("2026-10-22T10:00:00"));
  chk("the scheduled timetable is in the order the database insists on", R.timetableProblem(t) === null, R.timetableProblem(t));
  chk("registration is open from 22 Oct, the campaign follows it, voting runs 24 hours", t.registrationOpensAt === S.registrationOpensAt && t.campaignStartsAt === S.registrationClosesAt && t.votingEndsAt - t.votingStartsAt === 24 * R.HOUR);
  chk("a cycle announced late still has an announcement that is not after registration opens", R.scheduledTimetable(WAT("2026-10-24T12:00:00")).announcedAt <= S.registrationOpensAt);
  // the SQL migration is written in UTC; it must hold the same instants as the code
  const sql = readFileSync(new URL("../prisma/migrations/20261023000000_sug_election_schedule/migration.sql", import.meta.url), "utf8"), z = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  chk("the migration carries the same instants as the code", [t.registrationOpensAt, t.campaignStartsAt, t.votingStartsAt, t.votingEndsAt, t.termStartsAt, t.termEndsAt].every((ms) => sql.includes(`TIMESTAMP '${z(ms)}'`))); }

// ---- the stage and the windows at the exact boundaries ----
{ const t = R.scheduledTimetable(WAT("2026-10-22T08:00:00")), c = { ...t, status: "LIVE", resultsAt: null, runoffStartsAt: null, runoffEndsAt: null };
  const at = (iso) => WAT(iso), st = (iso) => R.stageOf(c, at(iso));
  chk("22 Oct: registration is open", st("2026-10-22T08:00:00") === "REGISTRATION" && R.registrationOpen(c, at("2026-10-22T08:00:00")));
  chk("23 and 24 Oct: registration is still open (it no longer closes on the 23rd)", ["2026-10-23T23:59:59", "2026-10-24T12:00:00"].every((i) => st(i) === "REGISTRATION" && R.registrationOpen(c, at(i))));
  chk("25 Oct 23:59:58: the last second of registration", st("2026-10-25T23:59:58") === "REGISTRATION" && R.registrationOpen(c, at("2026-10-25T23:59:58")));
  chk("25 Oct 23:59:59: registration is closed", st("2026-10-25T23:59:59") === "CAMPAIGN" && !R.registrationOpen(c, at("2026-10-25T23:59:59")));
  chk("26 Oct: registration stays closed and voting is not open", ["2026-10-26T00:00:00", "2026-10-26T12:00:00", "2026-10-26T23:59:59"].every((i) => st(i) === "CAMPAIGN" && !R.registrationOpen(c, at(i)) && R.openRound(c, at(i)) === 0));
  chk("27 Oct 00:00: voting opens, registration is still closed", st("2026-10-27T00:00:00") === "VOTING" && R.openRound(c, at("2026-10-27T00:00:00")) === 1 && !R.registrationOpen(c, at("2026-10-27T00:00:00")));
  chk("27 Oct 23:59:59: still voting; 28 Oct 00:00: voting is over", st("2026-10-27T23:59:59") === "VOTING" && R.openRound(c, at("2026-10-28T00:00:00")) === 0 && st("2026-10-28T00:00:00") === "RESULTS");
  const view = (iso) => cycleView({ ...c, id: 1, number: 1, title: "t", nominationFeeKobo: 0n, spendCapExecKobo: 0n, spendCapAssemblyKobo: 0n }, at(iso));
  chk("the countdown in the registration stage is to the closing instant", view("2026-10-22T09:00:00").next?.label === "Registration closes" && view("2026-10-22T09:00:00").next.at === S.registrationClosesAt);
  chk("the countdown in the campaign stage is to the first moment of 27 October", view("2026-10-26T09:00:00").next?.label === "Voting opens" && view("2026-10-26T09:00:00").next.at === S.votingStartsAt);
  chk("the timetable the screens get holds the same dates", view("2026-10-22T09:00:00").timetable.campaignStartsAt === S.registrationClosesAt && view("2026-10-22T09:00:00").timetable.votingStartsAt === S.votingStartsAt); }

// ---- which timetable a new cycle gets ----
chk("an election announced before voting day gets the calendar", R.defaultTimetable(WAT("2026-10-22T08:00:00"), { scale: 1 }).votingStartsAt === S.votingStartsAt);
chk("a demo run (SUG_TIME_SCALE) keeps its own shortened hours", R.defaultTimetable(WAT("2026-10-22T08:00:00"), { scale: 0.01 }).votingStartsAt !== S.votingStartsAt);
chk("a following election (it must not start before the old term ends) uses the hour-based timetable", R.defaultTimetable(WAT("2026-10-22T08:00:00"), { notBefore: WAT("2026-11-11T08:00:00"), scale: 1 }).votingStartsAt !== S.votingStartsAt);
chk("an election announced after the calendar's voting day uses the hour-based timetable", R.defaultTimetable(WAT("2026-10-28T08:00:00"), { scale: 1 }).votingStartsAt === R.buildTimetable(WAT("2026-10-28T08:00:00"), { scale: 1 }).votingStartsAt);

// ---- the service, against an in-memory database ----
function fakeDb(seed = []) {
  const cycles = seed.map((c, i) => ({ id: i + 1, resultsAt: null, runoffStartsAt: null, runoffEndsAt: null, ...c })), races = [];
  const ok = (c, where = {}) => Object.entries(where).every(([k, v]) => {
    if (v === null) return c[k] == null;
    if (v && typeof v === "object" && !(v instanceof Date)) { if ("gt" in v) return +c[k] > +v.gt; if ("not" in v) return c[k] !== v.not; if ("in" in v) return v.in.includes(c[k]); }
    return c[k] === v;
  });
  const sorted = (l, o) => (o?.number === "desc" ? [...l].sort((a, b) => b.number - a.number) : l);
  const db = {
    sugCycle: {
      findFirst: async ({ where, orderBy } = {}) => sorted(cycles.filter((c) => ok(c, where)), orderBy)[0] ?? null,
      findUnique: async ({ where }) => cycles.find((c) => c.id === where.id) ?? null,
      create: async ({ data }) => { const c = { id: cycles.length + 1, resultsAt: null, runoffStartsAt: null, runoffEndsAt: null, ...data }; cycles.push(c); return c; },
      updateMany: async ({ where, data }) => { const hit = cycles.filter((c) => ok(c, where)); hit.forEach((c) => Object.assign(c, data)); return { count: hit.length }; },
    },
    sugRace: { createMany: async ({ data }) => { races.push(...data); } },
    sugTerm: { updateMany: async () => ({ count: 0 }) },
    sugCampaignEvent: { findMany: async () => [] },
    $executeRaw: async () => 0,
  };
  db.$transaction = async (fn) => fn(db);
  return { db, cycles, races };
}
const oldTimetable = (announce) => R.buildTimetable(announce, { scale: 1 }); // what an election announced before the calendar existed looks like
const row = (announce, extra = {}) => { const t = oldTimetable(announce); return { number: 1, title: "SUG Election 1", status: "LIVE", stage: "REGISTRATION", createdBy: "SYSTEM", ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, new Date(v)])), ...extra }; };
const sameAsSchedule = (c) => R.onSchedule(c);

{ const f = fakeDb(), now = WAT("2026-10-22T08:30:00"), c = await createCycle(f.db, { announceAt: now, createdBy: "SYSTEM" });
  chk("a new cycle is created with the calendar's dates", sameAsSchedule(c) && +c.campaignStartsAt === S.registrationClosesAt && +c.votingStartsAt === S.votingStartsAt && c.races === undefined && f.races.length === R.POSITIONS.length);
  chk("it starts in the registration stage", c.stage === "REGISTRATION"); }
{ const f = fakeDb(), c = await createCycle(f.db, { announceAt: WAT("2026-10-22T08:30:00"), createdBy: "admin-1", timetable: { ...R.buildTimetable(WAT("2026-10-22T08:30:00"), { scale: 1 }) } });
  chk("an administrator's own dates are kept as typed", !sameAsSchedule(c)); }

// a running election announced before the calendar: moved onto it while voting has not begun
{ const announce = WAT("2026-10-21T15:00:00"), f = fakeDb([row(announce)]), before = f.cycles[0], now = WAT("2026-10-22T08:30:00");
  chk("(setup) the old election has other dates", !sameAsSchedule(before));
  const c = await advance(f.db, now);
  chk("advance() moves it onto the calendar: registration closes 25 Oct 23:59:59, voting opens 27 Oct 00:00", sameAsSchedule(f.cycles[0]) && +f.cycles[0].campaignStartsAt === S.registrationClosesAt && +f.cycles[0].votingStartsAt === S.votingStartsAt && sameAsSchedule(c));
  chk("its stage is right for the time", f.cycles[0].stage === "REGISTRATION" && R.registrationOpen(f.cycles[0], now));
  const snapshot = JSON.stringify(f.cycles[0]); await advance(f.db, now + 60_000);
  chk("doing it again changes nothing", JSON.stringify(f.cycles[0]) === snapshot);
  await advance(f.db, WAT("2026-10-24T10:00:00"));
  chk("on 24 Oct registration is still open and voting is not", f.cycles[0].stage === "REGISTRATION" && R.registrationOpen(f.cycles[0], WAT("2026-10-24T10:00:00")) && R.openRound(f.cycles[0], WAT("2026-10-24T10:00:00")) === 0);
  await advance(f.db, WAT("2026-10-26T10:00:00"));
  chk("on 26 Oct registration is closed and voting is not open", f.cycles[0].stage === "CAMPAIGN" && !R.registrationOpen(f.cycles[0], WAT("2026-10-26T10:00:00")) && R.openRound(f.cycles[0], WAT("2026-10-26T10:00:00")) === 0);
  await advance(f.db, WAT("2026-10-27T00:00:01"));
  chk("on 27 Oct voting is open", f.cycles[0].stage === "VOTING" && R.openRound(f.cycles[0], WAT("2026-10-27T00:00:01")) === 1); }
// a running election that already carries the PREVIOUS calendar (registration closing 23 Oct, voting 25 Oct) is moved to the current one
{ const prev = { registrationOpensAt: WAT("2026-10-22T00:00:00"), campaignStartsAt: WAT("2026-10-23T23:59:59"), votingStartsAt: WAT("2026-10-25T00:00:00"), votingEndsAt: WAT("2026-10-26T00:00:00"), termStartsAt: WAT("2026-10-26T08:00:00"), termEndsAt: WAT("2026-11-09T08:00:00") };
  const f = fakeDb([{ number: 1, title: "SUG Election 1", status: "LIVE", stage: "REGISTRATION", createdBy: "SYSTEM", announcedAt: new Date(WAT("2026-10-21T23:00:00")), ...Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, new Date(v)])) }]);
  chk("(setup) it is on the previous calendar", !sameAsSchedule(f.cycles[0]) && +f.cycles[0].campaignStartsAt === prev.campaignStartsAt);
  await advance(f.db, WAT("2026-10-23T06:45:00"));
  chk("on 23 Oct the previous calendar is replaced: registration stays open until 25 Oct 23:59:59, voting opens 27 Oct", sameAsSchedule(f.cycles[0]) && +f.cycles[0].campaignStartsAt === S.registrationClosesAt && +f.cycles[0].votingStartsAt === S.votingStartsAt && f.cycles[0].stage === "REGISTRATION" && R.registrationOpen(f.cycles[0], WAT("2026-10-23T06:45:00"))); }
// what is left alone
{ const f = fakeDb([row(WAT("2026-10-18T15:00:00"))]), now = WAT("2026-10-21T20:00:00"), voting = f.cycles[0].votingStartsAt;
  const t = oldTimetable(WAT("2026-10-18T15:00:00")); // its voting started on 21 Oct 16:00 game time: already begun at `now`
  await advance(f.db, Math.max(now, t.votingStartsAt + 1000));
  chk("an election whose voting has already begun is never moved", +f.cycles[0].votingStartsAt === +voting); }
{ const f = fakeDb([row(WAT("2026-10-21T15:00:00"), { createdBy: "admin-1" })]), v = f.cycles[0].votingStartsAt; await advance(f.db, WAT("2026-10-22T08:30:00"));
  chk("an election an administrator started is not moved", +f.cycles[0].votingStartsAt === +v); }
{ const f = fakeDb([row(WAT("2026-10-21T15:00:00"), { runoffStartsAt: new Date(WAT("2026-10-22T07:00:00")), runoffEndsAt: new Date(WAT("2026-10-22T13:00:00")) })]), v = f.cycles[0].votingStartsAt; await advance(f.db, WAT("2026-10-22T08:30:00"));
  chk("an election in a runoff is not moved", +f.cycles[0].votingStartsAt === +v); }
{ const f = fakeDb([row(WAT("2026-10-21T15:00:00"), { status: "DECIDED", resultsAt: new Date(WAT("2026-10-22T07:00:00")) })]), v = f.cycles[0].votingStartsAt; await advance(f.db, WAT("2026-10-22T08:30:00")).catch(() => {});
  chk("a decided election is not moved", +f.cycles[0].votingStartsAt === +v); }

console.log(bad ? `\n${bad} check(s) failed` : "\nAll SUG schedule checks passed"); process.exit(bad ? 1 : 0);
