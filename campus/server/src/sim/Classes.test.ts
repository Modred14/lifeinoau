import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTENDANCE_MINUTES, EVENTS, MINUTES_PER_DAY, REAL_SECONDS_PER_GAME_MINUTE, SHEET_WINDOW_MINUTES, classesOn, courseAttendance, gameTime, timetableFor, type ClassesPayload, type DayClass } from "@campuslife/shared";
import { ATTENDANCE_STUDY_POINTS, Classes, SNAP_QUESTIONS, TEST_ATTENDANCE_MARKS, type ClassStudent } from "./Classes";

const DEPARTMENT = "computer-science";
const LEVEL = "200L";
const SEARCH_DAYS = 400;
const SNAP_DEPARTMENT = "law";
const SNAP_LEVEL = "100L";
const timetable = timetableFor(DEPARTMENT, LEVEL);

function student(department = DEPARTMENT, level = LEVEL): ClassStudent {
  return { department, level, study: 0, weekStudy: 0, studySeconds: 0, attended: 0, weekAttended: 0, rusticatedUntil: 0, attendance: {} };
}

function desk(random?: () => number) {
  const notices: string[] = [];
  const sent: ClassesPayload[] = [];
  const classes = new Classes({ notify: (_id, text) => notices.push(text), send: (_id, payload) => sent.push(payload), random });
  return { classes, notices, sent };
}

function find(match: (c: DayClass) => boolean, from = timetable): { day: number; c: DayClass } {
  for (let day = 0; day < SEARCH_DAYS; day++) {
    const c = classesOn(from, day).find(match);
    if (c) return { day, c };
  }
  throw new Error("no such class in the search window");
}

const at = (day: number, minute: number) => gameTime(day * MINUTES_PER_DAY + minute);

function sit(classes: Classes, who: ClassStudent, day: number, c: DayClass, from: number, to: number, place = c.place) {
  for (let minute = from; minute < to; minute++) classes.tick("a", who, at(day, minute), REAL_SECONDS_PER_GAME_MINUTE, place);
}

test("sitting through a normal class signs attendance once", () => {
  const { day, c } = find((x) => x.status === "holds" && x.sheet === undefined && x.snap === undefined);
  const { classes, notices, sent } = desk();
  const who = student();
  classes.join("a", who, at(day, c.start - 40));
  sit(classes, who, day, c, c.start - 40, c.end);
  assert.equal(who.attended, 1);
  assert.equal(who.weekAttended, 1);
  assert.equal(who.study, ATTENDANCE_STUDY_POINTS);
  assert.deepEqual([courseAttendance(who.attendance, c.course.code).signed, courseAttendance(who.attendance, c.course.code).held], [1, 1]);
  assert.ok(notices.some((n) => n.includes("Your next class") && n.includes(c.course.code)));
  assert.ok(notices.some((n) => n.includes("Attendance signed")));
  assert.ok(sent.length >= 2);
  assert.ok(who.studySeconds > 0);
});

test("too little time, the wrong venue, or rustication signs nothing", () => {
  const { day, c } = find((x) => x.status === "holds" && x.sheet === undefined && x.snap === undefined);
  const short = student();
  const a = desk();
  a.classes.join("a", short, at(day, 0));
  sit(a.classes, short, day, c, c.begins, c.begins + ATTENDANCE_MINUTES - 5);
  assert.equal(short.attended, 0);
  const lost = student();
  const b = desk();
  b.classes.join("a", lost, at(day, 0));
  sit(b.classes, lost, day, c, c.start, c.end, c.place === 0 ? 1 : 0);
  assert.equal(lost.attended, 0);
  assert.deepEqual([courseAttendance(lost.attendance, c.course.code).signed, courseAttendance(lost.attendance, c.course.code).held], [0, 1]);
  const banned = { ...student(), rusticatedUntil: (day + 1) * MINUTES_PER_DAY };
  const d = desk();
  d.classes.join("a", banned, at(day, 0));
  sit(d.classes, banned, day, c, c.start, c.end);
  assert.equal(banned.attended, 0);
});

