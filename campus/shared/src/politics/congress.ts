import { MINUTES_PER_DAY } from "../clock";
import { PX_PER_METER, type Point } from "../map";
import { WEEK_MINUTES } from "./calendar";
import { STATE_MINUTES, type UnionState } from "./campus-state";
import { marchPlan } from "./march";
import { polPick, polRandom, polShuffle } from "./seed";
import { CONGRESS_GROUND, type PoliticsSite } from "./sites";

const M = PX_PER_METER;
const HOUR = 60;

export type MotionOutcome = "boycott" | "dialogue" | "protest";
export type CongressSide = "aye" | "nay";

export interface Motion {
  id: string;
  issue: string;
  question: string;
  aye: MotionOutcome;
  nay: MotionOutcome;
}

export const MOTIONS: readonly Motion[] = [
  { id: "fees", issue: "the fee hike", question: "Management has raised fees mid-session. Do we boycott lectures until they reverse it?", aye: "boycott", nay: "dialogue" },
  { id: "light-water", issue: "light and water in the hostels", question: "Three nights without light and the taps are dry. Do we march to the gate?", aye: "protest", nay: "dialogue" },
  { id: "bus-fare", issue: "the bus fare increase", question: "Shuttle fare has gone up again. Do we take it to the road with a peaceful protest?", aye: "protest", nay: "dialogue" },
  { id: "timetable", issue: "the exam timetable shift", question: "Exams were moved forward by two weeks. Do we stay away from lectures till it is reviewed?", aye: "boycott", nay: "dialogue" },
  { id: "hostels", issue: "hostel maintenance", question: "Leaking roofs and broken toilets in the halls. Do we march, or keep calm and keep writing letters?", aye: "protest", nay: "boycott" },
];

export const OUTCOME_LABEL: Record<MotionOutcome, string> = {
  boycott: "Boycott lectures",
  dialogue: "Dialogue with management",
  protest: "Peaceful protest",
};

export const findMotion = (id: string): Motion => MOTIONS.find((m) => m.id === id) ?? MOTIONS[0];

export const CONGRESS = {
  hour: 19,
  gather: 30,
  calledGather: 20,
  vote: 15,
  settle: 2,
  playerWeight: 25,
  npc: [120, 380] as readonly [number, number],
  ayeShare: [0.3, 0.7] as readonly [number, number],
  secondChance: 0.5,
  days: [0, 2, 5, 6] as readonly number[],
  reach: 20 * M,
  aisle: 1.5 * M,
  stand: 6 * M,
  fun: 10,
} as const;

export const CONGRESS_SITE: PoliticsSite = CONGRESS_GROUND;
export const CONGRESS_VENUE = "Awo Cafe, Awolowo Hall";

export interface CongressSitting {
  id: string;
  start: number;
  motion: string;
  called: boolean;
}

export function congressesFor(cycle: number): CongressSitting[] {
  const rand = polRandom(`congress:${cycle}`);
  const days = polShuffle(rand, CONGRESS.days);
  const count = rand() < CONGRESS.secondChance ? 2 : 1;
  const motions = polShuffle(rand, MOTIONS);
  return days
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((day, k) => ({ id: `s:${cycle}:${k}`, start: cycle * WEEK_MINUTES + day * MINUTES_PER_DAY + CONGRESS.hour * HOUR, motion: motions[k].id, called: false }));
}

export function calledSitting(term: number, usedAt: number): CongressSitting {
  return { id: `p:${term}`, start: usedAt, motion: polPick(polRandom(`called:${term}`), MOTIONS).id, called: true };
}

export type SittingPhase = "before" | "gather" | "vote" | "count" | "done";

export const voteOpensAt = (s: CongressSitting): number => s.start + (s.called ? CONGRESS.calledGather : CONGRESS.gather);
export const voteClosesAt = (s: CongressSitting): number => voteOpensAt(s) + CONGRESS.vote;
export const settlesAt = (s: CongressSitting): number => voteClosesAt(s) + CONGRESS.settle;

export function sittingPhase(s: CongressSitting, total: number): SittingPhase {
  if (total < s.start) return "before";
  if (total < voteOpensAt(s)) return "gather";
  if (total < voteClosesAt(s)) return "vote";
  if (total < settlesAt(s)) return "count";
  return "done";
}

export function congressSide(p: Point, site: PoliticsSite = CONGRESS_SITE): CongressSide | null {
  const dx = p.x - site.x;
  const dy = p.y - site.y;
  if (Math.hypot(dx, dy) > CONGRESS.reach) return null;
  const lateral = -dx * Math.sin(site.face) + dy * Math.cos(site.face);
  if (Math.abs(lateral) < CONGRESS.aisle) return null;
  return lateral < 0 ? "aye" : "nay";
}

export function congressStand(side: CongressSide, site: PoliticsSite = CONGRESS_SITE): Point {
  const sign = side === "aye" ? -1 : 1;
  return { x: site.x - Math.sin(site.face) * CONGRESS.stand * sign, y: site.y + Math.cos(site.face) * CONGRESS.stand * sign };
}

export interface CongressCount {
  aye: number;
  nay: number;
}

export function npcHouse(s: CongressSitting): CongressCount {
  const rand = polRandom(`house:${s.id}`);
  const crowd = Math.round(CONGRESS.npc[0] + rand() * (CONGRESS.npc[1] - CONGRESS.npc[0]));
  const aye = Math.round(crowd * (CONGRESS.ayeShare[0] + rand() * (CONGRESS.ayeShare[1] - CONGRESS.ayeShare[0])));
  return { aye, nay: crowd - aye };
}

export interface CongressResult extends CongressCount {
  carried: boolean;
  outcome: MotionOutcome;
}

export function congressResult(s: CongressSitting, real: CongressCount): CongressResult {
  const house = npcHouse(s);
  const aye = house.aye + Math.max(0, Math.floor(real.aye)) * CONGRESS.playerWeight;
  const nay = house.nay + Math.max(0, Math.floor(real.nay)) * CONGRESS.playerWeight;
  const motion = findMotion(s.motion);
  const carried = aye > nay;
  return { aye, nay, carried, outcome: carried ? motion.aye : motion.nay };
}

export const congressStateId = (s: CongressSitting): string => `c:${s.id}`;

export function stateFromCongress(s: CongressSitting, result: CongressResult): UnionState {
  const id = congressStateId(s);
  const issue = findMotion(s.motion).issue;
  const from = settlesAt(s);
  const until = result.outcome === "protest" ? marchPlan({ id, issue, from }).end : from + STATE_MINUTES[result.outcome];
  return { id, kind: result.outcome, issue, from, until, concession: "" };
}

export function resultLine(s: CongressSitting, result: CongressResult): string {
  const motion = findMotion(s.motion);
  return `📣 Congress on ${motion.issue}: Aye ${result.aye}, Nay ${result.nay}. The house says ${OUTCOME_LABEL[result.outcome].toLowerCase()}.`;
}
