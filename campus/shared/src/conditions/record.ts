import type { HealthLog, Illness } from "./health";
import type { BathLog } from "./water";

export interface ConditionsRecord extends HealthLog, BathLog {}

export const CONDITION_STATUS = { sick: 1, unwashed: 2 } as const;

export type ConditionTaskKind = "fetch" | "clinic" | "chemist";

export interface ConditionTask {
  kind: ConditionTaskKind;
  site: number;
  ends: number;
  number?: number;
}

export interface ConditionsPayload {
  illness: Illness | "";
  unwashed: boolean;
  nights: number;
  rest: number;
  task?: ConditionTask;
}

export interface ConditionsActPayload {
  site: number;
}

const NEVER = -1000000;
const ILLNESSES: readonly string[] = ["malaria", "typhoid"];
const TASKS: readonly string[] = ["fetch", "clinic", "chemist"];
const MAX_NIGHTS = 99;

export function freshConditions(): ConditionsRecord {
  return { illness: "", sickSince: 0, rest: 0, immuneUntil: 0, weak: 0, nights: 0, lastNight: NEVER, nightMinutes: 0, nightOf: NEVER, bathDay: NEVER, unwashed: false, unwashedDay: NEVER };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const int = (v: unknown, fallback: number) => Math.round(num(v, fallback));

export function sanitizeConditions(raw: unknown): ConditionsRecord {
  const base = freshConditions();
  if (!isObject(raw)) return base;
  return {
    illness: typeof raw.illness === "string" && ILLNESSES.includes(raw.illness) ? (raw.illness as Illness) : "",
    sickSince: int(raw.sickSince, base.sickSince),
    rest: num(raw.rest, base.rest, 0),
    immuneUntil: int(raw.immuneUntil, base.immuneUntil),
    weak: num(raw.weak, base.weak, 0),
    nights: num(int(raw.nights, base.nights), 0, 0, MAX_NIGHTS),
    lastNight: int(raw.lastNight, base.lastNight),
    nightMinutes: num(raw.nightMinutes, base.nightMinutes, 0),
    nightOf: int(raw.nightOf, base.nightOf),
    bathDay: int(raw.bathDay, base.bathDay),
    unwashed: raw.unwashed === true,
    unwashedDay: int(raw.unwashedDay, base.unwashedDay),
  };
}

export function conditionStatus(record: Pick<ConditionsRecord, "illness" | "unwashed">): number {
  return (record.illness ? CONDITION_STATUS.sick : 0) | (record.unwashed ? CONDITION_STATUS.unwashed : 0);
}

export function parseConditionsPayload(raw: unknown): ConditionsPayload | undefined {
  if (!isObject(raw)) return undefined;
  const out: ConditionsPayload = {
    illness: typeof raw.illness === "string" && ILLNESSES.includes(raw.illness) ? (raw.illness as Illness) : "",
    unwashed: raw.unwashed === true,
    nights: num(raw.nights, 0, 0, MAX_NIGHTS),
    rest: num(raw.rest, 0, 0, 1),
  };
  const task = raw.task;
  if (isObject(task) && typeof task.kind === "string" && TASKS.includes(task.kind) && typeof task.site === "number" && typeof task.ends === "number") {
    out.task = { kind: task.kind as ConditionTaskKind, site: task.site, ends: task.ends, number: typeof task.number === "number" ? task.number : undefined };
  }
  return out;
}

export function parseConditionsAct(raw: unknown): ConditionsActPayload | undefined {
  if (!isObject(raw) || typeof raw.site !== "number" || !Number.isInteger(raw.site) || raw.site < 0) return undefined;
  return { site: raw.site };
}
