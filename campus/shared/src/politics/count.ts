import { UNION_BODY_INFO, type UnionPost } from "./posts";
import { polHash, polRandom } from "./seed";

export const VOTE_WEIGHT = 25;
export const INFORMED_BONUS = 0.5;
export const ENDORSE_WEIGHT = 15;
export const RUNOFF_MARGIN = 0.02;
const TRANSFER_RANGE: [number, number] = [0.3, 0.7];

export interface BallotEntry {
  id: string;
  name: string;
  npc: boolean;
  base: number;
  endorsements: number;
  votes: number;
  informed: number;
  disqualified?: boolean;
}

export interface TallyRow {
  id: string;
  name: string;
  npc: boolean;
  total: number;
  real: number;
}

export interface RaceResult {
  race: string;
  rows: TallyRow[];
  winner: string | null;
  unopposed: boolean;
  runoff: boolean;
}

export function entryScore(post: UnionPost, e: BallotEntry): number {
  const scale = UNION_BODY_INFO[post.body].scale;
  return Math.round(e.base + scale * (ENDORSE_WEIGHT * e.endorsements + VOTE_WEIGHT * (e.votes + INFORMED_BONUS * e.informed)));
}

interface Ranked extends TallyRow {
  endorsements: number;
  luck: number;
}

const ahead = (a: Ranked, b: Ranked): number => b.total - a.total || b.real - a.real || b.endorsements - a.endorsements || a.luck - b.luck || (a.id < b.id ? -1 : 1);

export function tallyRace(cycle: number, race: string, post: UnionPost, entries: readonly BallotEntry[]): RaceResult {
  const ranked: Ranked[] = entries
    .filter((e) => !e.disqualified)
    .map((e) => ({ id: e.id, name: e.name, npc: e.npc, total: entryScore(post, e), real: e.votes, endorsements: e.endorsements, luck: polHash(`luck:${cycle}:${race}:${e.id}`) }))
    .sort(ahead);
  const strip = (r: Ranked): TallyRow => ({ id: r.id, name: r.name, npc: r.npc, total: r.total, real: r.real });
  if (ranked.length === 0) return { race, rows: [], winner: null, unopposed: false, runoff: false };
  if (ranked.length === 1) return { race, rows: ranked.map(strip), winner: ranked[0].id, unopposed: true, runoff: false };
  const sum = ranked.reduce((s, r) => s + r.total, 0) || 1;
  const runoff = ranked.length > 2 && (ranked[0].total - ranked[1].total) / sum < RUNOFF_MARGIN;
  if (!runoff) return { race, rows: ranked.map(strip), winner: ranked[0].id, unopposed: false, runoff: false };
  const rand = polRandom(`runoff:${cycle}:${race}`);
  const [first, second, ...rest] = ranked;
  const a = { ...first };
  const b = { ...second };
  for (const out of rest) {
    const share = Math.round(out.total * (TRANSFER_RANGE[0] + rand() * (TRANSFER_RANGE[1] - TRANSFER_RANGE[0])));
    a.total += share;
    b.total += out.total - share;
  }
  const final = [a, b].sort(ahead);
  return { race, rows: [...final, ...rest].map(strip), winner: final[0].id, unopposed: false, runoff: true };
}
