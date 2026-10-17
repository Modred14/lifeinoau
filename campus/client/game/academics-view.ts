import {
  ATTENDANCE_RULE_PERCENT,
  BOYCOTT_TEXT,
  CLASS_MINUTES,
  LECTURE_DAYS,
  DAYS,
  EVENTS,
  MINUTES_PER_DAY,
  NOSHOW_REVEAL_MINUTES,
  PLACES,
  SLOTS_PER_DAY,
  TEMPERAMENT_LABEL,
  adminWeek,
  attendancePenalty,
  boycottAt,
  classPhase,
  classesOn,
  courseAttendance,
  gstClassesOn,
  parseClassesPayload,
  sheetGoingRound,
  signedSession,
  slotStart,
  timetableFor,
  timetableWithCarryOvers,
  type AttendanceBook,
  type ClassPhase,
  type Course,
  type DayClass,
  type GameTime,
  type Point,
  type StudentTimetable,
} from "@campuslife/shared";
import { campusFeed } from "./gist-view";

export interface StudentRecord {
  department: string;
  level: string;
  book: AttendanceBook;
}

export const NO_RECORD: StudentRecord = { department: "", level: "", book: {} };

export type ClassState = "holding" | "shifted" | "late" | "on" | "cancelled" | "done";

export interface ClassView {
  key: string;
  code: string;
  title: string;
  course: string;
  lecturer: string;
  venue: string;
  place: number;
  door: Point;
  start: number;
  end: number;
  state: ClassState;
  note: string;
  signed: boolean;
  sheet: boolean;
  boycott: boolean;
  carry: boolean;
}

export interface DayView {
  name: string;
  today: boolean;
  classes: ClassView[];
}

export interface CourseView {
  code: string;
  title: string;
  units: number;
  gst: boolean;
  lecturer: string;
  temperament: string;
  signed: number;
  held: number;
  percent: number;
  low: boolean;
}

export interface EventView {
  title: string;
  days: string;
  start: number;
  end: number;
}

export interface TimetableView {
  today: string;
  minute: number;
  lectures: ClassView[];
  week: DayView[];
  courses: CourseView[];
  events: EventView[];
  penalty: number;
  rule: number;
  boycott: boolean;
}

export interface VenueClass {
  key: string;
  lecturerIn: boolean;
}

export interface HudClass {
  course: string;
  place: number;
  start: number;
  end: number;
}

const STATE_OF: Record<ClassPhase, ClassState> = { scheduled: "holding", shifted: "shifted", waiting: "late", on: "on", cancelled: "cancelled", done: "done" };
const DAY_ABBREVIATION = 3;
const NOTE = {
  on: "On now. Sit in a seat for attendance",
  sheet: "Sheet is going round. Sit down now",
  late: "Lecturer never show. Wait small",
  cancelled: "Lecturer no show. Class cancelled",
  signed: "Attendance signed",
  moved: (from: string) => `Shifted from ${from} today`,
  carry: "Carry-over class",
};
const OFF = { state: "cancelled" as ClassState, note: BOYCOTT_TEXT.note, sheet: false, boycott: true };

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function readRecord(payload: unknown): StudentRecord | undefined {
  return parseClassesPayload(payload);
}

interface Table {
  tt: StudentTimetable;
  extra: ReadonlySet<string>;
}

const slotKey = (weekday: number, slot: number) => `${weekday}:${slot}`;

function tableFor(record: StudentRecord, t: GameTime): Table {
  const plain = timetableFor(record.department, record.level);
  const admin = campusFeed().admin;
  const tt = admin ? timetableWithCarryOvers(plain, admin, adminWeek(t)) : plain;
  if (tt === plain) return { tt, extra: new Set() };
  const usual = new Set(plain.slots.map((s) => slotKey(s.weekday, s.slot)));
  return { tt, extra: new Set(tt.slots.map((s) => slotKey(s.weekday, s.slot)).filter((key) => !usual.has(key))) };
}

const boycottNow = (total: number) => boycottAt(campusFeed().states, total);

function base(course: Course, place: number, start: number, key: string): Omit<ClassView, "state" | "note" | "signed" | "sheet" | "boycott" | "carry"> {
  return {
    key,
    code: course.code,
    title: course.title,
    course: `${course.code} ${course.title}`,
    lecturer: course.lecturer.name,
    venue: PLACES[place].name,
    place,
    door: PLACES[place].door,
    start,
    end: start + CLASS_MINUTES,
  };
}

function noteFor(c: DayClass, state: ClassState, signed: boolean, sheet: boolean): string {
  if (signed) return NOTE.signed;
  if (state === "on") return sheet ? NOTE.sheet : NOTE.on;
  if (state === "late") return NOTE.late;
  if (state === "cancelled") return NOTE.cancelled;
  if (c.from && state !== "done") return NOTE.moved(c.from.start !== c.start ? hhmm(c.from.start) : PLACES[c.from.place].name);
  return "";
}

