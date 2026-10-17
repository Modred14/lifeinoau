import type { GameTime } from "../clock";
import { setLightRelief, type LightRelief } from "../conditions/power";
import { CONDITION_STATUS } from "../conditions/record";
import { campusEffects, findConcession, type UnionState } from "../politics/campus-state";
import { closedText, stallOfSpot, stallOpen } from "../shows/night-food";

export const BOYCOTT_TEXT = {
  toast: "✊ Boycott dey on. No class today.",
  note: "Boycott dey on. No class today",
  tag: "Boycott",
} as const;

export const STATUS_MARK = { sick: "🤒", unwashed: "🧼" } as const;

export const boycottAt = (states: readonly UnionState[], total: number): boolean => campusEffects(states, total).boycott;

export const fareWithFactor = (fare: number, factor: number): number => Math.max(0, Math.round(fare * factor));

export const concessionFare = (fare: number, states: readonly UnionState[], total: number): number => fareWithFactor(fare, campusEffects(states, total).fareFactor);

export function lightReliefs(states: readonly UnionState[]): LightRelief[] {
  return states.flatMap((state) => {
    const hours = state.kind === "concession" ? (findConcession(state.concession)?.lightHours ?? 0) : 0;
    return hours > 0 ? [{ from: state.from, until: state.until, hours }] : [];
  });
}

export function applyCampusStates(states: readonly UnionState[]) {
  setLightRelief(lightReliefs(states));
}

export function vendorOpen(spot: number, t: GameTime): boolean {
  const stall = stallOfSpot(spot);
  return stall < 0 || stallOpen(stall, t);
}

export function orderRefusal(spot: number, t: GameTime): string | undefined {
  const stall = stallOfSpot(spot);
  return stall < 0 || stallOpen(stall, t) ? undefined : closedText(stall);
}

export function statusMarks(status: number | undefined): string {
  const bits = status ?? 0;
  return `${bits & CONDITION_STATUS.sick ? STATUS_MARK.sick : ""}${bits & CONDITION_STATUS.unwashed ? STATUS_MARK.unwashed : ""}`;
}

export function withStatus(name: string, status: number | undefined): string {
  const marks = statusMarks(status);
  return marks ? `${name} ${marks}` : name;
}
