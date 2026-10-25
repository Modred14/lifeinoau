// tests/game-time-source.test.mjs
// There is ONE game clock (lib/campus-clock.js, West Africa Time). The Jobs app, the shift rules and the lecture timetable must all read it:
// a game day starts at 12:00 AM game time whatever moment the clock row's epoch happens to hold, and the minute of the day is gameMinuteOfDay().
import assert from "node:assert/strict";
import fs from "node:fs";
import { gameMinuteOfDay, gameMidnightAtOrBefore, gameMinuteText, weekAt, GAME_DAY_MS, GAME_WEEK_MS } from "../lib/campus-clock.js";
import { dayWindow } from "../lib/clock.js";
import { shiftBlock, windowText, JOBS } from "../lib/jobs.js";

const MIN = 60_000, HOUR = 3_600_000;
const wat = (d, h, m = 0) => Date.UTC(2026, 9, d, h - 1, m); // a West Africa Time wall time (UTC+1)

// a clock row whose epoch is NOT at game midnight (the deploy moment: 15:30 UTC = 4:30 PM game time)
const epoch = Date.UTC(2026, 9, 1, 15, 30);
const db = { gameClock: { findUnique: async () => ({ id: 1, startedAt: new Date(epoch), campusEpoch: new Date(epoch), campusStartWeek: 1 }) } };

// game midnight: 23:00 UTC
assert.equal(gameMidnightAtOrBefore(wat(20, 0, 0)), wat(20, 0, 0));
assert.equal(gameMidnightAtOrBefore(wat(20, 8, 15)), wat(20, 0, 0));
assert.equal(gameMidnightAtOrBefore(wat(20, 23, 59) + 59_999), wat(20, 0, 0));

// every day window starts where the game clock reads 12:00 AM, and the minute of the day is the minutes into that window
for (const t of [wat(1, 16, 29), wat(1, 16, 30), wat(2, 0, 0), wat(2, 0, 1), wat(5, 8, 0), wat(20, 12, 34), wat(20, 23, 59)]) {
  const d = await dayWindow(db, t);
  assert.equal(gameMinuteOfDay(d.start), 0, "a day starts at game midnight");
  assert.equal(d.end - d.start, GAME_DAY_MS);
  assert.equal(Math.floor((t - d.start) / MIN), gameMinuteOfDay(t), "minutes into the day agree with the clock on screen");
  assert.ok(t >= d.start && t < d.end);
}
assert.equal((await dayWindow(db, wat(1, 16, 30))).day, 1, "day 1 is the day the epoch falls in");
assert.equal((await dayWindow(db, wat(2, 0, 0))).day, 2, "the next day begins at game midnight, not at the epoch's time of day");
assert.equal((await dayWindow(db, wat(2, 16, 29))).day, 2, "and it does not turn over again at the epoch's time of day");
assert.equal((await dayWindow(db, wat(3, 0, 0))).day, 3);

// the week turns over at game midnight too, so a week is a whole number of game days
assert.equal(weekAt({ campusEpoch: new Date(epoch), campusStartWeek: 1 }, wat(7, 23, 59)), 1);
assert.equal(weekAt({ campusEpoch: new Date(epoch), campusStartWeek: 1 }, wat(8, 0, 0)), 2);
assert.equal(GAME_WEEK_MS, 7 * GAME_DAY_MS);

// the shift windows are checked against the game clock: 6:00 AM to 11:00 AM game time for the morning shift
const job = JOBS.vendor, ctx = (t) => ({ minute: gameMinuteOfDay(t), energy: 100, activeShift: false, lastShiftDay: null, day: 5, weekShifts: 0, busy: null });
assert.match(shiftBlock(job, "morning", ctx(wat(20, 5, 59))), /opens at 6:00 AM/);
assert.equal(shiftBlock(job, "morning", ctx(wat(20, 6, 0))), null);
assert.equal(shiftBlock(job, "morning", ctx(wat(20, 10, 59))), null);
assert.match(shiftBlock(job, "morning", ctx(wat(20, 11, 0))), /closed for today/);
assert.equal(shiftBlock(job, "night", ctx(wat(20, 18, 0))), null);
assert.match(windowText("morning"), /^6:00 AM to 11:00 AM/);
assert.equal(gameMinuteText(0), "12:00 AM"); assert.equal(gameMinuteText(12 * 60), "12:00 PM"); assert.equal(gameMinuteText(23 * 60 + 5), "11:05 PM");

// no second clock: the Jobs screen, the Jobs rules and the timetable have no private time maths left
const src = (p) => fs.readFileSync(new URL("../" + p, import.meta.url), "utf8");
const app = src("components/apps/CareerApp.js");
assert.ok(!/gameMinute\b/.test(app) && !/hhmm/.test(app), "the Jobs screen does not rebuild the time from an answer it remembered");
assert.ok(/gameClockWithZone/.test(app) && /serverTime/.test(app), "the Jobs screen shows the server-corrected game clock");
assert.ok(!/minuteOfDay\s*=/.test(src("lib/jobs.js")) && !/GAME_MINUTE_MS/.test(src("lib/jobs.js")), "lib/jobs.js has no clock of its own");
assert.ok(!/export const minuteOf\b/.test(src("lib/faculty.js")), "the timetable has no clock of its own");
for (const f of ["lib/careerService.js", "lib/facultyService.js", "lib/facultyGuard.js"]) assert.ok(/gameMinuteOfDay/.test(src(f)) && !/day\.start/.test(src(f).replace(/^.*dayStart.*$/gm, "")), f + " reads the minute of the day from the game clock");

console.log("The Jobs app, its shift rules and the timetable all run on the one game clock.");
