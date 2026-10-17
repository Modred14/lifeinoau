import type { GameTime } from "../clock";
import { STALLS } from "../interiors";
import { SOCIAL_SITES } from "../social/place";
import { ORDINARY_HOURS, SPECIAL_TRADES, withinHours, type SpecialId } from "../social/trades";
import { liveEvent } from "./calendar";
import { seeded } from "./seed";

export interface StallHours {
  open: number;
  close: number;
  special?: SpecialId;
}

export const FRESH_BATCH = { first: 5, gap: [35, 55], window: 12, fun: 8 } as const;

const SPECIAL_BY_STALL = new Map<number, SpecialId>();
for (const id of Object.keys(SPECIAL_TRADES) as SpecialId[]) {
  const stall = SOCIAL_SITES.stalls[id];
  if (stall !== undefined) SPECIAL_BY_STALL.set(stall, id);
}
const STALL_BY_SPOT = new Map<number, number>(STALLS.map((s, i) => [s.spot, i]));

const clock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const TEXT = {
  ordinary: (open: number) => `🌙 This trader don pack for the night. Come back from ${clock(open)}.`,
  risky: (open: number) => `🌙 Risky never open. Na from ${clock(open)} till early morning.`,
  hot: (open: number, close: number) => `🍩 As E Dey Hot fries from ${clock(open)} to ${clock(close)}. Come back then.`,
  palm: "🌴 Palm wine only flows on gyration night.",
  fresh: `🔥 Fresh batch! E still dey hot. +${FRESH_BATCH.fun} fun`,
};

export const stallOfSpot = (spot: number): number => STALL_BY_SPOT.get(spot) ?? -1;

export function stallHours(stall: number): StallHours {
  const special = SPECIAL_BY_STALL.get(stall);
  return special ? { open: SPECIAL_TRADES[special].open, close: SPECIAL_TRADES[special].close, special } : { ...ORDINARY_HOURS };
}

export function stallOpen(stall: number, t: GameTime): boolean {
  const hours = stallHours(stall);
  if (hours.special === "palm") return liveEvent("gyration", t) !== undefined;
  return withinHours(t.minute, hours.open, hours.close);
}

export function closedText(stall: number): string {
  const hours = stallHours(stall);
  if (hours.special === "palm") return TEXT.palm;
  if (hours.special === "risky") return TEXT.risky(hours.open);
  if (hours.special === "hot") return TEXT.hot(hours.open, hours.close);
  return TEXT.ordinary(hours.open);
}

export function batchTimes(dayIndex: number): number[] {
  const { open, close } = SPECIAL_TRADES.hot;
  const rand = seeded(dayIndex * 613 + 41);
  const out: number[] = [];
  for (let minute = open + FRESH_BATCH.first; minute < close - FRESH_BATCH.window; minute += FRESH_BATCH.gap[0] + Math.floor(rand() * (FRESH_BATCH.gap[1] - FRESH_BATCH.gap[0] + 1))) out.push(minute);
  return out;
}

export function freshBatch(t: GameTime): boolean {
  return batchTimes(t.dayIndex).some((minute) => t.minute >= minute && t.minute < minute + FRESH_BATCH.window);
}

export function freshBatchAt(stall: number, t: GameTime): string | undefined {
  return stallHours(stall).special === "hot" && freshBatch(t) ? TEXT.fresh : undefined;
}

export function nextBatch(t: GameTime): number | undefined {
  return batchTimes(t.dayIndex).find((minute) => minute + FRESH_BATCH.window > t.minute);
}
