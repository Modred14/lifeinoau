import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BED_HALLS,
  BED_SPACE,
  BOYCOTT_TEXT,
  MINUTES_PER_DAY,
  REAL_SECONDS_PER_GAME_MINUTE,
  ballotWindow,
  ballotWins,
  classesOn,
  courseAttendance,
  emptyAdminRecord,
  gameTime,
  timetableFor,
  timetableWithCarryOvers,
  type AdminPayload,
  type ClassesPayload,
  type DayClass,
  type GameTime,
} from "@campuslife/shared";
import { AdminDesk, type AdminStudent } from "./Admin";
import type { BedStore } from "./admin/types";
import { Classes, TEST_ATTENDANCE_MARKS, type ClassStudent } from "./Classes";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const SEARCH_DAYS = 400;
const WEEK = 7 * MINUTES_PER_DAY;
const START_CASH = 20000;
const tt = timetableFor(DEPARTMENT, LEVEL);
const at = (day: number, minute: number) => gameTime(day * MINUTES_PER_DAY + minute);

function pupil(): ClassStudent {
  return { department: DEPARTMENT, level: LEVEL, study: 0, weekStudy: 0, studySeconds: 0, attended: 0, weekAttended: 0, rusticatedUntil: 0, attendance: {} };
}

function plainDay(): { day: number; c: DayClass } {
  for (let day = 0; day < SEARCH_DAYS; day++) {
    const c = classesOn(tt, day).find((x) => x.status === "holds" && x.sheet === undefined && x.snap === undefined);
    if (c) return { day, c };
  }
  throw new Error("no plain class found");
}

function run(classes: Classes, who: ClassStudent, day: number, from: number, to: number, place = -1) {
  for (let minute = from; minute < to; minute++) classes.tick("a", who, at(day, minute), REAL_SECONDS_PER_GAME_MINUTE, place);
}

test("a boycott marks nothing as missed, toasts once and drops the attendance penalty", () => {
  const { day, c } = plainDay();
  let boycott = true;
  const notices: string[] = [];
  const sent: ClassesPayload[] = [];
  const classes = new Classes({ notify: (_id, text) => notices.push(text), send: (_id, payload) => sent.push(payload), boycott: () => boycott });
  const who = pupil();
  classes.join("a", who, at(day, 0));
  run(classes, who, day, 0, MINUTES_PER_DAY);
  assert.equal(notices.filter((n) => n === BOYCOTT_TEXT.toast).length, 1, "one boycott toast for the day");
  assert.equal(notices.length, 1, "no class reminders during a boycott");
  for (const course of tt.courses) assert.equal(courseAttendance(who.attendance, course.code).held, 0, `${course.code} was not counted`);
  assert.equal(classes.penalty(who), 0);
  assert.equal(classes.testMarks("a", who, at(day, c.end + 1)), TEST_ATTENDANCE_MARKS);

  boycott = false;
  const other = pupil();
  const again = new Classes({ notify: () => {}, send: () => {}, boycott: () => boycott });
  again.join("a", other, at(day, 0));
  run(again, other, day, 0, MINUTES_PER_DAY);
  assert.ok(courseAttendance(other.attendance, c.course.code).held >= 1, "without a boycott a skipped class is held against you");
});

test("a carry-over class from the admin timetable can be attended like any other", () => {
  const week = 6;
  const record = emptyAdminRecord();
  record.carry.push({ code: tt.courses[0].code, week });
  const mine = timetableWithCarryOvers(tt, record, week);
  const extra = mine.slots.find((s) => !tt.slots.some((b) => b.weekday === s.weekday && b.slot === s.slot));
  assert.ok(extra, "the carry-over took a free slot");
  const day = week * 7 + extra.weekday;
  const c = classesOn(mine, day).find((x) => x.course.code === extra.course.code && !classesOn(tt, day).some((b) => b.key === x.key));
  assert.ok(c, "the extra class is on that day");
  const classes = new Classes({ notify: () => {}, send: () => {}, timetable: () => mine });
  const who = pupil();
  classes.join("a", who, at(day, 0));
  assert.ok(classes.today("a").some((x) => x.key === c.key));
  if (c.status === "noshow") return;
  run(classes, who, day, c.start, c.end, c.place);
  assert.equal(courseAttendance(who.attendance, c.course.code).lastSigned, c.session);
});

