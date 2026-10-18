// tests/pg/academics.pg.mjs: faculty-based classes, tests and exams against a real PostgreSQL database (see harness.mjs)
import { db, reset, setGameClock, player, rq, char, ok, denied, assert, done } from "./harness.mjs";
import { courseAction, getCourses } from "../../lib/courseService.js";
import { sitExam } from "../../lib/gameService.js";
import { getFaculty, takeTest } from "../../lib/facultyService.js";
import { coursesFor } from "../../lib/curriculum.js";
import { catchUp } from "../../lib/tick.js";
import { WEEKDAYS } from "../../lib/faculty.js";
await reset();
const at = (p, placeId) => db.character.update({ where: { id: p.id }, data: { placeId, placeAt: new Date() } });
const law = await player("lawyer", { faculty: "Faculty of Law", char: { energy: 100, level: 100 } });
const courses = coursesFor("Faculty of Law", 100, 1.2), cs = courses[0];
const [wd, hh] = cs.slot.split(" "), weekday = WEEKDAYS.indexOf(wd); const h = (Number(hh.replace(/\D/g, "")) % 12) + (/PM/.test(hh) ? 12 : 0);
const clock = (day, minute) => setGameClock({ day, minute });
const attend = (p, code = cs.code) => courseAction(db, p.uid, { action: "attend", code, requestId: rq() });
console.log("course:", cs.code, "slot", cs.slot);

// ---------- location
await clock(1 + weekday, h * 60 + 30);
await denied("class: at home, not at the faculty", () => attend(law), /own faculty, Faculty of Law/);
await at(law, "f_social"); await denied("class: in somebody else's faculty", () => attend(law), /not your faculty/);
await at(law, "library"); await denied("class: anywhere else on campus", () => attend(law), /own faculty/);
// ---------- schedule
await at(law, "f_law");
await clock(1 + ((weekday + 1) % 5), h * 60 + 30); await denied("class: wrong day", () => attend(law), /lecture day/);
await clock(1 + weekday, h * 60 - 30); await denied("class: before the lecture starts", () => attend(law), /starts at/);
await clock(1 + weekday, 21 * 60); await denied("class: after the lecture's window", () => attend(law), /ended/);
await clock(1 + weekday, h * 60 + 30);
// ---------- faculty panel
let f = await getFaculty(db, law.uid); assert.equal(f.atOwn, true); const row = f.courses.find((x) => x.code === cs.code); assert.equal(row.open, true); console.log("OK   faculty panel: at own faculty, lecture open now:", cs.code, row.from + "-" + row.to);
// ---------- attend: once, energy, race
const rs = await Promise.allSettled(Array.from({ length: 6 }, () => attend(law)));
assert.equal(rs.filter((r) => r.status === "fulfilled" && !r.value.duplicate).length, 1); let c = await char(law); assert.equal(c.energy, 88);
assert.equal((await db.courseProgress.findFirst({ where: { characterId: law.id, code: cs.code } })).attended, 1); console.log("OK   6 simultaneous attends -> attended once, 12 energy spent");
await denied("class: already attended this week", () => attend(law), /already attended/);
await denied("class: not your course", () => attend(law, "ZZZ 999"), /not one of your courses/);
// ---------- activity status
const s = await player("sleeper", { faculty: "Faculty of Law", char: { placeId: "f_law", sleepingSince: new Date() } });
await denied("class: asleep", () => attend(s), /asleep/);
await db.character.update({ where: { id: s.id }, data: { sleepingSince: null, jobKey: "vendor", energy: 100 } });
await db.jobShift.create({ data: { characterId: s.id, jobKey: "vendor", shiftKey: "morning", gameDay: 99, gameWeek: 1, startedAt: new Date(), endsAt: new Date(Date.now() + 1e6), energyCost: 15, payKobo: 100n, requestId: "x-shift-1" } });
await denied("class: on a job shift", () => attend(s), /job shift/);

// ---------- every faculty has a building a student can be in
const fac = await db.faculty.findMany(); const { facultyHome } = await import("../../lib/faculty.js"); const { placeExists } = await import("../../lib/travelService.js");
for (const x of fac) assert.ok(placeExists(facultyHome(x.name).place), x.name + " -> " + facultyHome(x.name).place);
console.log("OK   all", fac.length, "faculties map to a place that exists on the map");

