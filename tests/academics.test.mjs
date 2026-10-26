// tests/academics.test.mjs
// GPA / CGPA arithmetic, level progression (advance, repeat, withdrawal, graduation), missed exams, and that academic records persist and agree.
// Pure rules are tested directly; progression is tested through the real lib/tick.js catchUp against an in-memory stand-in for the database.
import assert from "node:assert/strict";
import { gradePoint, cgpa, classify, closeSession, SESSION_WEEKS } from "../lib/engine.js";
import { resolveCourseExam, resolveCourseAction, courseScore, attendanceRate, COSTS } from "../lib/courses.js";
import { coursesFor } from "../lib/curriculum.js";
import { catchUp } from "../lib/tick.js";
import { getCourses } from "../lib/courseService.js";
import { sitExam } from "../lib/gameService.js";
import { makeDb } from "./fakedb.mjs";

let checks = 0;
const ok = (name, fn) => { fn(); checks++; console.log("OK  ", name); };
const okAsync = async (name, fn) => { await fn(); checks++; console.log("OK  ", name); };

// ---------------------------------------------------------------- score -> grade point -> CGPA -> class
ok("score to grade point follows the 5 point scale at every boundary", () => {
  const table = [[100, 5], [70, 5], [69, 4], [60, 4], [59, 3], [50, 3], [49, 2], [45, 2], [44, 1], [40, 1], [39, 0], [0, 0]];
  for (const [score, gp] of table) assert.equal(gradePoint(score), gp, `score ${score}`);
});
ok("CGPA is the mean grade point to two decimals, and null before any exam", () => {
  assert.equal(cgpa([]), null);
  assert.equal(cgpa([4]), 4);
  assert.equal(cgpa([5, 4, 3]), 4);
  assert.equal(cgpa([5, 5, 4]), 4.67);
  assert.equal(cgpa([1, 0]), 0.5);
  assert.equal(cgpa([0, 0, 0]), 0);
});
ok("degree classes switch exactly at 4.5, 3.5, 2.4, 1.5 and 1.0", () => {
  const table = [[5, "First Class"], [4.5, "First Class"], [4.49, "Second Class Upper"], [3.5, "Second Class Upper"], [3.49, "Second Class Lower"], [2.4, "Second Class Lower"],
    [2.39, "Third Class"], [1.5, "Third Class"], [1.49, "Pass"], [1, "Pass"], [0.99, "Fail"], [0, "Fail"]];
  for (const [g, cls] of table) assert.equal(classify(g), cls, `cgpa ${g}`);
});

// ---------------------------------------------------------------- the end of a session
ok("closeSession: pass advances a level, resets failures; a first failure repeats; a second in a row withdraws", () => {
  assert.deepEqual(closeSession({ level: 100, failedSessions: 0, sessionGps: [3, 3], allGps: [3, 3] }), { type: "ADVANCE", level: 200, failedSessions: 0 });
  assert.deepEqual(closeSession({ level: 200, failedSessions: 1, sessionGps: [2, 1], allGps: [0, 0, 2, 1] }), { type: "ADVANCE", level: 300, failedSessions: 0 }, "passing clears an earlier failure");
  assert.deepEqual(closeSession({ level: 100, failedSessions: 0, sessionGps: [0, 1], allGps: [0, 1] }), { type: "REPEAT", level: 100, failedSessions: 1 });
  assert.deepEqual(closeSession({ level: 100, failedSessions: 1, sessionGps: [0, 0], allGps: [0, 0, 0, 0] }), { type: "WITHDRAWN", level: 100, failedSessions: 2 });
  assert.equal(closeSession({ level: 100, failedSessions: 0, sessionGps: [], allGps: [] }).type, "REPEAT", "a session with no exam at all is a failed session");
});
ok("closeSession: a final-year student graduates only with a passing session AND a passing CGPA", () => {
  const g = closeSession({ level: 500, failedSessions: 0, sessionGps: [5, 5], allGps: [4, 4, 5, 5] });
  assert.equal(g.type, "GRADUATE"); assert.equal(g.cgpa, 4.5); assert.equal(g.classification, "First Class");
  assert.equal(closeSession({ level: 500, failedSessions: 0, sessionGps: [2, 2], allGps: [0, 0, 0, 0, 0, 0, 2, 2] }).type, "REPEAT", "a good last session cannot hide a failing record");
});
ok("a session is SESSION_WEEKS long with an exam every sixth week, so two exams a session", () => {
  assert.equal(SESSION_WEEKS, 12);
  assert.equal([...Array(SESSION_WEEKS).keys()].filter((i) => (i + 1) % 6 === 0).length, 2);
});

