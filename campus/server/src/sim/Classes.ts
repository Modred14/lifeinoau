import {
  ATTENDANCE_MINUTES,
  ATTENDANCE_RULE_PERCENT,
  BOYCOTT_TEXT,
  MINUTES_PER_DAY,
  NOSHOW_REVEAL_MINUTES,
  PLACES,
  REAL_SECONDS_PER_GAME_MINUTE,
  SHEET_WINDOW_MINUTES,
  attendancePenalty,
  attendanceShare,
  classesOn,
  courseAttendance,
  markHeld,
  markSigned,
  markSnap,
  sanitizeBook,
  sheetGoingRound,
  snapTestOn,
  timetableFor,
  type AttendanceBook,
  type ClassesPayload,
  type DayClass,
  type GameTime,
  type StudentTimetable,
} from "@campuslife/shared";

export interface ClassStudent {
  department: string;
  level: string;
  study: number;
  weekStudy: number;
  studySeconds: number;
  attended: number;
  weekAttended: number;
  rusticatedUntil: number;
  attendance: AttendanceBook;
}

export interface ClassesHost {
  notify(id: string, text: string): void;
  send(id: string, payload: ClassesPayload): void;
  random?: () => number;
  timetable?: (id: string, now: GameTime) => StudentTimetable | undefined;
  boycott?: () => boolean;
}

interface Desk {
  timetable: StudentTimetable;
  dayIndex: number;
  classes: DayClass[];
  said: Set<string>;
  minutes: Map<string, number>;
  since: number;
}

export const HEADS_UP_MINUTES = 30;
export const ATTENDANCE_STUDY_POINTS = 3;
export const SNAP_QUESTIONS = 5;
export const TEST_ATTENDANCE_MARKS = 24;
const NOSHOW_NOTICE_MINUTES = 10;
const ARRIVAL_NOTICE_MINUTES = 5;
const CLOSE_MINUTES = 5;
const FAIR_CHANCE_MINUTES = ATTENDANCE_MINUTES + 20;
const SNAP_BASE_CHANCE = 0.3;
const SNAP_BEST_CHANCE = 0.9;
const SNAP_STUDY_FOR_BEST = 180;
const MAX_STUDY = 65535;
const MAX_WEEK_ATTENDED = 255;
const NOT_SEATED = -1;
const BOYCOTT_KEY = "boycott";

const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const venue = (c: DayClass) => PLACES[c.place].name;
const fairChance = (c: DayClass, since: number, dayStart: number): boolean =>
  c.sheet !== undefined ? since < dayStart + c.sheet + SHEET_WINDOW_MINUTES : since <= dayStart + c.end - FAIR_CHANCE_MINUTES;

const TEXT = {
  soon: (c: DayClass) => `📚 Your next class: ${c.course.code} by ${hhmm(c.start)} at ${venue(c)}.`,
  shifted: (c: DayClass) => `🔁 ${c.course.code} don shift today. Now ${hhmm(c.start)} at ${venue(c)}.`,
  late: (c: DayClass) => `⏳ ${c.course.code}: ${c.course.lecturer.name} never show. Class rep says wait small.`,
  arrived: (c: DayClass) => `👣 ${c.course.lecturer.name} don enter. ${c.course.code} has started at ${venue(c)}.`,
  noshow: (c: DayClass) => `🚶 ${c.course.code}: lecturer no show, class rep says make una go.`,
  sheet: (c: DayClass) => `📝 ${c.course.code}: attendance sheet is going round at ${venue(c)}!`,
  signed: (c: DayClass) => `✅ Attendance signed: ${c.course.code}. +${ATTENDANCE_STUDY_POINTS} study points.`,
  snap: (c: DayClass, right: number) => `⚡ Snap test from ${c.course.lecturer.name}! You got ${right}/${SNAP_QUESTIONS}. +${right} study points.`,
  low: (c: DayClass, percent: number) => `⚠️ ${c.course.code} attendance is ${percent}%. Under ${ATTENDANCE_RULE_PERCENT}% and you lose marks in the daily test.`,
};

export class Classes {
  private desks = new Map<string, Desk>();
  private random: () => number;

  constructor(private host: ClassesHost) {
    this.random = host.random ?? Math.random;
  }

  join(id: string, student: ClassStudent, now: GameTime) {
    const timetable = this.host.timetable?.(id, now) ?? timetableFor(student.department, student.level);
    student.attendance = sanitizeBook(student.attendance);
    this.desks.set(id, { timetable, dayIndex: now.dayIndex, classes: classesOn(timetable, now.dayIndex), said: new Set(), minutes: new Map(), since: now.total });
    this.sync(id, student);
  }

  leave(id: string) {
    this.desks.delete(id);
  }

  penalty(student: ClassStudent): number {
    if (this.host.boycott?.()) return 0;
    return attendancePenalty(student.attendance, timetableFor(student.department, student.level).courses);
  }

  today(id: string): readonly DayClass[] {
    return this.desks.get(id)?.classes ?? [];
  }

  resend(id: string, student: ClassStudent) {
    if (this.desks.has(id)) this.sync(id, student);
  }

  testMarks(id: string, student: ClassStudent, now: GameTime): number {
    if (this.host.boycott?.()) return TEST_ATTENDANCE_MARKS;
    const desk = this.deskFor(id, student, now);
    const dayStart = now.dayIndex * MINUTES_PER_DAY;
    const held = desk.classes
      .filter((c) => c.status !== "noshow" && c.end <= now.minute && fairChance(c, desk.since, dayStart))
      .map((c) => ({ code: c.course.code, session: c.session }));
    return TEST_ATTENDANCE_MARKS * attendanceShare(student.attendance, held);
  }

