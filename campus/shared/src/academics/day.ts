import type { Course, Temperament } from "./courses";
import { isLectureDay } from "../semester";
import { randomFor } from "./seed";
import { CLASS_MINUTES, SLOTS_PER_DAY, slotStart, timetableFor, venuePool, type StudentTimetable } from "./timetable";

export type ClassStatus = "holds" | "late" | "noshow" | "shifted";

export interface ClassRoll {
  status: ClassStatus;
  delay: number;
  sheet: boolean;
  snap: boolean;
  moveSlot: boolean;
  picks: [number, number, number, number];
}

export interface DayClass {
  key: string;
  session: number;
  course: Course;
  status: ClassStatus;
  place: number;
  start: number;
  begins: number;
  end: number;
  sheet?: number;
  snap?: number;
  from?: { start: number; place: number };
}

interface Odds {
  late: number;
  noshow: number;
  shifted: number;
  sheet: number;
  snap: number;
}

const ODDS: Record<Temperament, Odds> = {
  strict: { late: 0.04, noshow: 0.06, shifted: 0.1, sheet: 0.5, snap: 0 },
  chill: { late: 0.14, noshow: 0.14, shifted: 0.1, sheet: 0.15, snap: 0 },
  late: { late: 0.45, noshow: 0.1, shifted: 0.1, sheet: 0.25, snap: 0 },
  surprise: { late: 0.1, noshow: 0.08, shifted: 0.12, sheet: 0.35, snap: 0.4 },
};

export const LATE_MIN_MINUTES = 10;
export const LATE_MAX_MINUTES = 30;
const LATE_STEP_MINUTES = 5;
export const SHEET_WINDOW_MINUTES = 8;
export const SNAP_WINDOW_MINUTES = 10;
export const NOSHOW_REVEAL_MINUTES = 15;
const SETTLE_MINUTES = 15;
const MOVE_SLOT_CHANCE = 0.5;
const GST_LEVELS = ["100L", "200L", "300L", "400L", "500L"];

const weekdayOf = (dayIndex: number) => ((dayIndex % 7) + 7) % 7;

export function rollClass(course: Course, dayIndex: number, slot: number): ClassRoll {
  const rand = randomFor(`roll:${course.id}:${dayIndex}:${slot}`);
  const odds = ODDS[course.lecturer.temperament];
  const r = rand();
  const status: ClassStatus = r < odds.noshow ? "noshow" : r < odds.noshow + odds.late ? "late" : r < odds.noshow + odds.late + odds.shifted ? "shifted" : "holds";
  const steps = (LATE_MAX_MINUTES - LATE_MIN_MINUTES) / LATE_STEP_MINUTES + 1;
  const delay = status === "late" ? LATE_MIN_MINUTES + Math.floor(rand() * steps) * LATE_STEP_MINUTES : 0;
  const held = status !== "noshow";
  const sheet = rand() < odds.sheet && held;
  const snap = rand() < odds.snap && held;
  const moveSlot = rand() < MOVE_SLOT_CHANCE && !course.gst;
  return { status, delay, sheet, snap, moveSlot, picks: [rand(), rand(), rand(), rand()] };
}

function otherVenue(course: Course, place: number, pick: number): number {
  const pool = venuePool(course).filter((p) => p !== place);
  return pool.length ? pool[Math.floor(pick * pool.length)] : place;
}

export function classesOn(tt: StudentTimetable, dayIndex: number): DayClass[] {
  const weekday = weekdayOf(dayIndex);
  if (!isLectureDay(weekday)) return [];
  const today = tt.slots.filter((s) => s.weekday === weekday);
  const used = new Set(today.map((s) => s.slot));
  const out = today.map((s): DayClass => {
    const roll = rollClass(s.course, dayIndex, s.slot);
    let slot = s.slot;
    let place = s.place;
    if (roll.status === "shifted") {
      const free = Array.from({ length: SLOTS_PER_DAY }, (_, i) => i).filter((i) => !used.has(i));
      if (roll.moveSlot && free.length) {
        slot = free[Math.floor(roll.picks[0] * free.length)];
        used.add(slot);
      } else place = otherVenue(s.course, s.place, roll.picks[1]);
    }
    const start = slotStart(slot);
    const begins = start + roll.delay;
    const end = start + CLASS_MINUTES;
    const room = end - begins - SETTLE_MINUTES * 2;
    const session = dayIndex * SLOTS_PER_DAY + s.slot;
    return {
      key: `${s.course.code}:${session}`,
      session,
      course: s.course,
      status: roll.status,
      place,
      start,
      begins,
      end,
      sheet: roll.sheet ? begins + SETTLE_MINUTES + Math.floor(roll.picks[2] * (room - SHEET_WINDOW_MINUTES)) : undefined,
      snap: roll.snap ? begins + SETTLE_MINUTES + Math.floor(roll.picks[3] * (room - SNAP_WINDOW_MINUTES)) : undefined,
      from: roll.status === "shifted" ? { start: slotStart(s.slot), place: s.place } : undefined,
    };
  });
  return out.sort((a, b) => a.start - b.start);
}

export function gstClassesOn(dayIndex: number): DayClass[] {
  return GST_LEVELS.flatMap((level) => classesOn(timetableFor("", level), dayIndex).filter((c) => c.course.gst)).sort((a, b) => a.start - b.start);
}

export type ClassPhase = "scheduled" | "shifted" | "waiting" | "on" | "cancelled" | "done";

export function classPhase(c: DayClass, minute: number): ClassPhase {
  if (c.status === "noshow") return minute >= c.start + NOSHOW_REVEAL_MINUTES ? "cancelled" : "scheduled";
  if (minute >= c.end) return "done";
  if (minute >= c.begins) return "on";
  if (minute >= c.start) return "waiting";
  return c.status === "shifted" ? "shifted" : "scheduled";
}

export const sheetGoingRound = (c: DayClass, minute: number) => c.sheet !== undefined && minute >= c.sheet && minute < c.sheet + SHEET_WINDOW_MINUTES;
export const snapTestOn = (c: DayClass, minute: number) => c.snap !== undefined && minute >= c.snap && minute < c.snap + SNAP_WINDOW_MINUTES;