// ---------------------------------------------------------------- course scoring
const student = { energy: 80, academics: 60, luck: 50, happiness: 60, popularity: 10, suspicion: 0 };
const science = coursesFor("Science", 100, 1.1);
ok("an exam's grade point always comes from its own score, and the per-course marks are what the score is the mean of", () => {
  const mid = (a, b) => Math.floor((a + b) / 2);
  const prog = Object.fromEntries(science.map((c) => [c.code, { attended: 5, prep: 60 }]));
  const r = resolveCourseExam(student, science, prog, 6, false, mid);
  assert.equal(r.gradePoint, gradePoint(r.score));
  assert.equal(r.score, Math.round(r.perCourse.reduce((t, x) => t + x.score, 0) / r.perCourse.length));
  for (const p of r.perCourse) { assert(p.score >= 0 && p.score <= 100); assert.equal(p.gradePoint, gradePoint(p.score)); }
});
ok("effort pays: attendance and preparation raise a course score, difficulty lowers it", () => {
  const mid = (a, b) => Math.floor((a + b) / 2), course = science[0];
  const lazy = courseScore(student, course, { attended: 0, prep: 0 }, 6, mid), keen = courseScore(student, course, { attended: 6, prep: 100 }, 6, mid);
  assert(keen > lazy + 20);
  assert(courseScore(student, { ...course, difficulty: course.difficulty + 0.3 }, { attended: 6, prep: 100 }, 6, mid) < keen);
  assert.equal(attendanceRate(9, 6), 1, "attendance never passes 100%");
});
ok("repeat lectures cost energy each time but count a week once", () => {
  const first = resolveCourseAction(student, "attend", null, 5, { repeat: true });
  const second = resolveCourseAction({ ...student, energy: first.stats.energy }, "attend", first.progress, 5, { repeat: true });
  assert.equal(first.progress.attended, 1); assert.equal(second.progress.attended, 1, "same week: still one");
  assert.equal(second.stats.energy, student.energy - 2 * COSTS.attend);
  assert.equal(resolveCourseAction({ ...student, energy: first.stats.energy }, "attend", first.progress, 6, { repeat: true }).progress.attended, 2, "a new week counts again");
});

// ---------------------------------------------------------------- progression through lib/tick.js
/** Runs catchUp once for a player. `results` is the player's ExamResult table (shared and mutated, like the real one). */
async function simulate({ char, results, week, classTests = [] }) {
  const A = { W: { id: "W", kind: "SYSTEM", balance: 0n }, L: { id: "L", kind: "SYSTEM", balance: 0n }, B: { id: "B", kind: "SYSTEM", balance: 0n }, P: { id: "P", kind: "PLAYER", balance: 0n } };
  const sys = { WORLD: A.W, LANDLORDS: A.L, BUSINESS: A.B }, ledger = [], notes = [];
  const tx = {
    $queryRaw: async () => [],
    character: { findUnique: async () => ({ ...char, account: A.P }), update: async ({ data }) => Object.assign(char, data) },
    account: { findUnique: async ({ where }) => (where.systemName ? sys[where.systemName] : A[where.id]),
      update: async ({ where, data }) => { const a = A[where.id], d = data.balance; if (d.decrement) a.balance -= d.decrement; if (d.increment) a.balance += d.increment; } },
    ledgerEntry: { findUnique: async ({ where }) => ledger.find((e) => e.idempotencyKey == where.idempotencyKey), create: async ({ data }) => { ledger.push(data); return data; } },
    examResult: {
      createMany: async ({ data }) => { for (const d of data) if (!results.find((r) => r.gameWeek == d.gameWeek)) results.push(d); },
      findMany: async ({ where } = {}) => results.filter((r) => r.gameWeek >= (where?.gameWeek?.gte ?? 0)),
    },
    notification: { create: async ({ data }) => notes.push(data.body) },
    courseProgress: { findFirst: async () => null, update: async () => {} },
    holding: { findMany: async () => [], update: async () => {} },
    business: { findMany: async () => [], update: async () => {} },
    pregnancy: { findMany: async () => [], update: async () => {} },
    classTest: { findMany: async () => [], findFirst: async () => classTests[0] ?? null, create: async ({ data }) => { classTests.push(data); return data; }, update: async () => {} },
  };
  const db = { gameClock: { findUnique: async () => ({ startedAt: new Date(0), campusEpoch: new Date(), campusStartWeek: week, energyRefilledAt: null }) }, character: tx.character, $transaction: async (f) => f(tx) };
  tx.gameClock = db.gameClock;
  await catchUp(db, "c1");
  return { notes, ledger, db };
}
const base = (o = {}) => ({ id: "c1", faculty: { name: "Science", difficulty: 1.1 }, academics: 50, luck: 50, gender: "F", dependents: 0, suspendedUntilWeek: 0, popularity: 30, hostel: "Awo", class: "MAPO",
  joinedWeek: 1, sessionStartWeek: 1, failedSessions: 0, level: 100, lastTickWeek: 0, lastParentCallWeek: 99, missedCallStreak: 0, happiness: 60, suspicion: 0, energy: 100, restartWeek: 0, expelled: false, graduated: false, ...o });

