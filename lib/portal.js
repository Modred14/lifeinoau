// lib/portal.js
// The E-Portal's pure rules: credit units, grade letters, and turning a player's stored exam results into a transcript. No database here.
//
// One rule decides everything, and it is the game's own (lib/engine.js): a semester IS one exam. Its grade point is gradePoint(mean score of the four courses),
// and CGPA is the mean of those grade points over every counted exam (cgpa()). The portal never works out a second, different CGPA: it uses the same functions.
// Per-course rows (score, letter, credit units) describe HOW the semester score was made up. Their mean is always forced to equal the stored semester score.
import { gradePoint, cgpa, classify, SESSION_WEEKS } from "./engine.js";

export const EXAMS_PER_SESSION = 2;
export const SEMESTER_NAMES = ["First semester", "Second semester"];
const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const clamp = (n) => Math.max(0, Math.min(100, n));

/** Credit units of a course: 2, 3 or 4, fixed by its code so a course weighs the same every time it is taken. */
export const creditUnits = (code) => 2 + (hash("units:" + code) % 3);
/** Nigerian grade letters, on the same boundaries as gradePoint(). */
export const gradeLetter = (score) => (score >= 70 ? "A" : score >= 60 ? "B" : score >= 50 ? "C" : score >= 45 ? "D" : score >= 40 ? "E" : "F");
/** Grade point to two decimals, the way a portal prints it. */
export const fmt2 = (n) => (n == null ? null : Math.round(n * 100) / 100);

/**
 * Make a list of per-course scores average exactly `target` (a whole number): each score is nudged one mark at a time, starting from the course the seed picks,
 * so the result is stable for the same inputs. Used when a stored breakdown does not add up to the stored semester score (a cheat bonus, a caught cheat, an old row).
 */
export function fitScores(scores, target) {
  const n = scores.length; if (!n) return [];
  const out = scores.map((s) => clamp(Math.round(s)));
  let diff = target * n - out.reduce((a, b) => a + b, 0), i = 0, guard = 0;
  while (diff !== 0 && guard++ < 1000) {
    const k = i++ % n, step = diff > 0 ? 1 : -1, v = out[k] + step;
    if (v < 0 || v > 100) continue;
    out[k] = v; diff -= step;
  }
  return out;
}

/** A breakdown for a semester that has none (a missed exam, or a result stored before breakdowns were kept): the courses of that level, scored around the stored semester score. */
export function deriveBreakdown(courses, score, seed) {
  if (!courses.length) return [];
  const raw = courses.map((c) => clamp(score + ((hash(`${seed}:${c.code}`) % 17) - 8)));
  const fit = fitScores(score === 0 ? raw.map(() => 0) : raw, score);
  return courses.map((c, k) => ({ code: c.code, title: c.title, score: fit[k], gradePoint: gradePoint(fit[k]), units: creditUnits(c.code) }));
}

/**
 * The breakdown to store and show for one exam row. `detail` is what the exam saved (per-course scores) or null. The courses are the faculty's courses at the row's level.
 * Returns { courses, changed }: `changed` says the stored detail was missing or did not match the semester score, so the caller should save the corrected one.
 */
export function normaliseDetail(row, courses, seed) {
  const stored = Array.isArray(row.detail) ? row.detail.filter((d) => d && typeof d.code === "string" && Number.isFinite(d.score)) : [];
  if (!stored.length || row.missed) {
    const made = deriveBreakdown(courses, row.missed ? 0 : row.score, seed);
    return { courses: made, changed: made.length > 0 };
  }
  const fit = fitScores(stored.map((d) => d.score), row.score);
  const next = stored.map((d, k) => ({ code: d.code, title: d.title ?? d.code, score: fit[k], gradePoint: gradePoint(fit[k]), units: Number.isInteger(d.units) ? d.units : creditUnits(d.code) }));
  const same = stored.every((d, k) => d.score === next[k].score && d.units === next[k].units && d.gradePoint === next[k].gradePoint);
  return { courses: next, changed: !same };
}

/**
 * Group the exam rows (oldest first) into sessions and semesters. A session is one level's run of two exams; a new one starts when the level changes or two exams are already in it
 * (so a repeated level becomes a second session at that level). `rows` need { gameWeek, level, score, gradePoint, missed, cheated, caught, courses }.
 */
export function buildTranscript(rows) {
  const asc = [...rows].sort((a, b) => a.gameWeek - b.gameWeek), sessions = [], gps = [];
  for (const r of asc) {
    let s = sessions[sessions.length - 1];
    if (!s || s.level !== r.level || s.semesters.length >= EXAMS_PER_SESSION) {
      const attempt = sessions.filter((x) => x.level === r.level).length + 1;
      s = { no: sessions.length + 1, level: r.level, attempt, semesters: [] }; sessions.push(s);
    }
    gps.push(r.gradePoint);
    const courses = r.courses ?? [];
    s.semesters.push({
      no: s.semesters.length + 1, name: SEMESTER_NAMES[s.semesters.length] ?? `Semester ${s.semesters.length + 1}`, week: r.gameWeek,
      score: r.score, gpa: r.gradePoint, grade: gradeLetter(r.score), missed: !!r.missed, malpractice: !!r.caught, cheated: !!r.cheated,
      courses: courses.map((c) => ({ ...c, grade: gradeLetter(c.score), passed: c.score >= 40 })),
      units: courses.reduce((t, c) => t + c.units, 0), unitsEarned: courses.reduce((t, c) => t + (c.score >= 40 ? c.units : 0), 0),
      cgpaAfter: cgpa(gps),
    });
  }
  for (const s of sessions) {
    s.gpa = cgpa(s.semesters.map((x) => x.gpa)); // the session's GPA: the mean of its semesters, the same rule CGPA uses
    s.units = s.semesters.reduce((t, x) => t + x.units, 0); s.unitsEarned = s.semesters.reduce((t, x) => t + x.unitsEarned, 0);
    s.complete = s.semesters.length >= EXAMS_PER_SESSION;
    s.cgpaAfter = s.semesters[s.semesters.length - 1].cgpaAfter;
  }
  const last = sessions[sessions.length - 1]?.semesters.at(-1) ?? null;
  return { sessions, cgpa: cgpa(gps), gpa: last ? last.gpa : null, semesters: gps.length,
    totalUnits: sessions.reduce((t, s) => t + s.units, 0), unitsEarned: sessions.reduce((t, s) => t + s.unitsEarned, 0) };
}

/** Where the student stands. Uses the same degree classes as the rest of the game. */
export function standingOf({ cgpa: g, graduated, classification, failedSessions = 0, expelled = false }) {
  if (graduated) return { label: classification ?? (g == null ? "Graduated" : classify(g)), status: "Graduated", tone: "good" };
  if (expelled) return { label: g == null ? "No results yet" : classify(g), status: "Expelled", tone: "bad" };
  if (g == null) return { label: "No results yet", status: "Awaiting first examination", tone: "none" };
  if (failedSessions >= 1) return { label: classify(g), status: "On probation: one more failed session means withdrawal", tone: "warn" };
  if (g < 1) return { label: classify(g), status: "Below pass mark", tone: "bad" };
  return { label: classify(g), status: "Good standing", tone: "good" };
}

/** A stable matric number made from the player's id, so it never changes: OAU/123456. */
export const matricNumber = (characterId) => `OAU/${100000 + (hash("matric:" + characterId) % 900000)}`;

export { SESSION_WEEKS };
