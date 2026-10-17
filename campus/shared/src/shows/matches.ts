import { MINUTES_PER_DAY, type GameTime } from "../clock";
import { PLACES } from "../map";
import { between, pick, seeded } from "./seed";

export interface Club {
  name: string;
  code: string;
  color: number;
}

export interface Goal {
  minute: number;
  side: 0 | 1;
}

export type MatchTier = "normal" | "derby" | "final";

export interface Match {
  key: string;
  dayIndex: number;
  kickoff: number;
  startTotal: number;
  endTotal: number;
  home: Club;
  away: Club;
  competition: string;
  tier: MatchTier;
  fee: number;
  goals: Goal[];
  banter: string;
}

export type MatchPhase = "soon" | "first" | "half" | "second" | "full";

export interface MatchState {
  phase: MatchPhase;
  minute: number;
  home: number;
  away: number;
}

export const HALF_MINUTES = 45;
export const BREAK_MINUTES = 15;
export const MATCH_MINUTES = HALF_MINUTES * 2 + BREAK_MINUTES;
export const MATCH_GATE_OPENS = 30;
export const MATCH_AFTER = 10;
export const MATCH_FEES: Record<MatchTier, number> = { normal: 50, derby: 100, final: 150 };
export const VIEWING_PLACES: readonly number[] = PLACES.map((p, i) => (p.kind === "hostel" ? i : -1)).filter((i) => i >= 0);

export const CLUBS: readonly Club[] = [
  { name: "Arsenal", code: "ARS", color: 0xd00027 },
  { name: "Chelsea", code: "CHE", color: 0x034694 },
  { name: "Man United", code: "MUN", color: 0xc70101 },
  { name: "Man City", code: "MCI", color: 0x6cabdd },
  { name: "Liverpool", code: "LIV", color: 0xa30d1e },
  { name: "Tottenham", code: "TOT", color: 0xe8e8ee },
  { name: "Barcelona", code: "BAR", color: 0x7a1f4f },
  { name: "Real Madrid", code: "RMA", color: 0xf4f4f4 },
  { name: "Bayern", code: "BAY", color: 0xb5121b },
  { name: "PSG", code: "PSG", color: 0x1a2a5c },
  { name: "Inter", code: "INT", color: 0x1450a3 },
  { name: "AC Milan", code: "MIL", color: 0xb0121c },
  { name: "Enyimba", code: "ENY", color: 0x1f4fa8 },
  { name: "Shooting Stars", code: "3SC", color: 0x2a4fa0 },
  { name: "Rangers", code: "RAN", color: 0xc8102e },
  { name: "Kano Pillars", code: "KAN", color: 0x1f7a3a },
];

const DERBIES: readonly [string, string, string][] = [
  ["Arsenal", "Tottenham", "North London derby"],
  ["Man United", "Man City", "Manchester derby"],
  ["Real Madrid", "Barcelona", "El Clasico"],
  ["Inter", "AC Milan", "Milan derby"],
  ["Liverpool", "Man United", "North West derby"],
  ["Enyimba", "Rangers", "Oriental derby"],
  ["Arsenal", "Chelsea", "London derby"],
];

interface Fixture {
  weekday: number;
  kickoff: number;
  competition: string;
  big: boolean;
}

const FIXTURES: readonly Fixture[] = [
  { weekday: 1, kickoff: 21 * 60, competition: "European night", big: false },
  { weekday: 2, kickoff: 21 * 60, competition: "European night", big: false },
  { weekday: 3, kickoff: 20 * 60, competition: "Naija league", big: false },
  { weekday: 5, kickoff: 13 * 60 + 30, competition: "League", big: false },
  { weekday: 5, kickoff: 16 * 60, competition: "League", big: false },
  { weekday: 5, kickoff: 18 * 60 + 30, competition: "League", big: true },
  { weekday: 6, kickoff: 15 * 60, competition: "League", big: false },
  { weekday: 6, kickoff: 17 * 60 + 30, competition: "League", big: true },
];