await okAsync("a player who was online for the exam week and skipped the exam gets a missed result once the week is over", async () => {
  const results = [], char = base({ lastTickWeek: 6 }); // last caught up IN exam week 6, never sat it
  await simulate({ char, results, week: 6 }); assert.equal(results.length, 0, "while the week is still running the player may yet sit the exam");
  await simulate({ char, results, week: 7 });
  assert.deepEqual(results.map((r) => [r.gameWeek, r.gradePoint, r.missed]), [[6, 0, true]]);
  await simulate({ char, results, week: 7 }); assert.equal(results.length, 1, "no duplicate");
});
await okAsync("skipping the second exam cannot rescue a session (the missed exam counts as grade point 0)", async () => {
  const results = [{ gameWeek: 6, gradePoint: 1 }], char = base({ lastTickWeek: 12 }); // sat exam 1 (E), skipped exam 2 while online
  await simulate({ char, results, week: 13 });
  assert.ok(results.some((r) => r.gameWeek === 12 && r.missed), "exam 2 is recorded as missed before the session is graded");
  assert.equal(char.level, 100, "mean (1+0)/2 = 0.5 is a fail: the level is repeated"); assert.equal(char.failedSessions, 1); assert.equal(char.sessionStartWeek, 13);
});
await okAsync("sitting both exams and passing advances the level", async () => {
  const results = [{ gameWeek: 6, gradePoint: 3 }, { gameWeek: 12, gradePoint: 3 }], char = base({ lastTickWeek: 12 });
  const { notes } = await simulate({ char, results, week: 13 });
  assert.equal(char.level, 200); assert.equal(char.failedSessions, 0); assert.equal(char.sessionStartWeek, 13); assert.equal(results.length, 2, "nothing extra is recorded");
  assert.ok(notes.some((n) => /advanced to 200L/.test(n)));
  await simulate({ char, results, week: 13 }); assert.equal(char.level, 200, "a session is graded exactly once");
});
await okAsync("a player away for the whole session misses both exams and repeats; a second failed session in a row withdraws them", async () => {
  const results = [], char = base({ lastTickWeek: 0 });
  await simulate({ char, results, week: 13 });
  assert.deepEqual(results.map((r) => r.gameWeek).sort((a, b) => a - b), [6, 12]); assert.equal(char.level, 100); assert.equal(char.failedSessions, 1);
  const second = base({ lastTickWeek: 24, failedSessions: 1, sessionStartWeek: 13, level: 100 }), r2 = [{ gameWeek: 18, gradePoint: 0 }, { gameWeek: 24, gradePoint: 0 }];
  await simulate({ char: second, results: r2, week: 25 });
  assert.equal(second.failedSessions, 2); assert.equal(second.expelled, true, "withdrawn: expelled, and restarts from 100L when it ends");
});
await okAsync("a final-year student with a passing record graduates once, with the right class and stored CGPA", async () => {
  const results = [{ gameWeek: 6, gradePoint: 5 }, { gameWeek: 12, gradePoint: 5 }], char = base({ level: 500, lastTickWeek: 12 });
  await simulate({ char, results, week: 13 });
  assert.equal(char.graduated, true); assert.equal(char.classification, "First Class"); assert.equal(char.finalCgpaX100, 500); assert.equal(char.graduatedWeek, 13);
  const before = { ...char }; await simulate({ char, results, week: 14 }); assert.equal(char.finalCgpaX100, before.finalCgpaX100, "a graduate's result never changes"); assert.equal(results.length, 2, "and no exams are recorded for a graduate");
});
await okAsync("after an expulsion restart only results since the restart count, and old exam weeks are not re-marked missed", async () => {
  const results = [{ gameWeek: 6, gradePoint: 0 }, { gameWeek: 12, gradePoint: 0 }, { gameWeek: 18, gradePoint: 4 }, { gameWeek: 24, gradePoint: 4 }]; // the first two belong to the life before the restart
  const char = base({ joinedWeek: 13, sessionStartWeek: 13, restartWeek: 13, lastTickWeek: 24 });
  await simulate({ char, results, week: 25 });
  assert.equal(char.level, 200, "CGPA counts from the restart only: 4.0, so the new run advances"); assert.equal(results.length, 4);
});

