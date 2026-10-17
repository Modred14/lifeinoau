import { PX_PER_METER, type Point } from "./map";

export const SITES_APART = 4 * PX_PER_METER;

export function sitesClear(x: number, y: number, others: readonly (readonly Point[])[], apart: number = SITES_APART): boolean {
  return others.every((list) => list.every((p) => Math.hypot(p.x - x, p.y - y) >= apart));
}

export function closestApart(a: readonly Point[], b: readonly Point[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
  return best;
}