function learner(key: string): AdminStudent {
  return { x: 0, y: 0, cash: START_CASH, energy: 80, study: 0, weekStudy: 0, department: DEPARTMENT, level: LEVEL, attendance: {}, admin: emptyAdminRecord(), profileId: key, ride: -1, driving: -1 };
}

function room(beds: BedStore | undefined) {
  const notices: string[] = [];
  const sent: AdminPayload[] = [];
  let saves = 0;
  const admin = new AdminDesk({ notify: (_id, text) => notices.push(text), send: (_id, payload) => sent.push(payload), earn: (_id, amount) => amount, changed: () => saves++, evict: () => {}, beds });
  return { admin, notices, saves: () => saves };
}

function sharedBeds(): BedStore & { rows: Map<string, string[]> } {
  const rows = new Map<string, string[]>();
  return {
    rows,
    async hallOf(week, accountId) {
      for (const [key, holders] of rows) if (key.startsWith(`${week}:`) && holders.includes(accountId)) return key.slice(key.indexOf(":") + 1);
      return undefined;
    },
    async claim(week, hall, beds, accountId) {
      const held = await this.hallOf(week, accountId);
      if (held !== undefined) return held === hall;
      const holders = rows.get(`${week}:${hall}`) ?? [];
      if (holders.length >= beds) return false;
      rows.set(`${week}:${hall}`, [...holders, accountId]);
      return true;
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("two rooms share one count of beds per hall", async () => {
  const week = 4;
  const hall = BED_HALLS[0];
  const open: GameTime = gameTime(week * WEEK + ballotWindow().start + 1);
  const store = sharedBeds();
  const rooms = [room(store), room(store)];
  const players: AdminStudent[] = [];
  for (let i = 0; i < 80; i++) {
    const key = `shared-bed-${i}`;
    const who = learner(key);
    players.push(who);
    const { admin } = rooms[i % 2];
    admin.join(key, who, open);
    admin.handle(key, who, { a: "ballot", hall: hall.place }, open);
  }
  await settle();
  const winners = players.filter((who) => who.admin.bed?.week === week);
  const lucky = players.filter((who) => ballotWins(week, hall.place, who.profileId));
  assert.ok(lucky.length > hall.beds, "more lucky tickets than beds in this sample");
  assert.equal(winners.length, hall.beds, "both rooms together hand out exactly the beds the hall has");
  assert.equal(store.rows.get(`${week}:${hall.name}`)?.length, hall.beds);
  for (const who of winners) assert.equal(who.cash, START_CASH - BED_SPACE.fee);
  for (const who of players) if (!who.admin.bed) assert.equal(who.cash, START_CASH, "losers pay nothing");
  assert.ok(rooms.some((r) => r.notices.some((n) => n.includes("Bed spaces exhausted"))));
  assert.ok(rooms[0].saves() > 0 && rooms[1].saves() > 0);

  const back = learner(winners[0].profileId);
  const fresh = room(store);
  fresh.admin.join("back", back, open);
  await settle();
  assert.deepEqual(back.admin.bed, { week, hall: hall.name }, "a held bed is restored from the shared table");
});

test("when the bed table is unreachable the room falls back to its own count", async () => {
  const week = 5;
  const hall = BED_HALLS[0];
  const open: GameTime = gameTime(week * WEEK + ballotWindow().start + 1);
  const broken: BedStore = { claim: () => Promise.reject(new Error("offline")), hallOf: () => Promise.reject(new Error("offline")) };
  const quiet = console.error;
  console.error = () => {};
  try {
    const { admin } = room(broken);
    let winners = 0;
    for (let i = 0; i < 60; i++) {
      const key = `offline-bed-${i}`;
      const who = learner(key);
      admin.join(key, who, open);
      admin.handle(key, who, { a: "ballot", hall: hall.place }, open);
      await settle();
      if (who.admin.bed) winners++;
    }
    assert.equal(winners, hall.beds);
  } finally {
    console.error = quiet;
  }
});
