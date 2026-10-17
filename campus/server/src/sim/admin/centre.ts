import { BUSINESS_CENTRES, STALLS, closedText, nearestBusinessCentre, stallOpen, type GameTime } from "@campuslife/shared";

export function centreClosed(x: number, y: number, now: GameTime): string | undefined {
  const near = nearestBusinessCentre(x, y);
  if (!near) return undefined;
  const stall = STALLS.indexOf(BUSINESS_CENTRES[near.index]);
  return stall < 0 || stallOpen(stall, now) ? undefined : closedText(stall);
}
