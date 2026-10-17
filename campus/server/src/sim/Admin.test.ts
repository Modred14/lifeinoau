import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BED_HALLS,
  BED_SPACE,
  ORDINARY_HOURS,
  BUSINESS_CENTRES,
  HANDOUT,
  HOSTEL_PITCHES,
  HUSTLES,
  INTERIORS,
  MINUTES_PER_DAY,
  PORTER_RAID,
  REGISTRATION,
  SPOTS,
  ballotWindow,
  ballotWins,
  classesOn,
  emptyAdminRecord,
  gameTime,
  hustlePay,
  markSigned,
  portalStatus,
  raidFor,
  testCourseOn,
  timetableFor,
  trayCustomers,
  type AdminPayload,
  type GameTime,
  type Point,
} from "@campuslife/shared";
import { AdminDesk, type AdminStudent } from "./Admin";
import { Classes } from "./Classes";
import { drawSecret } from "./secret";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const WEEK = 7 * MINUTES_PER_DAY;
const tt = timetableFor(DEPARTMENT, LEVEL);
const at = (week: number, weekday: number, minute: number): GameTime => gameTime(week * WEEK + weekday * MINUTES_PER_DAY + minute);

function student(key = "player-key-1", cash = 20000): AdminStudent {
  return { x: 0, y: 0, cash, energy: 80, study: 0, weekStudy: 0, department: DEPARTMENT, level: LEVEL, attendance: {}, admin: emptyAdminRecord(), profileId: key, ride: -1, driving: -1 };
}

function desk() {
  const notices: string[] = [];
  const sent: AdminPayload[] = [];
  const evicted: Point[] = [];
  const students = new Map<string, AdminStudent>();
  let saves = 0;
  const admin = new AdminDesk({
    notify: (_id, text) => notices.push(text),
    send: (_id, payload) => sent.push(payload),
    earn: (id, amount) => {
      const who = students.get(id);
      if (who) who.cash += amount;
      return amount;
    },
    changed: () => saves++,
    evict: (id, to) => {
      const who = students.get(id);
      if (who) who.act = undefined;
      evicted.push(to);
    },
  });
  const seat = (id: string, who: AdminStudent, now: GameTime) => {
    students.set(id, who);
    admin.join(id, who, now);
  };
  return { admin, notices, sent, evicted, seat, saves: () => saves };
}

function minuteWhere(week: number, want: "up" | "down", from: number, to: number): GameTime {
  for (let m = from; m < to; m++) if (portalStatus(week * WEEK + m).state === want) return gameTime(week * WEEK + m);
  throw new Error(`no ${want} minute`);
}

const standAt = (who: AdminStudent, p: Point) => {
  who.x = p.x;
  who.y = p.y;
};
const centre = (): Point => ({ x: SPOTS[BUSINESS_CENTRES[0].spot].sx, y: SPOTS[BUSINESS_CENTRES[0].spot].sy });

test("the server registers on a good portal, refuses on a bad one and charges the late fine", () => {
  const { admin, notices, seat, sent } = desk();
  const who = student();
  const down = minuteWhere(1, "down", ORDINARY_HOURS.open, ORDINARY_HOURS.close);
  seat("a", who, down);
  admin.handle("a", who, { a: "register" }, down);
  assert.equal(who.admin.reg, null);
  assert.ok(notices.some((n) => n.includes("Service unavailable")));
  admin.handle("a", who, { a: "centre" }, down);
  assert.equal(who.admin.reg, null, "not at a business centre");
  standAt(who, centre());
  admin.handle("a", who, { a: "centre" }, down);
  assert.deepEqual(who.admin.reg, { week: 1, late: false, by: "centre" });
  assert.equal(who.cash, 20000 - REGISTRATION.centreFee);
  assert.deepEqual(sent.at(-1)?.record.reg, who.admin.reg);

  const late = student("player-key-2");
  const after = minuteWhere(1, "up", REGISTRATION.closeMinute, WEEK);
  seat("b", late, after);
  admin.tick("b", late, after, 1);
  admin.tick("b", late, after, 1);
  assert.equal(notices.filter((n) => n.includes("missed registration")).length, 1);
  assert.ok(notices.some((n) => n.includes("missed registration")));
  admin.handle("b", late, { a: "register" }, after);
  assert.deepEqual(late.admin.reg, { week: 1, late: true, by: "portal" });
  assert.equal(late.cash, 20000 - REGISTRATION.lateFine);
  admin.handle("b", late, { a: "register" }, after);
  assert.equal(late.cash, 20000 - REGISTRATION.lateFine, "no double charge");
  admin.handle("b", late, { a: "nonsense" }, after);
  admin.handle("b", late, null, after);
});

