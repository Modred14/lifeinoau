// lib/courseService.js
import { loadLocked, GameError, start, needReq } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { resolveCourseAction, attendanceRate, COSTS } from "./courses.js";
import { SESSION_WEEKS } from "./engine.js";

const view = (course, p, week, we) => ({ code: course.code, title: course.title, slot: course.slot, difficulty: course.difficulty,
  lecturer: { name: course.lecturer.name, personality: course.lecturer.personality, style: course.lecturer.style, reputation: course.lecturer.reputation },
  attended: p?.attended ?? 0, prep: p?.prep ?? 0, attendancePct: Math.round(attendanceRate(p?.attended ?? 0, we) * 100),
  attendedThisWeek: p?.lastAttendWeek === week, studiedThisWeek: p?.lastStudyWeek === week });

export async function getCourses(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId);
  const c = await db.character.findUnique({ where: { id: base.id }, include: { faculty: true } });
  const rows = await db.courseProgress.findMany({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek } });
  const we = week - c.sessionStartWeek + 1, cw = week - c.joinedWeek + 1, nextExamWeek = week + ((6 - (cw % 6)) % 6);
  return { week, level: c.level, faculty: c.faculty.name, energy: c.energy, weeksElapsed: we, sessionWeeks: SESSION_WEEKS, nextExamWeek, examToday: nextExamWeek === week, costs: COSTS,
    courses: coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).map((x) => view(x, rows.find((r) => r.code === x.code), week, we)) };
}

export async function courseAction(db, userId, { action, code, requestId }) {
  needReq(requestId); const week = await start(db, userId);
  try {
    return await db.$transaction(async (tx) => {
      const c = await loadLocked(tx, userId);
      await tx.actionLog.create({ data: { characterId: c.id, requestId, action: "course:" + action, gameWeek: week } }); // P2002 on replay
      const course = coursesFor(c.faculty.name, c.level, Number(c.faculty.difficulty)).find((x) => x.code === code);
      if (!course) throw new GameError("That is not one of your courses.", 404);
      const row = await tx.courseProgress.findFirst({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek, code } });
      const r = resolveCourseAction(c, action, row, week); if (r.error) throw new GameError(r.error);
      const data = { attended: r.progress.attended, prep: r.progress.prep, lastAttendWeek: r.progress.lastAttendWeek, lastStudyWeek: r.progress.lastStudyWeek };
      row ? await tx.courseProgress.update({ where: { id: row.id }, data })
          : await tx.courseProgress.create({ data: { characterId: c.id, sessionStartWeek: c.sessionStartWeek, code, ...data } });
      await tx.character.update({ where: { id: c.id }, data: r.stats });
      return { ok: true, note: action === "attend" ? `You sat through ${course.lecturer.name}'s lecture in ${course.code}.` : `You studied ${course.code}.` };
    });
  } catch (e) { if (e.code === "P2002") return { ok: true, duplicate: true }; throw e; }
}
