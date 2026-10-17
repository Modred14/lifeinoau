/**
 * The campus clock and weekly calendar. Two real seconds = one game minute,
 * so a game day lasts 48 real minutes and a week about 5.6 hours.
 *
 * One campus week follows the programme in semester.ts: registration, lectures,
 * exams, then results and a short break.
 *
 * Time is derived from the wall clock against a fixed epoch, so it's the same
 * on every server restart and every device. The server still syncs the
 * current minute (state.clock) so clients never drift.
 */
import { PLACES } from "./map";
import { gstClassesOn } from "./academics/day";
import { EXAM_DAY, LECTURE_DAYS, SEMESTER_TIMES } from "./semester";

/** A Monday, 00:00 game time. */
let EPOCH_MS = Date.UTC(2026, 0, 5, 0, 0, 0);
let epochMinute = 0;

export function configureWorldClock(epoch: number, week: number) {
  EPOCH_MS = epoch;
  epochMinute = (week - 1) * 7 * 1440;
}
export const MINUTES_PER_DAY = 24 * 60;
/** Real seconds per game minute. */
export const REAL_SECONDS_PER_GAME_MINUTE = 2;
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;

let offsetMinutes = 0;
/** Dev/testing only: shift the campus clock (the server sets this from CLOCK_OFFSET_MINUTES). */
export function setClockOffset(minutes: number) {
  offsetMinutes = Math.round(minutes) || 0;
}

/** Total game minutes since the epoch at a wall-clock time. */
export const gameMinutesAt = (ms: number) => Math.floor((ms - EPOCH_MS) / (1000 * REAL_SECONDS_PER_GAME_MINUTE)) + offsetMinutes + epochMinute;

export interface GameTime {
  /** Total minutes since the epoch. */
  total: number;
  /** Days since the epoch (for seeding the timetable). */
  dayIndex: number;
  /** 0 = Monday ... 6 = Sunday. */
  weekday: number;
  /** Minute of the day, 0..1439. */
  minute: number;
  hour: number;
}

export function gameTime(total: number): GameTime {
  const dayIndex = Math.floor(total / MINUTES_PER_DAY);
  const minute = ((total % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { total, dayIndex, weekday: ((dayIndex % 7) + 7) % 7, minute, hour: Math.floor(minute / 60) };
}

export const formatClock = (t: GameTime) => `${DAYS[t.weekday].slice(0, 3)} ${String(t.hour).padStart(2, "0")}:${String(t.minute % 60).padStart(2, "0")}`;

/** 0 at night, 1 at full day, smooth through dawn (5:30–7:30) and dusk (18:00–20:00). */
export function daylight(minute: number): number {
  const h = minute / 60;
  if (h < 5.5 || h >= 20) return 0;
  if (h < 7.5) return smooth((h - 5.5) / 2);
  if (h >= 18) return 1 - smooth((h - 18) / 2);
  return 1;
}
const smooth = (x: number) => x * x * (3 - 2 * x);

// ---------------------------------------------------------------- lectures

export interface Lecture {
  course: string;
  /** PLACES index of the venue. */
  place: number;
  start: number; // minute of day
  end: number;
  /** Unique per day + slot (for attendance). */
  key: string;
}

/** The shared GST classes that hold on a day (Mon–Fri only). Each student's own timetable is in academics.ts. */
export function lecturesFor(dayIndex: number): Lecture[] {
  return gstClassesOn(dayIndex)
    .filter((c) => c.status !== "noshow")
    .map((c) => ({ course: `${c.course.code} ${c.course.title}`, place: c.place, start: c.begins, end: c.end, key: c.key }));
}

/** Game minutes in a lecture before your attendance is marked. */
export const ATTENDANCE_MINUTES = 30;

// ---------------------------------------------------------------- worship + parties

export interface CampusEvent {
  id: "jumat" | "service" | "party" | "exam";
  title: string;
  weekdays: number[];
  start: number; // minute of day
  end: number; // may pass midnight (> 1440)
  /** Where it happens (place name pattern). */
  where: RegExp;
}

export const EVENTS: CampusEvent[] = [
  { id: "jumat", title: "🕌 Jumat prayer", weekdays: [4], start: 13 * 60, end: 14 * 60 + 30, where: /mosque/i },
  { id: "service", title: "⛪ Sunday service", weekdays: [6], start: 9 * 60, end: 11 * 60 + 30, where: /church|chapel|rccg/i },
  { id: "party", title: "🎉 SUB night party", weekdays: [4, 5], start: 21 * 60, end: 26 * 60, where: /student union/i },
  { id: "exam", title: "📝 Evening test", weekdays: [...LECTURE_DAYS], start: SEMESTER_TIMES.testStart, end: SEMESTER_TIMES.testEnd, where: /1000 seater/i },
  { id: "exam", title: "📝 Weekly assessment", weekdays: [EXAM_DAY], start: SEMESTER_TIMES.examStart, end: SEMESTER_TIMES.examEnd, where: /1000 seater/i },
];

/** Events running at this time (handles parties that run past midnight). */
export function activeEvents(t: GameTime): CampusEvent[] {
  return EVENTS.filter((e) => {
    if (e.weekdays.includes(t.weekday) && t.minute >= e.start && t.minute < Math.min(e.end, MINUTES_PER_DAY)) return true;
    // After midnight, still part of yesterday's event.
    const yesterday = (t.weekday + 6) % 7;
    return e.end > MINUTES_PER_DAY && e.weekdays.includes(yesterday) && t.minute < e.end - MINUTES_PER_DAY;
  });
}

/** The PLACES index an event happens at. */
export const eventPlace = (e: CampusEvent) => PLACES.findIndex((p) => e.where.test(p.name));

// ---------------------------------------------------------------- academics

/** Game minutes to write a test (45 game minutes = 90 real seconds). */
export const EXAM_MINUTES = 45;
export const EXAM_SECONDS = EXAM_MINUTES * REAL_SECONDS_PER_GAME_MINUTE;
/** Chance the invigilator catches you copying. */
export const CHEAT_CATCH_CHANCE = 0.35;
/** Score boost if you copy and get away with it. */
export const CHEAT_BOOST = 25;
/** Malpractice cases before rustication, and how long it lasts (game minutes). */
export const RUSTICATE_AFTER = 2;
export const RUSTICATE_MINUTES = 7 * MINUTES_PER_DAY;
/** Crash reading (TOC): late-night study is faster but tiring. */
export const TOC_START = 22 * 60;
export const TOC_END = 4 * 60;
export const isToc = (minute: number) => minute >= TOC_START || minute < TOC_END;

/** Score (0..100) -> grade + grade point on the Nigerian 5.0 scale. */
export function gradeFor(score: number): { grade: string; gp: number } {
  if (score >= 70) return { grade: "A", gp: 5 };
  if (score >= 60) return { grade: "B", gp: 4 };
  if (score >= 50) return { grade: "C", gp: 3 };
  if (score >= 45) return { grade: "D", gp: 2 };
  if (score >= 40) return { grade: "E", gp: 1 };
  return { grade: "F", gp: 0 };
}

/** Class of degree for a CGPA. */
export function degreeClass(cgpa: number): string {
  if (cgpa >= 4.5) return "First Class";
  if (cgpa >= 3.5) return "Second Class Upper";
  if (cgpa >= 2.4) return "Second Class Lower";
  if (cgpa >= 1.5) return "Third Class";
  if (cgpa >= 1.0) return "Pass";
  return "On probation";
}