test("an unregistered student loses marks in the test and hears from the course adviser", () => {
  const { admin, notices, seat } = desk();
  const who = student();
  const monday = at(2, 0, 16 * 60 + 10);
  const thursday = at(2, 3, 16 * 60 + 10);
  seat("a", who, monday);
  assert.equal(admin.testMarks("a", who, monday), 0);
  assert.equal(admin.testMarks("a", who, thursday), -REGISTRATION.testPenalty);
  assert.ok(notices.some((n) => n.includes("Course adviser")));
  const course = testCourseOn(tt, thursday.dayIndex);
  assert.ok(course);
  who.admin.reg = { week: 2, late: true, by: "portal" };
  admin.handle("a", who, { a: "handout", code: course.code }, thursday);
  assert.equal(who.cash, 20000 - HANDOUT.repPrice);
  assert.ok(admin.testMarks("a", who, thursday) >= HANDOUT.testMarks);
});

test("the ballot gives beds to winners only, never more than a hall holds, once a week", () => {
  const week = 4;
  const hall = BED_HALLS[0];
  const open = gameTime(week * WEEK + ballotWindow().start + 1);
  const { admin, notices, seat } = desk();
  let winners = 0;
  let drawn = 0;
  for (let i = 0; i < 60; i++) {
    const key = `ballot-player-${i}`;
    const who = student(key);
    seat(key, who, open);
    admin.handle(key, who, { a: "ballot", hall: hall.place }, open);
    const lucky = ballotWins(week, hall.place, key, drawSecret());
    if (lucky) drawn++;
    if (who.admin.bed) {
      winners++;
      assert.equal(lucky, true);
      assert.equal(who.cash, 20000 - BED_SPACE.fee);
      assert.deepEqual(who.admin.bed, { week, hall: hall.name });
    } else assert.equal(who.cash, 20000, "losers pay nothing");
    assert.equal(who.admin.ballot.tried, true);
    admin.handle(key, who, { a: "ballot", hall: BED_HALLS[1].place }, open);
    assert.equal(who.admin.bed?.hall ?? hall.name, hall.name, "one try a week");
  }
  assert.ok(drawn > hall.beds, "more lucky tickets than beds in this sample");
  assert.equal(winners, hall.beds);
  assert.equal(admin.bedsHeld(week, hall.place), hall.beds);
  assert.ok(notices.some((n) => n.includes("Bed spaces exhausted")));

  const broke = student("ballot-broke", BED_SPACE.fee - 1);
  seat("broke", broke, open);
  admin.handle("broke", broke, { a: "ballot", hall: BED_HALLS[2].place }, open);
  assert.equal(broke.admin.ballot.tried, false, "no cash does not burn the try");
  const closed = gameTime(week * WEEK + 3 * MINUTES_PER_DAY);
  admin.handle("broke", broke, { a: "ballot", hall: BED_HALLS[2].place }, closed);
  assert.equal(broke.admin.bed, null);
});

test("a ballot in the calendar window wins a bed, and a bed owner rests better than a squatter", () => {
  const week = 6;
  const { admin, seat, evicted } = desk();
  const hall = BED_HALLS[2];
  const bed = SPOTS.findIndex((s) => s.kind === "sleep" && s.place === hall.place);
  assert.ok(bed >= 0);
  const joinAt = gameTime(week * WEEK + ballotWindow().start);
  const key = Array.from({ length: 400 }, (_, i) => `fresh-${i}`).find((k) => ballotWins(week, hall.place, k, drawSecret()));
  assert.ok(key);
  const owner = student(key);
  seat("o", owner, joinAt);
  assert.deepEqual(owner.admin.ballot, { week, from: joinAt.total, tried: false });
  admin.handle("o", owner, { a: "ballot", hall: hall.place }, gameTime(joinAt.total + 10));
  assert.deepEqual(owner.admin.bed, { week, hall: hall.name });

  const squatter = student("squat-1");
  seat("s", squatter, joinAt);
  const noon = at(week, 3, 13 * 60);
  owner.energy = squatter.energy = 10;
  owner.act = { spot: bed, kind: "sleep" };
  squatter.act = { spot: bed, kind: "sleep" };
  for (let s = 0; s < 10; s++) {
    admin.tick("o", owner, noon, 1);
    admin.tick("s", squatter, noon, 1);
  }
  assert.ok(Math.abs(owner.energy - (10 + 10 * BED_SPACE.ownerRestBonus)) < 1e-9);
  assert.ok(Math.abs(squatter.energy - (10 - 10 * 1.4 * (1 - BED_SPACE.squatterRestShare))) < 1e-9);
  assert.equal(evicted.length, 0);
});