test("on a sheet day only students seated when it goes round get signed", () => {
  const { day, c } = find((x) => x.sheet !== undefined && x.sheet - x.begins >= 10);
  const early = student();
  const a = desk();
  a.classes.join("a", early, at(day, 0));
  sit(a.classes, early, day, c, c.begins, c.sheet! - 1);
  a.classes.tick("a", early, at(day, c.sheet!), REAL_SECONDS_PER_GAME_MINUTE);
  assert.equal(early.attended, 0);
  assert.ok(a.notices.some((n) => n.includes("sheet is going round")));
  const there = student();
  const b = desk();
  b.classes.join("a", there, at(day, 0));
  sit(b.classes, there, day, c, c.sheet!, c.sheet! + 1);
  assert.equal(there.attended, 1);
});

test("late and no-show classes tell the students and a no-show never counts", () => {
  const late = find((x) => x.status === "late");
  const a = desk();
  const who = student();
  a.classes.join("a", who, at(late.day, 0));
  sit(a.classes, who, late.day, late.c, late.c.start, late.c.begins + 1);
  assert.ok(a.notices.some((n) => n.includes("wait small")));
  assert.ok(a.notices.some((n) => n.includes("don enter")));
  assert.equal(who.studySeconds, REAL_SECONDS_PER_GAME_MINUTE);
  const gone = find((x) => x.status === "noshow");
  const b = desk();
  const other = student();
  b.classes.join("a", other, at(gone.day, 0));
  sit(b.classes, other, gone.day, gone.c, gone.c.start, gone.c.end);
  assert.ok(b.notices.some((n) => n.includes("make una go")));
  assert.equal(other.attended, 0);
  assert.equal(courseAttendance(other.attendance, gone.c.course.code).held, 0);
});

test("a snap test pays study points from the roll", () => {
  const { day, c } = find((x) => x.snap !== undefined, timetableFor(SNAP_DEPARTMENT, SNAP_LEVEL));
  const a = desk(() => 0);
  const who = student(SNAP_DEPARTMENT, SNAP_LEVEL);
  a.classes.join("a", who, at(day, 0));
  sit(a.classes, who, day, c, c.snap!, c.snap! + 3);
  assert.ok(a.notices.some((n) => n.includes(`${SNAP_QUESTIONS}/${SNAP_QUESTIONS}`)));
  assert.ok(who.study >= SNAP_QUESTIONS);
  assert.equal(a.notices.filter((n) => n.includes("Snap test")).length, 1);
});

test("missing classes drops a course under the rule and costs test marks", () => {
  const who = student();
  const a = desk();
  const code = timetable.slots.find((s) => !s.course.gst)!.course.code;
  let held = 0;
  for (let day = 0; day < SEARCH_DAYS && held < 3; day++) {
    for (const c of classesOn(timetable, day)) {
      if (c.course.code !== code || c.status === "noshow") continue;
      a.classes.tick("a", who, at(day, 0), REAL_SECONDS_PER_GAME_MINUTE);
      a.classes.tick("a", who, at(day, c.end - 1), REAL_SECONDS_PER_GAME_MINUTE);
      held++;
    }
  }
  assert.equal(courseAttendance(who.attendance, code).held, 3);
  assert.ok(a.notices.some((n) => n.includes("attendance is 0%")));
  assert.ok(a.classes.penalty(who) > 0);
  assert.equal(a.classes.penalty(student()), 0);
});

test("a student who joins as a class is ending is not charged for it", () => {
  const { day, c } = find((x) => x.status === "holds");
  const who = student();
  const a = desk();
  a.classes.join("a", who, at(day, c.end - 10));
  sit(a.classes, who, day, c, c.end - 10, c.end, -1);
  assert.equal(courseAttendance(who.attendance, c.course.code).held, 0);
});

const examStart = EVENTS.find((e) => e.id === "exam")!.start;
const holding = (list: readonly DayClass[]) => list.filter((x) => x.status !== "noshow");

test("rejoining under another department keeps the old attendance record", () => {
  const { day, c } = find((x) => x.status === "holds");
  const who = student();
  const a = desk();
  a.classes.join("a", who, at(day, 0));
  sit(a.classes, who, day, c, c.start, c.end, -1);
  assert.equal(courseAttendance(who.attendance, c.course.code).held, 1);
  a.classes.leave("a");
  who.department = SNAP_DEPARTMENT;
  a.classes.join("a", who, at(day + 1, 0));
  a.classes.leave("a");
  who.department = DEPARTMENT;
  a.classes.join("a", who, at(day + 1, 0));
  assert.deepEqual([courseAttendance(who.attendance, c.course.code).signed, courseAttendance(who.attendance, c.course.code).held], [0, 1]);
});