function liveClass(c: DayClass, minute: number, book: AttendanceBook, dayStart: number, carry: boolean): ClassView {
  const state = STATE_OF[classPhase(c, minute)];
  const signed = signedSession(book, c.course.code, c.session);
  const sheet = state === "on" && !signed && sheetGoingRound(c, minute);
  const view = { ...base(c.course, c.place, c.start, c.key), state, note: noteFor(c, state, signed, sheet) || (carry ? NOTE.carry : ""), signed, sheet, boycott: false, carry };
  const off = !signed && state !== "done" && state !== "cancelled" && boycottNow(dayStart + Math.max(minute, c.start));
  return off ? { ...view, ...OFF } : view;
}

function weekOf(record: StudentRecord, t: GameTime): DayView[] {
  const { tt, extra } = tableFor(record, t);
  const monday = t.dayIndex - t.weekday;
  return LECTURE_DAYS.map((weekday) => {
    const name = DAYS[weekday];
    if (weekday > t.weekday) {
      const classes = tt.slots
        .filter((s) => s.weekday === weekday)
        .map((s): ClassView => {
          const carry = extra.has(slotKey(weekday, s.slot));
          const view: ClassView = { ...base(s.course, s.place, slotStart(s.slot), `${s.course.code}:${weekday}:${s.slot}`), state: "holding", note: carry ? NOTE.carry : "", signed: false, sheet: false, boycott: false, carry };
          return boycottNow((monday + weekday) * MINUTES_PER_DAY + view.start) ? { ...view, ...OFF } : view;
        });
      return { name, today: false, classes };
    }
    const today = weekday === t.weekday;
    const minute = today ? t.minute : MINUTES_PER_DAY;
    return { name, today, classes: classesOn(tt, monday + weekday).map((c) => liveClass(c, minute, record.book, (monday + weekday) * MINUTES_PER_DAY, extra.has(slotKey(weekday, c.session % SLOTS_PER_DAY)))) };
  });
}

function coursesOf(record: StudentRecord): CourseView[] {
  return timetableFor(record.department, record.level).courses.map((course) => {
    const { signed, held, percent, low } = courseAttendance(record.book, course.code);
    return { code: course.code, title: course.title, units: course.units, gst: course.gst, lecturer: course.lecturer.name, temperament: TEMPERAMENT_LABEL[course.lecturer.temperament], signed, held, percent, low };
  });
}

let cached: { record: StudentRecord; total: number; version: number; view: TimetableView } | undefined;

export function timetableView(record: StudentRecord, t: GameTime): TimetableView {
  const version = campusFeed().version;
  if (cached && cached.record === record && cached.total === t.total && cached.version === version) return cached.view;
  const week = weekOf(record, t);
  const view: TimetableView = {
    today: DAYS[t.weekday],
    minute: t.minute,
    lectures: week.find((day) => day.today)?.classes ?? [],
    week,
    courses: coursesOf(record),
    events: EVENTS.map((e) => ({ title: e.title, days: e.weekdays.map((d) => DAYS[d].slice(0, DAY_ABBREVIATION)).join(" & "), start: e.start, end: e.end })),
    penalty: attendancePenalty(record.book, timetableFor(record.department, record.level).courses),
    rule: ATTENDANCE_RULE_PERCENT,
    boycott: boycottNow(t.total),
  };
  cached = { record, total: t.total, version, view };
  return view;
}

function ownClasses(record: StudentRecord, t: GameTime): DayClass[] {
  return classesOn(tableFor(record, t).tt, t.dayIndex);
}

const asHud = (c: DayClass): HudClass => ({ course: c.course.code, place: c.place, start: c.start, end: c.end });

export function hudClassNow(record: StudentRecord, t: GameTime): HudClass | undefined {
  if (boycottNow(t.total)) return undefined;
  const c = ownClasses(record, t).find((x) => classPhase(x, t.minute) === "on");
  return c && asHud(c);
}

export function hudClassNext(record: StudentRecord, t: GameTime): HudClass | undefined {
  const c = ownClasses(record, t).find((x) => x.start > t.minute && !boycottNow(t.dayIndex * MINUTES_PER_DAY + x.start));
  return c && asHud(c);
}

export function venueClass(place: number, record: StudentRecord, t: GameTime): VenueClass | undefined {
  if (place < 0) return undefined;
  const c = [...ownClasses(record, t), ...gstClassesOn(t.dayIndex)].find((x) => {
    const until = x.status === "noshow" ? x.start + NOSHOW_REVEAL_MINUTES : x.end;
    return x.place === place && t.minute >= x.start && t.minute < until;
  });
  return c && { key: c.key, lecturerIn: c.status !== "noshow" && t.minute >= c.begins };
}
