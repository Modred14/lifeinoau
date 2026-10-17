import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BED_HALLS,
  BED_SPACE,
  BUSINESS_CENTRES,
  CLASS_START_HOURS,
  HANDOUT,
  HOSTEL_PITCHES,
  HUSTLES,
  HUSTLE_IDS,
  MINUTES_PER_DAY,
  PAPER_DAYS,
  PLACES,
  PORTER_RAID,
  PX_PER_METER,
  REGISTRATION,
  SLOTS_PER_DAY,
  SPOTS,
  STALLS,
  addHandout,
  adminWeekOf,
  ballotOpenFor,
  ballotPosition,
  ballotRivals,
  BALLOT_WINDOWS,
  ballotWindow,
  nextBallotWindow,
  ballotWins,
  carryOverSlots,
  emptyAdminRecord,
  finishHustle,
  gameTime,
  gradeFor,
  handoutClassStudy,
  handoutTestMarks,
  hustlePay,
  hustleRefusal,
  hustleSite,
  isBlocked,
  lovesHandouts,
  onRoad,
  parseAdminAction,
  portalRush,
  portalStatus,
  raidFor,
  raidOn,
  recordResult,
  restAdjust,
  resultSlip,
  rollAdminWeek,
  sanitizeAdminRecord,
  skillPay,
  testCourseOn,
  testCoursesFor,
  timetableFor,
  timetableWithCarryOvers,
  trayCustomers,
  tryBuyHandout,
  tryRegister,
  unregisteredPenalty,
} from "../src/index";

const WEEK = 7 * MINUTES_PER_DAY;
const tt = timetableFor("computer-science", "200L");
const at = (week: number, weekday: number, minute: number) => week * WEEK + weekday * MINUTES_PER_DAY + minute;
const RICH = 100000;

function firstMinute(week: number, want: "up" | "slow" | "down", from = 0, to = REGISTRATION.closeMinute): number {
  for (let m = from; m < to; m++) if (portalStatus(week * WEEK + m).state === want) return week * WEEK + m;
  throw new Error(`no ${want} minute`);
}

test("the registration window and portal trouble are the same every time", () => {
  for (let m = 0; m < WEEK; m += 7) assert.deepEqual(portalStatus(3 * WEEK + m), portalStatus(3 * WEEK + m));
  let up = 0;
  let rushTrouble = 0;
  let calmTrouble = 0;
  let rush = 0;
  let calm = 0;
  for (let week = 0; week < 20; week++) {
    for (let m = 0; m < REGISTRATION.closeMinute; m++) {
      const total = week * WEEK + m;
      const bad = portalStatus(total).state !== "up";
      if (!bad) up++;
      if (portalRush(total)) {
        rush++;
        if (bad) rushTrouble++;
      } else {
        calm++;
        if (bad) calmTrouble++;
      }
    }
  }
  assert.ok(up / (20 * REGISTRATION.closeMinute) > 0.5, "portal is usable most of the window");
  assert.ok(rushTrouble / rush > calmTrouble / calm, "the hours before the deadline are worse");
  const slow = firstMinute(2, "slow");
  assert.ok(portalStatus(slow).queue > 0);
  assert.ok(portalStatus(slow + 1).queue <= portalStatus(slow).queue);
});

test("registering on time is free, late costs the fine, and the portal can refuse", () => {
  const record = emptyAdminRecord();
  assert.deepEqual(tryRegister(record, firstMinute(1, "up"), 0, "portal"), { ok: true, cost: 0, late: false });
  const down = tryRegister(record, firstMinute(1, "down"), RICH, "portal");
  assert.equal(down.ok === false && down.reason, "down");
  const queued = tryRegister(record, firstMinute(1, "slow"), RICH, "portal");
  assert.equal(queued.ok === false && queued.reason, "queue");
  assert.deepEqual(tryRegister(record, firstMinute(1, "down"), RICH, "centre"), { ok: true, cost: REGISTRATION.centreFee, late: false });
  const late = firstMinute(1, "up", REGISTRATION.closeMinute, WEEK);
  assert.deepEqual(tryRegister(record, late, RICH, "portal"), { ok: true, cost: REGISTRATION.lateFine, late: true });
  const broke = tryRegister(record, late, REGISTRATION.lateFine - 1, "portal");
  assert.equal(broke.ok === false && broke.reason, "cash");
  record.reg = { week: 1, late: false, by: "portal" };
  const again = tryRegister(record, late, RICH, "portal");
  assert.equal(again.ok === false && again.reason, "registered");
});

