import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATTENDANCE_MINUTES,
  BALLOT_WINDOWS,
  CLASS_MINUTES,
  DEFAULT_TRANSPORT,
  EVENTS,
  EXAM_DAY,
  FARE_MAX,
  FARE_MIN,
  LECTURE_DAYS,
  LINES,
  MINUTES_PER_DAY,
  PAID_MODES,
  PX_PER_METER,
  REAL_SECONDS_PER_GAME_MINUTE,
  REGISTRATION,
  SEMESTER_MINUTES,
  SEMESTER_MOMENTS,
  SEMESTER_PHASES,
  SEMESTER_TIMES,
  TRANSPORT_DATA,
  activeEvents,
  classesOn,
  fareFor,
  gameTime,
  lineFare,
  lineRidePx,
  registrationOpen,
  semesterName,
  semesterPhase,
  semesterView,
  sessionName,
  timetableFor,
  transportFor,
} from "../src/index.ts";

const WEEK = 11;
const start = WEEK * SEMESTER_MINUTES;
const at = (weekday: number, minute: number) => gameTime(start + weekday * MINUTES_PER_DAY + minute);
const REAL_CLASS_LIMIT_SECONDS = 180;
const KM = 1000 * PX_PER_METER;

test("the semester phases cover the whole week in order with no gaps", () => {
  assert.equal(SEMESTER_PHASES[0].start, 0);
  assert.equal(SEMESTER_PHASES.at(-1)?.end, SEMESTER_MINUTES);
  for (let i = 1; i < SEMESTER_PHASES.length; i++) assert.equal(SEMESTER_PHASES[i].start, SEMESTER_PHASES[i - 1].end);
  assert.deepEqual(SEMESTER_PHASES.map((p) => p.id), ["registration", "lectures", "exams", "break"]);
  assert.equal(semesterPhase(at(0, 600).total).id, "registration");
  assert.equal(semesterPhase(at(1, 1439).total).id, "registration");
  assert.equal(semesterPhase(at(2, 0).total).id, "lectures");
  assert.equal(semesterPhase(at(4, 1439).total).id, "lectures");
  assert.equal(semesterPhase(at(EXAM_DAY, 600).total).id, "exams");
  assert.equal(semesterPhase(at(6, 600).total).id, "break");
});

test("registration and the bed ballot come before lectures, and exams after them", () => {
  assert.equal(REGISTRATION.closeMinute, SEMESTER_TIMES.registrationCloses);
  assert.ok(SEMESTER_TIMES.registrationCloses < SEMESTER_TIMES.lecturesBegin);
  assert.ok(BALLOT_WINDOWS[0].end <= SEMESTER_TIMES.registrationCloses);
  assert.ok(BALLOT_WINDOWS[0].start > SEMESTER_TIMES.registrationOpens, "registration opens before the ballot");
  assert.equal(registrationOpen(at(1, 17 * 60).total), true);
  assert.equal(registrationOpen(at(2, 8 * 60).total), false);
  const tt = timetableFor("", "100L");
  for (let weekday = 0; weekday < 7; weekday++) {
    const classes = classesOn(tt, WEEK * 7 + weekday);
    if (!LECTURE_DAYS.includes(weekday)) assert.equal(classes.length, 0, `no class on day ${weekday}`);
  }
  assert.ok(LECTURE_DAYS.some((weekday) => classesOn(tt, WEEK * 7 + weekday).length > 0));
  const moments = SEMESTER_MOMENTS.map((m) => m.id);
  assert.ok(moments.indexOf("resume") < moments.indexOf("lectures"));
  assert.ok(moments.indexOf("lectures") < moments.indexOf("exam"));
  assert.ok(moments.indexOf("exam") < moments.indexOf("results"));
});