test("the daily test attendance marks follow the share of the day's classes attended", () => {
  const free = Array.from({ length: SEARCH_DAYS }, (_, day) => day).find((day) => day % 7 < 5 && holding(classesOn(timetable, day)).length === 0)!;
  const idle = desk();
  assert.equal(idle.classes.testMarks("a", student(), at(free, examStart)), TEST_ATTENDANCE_MARKS);
  assert.equal(idle.classes.testMarks("a", student(), at(5, examStart)), TEST_ATTENDANCE_MARKS);
  const plain = (x: DayClass) => x.status === "holds" && x.sheet === undefined;
  const one = Array.from({ length: SEARCH_DAYS }, (_, day) => day).find((day) => holding(classesOn(timetable, day)).length === 1 && classesOn(timetable, day).some(plain))!;
  const only = classesOn(timetable, one).find(plain)!;
  const keen = student();
  const a = desk();
  a.classes.join("a", keen, at(one, 0));
  sit(a.classes, keen, one, only, only.start, only.end);
  assert.equal(a.classes.testMarks("a", keen, at(one, examStart)), TEST_ATTENDANCE_MARKS);
  const lazy = student();
  const b = desk();
  b.classes.join("a", lazy, at(one, 0));
  assert.equal(b.classes.testMarks("a", lazy, at(one, examStart)), 0);
  const two = Array.from({ length: SEARCH_DAYS }, (_, day) => day).find((day) => holding(classesOn(timetable, day)).length === 2 && classesOn(timetable, day).some(plain))!;
  const half = student();
  const d = desk();
  d.classes.join("a", half, at(two, 0));
  const first = classesOn(timetable, two).find(plain)!;
  sit(d.classes, half, two, first, first.start, first.end);
  assert.equal(d.classes.testMarks("a", half, at(two, examStart)), TEST_ATTENDANCE_MARKS / 2);
});

test("the classes payload is sent again when the client asks", () => {
  const a = desk();
  const who = student();
  a.classes.resend("a", who);
  assert.equal(a.sent.length, 0);
  a.classes.join("a", who, at(0, 0));
  for (let minute = 0; minute < 10; minute++) a.classes.tick("a", who, at(0, minute), REAL_SECONDS_PER_GAME_MINUTE);
  assert.equal(a.sent.length, 1);
  a.classes.resend("a", who);
  assert.equal(a.sent.length, 2);
  assert.equal(a.sent[1].department, DEPARTMENT);
});

test("leaving and rejoining during a snap test does not give a second go", () => {
  const { day, c } = find((x) => x.snap !== undefined, timetableFor(SNAP_DEPARTMENT, SNAP_LEVEL));
  const a = desk(() => 0);
  const who = student(SNAP_DEPARTMENT, SNAP_LEVEL);
  a.classes.join("a", who, at(day, 0));
  sit(a.classes, who, day, c, c.snap!, c.snap! + 2);
  const study = who.study;
  a.classes.leave("a");
  who.attendance = JSON.parse(JSON.stringify(who.attendance));
  a.classes.join("a", who, at(day, c.snap! + 2));
  sit(a.classes, who, day, c, c.snap! + 2, c.snap! + 5);
  assert.equal(a.notices.filter((n) => n.includes("Snap test")).length, 1);
  assert.ok(who.study - study < SNAP_QUESTIONS);
});

test("a sheet class only counts against a student who was online while the sheet went round", () => {
  const { day, c } = find((x) => x.sheet !== undefined && x.end - (x.sheet + SHEET_WINDOW_MINUTES) > ATTENDANCE_MINUTES + 25);
  const after = student();
  const a = desk();
  const arrive = c.sheet! + SHEET_WINDOW_MINUTES;
  a.classes.join("a", after, at(day, arrive));
  sit(a.classes, after, day, c, arrive, c.end);
  assert.equal(courseAttendance(after.attendance, c.course.code).held, 0);
  const during = student();
  const b = desk();
  b.classes.join("a", during, at(day, arrive - 1));
  sit(b.classes, during, day, c, arrive - 1, c.end, -1);
  assert.deepEqual([courseAttendance(during.attendance, c.course.code).signed, courseAttendance(during.attendance, c.course.code).held], [0, 1]);
});