test("no registration only costs marks after the window has closed", () => {
  const record = emptyAdminRecord();
  assert.equal(unregisteredPenalty(record, at(4, 0, 16 * 60)), 0);
  assert.equal(unregisteredPenalty(record, at(4, 3, 16 * 60)), REGISTRATION.testPenalty);
  record.reg = { week: 4, late: true, by: "centre" };
  assert.equal(unregisteredPenalty(record, at(4, 3, 16 * 60)), 0);
  assert.equal(unregisteredPenalty(record, at(5, 3, 16 * 60)), REGISTRATION.testPenalty);
});

test("the ballot is fair, stable and limited to the beds in a hall", () => {
  assert.ok(BED_HALLS.length >= 4);
  const hall = BED_HALLS[0];
  for (let week = 0; week < 6; week++) {
    const window = ballotWindow();
    assert.ok(window.start >= MINUTES_PER_DAY && window.end <= 2 * MINUTES_PER_DAY, "ballot is on Tuesday, after registration opens");
    assert.ok(window.start < REGISTRATION.closeMinute, "and before lectures start");
    assert.ok(ballotRivals(week, hall.place) >= hall.beds);
  }
  let wins = 0;
  const players = 4000;
  for (let i = 0; i < players; i++) {
    const key = `player-${i}`;
    assert.equal(ballotPosition(2, hall.place, key), ballotPosition(2, hall.place, key));
    if (ballotWins(2, hall.place, key)) wins++;
  }
  const odds = hall.beds / (ballotRivals(2, hall.place) + 1);
  assert.ok(Math.abs(wins / players - odds) < 0.05, `win share ${wins / players} near ${odds}`);
  assert.equal(ballotWins(2, -1, "player-1"), false);
});

test("a ballot opens only in the two calendar windows, the same for everybody, once a semester", () => {
  const week = 3;
  const window = ballotWindow();
  const late = BALLOT_WINDOWS[1];
  const record = emptyAdminRecord();
  assert.equal(ballotOpenFor(record, week * WEEK + window.start), true);
  assert.equal(ballotOpenFor(record, week * WEEK + window.end), false);
  record.ballot = { week, from: at(week, 2, 600), tried: false };
  assert.equal(ballotOpenFor(record, at(week, 2, 600 + 1)), false, "joining does not open a private ballot");
  assert.equal(ballotOpenFor(record, week * WEEK + late.start), true, "the late ballot is for anyone who missed the first");
  assert.equal(ballotOpenFor(record, week * WEEK + late.end), false);
  assert.equal(nextBallotWindow(window.end), late);
  assert.equal(nextBallotWindow(late.end), undefined);
  record.ballot.tried = true;
  assert.equal(ballotOpenFor(record, week * WEEK + window.start), false);
  record.ballot.tried = false;
  record.bed = { week, hall: BED_HALLS[0].name };
  assert.equal(ballotOpenFor(record, week * WEEK + window.start), false);
});

