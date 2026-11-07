// tests/portal.test.mjs: the E-Portal. Credit units, grade letters, transcript grouping, CGPA agreeing with the game's own, stored breakdowns, restart handling.
import assert from "node:assert/strict";
import { gradePoint, cgpa, classify } from "../lib/engine.js";
import { coursesFor } from "../lib/curriculum.js";
import { creditUnits, gradeLetter, fitScores, deriveBreakdown, normaliseDetail, buildTranscript, standingOf } from "../lib/portal.js";
import { getPortal } from "../lib/portalService.js";
import { makeDb } from "./fakedb.mjs";

let checks = 0;
const ok = (name, fn) => { fn(); checks++; console.log("OK  ", name); };
const okAsync = async (name, fn) => { await fn(); checks++; console.log("OK  ", name); };

ok("grade letters sit on the same boundaries as grade points", () => {
  for (let s = 0; s <= 100; s++) assert.equal({ A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 }[gradeLetter(s)], gradePoint(s), `score ${s}`);
});
ok("credit units are 2 to 4 and never change for a course", () => {
  for (const f of ["Science", "Law", "Arts"]) for (const c of coursesFor(f, 200)) { assert.ok([2, 3, 4].includes(creditUnits(c.code))); assert.equal(creditUnits(c.code), creditUnits(c.code)); }
});
ok("fitScores makes the courses average exactly the semester score", () => {
  for (const [scores, target] of [[[60, 70, 50, 40], 55], [[100, 100, 100, 100], 25], [[0, 0, 0, 0], 22], [[33, 44, 55, 66], 50], [[90, 95, 99, 100], 100]]) {
    const f = fitScores(scores, target); assert.equal(f.reduce((a, b) => a + b, 0), target * 4, JSON.stringify([scores, target])); assert.ok(f.every((x) => x >= 0 && x <= 100));
  }
});
ok("a derived breakdown averages to the stored score, is stable, and a missed exam is all zeros", () => {
  const cs = coursesFor("Science", 100), a = deriveBreakdown(cs, 58, "c1:6"), b = deriveBreakdown(cs, 58, "c1:6");
  assert.deepEqual(a, b); assert.equal(a.reduce((t, x) => t + x.score, 0) / 4, 58);
  const m = normaliseDetail({ score: 0, missed: true, detail: null }, cs, "c1:12"); assert.ok(m.courses.every((x) => x.score === 0 && x.gradePoint === 0));
});
ok("a stored detail that disagrees with the semester score (caught cheat) is brought into line", () => {
  const cs = coursesFor("Science", 100), detail = cs.map((c) => ({ code: c.code, title: c.title, score: 62, gradePoint: 4 }));
  const n = normaliseDetail({ score: 25, caught: true, detail }, cs, "x"); assert.equal(n.changed, true); assert.equal(n.courses.reduce((t, x) => t + x.score, 0) / 4, 25);
  const same = normaliseDetail({ score: 62, detail: n.courses.map(() => 0) && detail.map((d) => ({ ...d, units: creditUnits(d.code) })) }, cs, "x"); assert.equal(same.changed, false);
});
const row = (gameWeek, level, score, extra = {}) => ({ gameWeek, level, score, gradePoint: gradePoint(score), missed: false, courses: deriveBreakdown(coursesFor("Science", level), score, "t" + gameWeek), ...extra });
ok("transcript groups two exams per session, a repeated level is a second attempt, and CGPA is the game's CGPA", () => {
  const rows = [row(6, 100, 72), row(12, 100, 55), row(18, 200, 35), row(24, 200, 30), row(30, 200, 65), row(36, 200, 41)];
  const t = buildTranscript(rows);
  assert.deepEqual(t.sessions.map((s) => [s.level, s.attempt, s.semesters.length]), [[100, 1, 2], [200, 1, 2], [200, 2, 2]]);
  assert.equal(t.cgpa, cgpa(rows.map((r) => r.gradePoint)), "same function, same answer as the game");
  assert.equal(t.gpa, rows[5].gradePoint, "GPA is the latest semester");
  assert.equal(t.sessions[0].semesters[1].cgpaAfter, cgpa([5, 3]));
  assert.equal(t.totalUnits, t.sessions.reduce((a, s) => a + s.units, 0));
  assert.ok(t.unitsEarned <= t.totalUnits);
});
ok("no results gives a null CGPA and no sessions", () => { const t = buildTranscript([]); assert.equal(t.cgpa, null); assert.equal(t.sessions.length, 0); assert.equal(t.gpa, null); });
ok("standing follows the degree classes, probation, graduation", () => {
  assert.equal(standingOf({ cgpa: 4.6 }).label, "First Class"); assert.equal(standingOf({ cgpa: null }).label, "No results yet");
  assert.equal(standingOf({ cgpa: 2, failedSessions: 1 }).tone, "warn"); assert.equal(standingOf({ cgpa: 0.5 }).label, classify(0.5));
  assert.equal(standingOf({ cgpa: 3.6, graduated: true, classification: "Second Class Upper" }).status, "Graduated");
});

