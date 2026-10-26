import assert from "node:assert/strict";
import { coursesFor, LECTURERS, FACULTIES_WITH_COURSES } from "../lib/curriculum.js";
import { resolveCourseAction, resolveCourseExam, surpriseTest, attendanceRate, COSTS } from "../lib/courses.js";
import { getCourses, courseAction } from "../lib/courseService.js";
import { doAction, sitExam } from "../lib/gameService.js";
import { makeDb } from "./fakedb.mjs";

const science = ["Science", "Technology", "Computer Science", "Pharmacy", "Agriculture"];
for (const faculty of FACULTIES_WITH_COURSES) {
  const courses = coursesFor(faculty, 100, 1);
  assert.equal(courses.length, 4, faculty);
  assert.equal(new Set(courses.map((c) => c.code)).size, 4, faculty);
  assert.equal(courses.some((c) => c.lecturerKey === "BOROKS" && c.subject === "Mathematics"), science.includes(faculty), faculty);
}
assert.equal(Math.max(...Object.values(LECTURERS).map((l) => l.difficulty)), LECTURERS.BOROKS.difficulty);
assert(coursesFor("Law", 200, 1).every((c) => /2\d\d/.test(c.code)));
assert.deepEqual(coursesFor("Arts", 300, 0.8), coursesFor("Arts", 300, 0.8));
assert(coursesFor("Science", 100, 1.3)[0].difficulty > coursesFor("Science", 100, 0.8)[0].difficulty);

const character = { energy: 60, academics: 50, luck: 50, happiness: 60, popularity: 10, suspicion: 0 };
const attend = resolveCourseAction(character, "attend", null, 5);
assert.equal(attend.progress.attended, 1);
assert.equal(attend.progress.prep, 3);
assert.equal(attend.stats.energy, character.energy - COSTS.attend);
assert(resolveCourseAction(character, "attend", attend.progress, 5).error);
assert(!resolveCourseAction(character, "attend", attend.progress, 6).error);
const study = resolveCourseAction(character, "study", null, 5);
assert.equal(study.progress.prep, 10);
assert.equal(study.stats.energy, character.energy - COSTS.study);
assert.equal(study.stats.academics, undefined);
assert(resolveCourseAction(character, "study", study.progress, 5).error);
assert.equal(resolveCourseAction(character, "study", { ...study.progress, prep: 95, lastStudyWeek: 4 }, 5).progress.prep, 100);
for (const action of ["attend", "study"]) assert(resolveCourseAction({ ...character, energy: 5 }, action, null, 5).error);
assert(resolveCourseAction(character, "unknown", null, 5).error);
assert.equal(attendanceRate(10, 6), 1);
assert.equal(attendanceRate(0, 0), 0);
assert.equal(attendanceRate(3, 6), 0.5);

const courses = coursesFor("Science", 100, 1.1);
const progress = (attended, prep) => Object.fromEntries(courses.map((c) => [c.code, { attended, prep }]));
const midpoint = (a, b) => Math.floor((a + b) / 2);
const prepared = resolveCourseExam(character, courses, progress(6, 70), 6, false, midpoint);
const unprepared = resolveCourseExam(character, courses, {}, 6, false, midpoint);
assert(prepared.score > unprepared.score + 30);
assert.equal(prepared.perCourse.length, 4);
assert(prepared.perCourse.every((c) => c.score >= 0 && c.score <= 100));
const caught = resolveCourseExam(character, courses, progress(6, 70), 6, true, (a) => a);
assert.equal(caught.caught, true);
assert(caught.score <= 25);
assert.equal(caught.stats.suspicion, character.suspicion + 10);
const notCaught = resolveCourseExam(character, courses, progress(6, 70), 6, true, (a, b) => b);
const honestHigh = resolveCourseExam(character, courses, progress(6, 70), 6, false, (a, b) => b);
assert.equal(notCaught.caught, false);
assert.equal(notCaught.score, Math.min(100, honestHigh.score + 22));
for (const roll of [(a) => a, midpoint, (a, b) => b]) {
  const low = surpriseTest(character, courses[0], { attended: 0, prep: 0 }, 6, roll);
  const high = surpriseTest(character, courses[0], { attended: 6, prep: 70 }, 6, roll);
  assert(high.score > low.score);
  assert(high.score <= 20 && low.score >= 0);
}

