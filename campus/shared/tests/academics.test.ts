import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTENDANCE_PENALTY_CAP,
  ATTENDANCE_PENALTY_MARKS,
  CLASS_MINUTES,
  LECTURE_DAYS,
  CLASS_START_HOURS,
  EVENTS,
  INTERIORS,
  LATE_MAX_MINUTES,
  LATE_MIN_MINUTES,
  PLACES,
  SHEET_WINDOW_MINUTES,
  attendancePenalty,
  attendancePercent,
  attendanceShare,
  belowAttendanceRule,
  classPhase,
  classesOn,
  courseAttendance,
  coursePrefix,
  lecturesFor,
  markHeld,
  markSigned,
  markSnap,
  parseClassesPayload,
  rollClass,
  sanitizeBook,
  signedSession,
  timetableFor,
  type AttendanceBook,
  type DayClass,
} from "../src/index";
import { DEPARTMENT_GROUPS } from "../src/departments";
import { LEVELS } from "../src/levels";

const DEPARTMENTS = DEPARTMENT_GROUPS.other.flatMap((g) => g.departments.map((d) => d.id));
const ALL_LEVELS = LEVELS.other;
const SAMPLE = DEPARTMENTS.filter((_, i) => i % 7 === 0);
const DAYS_CHECKED = 70;
const exam = EVENTS.find((e) => e.id === "exam")!;

const shape = (department: string, level: string) =>
  timetableFor(department, level)
    .slots.map((s) => `${s.weekday}:${s.slot}:${s.course.code}:${s.course.title}:${s.course.lecturer.name}:${s.place}`)
    .join("|");

test("a timetable is the same every time and differs between departments and levels", () => {
  assert.equal(shape("computer-science", "200L"), shape("computer-science", "200L"));
  assert.notEqual(shape("computer-science", "200L"), shape("law", "200L"));
  assert.notEqual(shape("computer-science", "200L"), shape("computer-science", "300L"));
  assert.equal(coursePrefix("computer-science"), "CSC");
  assert.ok(timetableFor("computer-science", "200L").courses.some((c) => c.code === "CSC 201"));
});

test("every student carries 5 to 7 courses with GST shared across departments", () => {
  for (const department of SAMPLE) {
    for (const level of ALL_LEVELS) {
      const tt = timetableFor(department, level);
      assert.ok(tt.courses.length >= 5 && tt.courses.length <= 7, `${department} ${level} has ${tt.courses.length} courses`);
      assert.equal(new Set(tt.courses.map((c) => c.code)).size, tt.courses.length, `${department} ${level} repeats a code`);
      for (const course of tt.courses) assert.ok(tt.slots.some((s) => s.course === course), `${course.code} has no class`);
    }
  }
  const gst = (department: string) => timetableFor(department, "100L").slots.filter((s) => s.course.gst).map((s) => `${s.course.code}:${s.weekday}:${s.slot}:${s.place}`);
  assert.deepEqual(gst("computer-science"), gst("law"));
  assert.ok(gst("law").length >= 2);
});

test("no clashes, nothing in the test slot, no event venues, every venue has seats", () => {
  for (const department of ["", ...DEPARTMENTS]) {
    for (const level of ["", ...ALL_LEVELS]) {
      const tt = timetableFor(department, level);
      const seen = new Set<string>();
      for (const s of tt.slots) {
        const key = `${s.weekday}:${s.slot}`;
        assert.ok(!seen.has(key), `${department} ${level} has two classes at ${key}`);
        seen.add(key);
        assert.ok(LECTURE_DAYS.includes(s.weekday), "classes hold on lecture days only");
        assert.ok(CLASS_START_HOURS[s.slot] * 60 + CLASS_MINUTES <= exam.start);
        const place = PLACES[s.place];
        assert.ok(place, "venue is a real place");
        assert.ok(!/amphi|oduduwa/i.test(place.name), `${place.name} is an events venue`);
        assert.ok(INTERIORS[s.place]?.template.spots.some((spot) => spot.kind === "study"), `${place.name} has no seats`);
        if (s.course.gst) assert.equal(INTERIORS[s.place]?.template.id, "lecture", `${place.name} is too small for GST`);
      }
    }
  }
});

