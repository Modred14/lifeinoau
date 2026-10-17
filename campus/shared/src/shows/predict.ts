import type { GameTime } from "../clock";
import type { PredictionSave } from "../social/save";
import { CLUBS, matchState, matchesFor, type Club, type Match } from "./matches";

export type PredictResult = "exact" | "outcome" | "miss";

export interface Settlement {
  match: Match;
  result: PredictResult;
  prize: number;
  home: number;
  away: number;
}

export const PREDICT = { exact: 500, outcome: 150, maxGoals: 9, lookAheadDays: 2, boardReach: 5, cashWinsPerWeek: 2, cappedFun: 10 } as const;
export const CLUB_FUN = { win: 14, loss: 8, goal: 3 } as const;
const KEY = /^m(-?\d+):(\d+)$/;

export const SUPPORTED_CLUBS: readonly Club[] = CLUBS;
export const findClub = (code: unknown): Club | undefined => (typeof code === "string" ? CLUBS.find((c) => c.code === code) : undefined);

export function matchByKey(key: string): Match | undefined {
  const parts = KEY.exec(key);
  return parts ? matchesFor(Number(parts[1])).find((m) => m.key === key) : undefined;
}

export function nextPredictable(t: GameTime): Match | undefined {
  for (let d = 0; d < PREDICT.lookAheadDays; d++) {
    const next = matchesFor(t.dayIndex + d).find((m) => m.startTotal > t.total);
    if (next) return next;
  }
  return undefined;
}

export const canPredict = (m: Match, total: number): boolean => total < m.startTotal;

export function validScore(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= PREDICT.maxGoals;
}

export function judge(p: PredictionSave, home: number, away: number): PredictResult {
  if (p.home === home && p.away === away) return "exact";
  return Math.sign(p.home - p.away) === Math.sign(home - away) ? "outcome" : "miss";
}

export const prizeFor = (result: PredictResult): number => (result === "exact" ? PREDICT.exact : result === "outcome" ? PREDICT.outcome : 0);

export function settle(p: PredictionSave, total: number): Settlement | "void" | undefined {
  const match = matchByKey(p.key);
  if (!match) return "void";
  if (total < match.endTotal) return undefined;
  const final = matchState(match, match.endTotal);
  const result = judge(p, final.home, final.away);
  return { match, result, prize: prizeFor(result), home: final.home, away: final.away };
}

export function clubSide(m: Match, code: string | undefined): 0 | 1 | -1 {
  if (!code) return -1;
  return m.home.code === code ? 0 : m.away.code === code ? 1 : -1;
}
