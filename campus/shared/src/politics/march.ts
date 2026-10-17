import { MINUTES_PER_DAY, REAL_SECONDS_PER_GAME_MINUTE } from "../clock";
import { PLAYER_SPEED } from "../constants";
import { GATE, PLACES, PX_PER_METER, type Point } from "../map";
import { findRoadPath } from "../path";
import { CONCESSIONS, STATE_MINUTES, type UnionState } from "./campus-state";
import { polPick, polRandom } from "./seed";
import { FORM_DESK, GATHERING_SITES } from "./sites";

const M = PX_PER_METER;
const HOUR = 60;

export const MARCH = {
  formMinutes: 30,
  holdMinutes: 8,
  pace: 0.85,
  range: 16 * M,
  share: 0.25,
  playerWeight: 30,
  npc: [90, 260] as readonly [number, number],
  need: 220,
  hours: [7, 8, 9] as readonly number[],
  fun: 18,
  energy: 10,
  blockAhead: 5 * M,
} as const;

export const MARCH_SPEED = PLAYER_SPEED * MARCH.pace * REAL_SECONDS_PER_GAME_MINUTE;

export const PLACARDS: readonly string[] = [
  "Fix our hostels",
  "Light and water na our right",
  "We came to learn",
  "Fair fare for students",
  "Hear us out",
  "No light, no reading",
  "Students are not ATM",
  "Peaceful and resolute",
  "Greatest Ife! Great!",
  "Aluta continua",
];

const GATE_NAME = /^main gate$/i;

export interface MarchRoute {
  points: Point[];
  cum: number[];
  length: number;
  subAt: number;
}

let route: MarchRoute | undefined;

function lay(points: readonly Point[]): { points: Point[]; cum: number[] } {
  const out: Point[] = [];
  const cum: number[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    const step = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    if (last && step < 1) continue;
    cum.push((cum[cum.length - 1] ?? 0) + step);
    out.push({ x: p.x, y: p.y });
  }
  return { points: out, cum };
}

export function marchRoute(): MarchRoute {
  if (route) return route;
  const start: Point = GATHERING_SITES.anglomoz;
  const gate: Point = GATE ?? PLACES.find((p) => GATE_NAME.test(p.name))?.door ?? FORM_DESK;
  const first = findRoadPath(start, FORM_DESK)?.points ?? [start, FORM_DESK];
  const second = findRoadPath(first[first.length - 1], gate)?.points ?? [gate];
  const firstLeg = lay(first);
  const whole = lay([...first, ...second]);
  route = { points: whole.points, cum: whole.cum, length: whole.cum[whole.cum.length - 1] ?? 0, subAt: firstLeg.cum[firstLeg.cum.length - 1] ?? 0 };
  return route;
}

export function routePoint(distance: number): { x: number; y: number; angle: number } {
  const r = marchRoute();
  const d = Math.max(0, Math.min(r.length, distance));
  let i = 1;
  while (i < r.points.length - 1 && r.cum[i] < d) i++;
  const a = r.points[i - 1] ?? r.points[0];
  const b = r.points[i] ?? a;
  const span = (r.cum[i] ?? 0) - (r.cum[i - 1] ?? 0) || 1;
  const k = Math.max(0, Math.min(1, (d - (r.cum[i - 1] ?? 0)) / span));
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

export interface MarchPlan {
  id: string;
  issue: string;
  forms: number;
  start: number;
  reachSub: number;
  leaveSub: number;
  end: number;
}

export function marchPlan(state: Pick<UnionState, "id" | "issue" | "from">): MarchPlan {
  const r = marchRoute();
  const hour = polPick(polRandom(`march:${state.id}`), MARCH.hours);
  const forms = (Math.floor(state.from / MINUTES_PER_DAY) + 1) * MINUTES_PER_DAY + hour * HOUR;
  const start = forms + MARCH.formMinutes;
  const reachSub = start + Math.ceil(r.subAt / MARCH_SPEED);
  const leaveSub = reachSub + MARCH.holdMinutes;
  const end = leaveSub + Math.ceil((r.length - r.subAt) / MARCH_SPEED);
  return { id: state.id, issue: state.issue, forms, start, reachSub, leaveSub, end };
}

export type MarchPhase = "before" | "forming" | "walking" | "holding" | "done";

export interface MarchSpot {
  phase: MarchPhase;
  x: number;
  y: number;
  angle: number;
}

export function marchAt(plan: MarchPlan, minutes: number): MarchSpot {
  const r = marchRoute();
  const spot = (phase: MarchPhase, distance: number): MarchSpot => ({ phase, ...routePoint(distance) });
  if (minutes < plan.forms) return spot("before", 0);
  if (minutes < plan.start) return spot("forming", 0);
  if (minutes < plan.reachSub) return spot("walking", Math.min(r.subAt, (minutes - plan.start) * MARCH_SPEED));
  if (minutes < plan.leaveSub) return spot("holding", r.subAt);
  if (minutes < plan.end) return spot("walking", Math.min(r.length, r.subAt + (minutes - plan.leaveSub) * MARCH_SPEED));
  return spot("done", r.length);
}

export const marchLive = (plan: MarchPlan, minutes: number): boolean => minutes >= plan.forms && minutes < plan.end;
export const marchWalkMinutes = (plan: MarchPlan): number => plan.reachSub - plan.start + (plan.end - plan.leaveSub);
export const marchSecondsNeeded = (plan: MarchPlan): number => Math.ceil(marchWalkMinutes(plan) * REAL_SECONDS_PER_GAME_MINUTE * MARCH.share);
export const marchMark = (id: string): string => `march:${id}`;
export const withMarch = (p: Point, spot: MarchSpot): boolean => spot.phase !== "before" && spot.phase !== "done" && Math.hypot(p.x - spot.x, p.y - spot.y) <= MARCH.range;

export function marchBlockers(plan: MarchPlan, minutes: number): Point[] {
  const spot = marchAt(plan, minutes);
  if (spot.phase !== "walking" && spot.phase !== "holding") return [];
  return [
    { x: spot.x, y: spot.y },
    { x: spot.x + Math.cos(spot.angle) * MARCH.blockAhead, y: spot.y + Math.sin(spot.angle) * MARCH.blockAhead },
    { x: spot.x - Math.cos(spot.angle) * MARCH.blockAhead, y: spot.y - Math.sin(spot.angle) * MARCH.blockAhead },
  ];
}

export interface MarchTurnout {
  npc: number;
  real: number;
  total: number;
  agreed: boolean;
}

export function marchTurnout(id: string, real: number): MarchTurnout {
  const npc = Math.round(MARCH.npc[0] + polRandom(`turnout:${id}`)() * (MARCH.npc[1] - MARCH.npc[0]));
  const counted = Math.max(0, Math.floor(real));
  const total = npc + counted * MARCH.playerWeight;
  return { npc, real: counted, total, agreed: total >= MARCH.need };
}

export const concessionFor = (id: string) => polPick(polRandom(`concession:${id}`), CONCESSIONS);
export const afterMarchId = (id: string): string => `after:${id}`;

export function stateAfterMarch(plan: MarchPlan, turnout: MarchTurnout): UnionState {
  const kind = turnout.agreed ? "concession" : "standoff";
  return { id: afterMarchId(plan.id), kind, issue: plan.issue, from: plan.end, until: plan.end + STATE_MINUTES[kind], concession: turnout.agreed ? concessionFor(plan.id).id : "" };
}