function checkDay(classes: DayClass[], label: string) {
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i];
    assert.ok(c.end <= exam.start, `${label} runs into the test`);
    assert.ok(!/amphi|oduduwa/i.test(PLACES[c.place].name));
    assert.ok(INTERIORS[c.place]?.template.spots.some((spot) => spot.kind === "study"));
    if (i > 0) assert.ok(classes[i - 1].end <= c.start, `${label} has overlapping classes`);
    if (c.status === "late") assert.ok(c.begins - c.start >= LATE_MIN_MINUTES && c.begins - c.start <= LATE_MAX_MINUTES);
    else assert.equal(c.begins, c.start);
    if (c.status === "shifted") assert.ok(c.from && (c.from.start !== c.start || c.from.place !== c.place), `${label} shift changed nothing`);
    if (c.status === "noshow") assert.ok(c.sheet === undefined && c.snap === undefined);
    if (c.sheet !== undefined) assert.ok(c.sheet >= c.begins && c.sheet + SHEET_WINDOW_MINUTES <= c.end);
    if (c.snap !== undefined) assert.ok(c.snap >= c.begins && c.snap < c.end && c.course.lecturer.temperament === "surprise");
  }
}

test("the day's rolls are stable, valid, and cover every outcome", () => {
  const seen = { holds: 0, late: 0, noshow: 0, shifted: 0, sheet: 0, snap: 0, total: 0 };
  for (const department of SAMPLE) {
    const tt = timetableFor(department, "200L");
    for (let day = 0; day < DAYS_CHECKED; day++) {
      const classes = classesOn(tt, day);
      assert.deepEqual(classes, classesOn(tt, day));
      if (day % 7 > 4) assert.equal(classes.length, 0);
      checkDay(classes, `${department} day ${day}`);
      for (const c of classes) {
        seen[c.status]++;
        seen.total++;
        if (c.sheet !== undefined) seen.sheet++;
        if (c.snap !== undefined) seen.snap++;
      }
    }
  }
  assert.ok(seen.holds > seen.total / 2, "most classes hold");
  for (const kind of ["late", "noshow", "shifted", "sheet", "snap"] as const) assert.ok(seen[kind] > 0, `no ${kind} in ${seen.total} classes`);
  const course = timetableFor("law", "100L").courses[0];
  assert.deepEqual(rollClass(course, 12, 1), rollClass(course, 12, 1));
});

test("late and cancelled classes only show once they happen", () => {
  const all = SAMPLE.flatMap((d) => Array.from({ length: DAYS_CHECKED }, (_, day) => classesOn(timetableFor(d, "100L"), day)).flat());
  const late = all.find((c) => c.status === "late")!;
  assert.equal(classPhase(late, late.start - 1), "scheduled");
  assert.equal(classPhase(late, late.start), "waiting");
  assert.equal(classPhase(late, late.begins), "on");
  assert.equal(classPhase(late, late.end), "done");
  const gone = all.find((c) => c.status === "noshow")!;
  assert.equal(classPhase(gone, gone.start), "scheduled");
  assert.equal(classPhase(gone, gone.end), "cancelled");
});

test("the shared GST lectures stay in lecture theatres on weekdays", () => {
  for (let day = 0; day < 14; day++) {
    const list = lecturesFor(day);
    if (!LECTURE_DAYS.includes(day % 7)) assert.equal(list.length, 0);
    for (const l of list) assert.equal(INTERIORS[l.place]?.template.id, "lecture");
  }
  assert.ok(lecturesFor(2).length + lecturesFor(3).length > 0);
});

