import type { Course } from "./courses";

export type AttendanceBook = Record<string, number[]>;

export interface ClassesPayload {
  department: string;
  level: string;
  book: AttendanceBook;
}

export const ATTENDANCE_RULE_PERCENT = 75;
export const ATTENDANCE_RULE_MIN_CLASSES = 3;
export const ATTENDANCE_PENALTY_MARKS = 4;
export const ATTENDANCE_PENALTY_CAP = 12;
const FULL = 100;
const NO_SESSION = -1;
const SIGNED = 0;
const HELD = 1;
const LAST_HELD = 2;
const LAST_SIGNED = 3;
const LAST_SNAP = 4;
const ENTRY_LENGTH = 4;
const RECENT_FROM = 5;
const RECENT_SIGNED = 5;
const MAX_ENTRY_LENGTH = RECENT_FROM + RECENT_SIGNED;
const MAX_BOOK_COURSES = 40;
const MAX_CODE_LENGTH = 12;

function entryOf(book: AttendanceBook, code: string): number[] {
  const entry = (book[code] ??= [0, 0, NO_SESSION, NO_SESSION, NO_SESSION]);
  if (entry.length <= LAST_SNAP) entry[LAST_SNAP] = NO_SESSION;
  return entry;
}

const lastTouched = (entry: readonly number[]) => Math.max(entry[LAST_HELD], entry[LAST_SIGNED], entry[LAST_SNAP] ?? NO_SESSION);

export function signedSession(book: AttendanceBook, code: string, session: number): boolean {
  const entry = book[code];
  if (!entry) return false;
  return entry[LAST_SIGNED] === session || entry.indexOf(session, RECENT_FROM) >= 0;
}

export function markSnap(book: AttendanceBook, code: string, session: number): boolean {
  const entry = entryOf(book, code);
  if (entry[LAST_SNAP] === session) return false;
  entry[LAST_SNAP] = session;
  return true;
}

export function attendancePercent(signed: number, held: number): number {
  if (held <= 0) return FULL;
  return Math.round((Math.min(signed, held) / held) * FULL);
}

export function belowAttendanceRule(signed: number, held: number): boolean {
  return held >= ATTENDANCE_RULE_MIN_CLASSES && attendancePercent(signed, held) < ATTENDANCE_RULE_PERCENT;
}

export function courseAttendance(book: AttendanceBook, code: string): { signed: number; held: number; percent: number; low: boolean; lastSigned: number } {
  const entry = book[code];
  const signed = entry?.[SIGNED] ?? 0;
  const held = entry?.[HELD] ?? 0;
  return { signed, held, percent: attendancePercent(signed, held), low: belowAttendanceRule(signed, held), lastSigned: entry?.[LAST_SIGNED] ?? NO_SESSION };
}

export function attendancePenalty(book: AttendanceBook, courses: readonly Course[]): number {
  const low = courses.filter((course) => courseAttendance(book, course.code).low).length;
  return Math.min(ATTENDANCE_PENALTY_CAP, low * ATTENDANCE_PENALTY_MARKS);
}

export function markHeld(book: AttendanceBook, code: string, session: number): boolean {
  const entry = entryOf(book, code);
  if (entry[LAST_HELD] === session) return false;
  entry[LAST_HELD] = session;
  entry[HELD]++;
  return true;
}

export function markSigned(book: AttendanceBook, code: string, session: number): boolean {
  const entry = entryOf(book, code);
  if (entry[LAST_SIGNED] === session) return false;
  markHeld(book, code, session);
  entry[LAST_SIGNED] = session;
  entry[SIGNED]++;
  entry.push(session);
  if (entry.length > MAX_ENTRY_LENGTH) entry.splice(RECENT_FROM, entry.length - MAX_ENTRY_LENGTH);
  return true;
}

export function sanitizeBook(raw: unknown): AttendanceBook {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const rows: [string, number[]][] = [];
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    if (code.length === 0 || code.length > MAX_CODE_LENGTH) continue;
    if (!Array.isArray(value) || value.length < ENTRY_LENGTH || value.length > MAX_ENTRY_LENGTH || !value.every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    const [signed, held, ...sessions] = (value as number[]).map(Math.floor);
    const heldCount = Math.max(0, held);
    rows.push([code, [Math.min(Math.max(0, signed), heldCount), heldCount, ...sessions.map((session) => Math.max(NO_SESSION, session))]]);
  }
  if (rows.length > MAX_BOOK_COURSES) {
    const order = new Map(rows.map(([code], i) => [code, i]));
    rows.sort((a, b) => lastTouched(b[1]) - lastTouched(a[1]));
    rows.length = MAX_BOOK_COURSES;
    rows.sort((a, b) => order.get(a[0])! - order.get(b[0])!);
  }
  return Object.fromEntries(rows);
}

export function attendanceShare(book: AttendanceBook, classes: readonly { code: string; session: number }[]): number {
  if (classes.length === 0) return 1;
  return classes.filter((c) => signedSession(book, c.code, c.session)).length / classes.length;
}

export function parseClassesPayload(raw: unknown): ClassesPayload | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const p = raw as Record<string, unknown>;
  if (typeof p.department !== "string" || typeof p.level !== "string") return undefined;
  return { department: p.department, level: p.level, book: sanitizeBook(p.book) };
}
