import { MINUTES_PER_DAY, type GameTime } from "../clock";
import { FACULTY_TEAMS, facultyOfWeek, weekOf, type FacultyTeam } from "../social/faculties";
import { GROUND_LABEL, GROUND_PLACE, type GroundId } from "../social/grounds";
import { MATCH_AFTER, MATCH_GATE_OPENS, MATCH_MINUTES, goalsFor, matchState, type Club, type Match } from "./matches";
import { pick, seeded, type Rand } from "./seed";

export type PitchStage = "league" | "quarter" | "semi" | "final" | "novelty";

export interface PitchMatch extends Match {
  ground: GroundId;
  place: number;
  stage: PitchStage;
  teams: [number, number];
  pens?: 0 | 1;
  slots?: [string, string];
  knownAt: number;
}

export interface TableRow {
  team: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface Season {
  season: number;
  league: PitchMatch[];
  quarters: PitchMatch[];
  semis: PitchMatch[];
  final?: PitchMatch;
  matches: PitchMatch[];
  qualifiers: number[];
  champion: number;
}

interface Kick {
  weekday: number;
  kickoff: number;
  ground: GroundId;
}

const at = (hour: number, minute = 0) => hour * 60 + minute;

export const SEASON_WEEKS = 4;
export const LEAGUE_ROUNDS = 3;
export const CUP_SIZE = 8;
export const LEAGUE_NAME = "Interfaculty League";
export const CUP_NAME = "Dean's Cup";
export const NOVELTY_NAME = "Faculty week novelty match";
export const WIN_POINTS = 3;
export const DRAW_POINTS = 1;
const EARLY = at(14);
const LATE = at(16);
const ROUND_KICKS: readonly Kick[] = [
  { weekday: 2, kickoff: EARLY, ground: "sports" },
  { weekday: 2, kickoff: EARLY, ground: "bowl" },
  { weekday: 2, kickoff: LATE, ground: "sports" },
  { weekday: 2, kickoff: LATE, ground: "bowl" },
  { weekday: 5, kickoff: EARLY, ground: "sports" },
  { weekday: 5, kickoff: EARLY, ground: "bowl" },
  { weekday: 5, kickoff: LATE, ground: "bowl" },
];
const QUARTER_KICKS: readonly Kick[] = [
  { weekday: 1, kickoff: EARLY, ground: "sports" },
  { weekday: 1, kickoff: EARLY, ground: "bowl" },
  { weekday: 1, kickoff: LATE, ground: "sports" },
  { weekday: 1, kickoff: LATE, ground: "bowl" },
];
const SEMI_KICKS: readonly Kick[] = [
  { weekday: 3, kickoff: LATE, ground: "sports" },
  { weekday: 3, kickoff: LATE, ground: "bowl" },
];
const FINAL_KICK: Kick = { weekday: 5, kickoff: LATE, ground: "bowl" };
const NOVELTY_KICK: Kick = { weekday: 4, kickoff: LATE, ground: "sports" };
const QUARTER_PAIRS: readonly [number, number][] = [[0, 7], [3, 4], [1, 6], [2, 5]];
const STAGE_LABEL: Record<PitchStage, string> = { league: LEAGUE_NAME, quarter: `${CUP_NAME} quarter-final`, semi: `${CUP_NAME} semi-final`, final: `${CUP_NAME} final`, novelty: NOVELTY_NAME };
const NOVELTY_SIDES = { home: "Staff", away: "Students", staffColor: 0x4b5563 };
const SEASON_CACHE = 6;

export const PITCH_BANTER: readonly string[] = [
  "Referee na final year student. No trust am.",
  "That keeper suppose dey library.",
  "Coach, change that striker abeg!",
  "Na so dem go carry am reach faculty.",
  "The supporters club don lose voice.",
];

const club = (team: FacultyTeam): Club => ({ name: team.name, code: team.code, color: team.color });
const seasonCache = new Map<number, Season>();

function shuffled(rand: Rand, n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function roundPairs(order: readonly number[], round: number): [number, number][] {
  const seats = order.length % 2 ? [...order, -1] : [...order];
  const n = seats.length;
  const turned = [seats[0], ...seats.slice(1).map((_, i) => seats[1 + ((i + round) % (n - 1))])];
  const pairs: [number, number][] = [];
  for (let i = 0; i < n / 2; i++) {
    const a = turned[i];
    const b = turned[n - 1 - i];
    if (a >= 0 && b >= 0) pairs.push((i + round) % 2 ? [b, a] : [a, b]);
  }
  return pairs;
}

function fixture(key: string, stage: PitchStage, week: number, kick: Kick, teams: [number, number], rand: Rand, knownAt: number, slots?: [string, string], sides?: [Club, Club]): PitchMatch {
  const dayIndex = week * 7 + kick.weekday;
  const startTotal = dayIndex * MINUTES_PER_DAY + kick.kickoff;
  const goals = goalsFor(rand);
  const home = goals.filter((g) => g.side === 0).length;
  const level = home * 2 === goals.length;
  const knockout = stage === "quarter" || stage === "semi" || stage === "final";
  return {
    key,
    dayIndex,
    kickoff: kick.kickoff,
    startTotal,
    endTotal: startTotal + MATCH_MINUTES,
    home: sides?.[0] ?? club(FACULTY_TEAMS[teams[0]]),
    away: sides?.[1] ?? club(FACULTY_TEAMS[teams[1]]),
    competition: STAGE_LABEL[stage],
    tier: stage === "final" ? "final" : stage === "semi" ? "derby" : "normal",
    fee: 0,
    goals,
    banter: pick(rand, PITCH_BANTER),
    ground: kick.ground,
    place: GROUND_PLACE[kick.ground],
    stage,
    teams,
    pens: knockout && level ? (rand() < 0.5 ? 0 : 1) : undefined,
    slots,
    knownAt,
  };
}

export function matchWinner(m: PitchMatch): 0 | 1 | -1 {
  const home = m.goals.filter((g) => g.side === 0).length;
  const away = m.goals.length - home;
  if (home !== away) return home > away ? 0 : 1;
  return m.pens ?? -1;
}

export function tableOf(matches: readonly PitchMatch[], total = Infinity): TableRow[] {
  const rows: TableRow[] = FACULTY_TEAMS.map((t) => ({ team: t.index, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 }));
  for (const m of matches) {
    if (m.stage !== "league" || m.endTotal > total) continue;
    const home = m.goals.filter((g) => g.side === 0).length;
    const away = m.goals.length - home;
    const sides: [TableRow, number, number][] = [[rows[m.teams[0]], home, away], [rows[m.teams[1]], away, home]];
    for (const [row, scored, conceded] of sides) {
      row.played++;
      row.goalsFor += scored;
      row.goalsAgainst += conceded;
      if (scored > conceded) row.won++;
      else if (scored === conceded) row.drawn++;
      else row.lost++;
      row.points += scored > conceded ? WIN_POINTS : scored === conceded ? DRAW_POINTS : 0;
    }
  }
  return rows.sort((a, b) => b.points - a.points || b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) || b.goalsFor - a.goalsFor || a.team - b.team);
}

function build(season: number): Season {
  const firstWeek = season * SEASON_WEEKS;
  const order = shuffled(seeded(season * 131 + 17), FACULTY_TEAMS.length);
  const league: PitchMatch[] = [];
  for (let round = 0; round < LEAGUE_ROUNDS; round++)
    roundPairs(order, round).forEach((teams, i) => {
      const kick = ROUND_KICKS[i % ROUND_KICKS.length];
      league.push(fixture(`p${season}:l${round}:${i}`, "league", firstWeek + round, kick, teams, seeded(season * 977 + round * 61 + i * 7 + 1), 0));
    });
  const cupWeek = firstWeek + LEAGUE_ROUNDS;
  const leagueOver = league.reduce((end, m) => Math.max(end, m.endTotal), 0);
  const qualifiers = tableOf(league).slice(0, CUP_SIZE).map((row) => row.team);
  const winner = (m: PitchMatch) => m.teams[matchWinner(m) === 1 ? 1 : 0];
  const quarters = qualifiers.length < CUP_SIZE ? [] : QUARTER_PAIRS.map(([a, b], i) => fixture(`p${season}:q${i}`, "quarter", cupWeek, QUARTER_KICKS[i], [qualifiers[a], qualifiers[b]], seeded(season * 733 + i * 11 + 2), leagueOver, [`League ${a + 1}`, `League ${b + 1}`]));
  const semis = quarters.length < 4 ? [] : [0, 1].map((i) => {
    const feeders = [quarters[i * 2], quarters[i * 2 + 1]];
    return fixture(`p${season}:s${i}`, "semi", cupWeek, SEMI_KICKS[i], [winner(feeders[0]), winner(feeders[1])], seeded(season * 577 + i * 13 + 3), Math.max(feeders[0].endTotal, feeders[1].endTotal), [`Winner QF${i * 2 + 1}`, `Winner QF${i * 2 + 2}`]);
  });
  const final = semis.length < 2 ? undefined : fixture(`p${season}:f`, "final", cupWeek, FINAL_KICK, [winner(semis[0]), winner(semis[1])], seeded(season * 389 + 5), Math.max(semis[0].endTotal, semis[1].endTotal), ["Winner SF1", "Winner SF2"]);
  const matches = [...league, ...quarters, ...semis, ...(final ? [final] : [])].sort((a, b) => a.startTotal - b.startTotal);
  return { season, league, quarters, semis, final, matches, qualifiers, champion: final ? winner(final) : -1 };
}

export const seasonOf = (dayIndex: number): number => Math.floor(weekOf(dayIndex) / SEASON_WEEKS);

export function leagueSeason(season: number): Season {
  const hit = seasonCache.get(season);
  if (hit) return hit;
  const made = build(season);
  if (seasonCache.size >= SEASON_CACHE) seasonCache.clear();
  seasonCache.set(season, made);
  return made;
}

export function noveltyMatch(week: number): PitchMatch | undefined {
  const team = FACULTY_TEAMS[facultyOfWeek(week)];
  if (!team || GROUND_PLACE[NOVELTY_KICK.ground] < 0) return undefined;
  const sides: [Club, Club] = [
    { name: `${team.name} ${NOVELTY_SIDES.home}`, code: team.code, color: NOVELTY_SIDES.staffColor },
    { name: `${team.name} ${NOVELTY_SIDES.away}`, code: team.code, color: team.color },
  ];
  return fixture(`p:n${week}`, "novelty", week, NOVELTY_KICK, [team.index, team.index], seeded(week * 271 + 9), 0, undefined, sides);
}

export function pitchMatchesFor(dayIndex: number): PitchMatch[] {
  const out = leagueSeason(seasonOf(dayIndex)).matches.filter((m) => m.dayIndex === dayIndex && m.place >= 0);
  const novelty = noveltyMatch(weekOf(dayIndex));
  if (novelty && novelty.dayIndex === dayIndex) out.push(novelty);
  return out.sort((a, b) => a.startTotal - b.startTotal);
}

export function currentPitchMatch(ground: GroundId, t: GameTime): PitchMatch | undefined {
  return pitchMatchesFor(t.dayIndex).find((m) => m.ground === ground && t.total >= m.startTotal - MATCH_GATE_OPENS && t.total < m.endTotal + MATCH_AFTER);
}

export function pitchTitle(m: PitchMatch, total: number): string {
  return m.slots && total < m.knownAt ? `${m.slots[0]} v ${m.slots[1]}` : `${m.home.name} v ${m.away.name}`;
}

export const pitchVenue = (m: PitchMatch): string => GROUND_LABEL[m.ground];

export function pitchResult(m: PitchMatch): string {
  const s = matchState(m, m.endTotal);
  const base = `${m.home.name} ${s.home} to ${s.away} ${m.away.name}`;
  return m.pens === undefined ? base : `${base}, ${m.pens === 0 ? m.home.name : m.away.name} win on penalties`;
}