test("attendance percentages and the 75 percent rule", () => {
  assert.equal(attendancePercent(0, 0), 100);
  assert.equal(attendancePercent(3, 4), 75);
  assert.equal(attendancePercent(2, 3), 67);
  assert.equal(attendancePercent(5, 4), 100);
  assert.equal(belowAttendanceRule(0, 2), false);
  assert.equal(belowAttendanceRule(2, 3), true);
  assert.equal(belowAttendanceRule(3, 4), false);
  const book: AttendanceBook = {};
  assert.equal(markHeld(book, "CSC 201", 10), true);
  assert.equal(markHeld(book, "CSC 201", 10), false);
  assert.equal(markSigned(book, "CSC 201", 10), true);
  assert.equal(markSigned(book, "CSC 201", 10), false);
  assert.equal(markSigned(book, "CSC 201", 14), true);
  assert.equal(markHeld(book, "CSC 201", 14), false);
  markHeld(book, "CSC 201", 18);
  markHeld(book, "CSC 201", 22);
  const record = courseAttendance(book, "CSC 201");
  assert.deepEqual([record.signed, record.held, record.percent, record.low], [2, 4, 50, true]);
  const courses = timetableFor("computer-science", "200L").courses;
  assert.equal(attendancePenalty(book, courses), ATTENDANCE_PENALTY_MARKS);
  const bad: AttendanceBook = Object.fromEntries(courses.map((c) => [c.code, [0, 5, 1, -1]]));
  assert.equal(attendancePenalty(bad, courses), ATTENDANCE_PENALTY_CAP);
  assert.equal(attendancePenalty({}, courses), 0);
});

test("saved attendance is cleaned before use", () => {
  const book = sanitizeBook({ "CSC 201": [2.9, 4, 3, 3], "LAW 101": [1, 1, 1, 1], "CSC 203": "x", "CSC 205": [1, 2], "CSC 207": [9, 2, 5, 5] });
  assert.deepEqual(book, { "CSC 201": [2, 4, 3, 3], "LAW 101": [1, 1, 1, 1], "CSC 207": [2, 2, 5, 5] });
  assert.deepEqual(sanitizeBook(null), {});
  assert.equal(parseClassesPayload({ department: 1 }), undefined);
  assert.deepEqual(parseClassesPayload({ department: "law", level: "100L", book: { "LAW 101": [1, 1, 4, 4] } }), { department: "law", level: "100L", book: { "LAW 101": [1, 1, 4, 4] } });
});

test("courses outside the current timetable keep their record and the book stays bounded", () => {
  const many: AttendanceBook = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`ABC ${100 + i}`, [0, 4, i, -1]]));
  const kept = sanitizeBook(many);
  assert.equal(Object.keys(kept).length, 40);
  assert.ok(kept["ABC 159"]);
  assert.equal(kept["ABC 100"], undefined);
  assert.deepEqual(kept["ABC 130"], [0, 4, 30, -1]);
});

test("every signed session of the week is remembered and survives a save", () => {
  const book: AttendanceBook = {};
  markSigned(book, "CSC 201", 4);
  markSigned(book, "CSC 201", 9);
  markHeld(book, "CSC 201", 14);
  assert.equal(signedSession(book, "CSC 201", 4), true);
  assert.equal(signedSession(book, "CSC 201", 9), true);
  assert.equal(signedSession(book, "CSC 201", 14), false);
  assert.equal(signedSession(book, "CSC 203", 4), false);
  const back = parseClassesPayload({ department: "computer-science", level: "200L", book: JSON.parse(JSON.stringify(book)) })!.book;
  assert.equal(signedSession(back, "CSC 201", 4), true);
  assert.equal(signedSession({ "CSC 201": [1, 1, 4, 4] }, "CSC 201", 4), true);
  for (let session = 20; session < 60; session++) markSigned(book, "CSC 201", session);
  assert.ok(book["CSC 201"].length <= 10);
  assert.equal(courseAttendance(book, "CSC 201").signed, 42);
  assert.equal(signedSession(book, "CSC 201", 59), true);
});

test("a snap test is recorded once per session in the saved book", () => {
  const book: AttendanceBook = { "LAW 101": [1, 1, 4, 4] };
  assert.equal(markSnap(book, "LAW 101", 4), true);
  assert.equal(markSnap(sanitizeBook(JSON.parse(JSON.stringify(book))), "LAW 101", 4), false);
  assert.equal(markSnap(book, "LAW 101", 8), true);
  assert.equal(signedSession(book, "LAW 101", 8), false);
});

test("the test attendance share is the part of the day's classes that were signed", () => {
  const book: AttendanceBook = {};
  markSigned(book, "CSC 201", 4);
  const day = [
    { code: "CSC 201", session: 4 },
    { code: "CSC 203", session: 5 },
  ];
  assert.equal(attendanceShare(book, []), 1);
  assert.equal(attendanceShare(book, day), 0.5);
  assert.equal(attendanceShare(book, day.slice(0, 1)), 1);
  assert.equal(attendanceShare({}, day), 0);
});