const FINAL_EVERY_WEEKS = 4;
const FINAL_WEEKDAY = 5;
const MAX_GOALS = 5;
const NAIJA = new Set(["Enyimba", "Shooting Stars", "Rangers", "Kano Pillars"]);

export const BANTER: readonly string[] = [
  "Referee don chop money.",
  "Shift small. Bench no be your papa own.",
  "Signal don go. Who touch the decoder?",
  "Coach, remove that number 9 abeg!",
  "Final whistle. Go and read your book.",
  "Na so una team dey play every week?",
];

const club = (name: string) => CLUBS.find((c) => c.name === name) ?? CLUBS[0];
const cache = new Map<number, Match[]>();
const CACHE_DAYS = 32;

export function goalsFor(rand: () => number): Goal[] {
  const minutes = new Set<number>();
  const count = Math.min(MAX_GOALS, Math.floor(rand() * rand() * (MAX_GOALS + 2)));
  while (minutes.size < count) minutes.add(between(rand, 2, HALF_MINUTES * 2 - 1));
  return [...minutes].sort((a, b) => a - b).map((minute) => ({ minute, side: rand() < 0.55 ? 0 : 1 }));
}

export function matchesFor(dayIndex: number): Match[] {
  const hit = cache.get(dayIndex);
  if (hit) return hit;
  const weekday = ((dayIndex % 7) + 7) % 7;
  const week = Math.floor(dayIndex / 7);
  const out: Match[] = [];
  FIXTURES.forEach((f, index) => {
    if (f.weekday !== weekday) return;
    const rand = seeded(dayIndex * 97 + index * 13 + 3);
    const final = f.big && weekday === FINAL_WEEKDAY && ((week % FINAL_EVERY_WEEKS) + FINAL_EVERY_WEEKS) % FINAL_EVERY_WEEKS === FINAL_EVERY_WEEKS - 1;
    const tier: MatchTier = final ? "final" : f.big ? "derby" : "normal";
    let home: Club;
    let away: Club;
    let competition = final ? "Cup final" : f.competition;
    if (tier === "derby") {
      const derby = pick(rand, DERBIES);
      home = club(derby[0]);
      away = club(derby[1]);
      competition = derby[2];
    } else {
      const pool = CLUBS.filter((c) => (f.competition === "Naija league" ? NAIJA.has(c.name) : !NAIJA.has(c.name)));
      home = pick(rand, pool);
      away = pick(rand, pool.filter((c) => c !== home));
    }
    const startTotal = dayIndex * MINUTES_PER_DAY + f.kickoff;
    out.push({ key: `m${dayIndex}:${index}`, dayIndex, kickoff: f.kickoff, startTotal, endTotal: startTotal + MATCH_MINUTES, home, away, competition, tier, fee: MATCH_FEES[tier], goals: goalsFor(rand), banter: pick(rand, BANTER) });
  });
  if (cache.size >= CACHE_DAYS) cache.clear();
  cache.set(dayIndex, out);
  return out;
}

export function matchState(m: Match, total: number): MatchState {
  const elapsed = total - m.startTotal;
  const phase: MatchPhase = elapsed < 0 ? "soon" : elapsed < HALF_MINUTES ? "first" : elapsed < HALF_MINUTES + BREAK_MINUTES ? "half" : elapsed < MATCH_MINUTES ? "second" : "full";
  const minute = phase === "soon" ? 0 : phase === "first" ? elapsed : phase === "half" ? HALF_MINUTES : phase === "second" ? elapsed - BREAK_MINUTES : HALF_MINUTES * 2;
  let home = 0;
  let away = 0;
  for (const g of m.goals) {
    if (g.minute > minute) break;
    if (g.side === 0) home++;
    else away++;
  }
  return { phase, minute, home, away };
}

export function currentMatch(t: GameTime): Match | undefined {
  return matchesFor(t.dayIndex).find((m) => t.total >= m.startTotal - MATCH_GATE_OPENS && t.total < m.endTotal + MATCH_AFTER);
}

export function scoreLine(m: Match, s: MatchState): string {
  return `${m.home.name} ${s.home} to ${s.away} ${m.away.name}`;
}
