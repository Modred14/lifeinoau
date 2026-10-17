import { PX_PER_METER } from "../map";
import type { PredictionSave } from "./save";

export type SocialAction = { a: "status" } | { a: "club"; code: string } | { a: "predict"; home: number; away: number } | { a: "sign"; i: number };

export interface SocialStatus {
  club: string;
  predict?: PredictionSave;
  wins: number;
  shirt: number;
  finalist: boolean;
  faculty: number;
  signed: number[];
}

export const FINALIST_LEVELS: readonly string[] = ["400L", "500L", "600L", "HND2", "NCE3"];
export const FRESHER_LEVELS: readonly string[] = ["100L", "ND1", "NCE1"];
export const isFinalist = (level: string | undefined): boolean => !!level && FINALIST_LEVELS.includes(level);
export const isFresher = (level: string | undefined): boolean => !!level && FRESHER_LEVELS.includes(level);

export const SIGN_SHIRT = { reach: 3.2 * PX_PER_METER, share: 7 * PX_PER_METER, fun: 5, ownFun: 3 } as const;
export const FACULTY_PERKS = { toastFun: 5, weekFun: 12, showBoost: 1.5, winFun: 15, matricFun: 15 } as const;
export const TOAST_FROM = 7 * 60;
export const FORECOURT_JOLLOF = 18;
export const GYRATION_FUN = 0.7;
export const TOUCHLINE_FUN = 0.3;

const CODE_MAX = 4;
const MAX_INDEX = 255;
const MAX_GOALS = 9;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max;

export function parseSocialAction(payload: unknown): SocialAction | null {
  if (!isRecord(payload)) return null;
  switch (payload.a) {
    case "status":
      return { a: "status" };
    case "club":
      return typeof payload.code === "string" && payload.code.length > 0 && payload.code.length <= CODE_MAX ? { a: "club", code: payload.code } : null;
    case "predict":
      return count(payload.home, MAX_GOALS) && count(payload.away, MAX_GOALS) ? { a: "predict", home: payload.home, away: payload.away } : null;
    case "sign":
      return count(payload.i, MAX_INDEX) ? { a: "sign", i: payload.i } : null;
    default:
      return null;
  }
}

export function parseSocialStatus(payload: unknown): SocialStatus | null {
  if (!isRecord(payload) || typeof payload.club !== "string") return null;
  const p = payload.predict;
  const predict = isRecord(p) && typeof p.key === "string" && count(p.home, MAX_GOALS) && count(p.away, MAX_GOALS) ? { key: p.key, home: p.home, away: p.away } : undefined;
  return {
    club: payload.club,
    predict,
    wins: count(payload.wins, Number.MAX_SAFE_INTEGER) ? payload.wins : 0,
    shirt: count(payload.shirt, Number.MAX_SAFE_INTEGER) ? payload.shirt : 0,
    finalist: payload.finalist === true,
    faculty: typeof payload.faculty === "number" && Number.isInteger(payload.faculty) ? payload.faculty : -1,
    signed: Array.isArray(payload.signed) ? payload.signed.filter((n): n is number => count(n, MAX_INDEX)) : [],
  };
}