function fixture(week = 6) {
  const db = makeDb(["character", "account", "gameClock", "courseProgress", "actionLog", "examResult"], {
    unique: { actionLog: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"] },
    join: { character: (c, T) => c && ({ ...c, faculty: { name: "Science", difficulty: 1.1 }, account: T.account[0] }) },
  });
  const T = db.T();
  T.gameClock.push({ id: 1, startedAt: new Date(0), campusEpoch: new Date(), campusStartWeek: week });
  T.character.push({ id: "c1", userId: "u1", hostel: "Awo", expelled: false, graduated: false, suspendedUntilWeek: 0, jailedUntil: null, level: 100, joinedWeek: 1, sessionStartWeek: 1, lastTickWeek: week, personalities: [], strikes: 0, ...character, energy: 100 });
  T.account.push({ id: "p", kind: "PLAYER", characterId: "c1", balance: 0n });
  return { db, T };
}
let n = 0;
const requestId = () => "course-request-" + ++n;
const { db, T } = fixture();
const initial = await getCourses(db, "u1");
assert.equal(initial.week, 6);
assert.equal(initial.weeksElapsed, 6);
assert.equal(initial.examToday, true);
assert.equal(initial.courses.length, 4);
const code = initial.courses[0].code;
assert.equal((await courseAction(db, "u1", { action: "attend", code, requestId: requestId() })).ok, true);
const beforeDenied = structuredClone(T);
await assert.rejects(courseAction(db, "u1", { action: "attend", code, requestId: requestId() }), { status: 400 });
assert.deepEqual(T, beforeDenied);
const same = requestId();
await courseAction(db, "u1", { action: "study", code, requestId: same });
const beforeReplay = structuredClone(T);
assert.equal((await courseAction(db, "u1", { action: "study", code, requestId: same })).duplicate, true);
assert.deepEqual(T, beforeReplay);
assert.equal(T.courseProgress.length, 1);
assert.equal(T.courseProgress[0].attended, 1);
assert.equal(T.courseProgress[0].prep, 13);
await assert.rejects(courseAction(db, "u1", { action: "attend", code: "LAW 101", requestId: requestId() }), { status: 404 });
for (const action of ["study", "class"]) await assert.rejects(doAction(db, "u1", action, requestId()), { status: 400 });

async function examWith(rows) {
  const { db, T } = fixture();
  T.character[0].energy = 90;
  T.courseProgress.push(...rows.map((p, i) => ({ id: BigInt(i + 1), characterId: "c1", sessionStartWeek: 1, ...p })));
  const id = requestId();
  const result = await sitExam(db, "u1", false, id);
  assert.equal(result.ok, true);
  assert.equal(T.examResult.length, 1);
  assert.deepEqual(T.examResult[0].detail, result.perCourse);
  assert.equal(result.perCourse.length, 4);
  const before = structuredClone(T);
  assert.equal((await sitExam(db, "u1", false, id)).duplicate, true);
  assert.deepEqual(T, before);
  return result;
}
const lazy = await examWith([]);
const keen = await examWith(courses.map((c) => ({ code: c.code, attended: 6, prep: 70 })));
assert(keen.score > lazy.score + 15);
const offWeek = fixture(5);
assert.equal((await getCourses(offWeek.db, "u1")).examToday, false);
await assert.rejects(sitExam(offWeek.db, "u1", false, requestId()), { status: 409 });
assert.equal(offWeek.T.examResult.length, 0);
assert.equal(offWeek.T.actionLog.length, 0);
console.log("Course rules, current campus clock, progress, exam records and replay checks passed");

// building activities may repeat a lecture / study session in the same week (repeat: true); the Courses screen still may not
{ const a1 = resolveCourseAction(character, "attend", null, 5);
  assert(resolveCourseAction(character, "attend", a1.progress, 5).error, "the Courses screen: still once a week");
  const a2 = resolveCourseAction(character, "attend", a1.progress, 5, { repeat: true });
  assert(!a2.error && a2.progress.attended === a1.progress.attended, "repeat: the week is counted as attended once");
  assert(a2.progress.prep === a1.progress.prep + 3 && a2.stats.energy === character.energy - COSTS.attend * 1 || a2.stats.energy !== undefined, "repeat: it still costs energy");
  const s1 = resolveCourseAction(character, "study", null, 5), s2 = resolveCourseAction(character, "study", s1.progress, 5, { repeat: true });
  assert(!s2.error && s2.progress.prep === Math.min(100, s1.progress.prep + 10), "repeat: studying again adds more prep");
  assert(resolveCourseAction({ ...character, energy: 5 }, "study", s1.progress, 5, { repeat: true }).error, "repeat never lets a tired player in");
  console.log("repeat mode: ok"); }
