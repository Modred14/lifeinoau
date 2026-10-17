import { signedSession } from "../academics/attendance";
import { classPhase, classesOn, sheetGoingRound, type DayClass } from "../academics/day";
import { timetableFor, type StudentTimetable } from "../academics/timetable";
import { adminWeek } from "../admin/portal";
import { timetableWithCarryOvers } from "../admin/results";
import { MINUTES_PER_DAY, type GameTime } from "../clock";
import { PLACES } from "../map";
import { boycottAt } from "./glue";
import { GIST_PRIORITY, gistClock, soonness, type GistItem, type GistMe } from "./types";

const TEXT = {
  on: (code: string) => `${code} dey on`,
  next: (code: string, start: number) => `${code} by ${gistClock(start)}`,
  late: (code: string) => `${code}: lecturer never show`,
  sit: (venue: string, end: number) => `${venue} till ${gistClock(end)}. Sit down for attendance`,
  sheet: (venue: string) => `Attendance sheet is going round at ${venue}`,
  signed: (venue: string, end: number) => `Attendance signed. ${venue} till ${gistClock(end)}`,
  wait: (venue: string) => `Class rep says wait small at ${venue}`,
  at: (venue: string) => venue,
  shifted: (venue: string) => `Shifted today. Now at ${venue}`,
  boycott: "Boycott of lectures",
  boycottDetail: "No class today. Attendance no dey count",
};

export function myTimetable(me: Pick<GistMe, "department" | "level" | "admin">, t: GameTime): StudentTimetable {
  const base = timetableFor(me.department, me.level);
  return me.admin ? timetableWithCarryOvers(base, me.admin, adminWeek(t)) : base;
}

export function myClassesOn(me: Pick<GistMe, "department" | "level" | "admin">, t: GameTime): DayClass[] {
  return classesOn(myTimetable(me, t), t.dayIndex);
}

function classItem(c: DayClass, t: GameTime, me: GistMe): GistItem {
  const dayStart = t.dayIndex * MINUTES_PER_DAY;
  const phase = classPhase(c, t.minute);
  const venue = PLACES[c.place].name;
  const signed = signedSession(me.book ?? {}, c.course.code, c.session);
  const live = phase === "on" || phase === "waiting";
  const act = phase === "on" && !signed;
  let title = TEXT.next(c.course.code, c.start);
  let detail = c.status === "shifted" ? TEXT.shifted(venue) : TEXT.at(venue);
  if (phase === "on") {
    title = TEXT.on(c.course.code);
    detail = signed ? TEXT.signed(venue, c.end) : sheetGoingRound(c, t.minute) ? TEXT.sheet(venue) : TEXT.sit(venue, c.end);
  } else if (phase === "waiting") {
    title = TEXT.late(c.course.code);
    detail = TEXT.wait(venue);
  }
  const base = act ? GIST_PRIORITY.act : live ? GIST_PRIORITY.live : GIST_PRIORITY.mine;
  return { id: `class:${c.key}`, kind: "class", title, detail, start: dayStart + c.start, end: dayStart + c.end, live, act, priority: base + soonness(dayStart + c.start, t.total), place: c.place, door: PLACES[c.place].door, where: venue };
}

export function classGist(t: GameTime, me: GistMe): GistItem[] {
  const left = myClassesOn(me, t).filter((c) => {
    const phase = classPhase(c, t.minute);
    return phase !== "done" && phase !== "cancelled";
  });
  if (left.length === 0) return [];
  if (boycottAt(me.states ?? [], t.total)) {
    const dayStart = t.dayIndex * MINUTES_PER_DAY;
    return [{ id: `boycott:${t.dayIndex}`, kind: "class", title: TEXT.boycott, detail: TEXT.boycottDetail, start: t.total, end: dayStart + left[left.length - 1].end, live: true, act: false, priority: GIST_PRIORITY.mine }];
  }
  return [classItem(left[0], t, me)];
}
