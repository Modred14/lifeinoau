// tests/world-activities.test.mjs: the pure rules behind job shifts, sleep, the two on-site hustles, faculty academics and travel speed.
// (The database behaviour, races and persistence are tested against real PostgreSQL in tests/pg/.)
import assert from "node:assert/strict";
import { JOBS, SHIFT_TYPES, shiftBlock, shiftEnergy, rollPay, beginShift, shiftMinutes, shiftMs, MAX_SHIFTS_PER_WEEK } from "../lib/jobs.js";
import { SLEEP, wakeResult, sleepBlock, msToFull, sleepRate } from "../lib/sleep.js";
import { ACTIVITY_SECONDS, ACTIVITY_MS } from "../lib/activityTime.js";
import { SITES, beginRun, siteOfPlace, crewRole, runMs } from "../lib/hustleSites.js";
import { HUSTLE, gapFor } from "../lib/engine.js";
import { FACULTY_PLACE, facultyHome, isOwnFacultyPlace, classWindow, classOpen, teachingOpen, dayOfWeek } from "../lib/faculty.js";
import { FACULTIES } from "../lib/faculties.js";
import { minTravelMs } from "../lib/travel.js";
import { placeExists } from "../lib/travelService.js";
import { CAMPUS_MINUTE_MS } from "../lib/campus-clock.js";

const max = (a, b) => b, min = (a) => a; // roll() stand-ins: always the top / the bottom of the range

// ---- jobs: every job has a shift menu; windows, energy, pay and duration
for (const [key, j] of Object.entries(JOBS)) {
  assert.ok(j.shifts.length && j.shifts.every((s) => SHIFT_TYPES[s]), key + " has valid shifts"); assert.ok(j.hours >= 2 && j.hours <= 6, key + " hours");
  assert.ok(shiftMinutes(j) === j.hours * 60);
}
const ctx = (o = {}) => ({ minute: 8 * 60, energy: 100, activeShift: false, lastShiftDay: null, day: 3, weekShifts: 0, busy: null, ...o });
const v = JOBS.vendor;
assert.equal(shiftBlock(v, "morning", ctx()), null);
assert.match(shiftBlock(v, "morning", ctx({ minute: 5 * 60 })), /opens at 06:00/); assert.match(shiftBlock(v, "morning", ctx({ minute: 11 * 60 })), /closed for today/);
assert.match(shiftBlock(v, "night", ctx({ minute: 8 * 60 })), /opens at 18:00/); assert.equal(shiftBlock(v, "night", ctx({ minute: 20 * 60 })), null);
assert.match(shiftBlock(JOBS.dj, "morning", ctx()), /no morning shift/, "a night-only job has no morning shift");
assert.match(shiftBlock(v, "morning", ctx({ activeShift: true })), /already on a shift/);
assert.match(shiftBlock(v, "night", ctx({ minute: 20 * 60, lastShiftDay: 3 })), /already worked today/, "one shift a day, even if the other window is open");
assert.equal(shiftBlock(v, "night", ctx({ minute: 20 * 60, lastShiftDay: 2 })), null, "the next day it is open again");
assert.match(shiftBlock(v, "morning", ctx({ weekShifts: MAX_SHIFTS_PER_WEEK })), /shifts a week/);
assert.match(shiftBlock(v, "morning", ctx({ energy: shiftEnergy(v, "morning") - 1 })), /energy/); assert.match(shiftBlock(v, "morning", ctx({ busy: "You are asleep." })), /asleep/);
assert.ok(shiftEnergy(v, "night") > shiftEnergy(v, "morning"), "nights tire you more");
assert.ok(rollPay(v, 0, "night", max) > rollPay(v, 0, "morning", max), "and pay a premium"); assert.ok(rollPay(v, 50, "morning", max) > rollPay(v, 0, "morning", max), "pay grows with job level");
const b = beginShift({ energy: 90 }, v, 0, "morning", 1_000_000, max); assert.equal(b.endsAtMs, 1_000_000 + ACTIVITY_MS, "a shift lasts one activity length (15 s)"); assert.equal(shiftMs(v), ACTIVITY_MS); assert.ok(beginShift({ energy: 1 }, v, 0, "morning", 0, max).error);