  tick(id: string, student: ClassStudent, now: GameTime, dt: number, seatedPlace: number = NOT_SEATED) {
    const desk = this.deskFor(id, student, now);
    if (this.host.boycott?.()) return this.boycotted(id, desk, now.minute);
    for (const c of desk.classes) {
      this.headsUp(id, desk, c, now.minute);
      if (c.status === "noshow") continue;
      if (now.minute >= c.begins && now.minute < c.end && seatedPlace === c.place) this.seated(id, student, desk, c, now, dt);
      const closing = now.minute >= c.end - CLOSE_MINUTES && now.minute < c.end;
      const dayStart = now.dayIndex * MINUTES_PER_DAY;
      if (closing && fairChance(c, desk.since, dayStart)) this.close(id, student, c);
    }
  }

  private deskFor(id: string, student: ClassStudent, now: GameTime): Desk {
    let desk = this.desks.get(id);
    if (!desk) {
      this.join(id, student, now);
      desk = this.desks.get(id)!;
    }
    if (desk.dayIndex !== now.dayIndex) {
      desk.dayIndex = now.dayIndex;
      desk.timetable = this.host.timetable?.(id, now) ?? desk.timetable;
      desk.classes = classesOn(desk.timetable, now.dayIndex);
      desk.said.clear();
      desk.minutes.clear();
    }
    return desk;
  }

  private boycotted(id: string, desk: Desk, minute: number) {
    const next = desk.classes.find((c) => c.end > minute);
    if (next && minute >= next.start - HEADS_UP_MINUTES) this.say(id, desk, BOYCOTT_KEY, BOYCOTT_TEXT.toast);
  }

  private say(id: string, desk: Desk, key: string, text: string) {
    if (desk.said.has(key)) return;
    desk.said.add(key);
    this.host.notify(id, text);
  }

  private headsUp(id: string, desk: Desk, c: DayClass, minute: number) {
    if (minute >= c.start - HEADS_UP_MINUTES && minute < c.start) this.say(id, desk, `soon:${c.key}`, c.status === "shifted" ? TEXT.shifted(c) : TEXT.soon(c));
    if (c.status === "late") {
      if (minute >= c.start && minute < c.begins) this.say(id, desk, `late:${c.key}`, TEXT.late(c));
      if (minute >= c.begins && minute < c.begins + ARRIVAL_NOTICE_MINUTES) this.say(id, desk, `in:${c.key}`, TEXT.arrived(c));
    }
    if (c.status === "noshow") {
      const from = c.start + NOSHOW_REVEAL_MINUTES;
      if (minute >= from && minute < from + NOSHOW_NOTICE_MINUTES) this.say(id, desk, `gone:${c.key}`, TEXT.noshow(c));
    }
    if (sheetGoingRound(c, minute)) this.say(id, desk, `sheet:${c.key}`, TEXT.sheet(c));
  }

  private seated(id: string, student: ClassStudent, desk: Desk, c: DayClass, now: GameTime, dt: number) {
    student.studySeconds += dt;
    if (snapTestOn(c, now.minute) && markSnap(student.attendance, c.course.code, c.session)) this.snapTest(id, student, c);
    if (now.total < student.rusticatedUntil) return;
    if (c.sheet !== undefined) {
      if (sheetGoingRound(c, now.minute)) this.sign(id, student, c);
      return;
    }
    const minutes = (desk.minutes.get(c.key) ?? 0) + dt / REAL_SECONDS_PER_GAME_MINUTE;
    desk.minutes.set(c.key, minutes);
    if (minutes >= ATTENDANCE_MINUTES) this.sign(id, student, c);
  }

  private sign(id: string, student: ClassStudent, c: DayClass) {
    if (!markSigned(student.attendance, c.course.code, c.session)) return;
    student.attended++;
    student.weekAttended = Math.min(MAX_WEEK_ATTENDED, student.weekAttended + 1);
    this.addStudy(student, ATTENDANCE_STUDY_POINTS);
    this.host.notify(id, TEXT.signed(c));
    this.sync(id, student);
  }

  private snapTest(id: string, student: ClassStudent, c: DayClass) {
    const chance = Math.min(SNAP_BEST_CHANCE, SNAP_BASE_CHANCE + ((SNAP_BEST_CHANCE - SNAP_BASE_CHANCE) * student.study) / SNAP_STUDY_FOR_BEST);
    let right = 0;
    for (let q = 0; q < SNAP_QUESTIONS; q++) if (this.random() < chance) right++;
    this.addStudy(student, right);
    this.host.notify(id, TEXT.snap(c, right));
  }

  private close(id: string, student: ClassStudent, c: DayClass) {
    if (!markHeld(student.attendance, c.course.code, c.session)) return;
    const record = courseAttendance(student.attendance, c.course.code);
    if (record.low) this.host.notify(id, TEXT.low(c, record.percent));
    this.sync(id, student);
  }

  private addStudy(student: ClassStudent, points: number) {
    student.study = Math.min(MAX_STUDY, student.study + points);
    student.weekStudy = Math.min(MAX_STUDY, student.weekStudy + points);
  }

  private sync(id: string, student: ClassStudent) {
    this.host.send(id, { department: student.department, level: student.level, book: student.attendance });
  }
}