test("the porter catches a squatter once on a raid night, never the bed owner", () => {
  const hall = BED_HALLS[3];
  const bed = SPOTS.findIndex((s) => s.kind === "sleep" && s.place === hall.place);
  let day = 0;
  while (!raidFor(day, hall.place).raid) day++;
  const roll = raidFor(day, hall.place);
  const week = Math.floor(day / 7);
  const now = gameTime(day * MINUTES_PER_DAY + roll.start + 1);
  const { admin, notices, evicted, seat } = desk();
  const squatter = student("squat-2", 1000);
  const owner = student("owner-2");
  owner.admin.bed = { week, hall: hall.name };
  seat("s", squatter, now);
  seat("o", owner, now);
  squatter.act = { spot: bed, kind: "sleep" };
  owner.act = { spot: bed, kind: "sleep" };
  admin.tick("s", squatter, now, 1);
  admin.tick("o", owner, now, 1);
  assert.equal(evicted.length, 1);
  assert.equal(INTERIORS[hall.place] !== undefined && evicted[0].x < INTERIORS[hall.place]!.ox, true, "moved to the door outside");
  assert.equal(squatter.cash, 1000 - PORTER_RAID.fine);
  assert.equal(squatter.act, undefined);
  assert.ok(owner.act);
  assert.ok(notices.some((n) => n.includes("Porter")));
  squatter.act = { spot: bed, kind: "sleep" };
  admin.tick("s", squatter, gameTime(now.total + 2), 1);
  assert.equal(evicted.length, 1, "only one raid a night, sleep is still allowed");
  assert.ok(squatter.act);

  const poor = student("squat-3", 100);
  seat("p", poor, now);
  poor.act = { spot: bed, kind: "sleep" };
  admin.tick("p", poor, now, 1);
  assert.equal(poor.cash, 0, "the fine never goes below zero");
});

test("holding the handout adds study when attendance is signed, once per class", () => {
  let day = 14;
  while (classesOn(tt, day).length === 0) day++;
  const c = classesOn(tt, day)[0];
  const now = gameTime(day * MINUTES_PER_DAY + c.begins + 50);
  const { admin, notices, seat } = desk();
  const who = student();
  const plain = student("player-key-9");
  seat("a", who, now);
  seat("b", plain, now);
  admin.handle("a", who, { a: "copy", code: c.course.code }, now);
  assert.equal(who.admin.handouts.held.length, 0, "photocopy needs a business centre");
  standAt(who, centre());
  admin.handle("a", who, { a: "copy", code: c.course.code }, now);
  assert.equal(who.cash, 20000 - HANDOUT.copyPrice);
  admin.tick("a", who, now, 1);
  assert.equal(who.study, 0, "nothing before the class is signed");
  markSigned(who.attendance, c.course.code, c.session);
  markSigned(plain.attendance, c.course.code, c.session);
  admin.tick("a", who, now, 1);
  admin.tick("a", who, now, 1);
  admin.tick("b", plain, now, 1);
  assert.equal(who.study, HANDOUT.classStudy);
  assert.equal(who.weekStudy, HANDOUT.classStudy);
  assert.equal(plain.study, 0);
  assert.equal(notices.filter((n) => n.includes("handout helped")).length, 1);
});

test("a failed test writes the slip and puts one carry-over class in next week's timetable", () => {
  const { admin, notices, seat, sent } = desk();
  const who = student();
  const week = 8;
  const wednesday = at(week, 2, 17 * 60);
  seat("a", who, wednesday);
  const course = testCourseOn(tt, wednesday.dayIndex);
  assert.ok(course);
  admin.testDone("a", who, 31, wednesday);
  assert.deepEqual(who.admin.results.at(-1), { week, weekday: 2, code: course.code, title: course.title, units: course.units, score: 31 });
  assert.deepEqual(who.admin.carry, [{ code: course.code, week: week + 1 }]);
  assert.ok(notices.some((n) => n.includes("Carry over")));
  assert.ok(notices.some((n) => n.includes("carry-over")));
  assert.equal(sent.at(-1)?.record.results.length, 1);
  assert.equal(admin.timetable(who, wednesday).slots.length, tt.slots.length);
  const nextWeek = at(week + 1, 0, 60);
  const extra = admin.timetable(who, nextWeek).slots.filter((s) => !tt.slots.includes(s));
  assert.equal(extra.length, 1);
  assert.equal(extra[0].course.code, course.code);

  const classes = new Classes({ notify: () => {}, send: () => {}, timetable: (_id, now) => admin.timetable(who, now) });
  const classDay = (week + 1) * 7 + extra[0].weekday;
  const whoClass = { ...who, studySeconds: 0, attended: 0, weekAttended: 0, rusticatedUntil: 0 };
  classes.join("a", whoClass, gameTime(classDay * MINUTES_PER_DAY));
  assert.equal(classes.today("a").filter((x) => x.course.code === course.code).length, classesOn(tt, classDay).filter((x) => x.course.code === course.code).length + 1);

  admin.testDone("a", who, 80, at(week, 3, 17 * 60));
  assert.equal(who.admin.carry.length, 1, "a pass adds no carry-over");
});

