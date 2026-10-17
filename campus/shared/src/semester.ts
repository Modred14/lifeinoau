import type { GameTime } from "./clock";

const HOUR = 60;
const DAY = 24 * HOUR;
const at = (weekday: number, hour: number) => weekday * DAY + hour * HOUR;

export const SEMESTER_DAYS = 7;
export const SEMESTER_MINUTES = SEMESTER_DAYS * DAY;
export const REGISTRATION_DAYS: readonly number[] = [0, 1];
export const LECTURE_DAYS: readonly number[] = [2, 3, 4];
export const EXAM_DAY = 5;
export const BREAK_DAY = 6;
export const PAPER_DAYS: readonly number[] = [...LECTURE_DAYS, EXAM_DAY];

export const SEMESTER_TIMES = {
  registrationOpens: at(0, 0),
  registrationCloses: at(1, 18),
  ballotOpens: at(1, 9),
  ballotCloses: at(1, 15),
  lecturesBegin: at(LECTURE_DAYS[0], 8),
  lecturesEnd: at(LECTURE_DAYS[LECTURE_DAYS.length - 1], 18),
  lateBallotOpens: at(3, 16),
  lateBallotCloses: at(3, 18),
  testStart: 16 * HOUR,
  testEnd: 18 * HOUR,
  examStart: 10 * HOUR,
  examEnd: 14 * HOUR,
  resultsOut: at(BREAK_DAY, 8),
} as const;

export type SemesterPhaseId = "registration" | "lectures" | "exams" | "break";

export interface SemesterPhase {
  id: SemesterPhaseId;
  title: string;
  detail: string;
  start: number;
  end: number;
}

export const SEMESTER_PHASES: readonly SemesterPhase[] = [
  { id: "registration", title: "Registration", detail: "Register for this week and ballot for a bed space", start: at(0, 0), end: at(LECTURE_DAYS[0], 0) },
  { id: "lectures", title: "Lectures", detail: "Classes hold, with a test every evening", start: at(LECTURE_DAYS[0], 0), end: at(EXAM_DAY, 0) },
  { id: "exams", title: "Exams", detail: "Weekly assessment at the 1000 Seater", start: at(EXAM_DAY, 0), end: at(BREAK_DAY, 0) },
  { id: "break", title: "Results and break", detail: "Results are out. Rest before the next campus week", start: at(BREAK_DAY, 0), end: SEMESTER_MINUTES },
];

export interface SemesterMoment {
  id: "resume" | "regClose" | "ballot" | "lectures" | "lateBallot" | "exam" | "results";
  title: string;
  start: number;
  end: number;
}

export const SEMESTER_MOMENTS: readonly SemesterMoment[] = [
  { id: "resume", title: "Resumption. Course registration opens", start: SEMESTER_TIMES.registrationOpens, end: SEMESTER_TIMES.registrationCloses },
  { id: "ballot", title: "Bed space ballot", start: SEMESTER_TIMES.ballotOpens, end: SEMESTER_TIMES.ballotCloses },
  { id: "regClose", title: "Course registration closes", start: SEMESTER_TIMES.registrationCloses, end: SEMESTER_TIMES.registrationCloses },
  { id: "lectures", title: "Lectures, with a test each evening", start: SEMESTER_TIMES.lecturesBegin, end: SEMESTER_TIMES.lecturesEnd },
  { id: "lateBallot", title: "Late bed space ballot", start: SEMESTER_TIMES.lateBallotOpens, end: SEMESTER_TIMES.lateBallotCloses },
  { id: "exam", title: "Weekly assessment", start: at(EXAM_DAY, 0) + SEMESTER_TIMES.examStart, end: at(EXAM_DAY, 0) + SEMESTER_TIMES.examEnd },
  { id: "results", title: "Results out, then break", start: SEMESTER_TIMES.resultsOut, end: SEMESTER_MINUTES },
];

const SEMESTER_NAMES = ["Harmattan", "Rain"] as const;
const SEMESTERS_PER_SESSION = SEMESTER_NAMES.length;
const FIRST_SESSION_YEAR = 2025;

const wrap = (n: number, by: number) => ((n % by) + by) % by;

export const semesterOf = (total: number) => Math.floor(total / SEMESTER_MINUTES);
export const semesterStart = (semester: number) => semester * SEMESTER_MINUTES;
export const semesterMinute = (total: number) => total - semesterStart(semesterOf(total));
export const semesterName = (semester: number) => SEMESTER_NAMES[wrap(semester, SEMESTERS_PER_SESSION)];

export function sessionName(semester: number): string {
  const year = FIRST_SESSION_YEAR + Math.floor(semester / SEMESTERS_PER_SESSION);
  return `${year}/${year + 1}`;
}

export function semesterPhase(total: number): SemesterPhase {
  const minute = semesterMinute(total);
  return SEMESTER_PHASES.find((phase) => minute >= phase.start && minute < phase.end) ?? SEMESTER_PHASES[0];
}

export const isLectureDay = (weekday: number) => LECTURE_DAYS.includes(weekday);
export const isPaperDay = (weekday: number) => PAPER_DAYS.includes(weekday);
export const paperIndex = (weekday: number) => PAPER_DAYS.indexOf(weekday);
export const paperName = (weekday: number) => (weekday === EXAM_DAY ? "exam" : "test");

export type SemesterStage = "done" | "now" | "next";

export interface SemesterEntry extends SemesterMoment {
  stage: SemesterStage;
  startTotal: number;
  endTotal: number;
}

export interface SemesterView {
  semester: number;
  name: string;
  session: string;
  phase: SemesterPhase;
  day: number;
  endsIn: number;
  entries: SemesterEntry[];
}

export function semesterView(t: Pick<GameTime, "total" | "weekday">): SemesterView {
  const semester = semesterOf(t.total);
  const from = semesterStart(semester);
  const minute = t.total - from;
  const phase = semesterPhase(t.total);
  const entries = SEMESTER_MOMENTS.map((moment): SemesterEntry => {
    const stage: SemesterStage = minute >= Math.max(moment.end, moment.start + 1) ? "done" : minute >= moment.start ? "now" : "next";
    return { ...moment, stage, startTotal: from + moment.start, endTotal: from + moment.end };
  });
  return { semester, name: semesterName(semester), session: sessionName(semester), phase, day: Math.floor(minute / DAY) + 1, endsIn: phase.end - minute, entries };
}