function fixture(week, results, extra = {}) {
  const db = makeDb(["character", "account", "gameClock", "courseProgress", "actionLog", "examResult"], {
    unique: { actionLog: ["characterId", "requestId"], examResult: ["characterId", "gameWeek"] },
    join: { character: (c, T) => c && ({ ...c, faculty: { name: "Science", difficulty: 1.1 }, account: T.account[0] }) },
  });
  const T = db.T();
  T.gameClock.push({ id: 1, startedAt: new Date(0), campusEpoch: new Date(), campusStartWeek: week });
  T.character.push({ id: "c1", userId: "u1", name: "Ada", hostel: "Awo", expelled: false, graduated: false, suspendedUntilWeek: 0, jailedUntil: null, level: 100, joinedWeek: 1, sessionStartWeek: 1, lastTickWeek: week, personalities: [], strikes: 1, failedSessions: 0, restartWeek: 0, academics: 60, energy: 100, luck: 50, popularity: 50, suspicion: 0, ...extra });
  T.account.push({ id: "p", kind: "PLAYER", characterId: "c1", balance: 0n });
  results.forEach((r, i) => T.examResult.push({ id: BigInt(i + 1), characterId: "c1", cheated: false, caught: false, missed: false, detail: null, ...r }));
  return { db, T };
}
await okAsync("the portal's CGPA equals the CGPA the game computes from the same rows, and its breakdown is stored once", async () => {
  const { db, T } = fixture(13, [{ gameWeek: 6, level: 100, score: 66, gradePoint: 4 }, { gameWeek: 12, level: 100, score: 48, gradePoint: 2 }]);
  const p = await getPortal(db, "u1");
  assert.equal(p.summary.cgpa, cgpa([4, 2])); assert.equal(p.summary.gpa, 2); assert.equal(p.sessions.length, 1);
  const sem = p.sessions[0].semesters[1]; assert.equal(sem.courses.length, 4); assert.equal(Math.round(sem.courses.reduce((t, c) => t + c.score, 0) / 4), 48);
  assert.ok(T.examResult.every((r) => Array.isArray(r.detail) && r.detail.length === 4), "generated breakdowns are saved");
  const before = JSON.stringify(T.examResult.map((r) => r.detail)), p2 = await getPortal(db, "u1");
  assert.equal(JSON.stringify(T.examResult.map((r) => r.detail)), before, "a second read changes nothing"); assert.deepEqual(p2.sessions, p.sessions);
  assert.equal(p.current.courses.length, 4); assert.ok(p.current.courses.every((c) => creditUnits(c.code) === c.units));
});
await okAsync("results from before a restart are archived and left out of CGPA", async () => {
  const { db } = fixture(30, [{ gameWeek: 6, level: 100, score: 80, gradePoint: 5 }, { gameWeek: 24, level: 100, score: 41, gradePoint: 1 }], { restartWeek: 20, sessionStartWeek: 20, joinedWeek: 20 });
  const p = await getPortal(db, "u1");
  assert.equal(p.summary.cgpa, 1); assert.equal(p.summary.archived, 1); assert.equal(p.sessions.length, 1);
});
await okAsync("a player with no exams yet sees an honest empty state, not made-up results", async () => {
  const { db, T } = fixture(2, []);
  const p = await getPortal(db, "u1"); assert.equal(p.summary.cgpa, null); assert.equal(p.sessions.length, 0); assert.equal(T.examResult.length, 0); assert.equal(p.summary.status, "Awaiting first examination");
});
await okAsync("a graduate sees final standing and no registration", async () => {
  const { db } = fixture(60, [{ gameWeek: 6, level: 500, score: 75, gradePoint: 5 }], { graduated: true, classification: "First Class", level: 500 });
  const p = await getPortal(db, "u1"); assert.equal(p.current, null); assert.equal(p.summary.standing, "First Class");
});
console.log(`\n${checks} portal checks passed`);