test("the porter's raid roll is stable for a night and squatters still rest", () => {
  const hall = BED_HALLS[1].place;
  let raids = 0;
  const nights = 700;
  for (let day = 0; day < nights; day++) {
    const roll = raidFor(day, hall);
    assert.deepEqual(roll, raidFor(day, hall));
    assert.ok(roll.start >= PORTER_RAID.earliest && roll.end <= MINUTES_PER_DAY);
    if (roll.raid) {
      raids++;
      assert.equal(raidOn(day, hall, roll.start), true);
      assert.equal(raidOn(day, hall, roll.end), false);
    } else assert.equal(raidOn(day, hall, roll.start), false);
  }
  assert.ok(Math.abs(raids / nights - PORTER_RAID.chance) < 0.06);
  const sleepRate = 1.4;
  assert.ok(sleepRate + restAdjust("squatter", sleepRate) > 0, "a squatter still gains energy");
  assert.ok(Math.abs(sleepRate + restAdjust("squatter", sleepRate) - sleepRate * BED_SPACE.squatterRestShare) < 1e-9);
  assert.equal(restAdjust("owner", sleepRate), BED_SPACE.ownerRestBonus);
});

test("a handout adds study once per class and marks in that course's test", () => {
  const record = emptyAdminRecord();
  const course = tt.courses[0];
  const week = 2;
  assert.equal(handoutClassStudy(record, week, course.code, 11), 0);
  assert.equal(handoutTestMarks(record, week, course), 0);
  const buy = tryBuyHandout(record, week, tt.courses, course.code, "copy", HANDOUT.copyPrice);
  assert.deepEqual(buy, { ok: true, price: HANDOUT.copyPrice, favour: false });
  addHandout(record, week, course.code, "copy");
  assert.equal(handoutClassStudy(record, week, course.code, 11), HANDOUT.classStudy);
  assert.equal(handoutClassStudy(record, week, course.code, 11), 0);
  assert.equal(handoutClassStudy(record, week, course.code, 12), HANDOUT.classStudy);
  assert.equal(handoutTestMarks(record, week, course), HANDOUT.testMarks);
  assert.equal(handoutTestMarks(record, week + 1, course), 0);
  assert.equal(tryBuyHandout(record, week, tt.courses, course.code, "rep", RICH).ok, false);
  assert.equal(tryBuyHandout(record, week, tt.courses, "XXX 999", "rep", RICH).ok, false);
  assert.equal(tryBuyHandout(record, week, tt.courses, tt.courses[1].code, "rep", HANDOUT.repPrice - 1).ok, false);
  const lover = tt.courses.find(lovesHandouts);
  assert.ok(lover, "some lecturer loves handouts");
  const fan = emptyAdminRecord();
  addHandout(fan, week, lover.code, "rep");
  assert.equal(handoutTestMarks(fan, week, lover), HANDOUT.testMarks + HANDOUT.favourMarks);
});

test("each paper in a semester is on a different course from the student's own list", () => {
  for (let week = 0; week < 8; week++) {
    const courses = testCoursesFor(tt, week);
    assert.equal(courses.length, PAPER_DAYS.length);
    assert.equal(new Set(courses.map((c) => c.code)).size, PAPER_DAYS.length);
    for (const c of courses) assert.ok(tt.courses.includes(c));
    PAPER_DAYS.forEach((weekday, i) => assert.equal(testCourseOn(tt, week * 7 + weekday), courses[i]));
    assert.equal(testCourseOn(tt, week * 7), undefined, "no paper in registration");
    assert.equal(testCourseOn(tt, week * 7 + 6), undefined, "no paper in the break");
  }
});

test("the result slip adds up and a fail is flagged once as a carry-over", () => {
  const record = emptyAdminRecord();
  const week = 5;
  const [a, b, c] = tt.courses;
  assert.equal(recordResult(record, week, 0, a, 72).carried, false);
  assert.equal(recordResult(record, week, 1, b, 39.6).carried, false);
  assert.equal(recordResult(record, week, 2, c, 12).carried, true);
  assert.equal(recordResult(record, week, 2, c, 20).carried, false);
  const slip = resultSlip(record, week);
  assert.deepEqual(slip.rows.map((r) => [r.code, r.score, r.grade, r.remark]), [
    [a.code, 72, "A", "Pass"],
    [b.code, 40, "E", "Pass"],
    [c.code, 20, "F", "Carry over"],
  ]);
  const units = a.units + b.units + c.units;
  const points = a.units * gradeFor(72).gp + b.units * gradeFor(40).gp;
  assert.equal(slip.units, units);
  assert.equal(slip.points, points);
  assert.equal(slip.gpa, Math.round((points / units) * 100) / 100);
  assert.equal(slip.carried, 1);
  assert.deepEqual(record.carry, [{ code: c.code, week: week + 1 }]);
  assert.deepEqual(resultSlip(record, week + 1), { week: week + 1, rows: [], units: 0, points: 0, gpa: 0, carried: 0 });
});

