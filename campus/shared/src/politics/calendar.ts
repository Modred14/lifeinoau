import { DAYS, MINUTES_PER_DAY, type GameTime } from "../clock";
import { polRandom, polShuffle } from "./seed";

const HOUR = 60;
const at = (weekday: number, hour: number) => weekday * MINUTES_PER_DAY + hour * HOUR;
const COLLATION_MINUTES = 24;

export const WEEK_MINUTES = 7 * MINUTES_PER_DAY;
export const ELECTION_TIMES = {
  formsOpen: at(0, 8),
  lateForms: at(1, 0),
  formsClose: at(1, 12),
  campaignOpen: at(1, 6),
  campaignClose: at(3, 18),
  debateStart: at(3, 19),
  debateEnd: at(3, 22),
  pollsOpen: at(4, 8),
  pollsClose: at(4, 16),
  results: at(4, 18),
  declaration: at(4, 18) + COLLATION_MINUTES,
  swearingIn: at(5, 10),
} as const;

export type ElectionPhase = "forms" | "campaign" | "debate" | "voting" | "counting" | "results" | "handover";

export const electionCycle = (t: GameTime): number => Math.floor(t.dayIndex / 7);
export const weekMinute = (t: GameTime): number => t.weekday * MINUTES_PER_DAY + t.minute;

export function electionPhase(t: GameTime): ElectionPhase {
  const m = weekMinute(t);
  if (m < at(1, 0)) return "forms";
  if (m < at(3, 0)) return "campaign";
  if (m < at(4, 0)) return "debate";
  if (m < ELECTION_TIMES.pollsClose) return "voting";
  if (m < ELECTION_TIMES.results) return "counting";
  if (m < ELECTION_TIMES.swearingIn) return "results";
  return "handover";
}

const between = (t: GameTime, from: number, to: number) => weekMinute(t) >= from && weekMinute(t) < to;
export const formsOnSale = (t: GameTime) => between(t, ELECTION_TIMES.formsOpen, ELECTION_TIMES.formsClose);
export const lateForm = (t: GameTime) => weekMinute(t) >= ELECTION_TIMES.lateForms;
export const campaignsOpen = (t: GameTime) => between(t, ELECTION_TIMES.campaignOpen, ELECTION_TIMES.campaignClose);
export const debateOn = (t: GameTime) => between(t, ELECTION_TIMES.debateStart, ELECTION_TIMES.debateEnd);
export const pollsOpen = (t: GameTime) => between(t, ELECTION_TIMES.pollsOpen, ELECTION_TIMES.pollsClose);
export const resultsOut = (t: GameTime) => weekMinute(t) >= ELECTION_TIMES.results;
export const resultsDeclared = (t: GameTime) => weekMinute(t) >= ELECTION_TIMES.declaration;
export const swornIn = (t: GameTime) => weekMinute(t) >= ELECTION_TIMES.swearingIn;
export const termCycle = (t: GameTime): number => electionCycle(t) - (swornIn(t) ? 0 : 1);

export interface CalendarEntry {
  phase: ElectionPhase;
  start: number;
  end: number;
  title: string;
  where: string;
}

export const ELECTION_CALENDAR: readonly CalendarEntry[] = [
  { phase: "forms", start: ELECTION_TIMES.formsOpen, end: ELECTION_TIMES.formsClose, title: "SUIEC sells nomination forms", where: "Student Union Building" },
  { phase: "campaign", start: ELECTION_TIMES.campaignOpen, end: ELECTION_TIMES.campaignClose, title: "Campaigns, hostel to hostel", where: "Halls and Anglo-Moz" },
  { phase: "debate", start: ELECTION_TIMES.debateStart, end: ELECTION_TIMES.debateEnd, title: "Press Night and Debate", where: "Amphi Theatre" },
  { phase: "voting", start: ELECTION_TIMES.pollsOpen, end: ELECTION_TIMES.pollsClose, title: "Election day", where: "Faculty polling units" },
  { phase: "results", start: ELECTION_TIMES.results, end: ELECTION_TIMES.swearingIn, title: "SUIEC collates and declares results", where: "Student Union Building" },
  { phase: "handover", start: ELECTION_TIMES.swearingIn, end: WEEK_MINUTES, title: "Swearing-in and handover", where: "Student Union Building" },
];

export function weekClock(minuteOfWeek: number): string {
  const day = DAYS[Math.floor(minuteOfWeek / MINUTES_PER_DAY) % 7].slice(0, 3);
  const m = minuteOfWeek % MINUTES_PER_DAY;
  return `${day} ${String(Math.floor(m / HOUR)).padStart(2, "0")}:${String(m % HOUR).padStart(2, "0")}`;
}

export const RALLY_SITE_COUNT = 9;
const RALLY_DAYS = [1, 2];
const RALLY_HOURS = [10, 12, 14, 16, 18];
const RALLY_MINUTES = 90;

export interface Rally {
  site: number;
  start: number;
  end: number;
}

const rallyMemo = new Map<number, Rally[]>();
const RALLY_MEMO_LIMIT = 8;

export function ralliesFor(cycle: number): Rally[] {
  const known = rallyMemo.get(cycle);
  if (known) return known;
  if (rallyMemo.size >= RALLY_MEMO_LIMIT) rallyMemo.clear();
  const made = planRallies(cycle);
  rallyMemo.set(cycle, made);
  return made;
}

function planRallies(cycle: number): Rally[] {
  const rand = polRandom(`rally:${cycle}`);
  const order = [...polShuffle(rand, Array.from({ length: RALLY_SITE_COUNT }, (_v, i) => i)), Math.floor(rand() * RALLY_SITE_COUNT)];
  return RALLY_DAYS.flatMap((day, d) =>
    RALLY_HOURS.map((hour, h) => {
      const start = at(day, hour);
      return { site: order[d * RALLY_HOURS.length + h], start, end: start + RALLY_MINUTES };
    }),
  );
}

export function activeRallies(t: GameTime): Rally[] {
  const m = weekMinute(t);
  return ralliesFor(electionCycle(t)).filter((r) => m >= r.start && m < r.end);
}
