import type { Course } from "../academics/courses";
import { pickFrom, randomFor, shuffled } from "../academics/seed";
import { SLOTS_PER_DAY, WEEK_SLOTS, slotIndexOf, slotWeekday, venuePool, type ClassSlot, type StudentTimetable } from "../academics/timetable";
import { gradeFor } from "../clock";
import { PAPER_DAYS, paperIndex } from "../semester";
import { ADMIN_RESULTS_KEPT, type AdminRecord, type AdminResult } from "./record";

export const RESULT_PASS_MARK = 40;
export const RESULT_REMARK = { pass: "Pass", carry: "Carry over" } as const;
export const RESULT_TEXT = {
  sheet: (code: string, score: number, grade: string, remark: string) => `🧾 ${code}: ${score}% · ${grade}. ${remark}.`,
  carry: (code: string) => `⚠️ ${code} na carry-over. One extra ${code} class next semester. Carry-over no be death sentence.`,
  adviser: (marks: number) => `📋 Course adviser: you no register this semester. Minus ${marks} marks in this paper.`,
};

export interface SlipRow {
  weekday: number;
  code: string;
  title: string;
  units: number;
  score: number;
  grade: string;
  points: number;
  remark: string;
}

export interface ResultSlip {
  week: number;
  rows: SlipRow[];
  units: number;
  points: number;
  gpa: number;
  carried: number;
}

const DAYS_PER_WEEK = 7;
const GPA_PLACES = 100;

export const resultRemark = (score: number) => (score >= RESULT_PASS_MARK ? RESULT_REMARK.pass : RESULT_REMARK.carry);

export function testCoursesFor(tt: StudentTimetable, week: number): Course[] {
  const order = shuffled(tt.courses, randomFor(`tests:${tt.department}:${tt.level}:${week}`));
  const left = [...order];
  const out: Course[] = [];
  for (const weekday of order.length > 0 ? PAPER_DAYS : []) {
    if (left.length === 0) left.push(...order);
    const taught = new Set(tt.slots.filter((s) => s.weekday === weekday).map((s) => s.course.code));
    const found = left.findIndex((c) => taught.has(c.code));
    out.push(left.splice(found >= 0 ? found : 0, 1)[0]);
  }
  return out;
}

export function testCourseOn(tt: StudentTimetable, dayIndex: number): Course | undefined {
  const weekday = ((dayIndex % DAYS_PER_WEEK) + DAYS_PER_WEEK) % DAYS_PER_WEEK;
  return testCoursesFor(tt, Math.floor(dayIndex / DAYS_PER_WEEK))[paperIndex(weekday)];
}

export function recordResult(record: AdminRecord, week: number, weekday: number, course: Course, score: number): { result: AdminResult; carried: boolean } {
  const result: AdminResult = { week, weekday, code: course.code, title: course.title, units: course.units, score: Math.round(Math.max(0, Math.min(100, score))) };
  record.results = [...record.results.filter((r) => r.week !== week || r.weekday !== weekday), result].slice(-ADMIN_RESULTS_KEPT);
  const failed = result.score < RESULT_PASS_MARK;
  const carried = failed && !record.carry.some((c) => c.code === course.code && c.week === week + 1);
  if (carried) record.carry.push({ code: course.code, week: week + 1 });
  return { result, carried };
}

export function resultSlip(record: AdminRecord, week: number): ResultSlip {
  const rows = record.results
    .filter((r) => r.week === week)
    .sort((a, b) => a.weekday - b.weekday)
    .map((r): SlipRow => {
      const { grade, gp } = gradeFor(r.score);
      return { weekday: r.weekday, code: r.code, title: r.title, units: r.units, score: r.score, grade, points: gp * r.units, remark: resultRemark(r.score) };
    });
  const units = rows.reduce((sum, row) => sum + row.units, 0);
  const points = rows.reduce((sum, row) => sum + row.points, 0);
  return { week, rows, units, points, gpa: units ? Math.round((points / units) * GPA_PLACES) / GPA_PLACES : 0, carried: rows.filter((row) => row.remark === RESULT_REMARK.carry).length };
}

export const carryOverCodes = (record: AdminRecord, week: number) => record.carry.filter((c) => c.week === week).map((c) => c.code);

export function carryOverSlots(tt: StudentTimetable, codes: readonly string[], week: number): ClassSlot[] {
  const taken = new Set(tt.slots.map((s) => slotIndexOf(s.weekday, s.slot)));
  const out: ClassSlot[] = [];
  for (const code of [...new Set(codes)].sort()) {
    const course = tt.courses.find((c) => c.code === code);
    if (!course) continue;
    const seed = `carry:${tt.department}:${tt.level}:${code}:${week}`;
    const free = shuffled(Array.from({ length: WEEK_SLOTS }, (_, i) => i), randomFor(seed)).find((index) => !taken.has(index));
    if (free === undefined) break;
    taken.add(free);
    out.push({ course, weekday: slotWeekday(free), slot: free % SLOTS_PER_DAY, place: pickFrom(venuePool(course), randomFor(`${seed}:venue`)) });
  }
  return out;
}

export function timetableWithCarryOvers(tt: StudentTimetable, record: AdminRecord, week: number): StudentTimetable {
  const extra = carryOverSlots(tt, carryOverCodes(record, week), week);
  if (extra.length === 0) return tt;
  return { ...tt, slots: [...tt.slots, ...extra].sort((a, b) => a.weekday - b.weekday || a.slot - b.slot) };
}