test("a carry-over adds exactly one extra class in a free slot before 16:00", () => {
  const record = emptyAdminRecord();
  const course = tt.courses[3];
  const week = 9;
  recordResult(record, week - 1, 1, course, 10);
  assert.equal(timetableWithCarryOvers(tt, record, week - 1), tt);
  const next = timetableWithCarryOvers(tt, record, week);
  assert.equal(next.slots.length, tt.slots.length + 1);
  const extra = next.slots.filter((s) => !tt.slots.includes(s));
  assert.equal(extra.length, 1);
  assert.equal(extra[0].course, course);
  assert.ok(extra[0].weekday >= 0 && extra[0].weekday < 5);
  assert.ok(extra[0].slot >= 0 && extra[0].slot < SLOTS_PER_DAY);
  assert.ok(CLASS_START_HOURS[extra[0].slot] < 16);
  assert.equal(tt.slots.some((s) => s.weekday === extra[0].weekday && s.slot === extra[0].slot), false);
  assert.ok(PLACES[extra[0].place]);
  assert.deepEqual(carryOverSlots(tt, [course.code], week), carryOverSlots(tt, [course.code], week));
  const many = carryOverSlots(tt, tt.courses.map((c) => c.code), week);
  const all = [...tt.slots, ...many].map((s) => s.weekday * SLOTS_PER_DAY + s.slot);
  assert.equal(new Set(all).size, all.length, "no two classes share a slot");
  assert.equal(timetableWithCarryOvers(tt, record, week + 1), tt);
});

test("a new week clears the bed, registration, handouts and old carry-overs", () => {
  const record = emptyAdminRecord();
  record.bed = { week: 3, hall: BED_HALLS[0].name };
  record.reg = { week: 3, late: false, by: "portal" };
  addHandout(record, 3, tt.courses[0].code, "rep");
  recordResult(record, 3, 0, tt.courses[0], 10);
  assert.equal(rollAdminWeek(record, 3), false);
  assert.equal(rollAdminWeek(record, 4), true);
  assert.equal(record.bed, null);
  assert.equal(record.reg, null);
  assert.deepEqual(record.handouts.held, []);
  assert.equal(record.carry.length, 1);
  assert.equal(record.results.length, 1);
  rollAdminWeek(record, 5);
  assert.equal(record.carry.length, 0);
  assert.equal(record.results.length, 0);
});

test("a saved record survives a round trip and junk falls back to defaults", () => {
  const record = emptyAdminRecord();
  record.bed = { week: 3, hall: BED_HALLS[0].name };
  record.reg = { week: 3, late: true, by: "centre" };
  addHandout(record, 3, tt.courses[0].code, "rep");
  recordResult(record, 3, 0, tt.courses[0], 10);
  finishHustle(record, "typing", 21);
  assert.deepEqual(sanitizeAdminRecord(JSON.parse(JSON.stringify(record))), record);
  assert.deepEqual(sanitizeAdminRecord({}), emptyAdminRecord());
  assert.deepEqual(sanitizeAdminRecord({ bed: 5, reg: "x", results: [1, { code: 7 }], carry: "no", skills: { typing: 900 } }).skills.typing, 100);
  assert.deepEqual(sanitizeAdminRecord(null), emptyAdminRecord());
  assert.equal(parseAdminAction({ a: "ballot", hall: 1.5 }), undefined);
  assert.equal(parseAdminAction({ a: "hustle", id: "rob" }), undefined);
  assert.deepEqual(parseAdminAction({ a: "copy", code: "CSC 201", extra: 1 }), { a: "copy", code: "CSC 201" });
});

