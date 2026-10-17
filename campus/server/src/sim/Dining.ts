import { INTERIORS, SPOTS, type Spot } from "@campuslife/shared";

const served = new WeakMap<object, number>();
const tables = new Map<number, number[]>();

function tableSeats(place: number): number[] {
  let seats = tables.get(place);
  if (!seats) {
    seats = [];
    const interior = INTERIORS[place];
    if (interior) for (let i = interior.spotStart; i < interior.spotEnd; i++) if (SPOTS[i].menu !== undefined) seats.push(i);
    tables.set(place, seats);
  }
  return seats;
}

export function findTableSeat(counter: number, owners: ReadonlyMap<number, string>): number | undefined {
  const from = SPOTS[counter];
  if (!from || from.kind !== "eat" || from.place < 0) return undefined;
  let best: number | undefined;
  let bestScore = Infinity;
  for (const i of tableSeats(from.place)) {
    if (owners.has(i)) continue;
    const seat = SPOTS[i];
    const score = Math.hypot(seat.x - from.x, seat.y - from.y) + (seat.menu === counter ? 0 : 1e6);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

export function serveMeal(act: object, counter: number) {
  served.set(act, counter);
}

export function mealServed(act: object, spot: Spot): Spot | undefined {
  const counter = served.get(act);
  if (counter !== undefined) return SPOTS[counter];
  return spot.kind === "eat" ? spot : undefined;
}
