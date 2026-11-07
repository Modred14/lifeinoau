// lib/portalService.js: the E-Portal's data. Everything comes from the player's own saved rows (ExamResult, CourseProgress, Character), nothing is invented per request.
// A semester's per-course breakdown is stored in ExamResult.detail when the exam is sat. Rows that have none (a missed exam, or an exam from before breakdowns were kept)
// get one generated once from their stored score, saved back, and read from storage ever after (see normaliseDetail in lib/portal.js).
import { GameError, start } from "./gameService.js";
import { coursesFor } from "./curriculum.js";
import { SESSION_WEEKS } from "./engine.js";
import { attendanceRate } from "./courses.js";
import { creditUnits, normaliseDetail, buildTranscript, standingOf, matricNumber } from "./portal.js";

export async function getPortal(db, userId) {
  const base = await db.character.findUnique({ where: { userId }, select: { id: true } });
  if (!base) throw new GameError("Create a character first.", 404);
  const week = await start(db, userId); // brings the player's weeks up to date first, so an exam missed while away is already on the record
  const c = await db.character.findUnique({ where: { id: base.id }, include: { faculty: true } });
  const restart = c.restartWeek ?? 0, difficulty = Number(c.faculty.difficulty);
  const [all, progress] = await Promise.all([
    db.examResult.findMany({ where: { characterId: c.id }, orderBy: { gameWeek: "asc" } }),
    db.courseProgress.findMany({ where: { characterId: c.id, sessionStartWeek: c.sessionStartWeek } }),
  ]);
  const counted = all.filter((r) => r.gameWeek >= restart); // results from before an expulsion restart are kept but no longer count, exactly as in the game's own CGPA
  const rows = [];
  for (const r of counted) {
    const { courses, changed } = normaliseDetail(r, coursesFor(c.faculty.name, r.level, difficulty), `${c.id}:${r.gameWeek}`);
    if (changed) await db.examResult.update({ where: { id: r.id }, data: { detail: courses } }).catch(() => {}); // stored once; a failed save only means it is worked out again next time
    rows.push({ gameWeek: r.gameWeek, level: r.level, score: r.score, gradePoint: r.gradePoint, missed: r.missed, cheated: r.cheated, caught: r.caught, courses });
  }
  const t = buildTranscript(rows), cw = week - c.joinedWeek + 1, we = week - c.sessionStartWeek + 1;
  const standing = standingOf({ cgpa: t.cgpa, graduated: c.graduated, classification: c.classification, failedSessions: c.failedSessions, expelled: !!c.expelled });
  return {
    week,
    student: { name: c.name, matric: matricNumber(c.id), faculty: c.faculty.name, level: c.level, graduated: c.graduated, graduatedWeek: c.graduatedWeek ?? null },
    summary: { cgpa: t.cgpa, gpa: t.gpa, scale: 5, standing: standing.label, status: standing.status, tone: standing.tone, semesters: t.semesters, totalUnits: t.totalUnits, unitsEarned: t.unitsEarned,
      strikes: c.strikes, failedSessions: c.failedSessions, archived: all.length - counted.length },
    current: c.graduated ? null : { level: c.level, week: we, sessionWeeks: SESSION_WEEKS, weeksLeft: Math.max(0, c.sessionStartWeek + SESSION_WEEKS - week), nextExamWeek: week + ((6 - (cw % 6)) % 6),
      sat: rows.some((r) => r.gameWeek === week),
      courses: coursesFor(c.faculty.name, c.level, difficulty).map((x) => { const p = progress.find((q) => q.code === x.code); return { code: x.code, title: x.title, units: creditUnits(x.code), lecturer: x.lecturer.name, attendancePct: Math.round(attendanceRate(p?.attended ?? 0, we) * 100), prep: p?.prep ?? 0 }; }) },
    sessions: t.sessions.reverse(), // newest first
  };
}