test("tests sit on lecture evenings and the exam on exam day, never in registration or the break", () => {
  for (const weekday of LECTURE_DAYS) {
    assert.equal(activeEvents(at(weekday, SEMESTER_TIMES.testStart + 5)).some((e) => e.id === "exam"), true);
    assert.equal(activeEvents(at(weekday, SEMESTER_TIMES.examStart + 5)).some((e) => e.id === "exam"), false);
  }
  assert.equal(activeEvents(at(EXAM_DAY, SEMESTER_TIMES.examStart + 5)).some((e) => e.id === "exam"), true);
  for (const weekday of [0, 1, 6]) for (let minute = 0; minute < MINUTES_PER_DAY; minute += 30) assert.equal(activeEvents(at(weekday, minute)).some((e) => e.id === "exam"), false);
  assert.equal(EVENTS.filter((e) => e.id === "exam").length, 2);
});

test("a class lasts three real minutes at most and attendance takes one", () => {
  assert.ok(CLASS_MINUTES * REAL_SECONDS_PER_GAME_MINUTE <= REAL_CLASS_LIMIT_SECONDS);
  assert.ok(ATTENDANCE_MINUTES * REAL_SECONDS_PER_GAME_MINUTE <= REAL_CLASS_LIMIT_SECONDS / 3);
  assert.ok(ATTENDANCE_MINUTES < CLASS_MINUTES / 2, "a student who comes late can still sign");
});

test("every player reads the same calendar from the same clock", () => {
  const a = semesterView(at(3, 9 * 60));
  const b = semesterView(gameTime(at(3, 9 * 60).total));
  assert.deepEqual(a, b);
  assert.equal(a.phase.id, "lectures");
  assert.equal(a.day, 4);
  assert.equal(a.entries.find((e) => e.id === "resume")?.stage, "done");
  assert.equal(a.entries.find((e) => e.id === "lectures")?.stage, "now");
  assert.equal(a.entries.find((e) => e.id === "exam")?.stage, "next");
  assert.equal(a.entries.find((e) => e.id === "exam")?.startTotal, start + EXAM_DAY * MINUTES_PER_DAY + SEMESTER_TIMES.examStart);
  assert.notEqual(semesterName(WEEK), semesterName(WEEK + 1));
  assert.equal(sessionName(WEEK), sessionName(WEEK - 1));
  assert.notEqual(sessionName(WEEK + 1), sessionName(WEEK));
});

test("every fare stays between the floor and the cap and never falls with distance", () => {
  const configs = [DEFAULT_TRANSPORT, ...Object.keys(TRANSPORT_DATA.schools).map((id) => transportFor(id))];
  for (const config of configs) {
    for (const mode of PAID_MODES) {
      let last = 0;
      for (let km = 0; km <= 8; km += 0.25) {
        const fare = fareFor(config, mode, km * KM);
        assert.ok(fare >= FARE_MIN && fare <= FARE_MAX, `${config.school} ${mode} ${km} km is ₦${fare}`);
        assert.ok(fare >= last);
        last = fare;
      }
    }
  }
  assert.equal(fareFor(DEFAULT_TRANSPORT, "keke", 0), FARE_MIN);
  assert.equal(fareFor(DEFAULT_TRANSPORT, "keke", 20 * KM), FARE_MAX);
  assert.ok(fareFor(DEFAULT_TRANSPORT, "keke", 1.5 * KM) > fareFor(DEFAULT_TRANSPORT, "bus", 1.5 * KM), "a keke costs more than the bus for the same trip");
});

test("a shuttle or bus ticket grows with the stops ridden", () => {
  const line = LINES.find((l) => l.stops.length >= 3);
  assert.ok(line);
  const config = transportFor("obafemi-awolowo-university-ile-ife");
  const short = lineRidePx(line, 0, 1);
  const long = lineRidePx(line, 0, line.stops.length - 1);
  assert.ok(long > short);
  assert.equal(lineFare(line.id, config), FARE_MIN);
  assert.ok(lineFare(line.id, config, long) >= lineFare(line.id, config, short));
  assert.ok(lineFare(line.id, config, line.length) <= FARE_MAX);
});
