// lib/courses.js
// Pure course rules: attending, studying, exams that depend on your effort, and surprise tests. No database here.
import { clamp, gradePoint, CATCH_PERCENT } from "./engine.js";

export const K = { acad: 0.55, prep: 0.30, attend: 20, energy: 0.15, luck: 0.1, diff: 20, noise: 10, prepPerStudy: 10 };
export const COSTS = { attend: 12, study: 15 };
/** Attendance so far this session: lectures attended divided by weeks gone by (never above 1). */
export const attendanceRate = (attended, weeksElapsed) => Math.min(1, attended / Math.max(1, weeksElapsed));

/**
 * Attend one lecture or study one course. From the Courses screen it is one of each per course per week. progress = { attended, prep, lastAttendWeek, lastStudyWeek }.
 * `repeat: true` (the building activities) lifts the once-a-week rule: a lecture or a study session can be done again and again, paid for with energy each time.
 * The attendance RECORD stays honest: a week counts as attended once, however many lectures were sat in it, so repeating can never make up for a missed week.
 */
export function resolveCourseAction(c, action, progress, week, { repeat = false } = {}) {
  const p = { attended: 0, prep: 0, lastAttendWeek: null, lastStudyWeek: null, ...progress };
  if (action === "attend") {
    if (!repeat && p.lastAttendWeek === week) return { error: "You already attended this course this week." };
    if (c.energy < COSTS.attend) return { error: "You are too tired for a lecture." };
    return { progress: { ...p, attended: p.attended + (p.lastAttendWeek === week ? 0 : 1), prep: Math.min(100, p.prep + 3), lastAttendWeek: week },
      stats: { energy: clamp(c.energy - COSTS.attend) } }; // ability does not grow from sitting in a lecture: effort shows up as attendance and prep
  }
  if (action === "study") {
    if (!repeat && p.lastStudyWeek === week) return { error: "You already studied this course this week." };
    if (c.energy < COSTS.study) return { error: "You are too tired to study." };
    return { progress: { ...p, prep: Math.min(100, p.prep + K.prepPerStudy), lastStudyWeek: week },
      stats: { energy: clamp(c.energy - COSTS.study), happiness: clamp(c.happiness - 2) } };
  }
  return { error: "Unknown action." };
}

/** Score for one course out of 100. */
export function courseScore(c, course, progress, weeksElapsed, roll) {
  const a = attendanceRate(progress?.attended ?? 0, weeksElapsed), prep = progress?.prep ?? 0;
  const s = c.academics * K.acad + prep * K.prep + a * K.attend + (c.energy - 50) * K.energy + (c.luck - 50) * K.luck + roll(-K.noise, K.noise) - (course.difficulty - 1) * K.diff;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/** Whole exam: the mean of the four courses. Cheating adds marks but a caught cheat caps the score and costs a strike (handled by the caller). */
export function resolveCourseExam(c, courses, progressByCode, weeksElapsed, cheat, roll) {
  const per = courses.map((course) => { const score = courseScore(c, course, progressByCode[course.code], weeksElapsed, roll); return { code: course.code, title: course.title, score, gradePoint: gradePoint(score) }; });
  let score = Math.round(per.reduce((t, x) => t + x.score, 0) / Math.max(1, per.length)), caught = false;
  if (cheat) { if (roll(1, 100) <= CATCH_PERCENT) { caught = true; score = Math.min(score, 25); } else score = Math.min(100, score + 22); }
  return { score, gradePoint: gradePoint(score), caught, perCourse: per,
    stats: { energy: clamp(c.energy - 20), popularity: clamp(c.popularity - (caught ? 10 : 0)), suspicion: clamp(c.suspicion + (caught ? 10 : cheat ? 8 : 0)) } };
}

/** A lecturer springs a test. Your effort so far decides the score out of 20. */
export function surpriseTest(c, course, progress, weeksElapsed, roll) {
  const a = attendanceRate(progress?.attended ?? 0, weeksElapsed), prep = progress?.prep ?? 0;
  const score = Math.max(0, Math.min(20, Math.round(4 + a * 6 + prep * 0.08 + (c.academics - 40) * 0.08 + roll(-3, 3) - (course.difficulty - 1) * 4)));
  return { score, academics: score >= 14 ? 1 : score < 8 ? -1 : 0, happiness: score < 8 ? -3 : score >= 14 ? 2 : 0, prep: score >= 14 ? 5 : 0 };
}