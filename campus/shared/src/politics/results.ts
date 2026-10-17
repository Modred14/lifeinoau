import { ELECTION_TIMES } from "./calendar";
import type { BallotEntry, RaceResult } from "./count";
import { facultyOf } from "./faculty";
import { parseRace, type UnionPost } from "./posts";
import { polRandom, polShuffle } from "./seed";
import { POLL_UNITS, unitForFaculty, type PoliticsSite } from "./sites";

const FEE_ROUND = 50;
const UNIT_SIZE: readonly [number, number] = [0.6, 1.6];
const UNIT_LEAN: readonly [number, number] = [0.7, 1.3];
const LINE_TOP = 3;

export const PETITION = {
  feeFactor: 0.5,
  chance: 0.2,
  swing: [0.75, 1.15] as readonly [number, number],
  mark: "petition",
} as const;

export const CELEBRATE = { mark: "celebrate", fun: 20 } as const;

export interface UnitReturn {
  unit: string;
  name: string;
  at: number;
  rows: { id: string; votes: number }[];
}

export function unitsFor(race: string): PoliticsSite[] {
  const parsed = parseRace(race);
  if (!parsed || parsed.post.body === "sug") return [...POLL_UNITS];
  const faculty = parsed.post.body === "faculty" ? parsed.scope : (facultyOf(parsed.scope)?.key ?? "");
  return [unitForFaculty(faculty)];
}

function split(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((n, w) => n + w, 0) || 1;
  const exact = weights.map((w) => (total * w) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((n, s) => n + s, 0);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length, left--) shares[order[k].i]++;
  return shares;
}

export function unitReturns(cycle: number, result: RaceResult): UnitReturn[] {
  const rand = polRandom(`units:${cycle}:${result.race}`);
  const units = polShuffle(rand, unitsFor(result.race));
  const sizes = units.map(() => UNIT_SIZE[0] + rand() * (UNIT_SIZE[1] - UNIT_SIZE[0]));
  const window = ELECTION_TIMES.declaration - ELECTION_TIMES.results;
  const out: UnitReturn[] = units.map((unit, k) => ({ unit: unit.id, name: unit.name, at: ELECTION_TIMES.results + Math.floor((window * (k + 1)) / (units.length + 1)), rows: [] }));
  for (const row of result.rows) {
    const lean = polRandom(`lean:${cycle}:${result.race}:${row.id}`);
    const shares = split(row.total, sizes.map((size) => size * (UNIT_LEAN[0] + lean() * (UNIT_LEAN[1] - UNIT_LEAN[0]))));
    shares.forEach((votes, k) => out[k].rows.push({ id: row.id, votes }));
  }
  return out;
}

export const returnsUntil = (cycle: number, result: RaceResult, minuteOfWeek: number): UnitReturn[] => unitReturns(cycle, result).filter((u) => u.at <= minuteOfWeek);

export function returnLine(unit: UnitReturn, label: (id: string) => string): string {
  const top = [...unit.rows].sort((a, b) => b.votes - a.votes).slice(0, LINE_TOP);
  return `📊 ${unit.name} unit: ${top.map((r) => `${label(r.id)} ${r.votes.toLocaleString("en-NG")}`).join(", ")}.`;
}

export const petitionFee = (post: UnionPost): number => Math.round((post.fee * PETITION.feeFactor) / FEE_ROUND) * FEE_ROUND;
export const petitionGranted = (cycle: number, race: string, candidacy: string, secret = ""): boolean => polRandom(`petition:${cycle}:${race}:${candidacy}${secret ? `:${secret}` : ""}`)() < PETITION.chance;

export function rerunEntries(cycle: number, race: string, entries: readonly BallotEntry[]): BallotEntry[] {
  return entries.map((e) => {
    if (!e.npc) return { ...e };
    const swing = PETITION.swing[0] + polRandom(`rerun:${cycle}:${race}:${e.id}`)() * (PETITION.swing[1] - PETITION.swing[0]);
    return { ...e, base: Math.round(e.base * swing) };
  });
}