test("business centres and hostel pitches stand clear of roads and buildings", () => {
  assert.ok(BUSINESS_CENTRES.length >= 5, `${BUSINESS_CENTRES.length} business centres`);
  for (const stall of BUSINESS_CENTRES) {
    assert.equal(stall.style, "kiosk");
    const spot = SPOTS[stall.spot];
    assert.equal(isBlocked(spot.sx, spot.sy), false);
    assert.equal(hustleSite("typing", spot.sx, spot.sy) !== undefined, true);
  }
  assert.equal(HOSTEL_PITCHES.length, BED_HALLS.length);
  for (const pitch of HOSTEL_PITCHES) {
    assert.equal(isBlocked(pitch.at.x, pitch.at.y), false, `${pitch.name} pitch is blocked`);
    assert.equal(onRoad(pitch.at.x, pitch.at.y, PX_PER_METER), false, `${pitch.name} pitch is on a road`);
    for (const stall of STALLS) assert.ok(Math.hypot(stall.x - pitch.at.x, stall.y - pitch.at.y) > 4 * PX_PER_METER);
    assert.equal(hustleSite("tray", pitch.at.x, pitch.at.y), pitch.place);
    assert.equal(hustleSite("hair", pitch.at.x, pitch.at.y), undefined);
  }
});

test("each hustle pays by skill and keeps to its hours, days, energy and daily limit", () => {
  const monday = gameTime(at(2, 0, 10 * 60));
  const saturday = gameTime(at(2, 5, 10 * 60));
  for (const id of HUSTLE_IDS) {
    const spec = HUSTLES[id];
    const open = id === "hair" ? saturday : monday;
    const record = emptyAdminRecord();
    assert.equal(hustleRefusal(id, record, open, 100), undefined);
    assert.ok(hustleRefusal(id, record, open, spec.energy), "too tired");
    assert.ok(hustleRefusal(id, record, gameTime(at(2, 5, 2 * 60)), 100), "closed at night");
    for (let n = 0; n < spec.dailyShifts; n++) finishHustle(record, id, open.dayIndex);
    assert.ok(hustleRefusal(id, record, open, 100), "daily limit");
    assert.equal(hustleRefusal(id, record, gameTime(open.total + 7 * MINUTES_PER_DAY), 100), undefined);
    assert.equal(record.skills[id], Math.min(100, spec.dailyShifts * spec.skillGain));
    assert.ok(spec.seconds > 0 && spec.energy > 0 && spec.basePay > 0);
  }
  assert.ok(hustleRefusal("hair", emptyAdminRecord(), monday, 100), "hair is weekend work");
  assert.equal(hustlePay("typing", 0, 0, monday), HUSTLES.typing.basePay);
  assert.equal(hustlePay("typing", 50, 0, monday), Math.round(HUSTLES.typing.basePay * skillPay(50)));
  assert.equal(hustlePay("hair", 100, 0, saturday), HUSTLES.hair.basePay * 2);
  const hall = BED_HALLS[0].place;
  assert.equal(trayCustomers(hall, monday.dayIndex, 19), trayCustomers(hall, monday.dayIndex, 19));
  assert.equal(trayCustomers(hall, monday.dayIndex, 3), 0);
  let evening = 0;
  let noon = 0;
  for (let day = 0; day < 60; day++) {
    evening += trayCustomers(hall, day, 19);
    noon += trayCustomers(hall, day, 11);
  }
  assert.ok(evening > noon * 2, "evening rush beats midday");
  const evening7 = gameTime(at(2, 0, 19 * 60));
  assert.equal(hustlePay("tray", 0, hall, evening7), trayCustomers(hall, evening7.dayIndex, 19) * HUSTLES.tray.basePay);
  assert.equal(adminWeekOf(evening7.total), 2);
});
