// lib/facultyService.js: what the faculty building shows (entrance desk, lecture hall, test hall, examination hall) and sitting a surprise test.
// Attending a class and sitting an exam are courseAction / sitExam; both go through academicBlock, exactly like the test here.
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { attendanceRate, surpriseTest } from "./courses.js";
import { SESSION_WEEKS, clamp } from "./engine.js";
import { dayWindow } from "./clock.js";
import { gameMinuteOfDay } from "./campus-clock.js";
import { placeOf } from "./travel.js";
import { roll } from "./rng.js";
import { academicBlock } from "./facultyGuard.js";
import { facultyHome, isOwnFacultyPlace, dayOfWeek, classOpen, classWindow, teachingWhy, clockText, WEEKDAYS, FACULTY_PLACE_IDS } from "./faculty.js";

/** The faculty building as this student sees it: are they in the right place, what is open now, what is waiting for them. Read only. */
export async function getFaculty(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId), now = Date.now();
  const c = await db.character.findUnique({ where: { id: base.id }, include: { faculty: true } });
  const home = facultyHome(c.faculty.name), here = placeOf(c), day = await dayWindow(db, now), minute = gameMinuteOfDay(now), wd = dayOfWeek(day.day);
  const we = week - c.sessionStartWeek + 1, cw = week - c.joinedWeek + 1, examWeek = cw > 0 && cw % 6 === 0;
  const [rows, test, sat, shift, run] = await Promise.all([
    db.courseProgress.findMany({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek } }),
    db.classTest.findFirst({ where: { characterId: c.id, gameWeek: week } }),
    db.examResult.findFirst({ where: { characterId: c.id, gameWeek: week } }),
    db.jobShift.findFirst({ where: { characterId: c.id, status: "ACTIVE" } }), db.hustleRun.findFirst({ where: { characterId: c.id, status: "ACTIVE" } })]);
  const atOwn = !!home && isOwnFacultyPlace(c.faculty.name, here), atOther = !atOwn && FACULTY_PLACE_IDS.has(here);
  const busy = c.sleepingSince ? "You are asleep." : c.jailedUntil && +c.jailedUntil > now ? "You are in QRS custody." : shift ? "You are on a job shift." : run ? "You are in the middle of a hustle." : null;
  const courses = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).map((x) => {
    const p = rows.find((r) => r.code === x.code), w = classWindow(x.slot), o = classOpen(x.slot, wd, minute);
    return { code: x.code, title: x.title, slot: x.slot, lecturer: x.lecturer.name, from: w ? clockText(w.from) : null, to: w ? clockText(w.to) : null, attended: p?.attended ?? 0,
      attendancePct: Math.round(attendanceRate(p?.attended ?? 0, we) * 100), doneThisWeek: p?.lastAttendWeek === week, open: o.open, why: o.why };
  });
  return { serverNow: now, week, weekday: WEEKDAYS[wd], minute, clock: clockText(minute), dayEndsAt: day.end, faculty: c.faculty.name, home, here, atOwn, atOther, busy,
    wrongPlace: !atOwn ? (atOther ? `This is not your faculty. You study at ${home?.name}.` : `Your faculty is ${home?.name}.`) : null,
    courses, test: test && { code: test.code, status: test.status, score: test.score, why: test.status === "PENDING" ? teachingWhy(minute, "test hall") : null },
    exam: { week: examWeek, sat: !!sat && !sat.missed, why: !examWeek ? "There is no exam this week." : sat ? "You have already sat this exam." : teachingWhy(minute, "examination hall") } };
}

/** Sit this week's surprise test, in person. The score comes from the same rule as before (effort in the course); nothing the client sends changes it. */
export async function takeTest(db, userId, { requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId, { awake: true });
      const why = await academicBlock(tx, c, "test"); if (why) throw new GameError(why, 403);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "classtest", gameWeek: week } }); // P2002 on replay
      const t = await tx.classTest.findFirst({ where: { characterId: c.id, gameWeek: week, status: "PENDING" } });
      if (!t) throw new GameError("There is no test waiting for you this week.", 409);
      const done = await tx.classTest.updateMany({ where: { id: t.id, status: "PENDING" }, data: { status: "TAKEN", takenAt: new Date() } });
      if (done.count !== 1) return { ok: true, duplicate: true };
      const course = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).find((x) => x.code === t.code);
      const row = await tx.courseProgress.findFirst({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek, code: t.code } });
      const r = surpriseTest({ academics: c.academics }, course, row, week - c.sessionStartWeek + 1, roll);
      await tx.classTest.update({ where: { id: t.id }, data: { score: r.score } });
      if (row && r.prep) await tx.courseProgress.update({ where: { id: row.id }, data: { prep: Math.min(100, row.prep + r.prep) } });
      await tx.character.update({ where: { id: c.id }, data: { academics: clamp(c.academics + r.academics), happiness: clamp(c.happiness + r.happiness) } });
      return { ok: true, code: t.code, score: r.score, outOf: 20, note: `${course.lecturer.name}'s test in ${t.code}: ${r.score}/20.` };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}