test("typing at a business centre pays by skill after the full shift and costs energy", () => {
  const { admin, notices, seat, sent } = desk();
  const who = student();
  const now = at(3, 1, 10 * 60);
  seat("a", who, now);
  admin.handle("a", who, { a: "hustle", id: "typing" }, now);
  assert.ok(notices.some((n) => n.includes("business centre")), "must stand at a centre");
  standAt(who, centre());
  who.act = { spot: 0, kind: "sit" };
  admin.handle("a", who, { a: "hustle", id: "typing" }, now);
  assert.equal(sent.at(-1)?.shift, undefined, "busy students cannot start");
  who.act = undefined;
  admin.handle("a", who, { a: "hustle", id: "typing" }, now);
  assert.deepEqual(sent.at(-1)?.shift, { id: "typing", left: HUSTLES.typing.seconds });
  for (let s = 0; s < HUSTLES.typing.seconds - 1; s++) admin.tick("a", who, now, 1);
  assert.equal(who.cash, 20000);
  admin.tick("a", who, now, 1);
  assert.equal(who.cash, 20000 + HUSTLES.typing.basePay);
  assert.ok(Math.abs(who.energy - (80 - HUSTLES.typing.energy)) < 1e-6);
  assert.equal(who.admin.skills.typing, HUSTLES.typing.skillGain);
  assert.equal(sent.at(-1)?.shift, undefined);

  admin.handle("a", who, { a: "hustle", id: "typing" }, now);
  for (let s = 0; s < HUSTLES.typing.seconds; s++) admin.tick("a", who, now, 1);
  assert.equal(who.cash, 20000 + HUSTLES.typing.basePay + hustlePay("typing", HUSTLES.typing.skillGain, 0, now));

  admin.handle("a", who, { a: "hustle", id: "typing" }, now);
  who.x += 400;
  admin.tick("a", who, now, 1);
  assert.ok(notices.some((n) => n.includes("No pay")));
  assert.equal(who.admin.hustle.done.typing, 2);
});

test("the recharge tray pays by foot traffic and hair is weekend work inside a hostel", () => {
  const { admin, notices, seat } = desk();
  const who = student();
  const pitch = HOSTEL_PITCHES[0];
  const evening = at(3, 2, 19 * 60);
  seat("a", who, evening);
  standAt(who, pitch.at);
  admin.handle("a", who, { a: "hustle", id: "tray" }, evening);
  for (let s = 0; s < HUSTLES.tray.seconds; s++) admin.tick("a", who, evening, 1);
  assert.equal(who.cash, 20000 + trayCustomers(pitch.place, evening.dayIndex, 19) * HUSTLES.tray.basePay);
  assert.equal(who.admin.hustle.done.tray, 1);

  const inside = INTERIORS[BED_HALLS[0].place];
  assert.ok(inside);
  standAt(who, inside.entry);
  const cashBefore = who.cash;
  admin.handle("a", who, { a: "hustle", id: "hair" }, evening);
  assert.ok(notices.some((n) => n.includes("weekend")));
  const saturday = at(3, 5, 11 * 60);
  admin.handle("a", who, { a: "hustle", id: "hair" }, saturday);
  for (let s = 0; s < HUSTLES.hair.seconds; s++) admin.tick("a", who, saturday, 1);
  assert.equal(who.cash, cashBefore + HUSTLES.hair.basePay);
  for (let shift = 1; shift < HUSTLES.hair.dailyShifts; shift++) {
    who.energy = 80;
    admin.handle("a", who, { a: "hustle", id: "hair" }, saturday);
    for (let s = 0; s < HUSTLES.hair.seconds; s++) admin.tick("a", who, saturday, 1);
  }
  who.energy = 80;
  const full = who.cash;
  admin.handle("a", who, { a: "hustle", id: "hair" }, saturday);
  for (let s = 0; s < HUSTLES.hair.seconds; s++) admin.tick("a", who, saturday, 1);
  assert.equal(who.cash, full, "daily limit reached");
  assert.equal(who.admin.hustle.done.hair, HUSTLES.hair.dailyShifts);
});