// ---------- exam: only in own faculty, in exam week, in hours
await reset(); const e = await player("examinee", { faculty: "Faculty of Law", char: { energy: 100, joinedWeek: 1, level: 100 } });
const wk = async () => (await db.gameClock.findUnique({ where: { id: 1 } })); const sit = (cheat = false) => sitExam(db, e.uid, cheat, rq());
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (5 * 7 * 1440 + 3 * 1440 + 600) * 60_000), campusStartWeek: 1 } }); // week 6, day 4 of it, 10:00
await denied("exam: at home", () => sit(), /own faculty/);
await at(e, "f_arts"); await denied("exam: in the wrong faculty", () => sit(), /not your faculty/);
await at(e, "f_law");
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (5 * 7 * 1440 + 3 * 1440 + 20 * 60) * 60_000) } });
await denied("exam: after hours (20:00)", () => sit(), /closed for the day/);
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (5 * 7 * 1440 + 3 * 1440 + 600) * 60_000) } });
await db.character.update({ where: { id: e.id }, data: { sleepingSince: new Date() } }); await denied("exam: asleep", () => sit(), /asleep/);
await db.character.update({ where: { id: e.id }, data: { sleepingSince: null } });
const ex = await Promise.allSettled([sit(), sit(), sit(), sit()]); const sat = ex.filter((r) => r.status === "fulfilled" && !r.value.duplicate);
assert.equal(sat.length, 1); assert.equal(await db.examResult.count({ where: { characterId: e.id } }), 1); console.log("OK   exam sat once at own faculty (4 simultaneous attempts -> 1 result); score", sat[0].value.score);
const again = await sit(); assert.ok(again.duplicate); assert.equal(await db.examResult.count({ where: { characterId: e.id } }), 1); console.log("OK   sitting again changes nothing (still one result)");
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (4 * 7 * 1440 + 600) * 60_000) } }); await denied("exam: not an exam week", () => sit(), /no exam this week/);

// ---------- surprise test waits at the faculty
await reset(); const t = await player("tester", { faculty: "Faculty of Law", char: { energy: 100, level: 100, joinedWeek: 1 } });
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (2 * 7 * 1440 + 600) * 60_000), campusStartWeek: 1 } }); // week 3, 10:00 Monday
await db.classTest.create({ data: { characterId: t.id, sessionStartWeek: 1, gameWeek: 3, code: coursesFor("Faculty of Law", 100, 1.2)[1].code } });
await denied("test: at home", () => takeTest(db, t.uid, { requestId: rq() }), /own faculty/);
await at(t, "f_law"); let pf = await getFaculty(db, t.uid); assert.equal(pf.test.status, "PENDING");
const tr = await Promise.allSettled(Array.from({ length: 5 }, () => takeTest(db, t.uid, { requestId: rq() })));
assert.equal(tr.filter((r) => r.status === "fulfilled" && !r.value.duplicate).length, 1); const done1 = await db.classTest.findFirst({ where: { characterId: t.id } });
assert.equal(done1.status, "TAKEN"); assert.ok(done1.score >= 0 && done1.score <= 20); console.log("OK   test sat once in person (5 simultaneous attempts), scored", done1.score + "/20");
await denied("test: nothing left to sit", () => takeTest(db, t.uid, { requestId: rq() }), /no test waiting/);
// a test nobody sat is missed once the week is over
await db.classTest.update({ where: { id: done1.id }, data: { status: "PENDING", score: null } }); await db.character.update({ where: { id: t.id }, data: { lastTickWeek: 3 } });
await db.gameClock.update({ where: { id: 1 }, data: { campusEpoch: new Date(Date.now() - (3 * 7 * 1440 + 600) * 60_000) } }); // week 4
await catchUp(db, t.id); const missed = await db.classTest.findFirst({ where: { characterId: t.id, gameWeek: 3 } }); assert.equal(missed.status, "MISSED"); console.log("OK   an unsat test is MISSED when the week ends (score 0)");
console.log("DONE"); await done();
