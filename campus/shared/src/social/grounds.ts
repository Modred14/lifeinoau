import { AREAS, PLACES, PX_PER_METER, nearBuilding, onRoad, pointInPoly, type Point } from "../map";

export type GroundId = "sports" | "bowl";

export interface Pitch {
  ground: GroundId;
  place: number;
  area: number;
  cx: number;
  cy: number;
  angle: number;
  length: number;
  width: number;
}

const M = PX_PER_METER;
export const GROUND_IDS: readonly GroundId[] = ["sports", "bowl"];
export const GROUND_NAMES: Record<GroundId, RegExp> = { sports: /oau sports centre/i, bowl: /main bowl/i };
export const GROUND_LABEL: Record<GroundId, string> = { sports: "Sports Centre pitch", bowl: "Main bowl" };
const FULL_SIZE = { length: 100 * M, width: 64 * M };
const SMALLEST = 0.5;
const SHRINK = 0.95;
const APRON = 7 * M;
const CLEAR = 1 * M;

export const GROUND_PLACE: Record<GroundId, number> = {
  sports: PLACES.findIndex((p) => GROUND_NAMES.sports.test(p.name)),
  bowl: PLACES.findIndex((p) => GROUND_NAMES.bowl.test(p.name)),
};

function centroid(poly: readonly number[]): Point {
  let x = 0;
  let y = 0;
  const n = poly.length / 2;
  for (let i = 0; i < poly.length; i += 2) {
    x += poly[i];
    y += poly[i + 1];
  }
  return { x: x / n, y: y / n };
}

function longestEdgeAngle(poly: readonly number[]): number {
  let best = 0;
  let angle = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = poly[j * 2] - poly[i * 2];
    const dy = poly[j * 2 + 1] - poly[i * 2 + 1];
    const len = Math.hypot(dx, dy);
    if (len > best) {
      best = len;
      angle = Math.atan2(dy, dx);
    }
  }
  return angle;
}

export function pitchPoint(p: Pitch, along: number, across: number): Point {
  const ux = Math.cos(p.angle);
  const uy = Math.sin(p.angle);
  return { x: p.cx + ux * along * (p.length / 2) - uy * across * (p.width / 2), y: p.cy + uy * along * (p.length / 2) + ux * across * (p.width / 2) };
}

export function pitchOffset(p: Pitch, alongPx: number, acrossPx: number): Point {
  const ux = Math.cos(p.angle);
  const uy = Math.sin(p.angle);
  return { x: p.cx + ux * alongPx - uy * acrossPx, y: p.cy + uy * alongPx + ux * acrossPx };
}

function fits(p: Pitch, poly: readonly number[]): boolean {
  for (const along of [-1, -0.5, 0, 0.5, 1])
    for (const across of [-1, 0, 1]) {
      const edge = pitchOffset(p, along * (p.length / 2 + (Math.abs(along) === 1 ? CLEAR : 0)), across * (p.width / 2 + APRON));
      if (!pointInPoly(edge.x, edge.y, poly) || nearBuilding(edge.x, edge.y, CLEAR) || onRoad(edge.x, edge.y, CLEAR)) return false;
    }
  return true;
}

function polyArea(poly: readonly number[]): number {
  let sum = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += poly[i * 2] * poly[j * 2 + 1] - poly[j * 2] * poly[i * 2 + 1];
  }
  return Math.abs(sum) / 2;
}

function fieldFor(ground: GroundId, place: number): Pitch | undefined {
  if (place < 0) return undefined;
  const from = PLACES[place].label;
  let best: Pitch | undefined;
  let bestArea = Infinity;
  AREAS.forEach((a, i) => {
    if (a.kind !== "field" || !pointInPoly(from.x, from.y, a.poly)) return;
    const area = polyArea(a.poly);
    if (area >= bestArea) return;
    const pitch = fitPitch(ground, place, i);
    if (!pitch) return;
    best = pitch;
    bestArea = area;
  });
  return best;
}

function fitPitch(ground: GroundId, place: number, area: number): Pitch | undefined {
  const poly = AREAS[area].poly;
  const c = centroid(poly);
  const angle = longestEdgeAngle(poly);
  for (let scale = 1; scale >= SMALLEST; scale *= SHRINK) {
    const pitch: Pitch = { ground, place, area, cx: c.x, cy: c.y, angle, length: FULL_SIZE.length * scale, width: FULL_SIZE.width * scale };
    if (fits(pitch, poly)) return pitch;
  }
  return undefined;
}

const build = (ground: GroundId): Pitch | undefined => fieldFor(ground, GROUND_PLACE[ground]);

export const PITCHES: Partial<Record<GroundId, Pitch>> = Object.fromEntries(GROUND_IDS.map((g) => [g, build(g)] as const).filter((entry): entry is [GroundId, Pitch] => entry[1] !== undefined));

export const pitchOf = (ground: GroundId): Pitch | undefined => PITCHES[ground];