// ---------------------------------------------------------------- persistence: what is stored is what every later read shows
function fixture(week) {
  const db = makeDb(["character", "account", "gameClock", "courseProgress", "actionLog", "examResult"], {
    unique: { actionLog: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"] },
    join: { character: (c, T) => c && ({ ...c, faculty: { name: "Science", difficulty: 1.1 }, account: T.account[0] }) },
  });
  const T = db.T();
  T.gameClock.push({ id: 1, startedAt: new Date(0), campusEpoch: new Date(), campusStartWeek: week });
  T.character.push({ id: "c1", userId: "u1", hostel: "Awo", expelled: false, graduated: false, suspendedUntilWeek: 0, jailedUntil: null, level: 100, joinedWeek: 1, sessionStartWeek: 1, lastTickWeek: week, personalities: [], strikes: 0, ...student, energy: 100 });
  T.account.push({ id: "p", kind: "PLAYER", characterId: "c1", balance: 0n });
  return { db, T };
}
await okAsync("an exam result is stored once, with its per-course detail, and every later read agrees with it", async () => {
  const { db, T } = fixture(6), rows = science.map((c, i) => ({ id: BigInt(i + 1), characterId: "c1", sessionStartWeek: 1, code: c.code, attended: 5, prep: 60 }));
  T.courseProgress.push(...rows);
  const r = await sitExam(db, "u1", false, "persist-req-0001");
  assert.equal(T.examResult.length, 1); const saved = T.examResult[0];
  assert.equal(saved.score, r.score); assert.equal(saved.gradePoint, r.gradePoint); assert.deepEqual(saved.detail, r.perCourse); assert.equal(saved.gradePoint, gradePoint(saved.score));
  assert.equal(cgpa(T.examResult.map((x) => x.gradePoint)), r.gradePoint, "the CGPA after the first exam is that exam's grade point");
  const again = await sitExam(db, "u1", false, "persist-req-0001"); assert.equal(again.duplicate, true); assert.equal(T.examResult.length, 1, "a repeated request stores nothing more");
  const logs = T.actionLog.length;
  await assert.rejects(sitExam(db, "u1", false, "persist-req-0002"), { status: 409, message: /already sat/ }, "a second exam in the same week is refused, not reported as a success");
  assert.equal(T.examResult.length, 1); assert.equal(T.actionLog.length, logs, "and leaves no trace");
  const view = await getCourses(db, "u1"); assert.equal(view.courses.length, 4); assert.equal(view.courses[0].prep, 60); assert.equal(view.courses[0].attended, 5, "the course progress survives and is read back unchanged");
});
await okAsync("a graduate can no longer add an exam result", async () => {
  const { db, T } = fixture(6); T.character[0].graduated = true;
  await assert.rejects(sitExam(db, "u1", false, "persist-req-0003"), { status: 409 }); assert.equal(T.examResult.length, 0);
});

console.log(`\n${checks} academic checks passed`);