// ---- sleep: recovery comes from elapsed time and caps at 100
const c = { energy: 20, health: 70, personalities: [] };
const slept = (sec, bed = "single_bed", ch = c) => wakeResult(ch, bed, 0, sec * 1000);
assert.equal(slept(0).restored, 0, "lying down and getting straight up restores nothing"); assert.equal(slept(6).restored, 40, "6 s of a 15 s sleep is 40 energy"); assert.equal(slept(9).restored, 60);
assert.ok(slept(10).restored > slept(6).restored, "longer sleep restores more");
assert.equal(slept(ACTIVITY_SECONDS).energy, 100, "a full 15 s sleep reaches the cap"); assert.equal(slept(ACTIVITY_SECONDS).rested, true);
assert.equal(slept(ACTIVITY_SECONDS).energy, slept(5000).energy, "a sleep never counts past one activity length");
assert.equal(SLEEP.durationMs, ACTIVITY_MS, "sleep lasts exactly one activity length");
assert.equal(slept(5, "double_bed").restored, slept(5).restored, "every bed is the same speed");
assert.equal(sleepRate({ personalities: ["Introvert"] }, "single_bed"), sleepRate(c, "single_bed"));
assert.equal(slept(0, "single_bed", { ...c, energy: 100 }).energy, 100); assert.equal(msToFull(c, "single_bed"), 12_000, "from 20 energy it takes 12 s to fill"); assert.ok(msToFull({ ...c, energy: 0 }, "single_bed") <= ACTIVITY_MS);
assert.match(sleepBlock(c, { asleep: true }), /already asleep/); assert.match(sleepBlock(c, { jailed: true }), /custody/); assert.match(sleepBlock(c, { shift: true }), /shift/);
assert.match(sleepBlock(c, { hustling: true }), /hustle/); assert.match(sleepBlock({ energy: 98 }, {}), /not tired/); assert.equal(sleepBlock(c, {}), null);

// ---- the two on-site hustles keep the old economy exactly
assert.equal(SITES.crew.place, "oduduwa"); assert.equal(SITES.backstairs.place, "sub"); assert.equal(siteOfPlace("sub"), "backstairs"); assert.equal(siteOfPlace("library"), null);
const rich = { energy: 100, suspicion: 0, luck: 50, riskTolerance: 50, popularity: 50, happiness: 50, strikes: 0, personalities: [] };
const cr = beginRun(rich, "crew", 0, max); assert.equal(cr.energyCost, HUSTLE.safe.energy); assert.equal(cr.caught, false);
assert.ok(cr.payKobo >= BigInt(HUSTLE.safe.min) * 100n && cr.payKobo <= BigInt(HUSTLE.safe.max) * 100n); assert.equal(cr.endsAtMs, runMs("crew")); assert.equal(cr.endsAtMs, ACTIVITY_MS);
assert.ok(beginRun({ ...rich, energy: 5 }, "crew", 0, max).error, "needs the energy");
const bs = beginRun(rich, "backstairs", 0, min); assert.equal(bs.energyCost, HUSTLE.risky.energy); assert.ok(bs.stats.suspicion > rich.suspicion, "suspicion rises at the start");
assert.notEqual(crewRole(1_500), crewRole(14_000)); assert.equal(runMs("backstairs"), ACTIVITY_MS); assert.equal(runMs("crew"), ACTIVITY_MS, "both hustle runs last one activity length (15 s)");
// the gap between two safe hustles follows the clock: a quarter of an in-game day
assert.equal(gapFor(0, 24 * 3600_000), 6 * 3600_000); assert.equal(gapFor(0, 48 * 60_000), 12 * 60_000);

// ---- faculties: every one has a building that exists on the map, and the timetable follows the game clock
for (const [name] of FACULTIES) { const h = facultyHome(name); assert.ok(h, name + " has a building"); assert.ok(placeExists(h.place), name + " -> " + h.place + " is on the map"); }
assert.equal(facultyHome("Science").place, "f_science", "older short faculty names still work");
assert.ok(isOwnFacultyPlace("Faculty of Law", "f_law") && !isOwnFacultyPlace("Faculty of Law", "f_social") && isOwnFacultyPlace("Faculty of Arts", "f_arts_b2") && !isOwnFacultyPlace("Faculty of Law", "library"));
assert.equal(Object.keys(FACULTY_PLACE).length, FACULTIES.length);
assert.deepEqual(classWindow("Tue 10AM"), { weekday: 1, from: 600, to: 960 }); assert.equal(classWindow("Fri 4PM").to, 20 * 60, "late lectures never run past 20:00"); assert.equal(classWindow("nonsense"), null);
assert.equal(classOpen("Tue 10AM", 1, 700).open, true); assert.match(classOpen("Tue 10AM", 2, 700).why, /lecture day/); assert.match(classOpen("Tue 10AM", 1, 500).why, /starts at 10:00/); assert.match(classOpen("Tue 10AM", 1, 1000).why, /ended/);
assert.ok(teachingOpen(8 * 60) && !teachingOpen(7 * 60 + 59) && !teachingOpen(18 * 60)); assert.equal(dayOfWeek(1), 0); assert.equal(dayOfWeek(8), 0); assert.equal(dayOfWeek(6), 5);

// ---- travel speed: nobody gets anywhere faster than the distance allows
assert.equal(minTravelMs(0, "trek"), 0); assert.equal(minTravelMs(50, "trek"), 0, "short hops are never refused"); assert.ok(minTravelMs(1000, "trek") >= 90_000);
assert.ok(minTravelMs(2000, "car") < minTravelMs(2000, "trek"), "driving is faster than walking"); assert.ok(minTravelMs(3000, "keke") >= 5000 && minTravelMs(3000, "keke") <= 8000);
assert.ok(minTravelMs(3000, "car", true) >= 3000, "a driver's ride still takes its time");
console.log("job shift, sleep, hustle site, faculty and travel rules passed");
