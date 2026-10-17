import { EVENTS, MINUTES_PER_DAY, type GameTime } from "../clock";
import { PLACES, type Point } from "../map";
import { FACULTY_TEAMS, facultyOfWeek, weekOf } from "../social/faculties";
import { SOCIAL_SITES } from "../social/place";
import { noveltyMatch } from "./league";
import { showsFor } from "./programme";
import { seeded } from "./seed";
import { RESERVED_SLOTS, SHOW_PARTY_GAP, VENUE_PLACE, type Show, type ShowKind, type ShowMoment, type SpecialShow, type VenueId } from "./types";

export type CalendarKind = "cultural" | "oldschool" | "novelty" | "dinner" | "rave" | "games" | "matric" | "signout" | "gyration";

export interface CalendarEvent {
  key: string;
  kind: CalendarKind;
  title: string;
  detail: string;
  where: string;
  place: number;
  at: Point;
  dayIndex: number;
  start: number;
  end: number;
  startTotal: number;
  endTotal: number;
  fee: number;
  color: number;
  faculty: number;
  big: boolean;
}

export interface WeekPlan {
  week: number;
  faculty: number;
  union: boolean;
  matric: boolean;
  signout: boolean;
  gyration: number;
}

interface Stage {
  kind: SpecialShow;
  venue: VenueId;
  weekday: number;
  start: number;
  end: number;
  show: ShowKind;
  act: string;
  fee: number;
  fun: number;
  dance: boolean;
  color: number;
  moments: readonly [share: number, text: string, fun: number][];
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

export const UNION_WEEK = { every: 6, offset: 2 } as const;
export const MATRIC = { every: 5, offset: 0 } as const;
export const SIGN_OUT = { every: 5, offset: 3, weekday: 4, start: at(12), end: at(18) } as const;
export const GYRATION = { chance: 0.65, weekdays: [0, 2, 6], start: at(20), end: at(23) } as const;
export const OLD_SCHOOL = { weekday: 3, start: at(8), end: at(18) } as const;
export const UNION_GAMES = { weekday: 3, start: at(13), end: at(17) } as const;
export const FACULTY_DINNER_FEE = 1500;

const STAGES: Record<SpecialShow, Stage> = {
  cultural: {
    kind: "cultural", venue: "amphi", weekday: 1, start: at(14), end: at(16, 30), show: "carnival", act: "Faculty dance troupe", fee: 0, fun: 1.1, dance: true, color: 0x2d6a4f,
    moments: [[0.25, "🥁 Talking drum don enter. Every department dey show their own.", 4], [0.6, "👘 Aso oke parade. The whole Amphi dey hail.", 5]],
  },
  dinner: {
    kind: "dinner", venue: "oduduwa", weekday: 6, start: at(20), end: at(22, 30), show: "dinner", act: "Faculty Students Association", fee: FACULTY_DINNER_FEE, fun: 1.2, dance: false, color: 0x1b1b1e,
    moments: [[0.3, "🏆 Most Sociable award don land. One table dey shout pass.", 4], [0.55, "🏆 Class Rep of the Year. Everybody know who e be.", 4], [0.8, "🏆 Best Dressed. The hall don stand up.", 5]],
  },
  rave: {
    kind: "rave", venue: "amphi", weekday: 1, start: at(21, 45), end: at(23, 55), show: "concert", act: "Director of Socials presents", fee: 0, fun: 1.4, dance: true, color: 0x7209b7,
    moments: [[0.2, "🔥 Union Week rave don start. The Amphi full reach road.", 5], [0.5, "📣 Great Ife! The crowd answer back.", 5], [0.8, "🎶 Last set. Nobody wan go hostel.", 5]],
  },
  matric: {
    kind: "matric", venue: "oduduwa", weekday: 1, start: at(10), end: at(12, 30), show: "lecture", act: "The Registrar", fee: 0, fun: 0.6, dance: false, color: 0x1e3a8a,
    moments: [[0.3, "🎓 Freshers don stand in blue gowns. Oath time.", 6], [0.7, "📸 Parents dey snap picture for every corner.", 5]],
  },
};

const TEXT = {
  cultural: (f: string) => `${f} Cultural Day`,
  dinner: (f: string) => `${f} Dinner and Awards Night`,
  oldschool: (f: string) => `${f} Old School Day`,
  novelty: (f: string) => `${f} novelty match`,
  rave: "Union Week Rave",
  games: "Union Week: Jollof and Games",
  matric: "Freshers' Matriculation",
  signout: "FYB Sign-out Day",
  gyration: "Kegites Gyration",
  oldschoolDetail: "Dress like your secondary school days. Faculty students get extra fun.",
  noveltyDetail: "Staff against students. Free at the touchline.",
  gamesDetail: "Free jollof and games at the forecourt.",
  signoutDetail: "Finalists in white shirts. Find one and sign the shirt.",
  gyrationDetail: "Drums, songs and palm wine at the shrine. Join the circle.",
  forecourt: "SUB forecourt",
  shrine: "Kegites shrine, by the SUB",
  campus: "Around the SUB and the faculties",
};
const COLORS: Record<CalendarKind, number> = { cultural: 0x2d6a4f, oldschool: 0x9a3412, novelty: 0x14532d, dinner: 0x1b1b1e, rave: 0x7209b7, games: 0xb45309, matric: 0x1e3a8a, signout: 0xf8fafc, gyration: 0x3f6212 };
const UNION = /student union/i;
const CACHE_DAYS = 32;

const union = PLACES.findIndex((p) => UNION.test(p.name));
const cycle = (week: number, every: number, offset: number) => ((week % every) + every) % every === offset;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

export function weekPlan(week: number): WeekPlan {
  const rand = seeded(week * 419 + 23);
  const on = rand() < GYRATION.chance;
  const weekday = GYRATION.weekdays[Math.floor(rand() * GYRATION.weekdays.length)];
  return {
    week,
    faculty: facultyOfWeek(week),
    union: cycle(week, UNION_WEEK.every, UNION_WEEK.offset),
    matric: cycle(week, MATRIC.every, MATRIC.offset),
    signout: cycle(week, SIGN_OUT.every, SIGN_OUT.offset),
    gyration: on && SOCIAL_SITES.gyration ? weekday : -1,
  };
}

function clashes(stage: Stage): boolean {
  if (RESERVED_SLOTS.some((r) => r.venue === stage.venue && r.weekday === stage.weekday && overlaps(stage.start, stage.end, r.start, r.end))) return true;
  return EVENTS.some((e) => e.id === "party" && e.weekdays.includes(stage.weekday) && overlaps(stage.start, stage.end + SHOW_PARTY_GAP, e.start, e.end));
}

function staged(stage: Stage, title: string, dayIndex: number, faculty: number): Show | undefined {
  const place = VENUE_PLACE[stage.venue];
  if (place < 0 || clashes(stage)) return undefined;
  const length = stage.end - stage.start;
  const moments: ShowMoment[] = stage.moments.map(([share, text, fun]) => ({ at: Math.round(length * share), text, fun }));
  return {
    key: `c${dayIndex}:${stage.kind}`,
    kind: stage.show,
    title,
    act: stage.act,
    venue: stage.venue,
    place,
    dayIndex,
    start: stage.start,
    end: stage.end,
    startTotal: dayIndex * MINUTES_PER_DAY + stage.start,
    endTotal: dayIndex * MINUTES_PER_DAY + stage.end,
    fee: stage.fee,
    fun: stage.fun,
    color: stage.color,
    dance: stage.dance,
    moments,
    faculty,
    special: stage.kind,
  };
}

const showCache = new Map<number, Show[]>();

export function specialShowsFor(dayIndex: number): Show[] {
  const hit = showCache.get(dayIndex);
  if (hit) return hit;
  const plan = weekPlan(weekOf(dayIndex));
  const weekday = ((dayIndex % 7) + 7) % 7;
  const team = FACULTY_TEAMS[plan.faculty];
  const out: (Show | undefined)[] = [];
  const add = (stage: Stage, title: string, faculty: number) => {
    if (stage.weekday === weekday) out.push(staged(stage, title, dayIndex, faculty));
  };
  if (team) {
    add(STAGES.cultural, TEXT.cultural(team.name), team.index);
    add(STAGES.dinner, TEXT.dinner(team.name), team.index);
  }
  if (plan.union) add(STAGES.rave, TEXT.rave, -1);
  if (plan.matric) add(STAGES.matric, TEXT.matric, -1);
  const shows = out.filter((s): s is Show => s !== undefined).sort((a, b) => a.start - b.start);
  if (showCache.size >= CACHE_DAYS) showCache.clear();
  showCache.set(dayIndex, shows);
  return shows;
}

function outdoor(kind: CalendarKind, title: string, detail: string, where: string, place: number, spot: Point, dayIndex: number, start: number, end: number, faculty = -1): CalendarEvent {
  return { key: `e${dayIndex}:${kind}`, kind, title, detail, where, place, at: spot, dayIndex, start, end, startTotal: dayIndex * MINUTES_PER_DAY + start, endTotal: dayIndex * MINUTES_PER_DAY + end, fee: 0, color: COLORS[kind], faculty, big: kind !== "oldschool" };
}

const calendarCache = new Map<number, CalendarEvent[]>();

export function calendarFor(dayIndex: number): CalendarEvent[] {
  const hit = calendarCache.get(dayIndex);
  if (hit) return hit;
  const week = weekOf(dayIndex);
  const plan = weekPlan(week);
  const weekday = ((dayIndex % 7) + 7) % 7;
  const team = FACULTY_TEAMS[plan.faculty];
  const out: CalendarEvent[] = specialShowsFor(dayIndex).map((s) => ({
    key: s.key, kind: s.special ?? "cultural", title: s.title, detail: s.act, where: PLACES[s.place].name, place: s.place, at: PLACES[s.place].door, dayIndex, start: s.start, end: s.end,
    startTotal: s.startTotal, endTotal: s.endTotal, fee: s.fee, color: s.color, faculty: s.faculty ?? -1, big: true,
  }));
  if (team && weekday === OLD_SCHOOL.weekday && team.place >= 0) out.push(outdoor("oldschool", TEXT.oldschool(team.name), TEXT.oldschoolDetail, PLACES[team.place].name, team.place, PLACES[team.place].door, dayIndex, OLD_SCHOOL.start, OLD_SCHOOL.end, team.index));
  const novelty = noveltyMatch(week);
  if (team && novelty && novelty.dayIndex === dayIndex && novelty.place >= 0) out.push(outdoor("novelty", TEXT.novelty(team.name), TEXT.noveltyDetail, PLACES[novelty.place].name, novelty.place, PLACES[novelty.place].door, dayIndex, novelty.kickoff, novelty.endTotal - dayIndex * MINUTES_PER_DAY, team.index));
  if (union >= 0) {
    const forecourt = SOCIAL_SITES.forecourt;
    const ring = SOCIAL_SITES.gyration;
    if (plan.union && weekday === UNION_GAMES.weekday && forecourt) out.push(outdoor("games", TEXT.games, TEXT.gamesDetail, TEXT.forecourt, union, forecourt, dayIndex, UNION_GAMES.start, UNION_GAMES.end));
    if (plan.signout && weekday === SIGN_OUT.weekday) out.push(outdoor("signout", TEXT.signout, TEXT.signoutDetail, TEXT.campus, union, PLACES[union].door, dayIndex, SIGN_OUT.start, SIGN_OUT.end));
    if (plan.gyration === weekday && ring) out.push(outdoor("gyration", TEXT.gyration, TEXT.gyrationDetail, TEXT.shrine, union, ring, dayIndex, GYRATION.start, GYRATION.end));
  }
  out.sort((a, b) => a.startTotal - b.startTotal);
  if (calendarCache.size >= CACHE_DAYS) calendarCache.clear();
  calendarCache.set(dayIndex, out);
  return out;
}

export function liveEvent(kind: CalendarKind, t: GameTime): CalendarEvent | undefined {
  return calendarFor(t.dayIndex).find((e) => e.kind === kind && t.total >= e.startTotal && t.total < e.endTotal);
}

export function weekCalendar(week: number): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (let d = 0; d < 7; d++) out.push(...calendarFor(week * 7 + d));
  return out;
}

export function facultyDayNote(dayIndex: number): string {
  const today = calendarFor(dayIndex).filter((e) => e.faculty >= 0);
  return today.length ? today.map((e) => e.title).join(" and ") : "";
}

export function allShowsFor(dayIndex: number): Show[] {
  const specials = specialShowsFor(dayIndex);
  return specials.length ? [...showsFor(dayIndex), ...specials].sort((a, b) => a.start - b.start) : showsFor(dayIndex);
}
