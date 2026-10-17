import { SPOTS, STALLS } from "../interiors";
import { MOTOR_PARK } from "../life";
import { AREAS, GATE, GATE_PILLARS, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, SPAWN_POINT, nearBuilding, onRoad, pointInPoly, type Place, type Point } from "../map";
import { QUEUES } from "../queues";
import { DEBATE_SITE, FORM_DESK, POLL_UNITS, RALLY_POINTS } from "../politics/sites";
import { LINES } from "../transit";
import { BANNER_SIZES, type BannerSpot, type BannerZone } from "./types";

const M = PX_PER_METER;

export const KEEP = { door: 5, kerb: 6, stand: 4, stall: 4.2, seller: 2, customer: 3, queue: 1.6, park: 5, spawn: 6, pillar: 4.5, edge: 4 };
export const SPACING = { gap: 3, footStep: 1.5, ringPoints: 12 };
export const ZONE_REACH = { gate: 260, union: 150, place: 110 };

const PLACE_ZONE: Record<Place["kind"], BannerZone> = {
  academic: "faculty",
  hostel: "hostel",
  residence: "road",
  worship: "faith",
  commercial: "commerce",
  sports: "sport",
  civic: "road",
  other: "road",
  area: "sport",
  food: "commerce",
  nightlife: "commerce",
};

export const UNION_PLACE = PLACES.findIndex((p) => /student union/i.test(p.name));
const NO_GO = AREAS.filter((a) => a.kind === "water" || a.kind === "field");

interface KeepOut {
  at: Point;
  radius: number;
}

const KEEP_CELL = 24 * M;
const KEEP_COLS = Math.ceil(MAP_WIDTH_PX / KEEP_CELL) + 2;
const keepCells = new Map<number, KeepOut[]>();

function keep(at: Point, metres: number) {
  if (at.x < 0 || at.y < 0 || at.x > MAP_WIDTH_PX || at.y > MAP_HEIGHT_PX) return;
  const k: KeepOut = { at, radius: metres * M };
  const cx = Math.floor(at.x / KEEP_CELL);
  const cy = Math.floor(at.y / KEEP_CELL);
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const key = (cy + dy + 1) * KEEP_COLS + cx + dx + 1;
      const list = keepCells.get(key);
      if (list) list.push(k);
      else keepCells.set(key, [k]);
    }
}

for (const p of PLACES) keep(p.door, KEEP.door);
for (const line of LINES)
  for (const s of line.stops) {
    keep(s.kerb, KEEP.kerb);
    keep({ x: s.x, y: s.y }, KEEP.stand);
  }
for (const s of STALLS) {
  keep({ x: s.x, y: s.y }, KEEP.stall);
  keep({ x: s.npc.x, y: s.npc.y }, KEEP.seller);
  const stand = SPOTS[s.spot];
  if (stand) keep({ x: stand.sx, y: stand.sy }, KEEP.customer);
}
for (const q of QUEUES) for (const slot of q.slots) keep(slot, KEEP.queue);
for (const g of GATE_PILLARS) keep(g, KEEP.pillar);
keep(MOTOR_PARK, KEEP.park);
keep(SPAWN_POINT, KEEP.spawn);

const POLITICS_KEEP = 6;
for (const site of [...POLL_UNITS, ...RALLY_POINTS, FORM_DESK, DEBATE_SITE]) keep(site, POLITICS_KEEP);

function kept(x: number, y: number): boolean {
  const list = keepCells.get((Math.floor(y / KEEP_CELL) + 1) * KEEP_COLS + Math.floor(x / KEEP_CELL) + 1);
  return !!list && list.some((k) => Math.hypot(k.at.x - x, k.at.y - y) < k.radius);
}

export function offRoad(x: number, y: number, margin: number): boolean {
  if (onRoad(x, y)) return false;
  for (let i = 0; i < SPACING.ringPoints; i++) {
    const a = (i / SPACING.ringPoints) * Math.PI * 2;
    if (onRoad(x + Math.cos(a) * margin, y + Math.sin(a) * margin)) return false;
  }
  return true;
}

export function bannerFootprint(s: Pick<BannerSpot, "kind" | "x" | "y" | "face" | "span">): Point[] {
  const ax = -Math.sin(s.face);
  const ay = Math.cos(s.face);
  const half = (s.span / 2) * M;
  if (s.kind === "cross") return [{ x: s.x - ax * half, y: s.y - ay * half }, { x: s.x + ax * half, y: s.y + ay * half }];
  const n = Math.max(1, Math.ceil(s.span / SPACING.footStep));
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = -half + (2 * half * i) / n;
    out.push({ x: s.x + ax * t, y: s.y + ay * t });
  }
  return out;
}

export function nearestPlace(x: number, y: number): { index: number; distance: number } {
  let index = 0;
  let best = Infinity;
  PLACES.forEach((p, i) => {
    const d = Math.hypot(p.door.x - x, p.door.y - y);
    if (d < best) {
      best = d;
      index = i;
    }
  });
  return { index, distance: best };
}

export function zoneAt(x: number, y: number): BannerZone {
  if (GATE && Math.hypot(GATE.x - x, GATE.y - y) < ZONE_REACH.gate * M) return "gate";
  const union = PLACES[UNION_PLACE];
  if (union && Math.hypot(union.door.x - x, union.door.y - y) < ZONE_REACH.union * M) return "union";
  const near = nearestPlace(x, y);
  return near.distance < ZONE_REACH.place * M ? PLACE_ZONE[PLACES[near.index].kind] : "road";
}

export function groundFree(s: Pick<BannerSpot, "kind" | "x" | "y" | "face" | "span">): boolean {
  const size = BANNER_SIZES[s.kind];
  const edge = KEEP.edge * M;
  for (const p of bannerFootprint(s)) {
    if (p.x < edge || p.y < edge || p.x > MAP_WIDTH_PX - edge || p.y > MAP_HEIGHT_PX - edge) return false;
    if (!offRoad(p.x, p.y, size.margin * M) || nearBuilding(p.x, p.y, size.wall * M) || kept(p.x, p.y)) return false;
    if (NO_GO.some((a) => pointInPoly(p.x, p.y, a.poly))) return false;
  }
  return true;
}

export function spacedFrom(s: Pick<BannerSpot, "kind" | "x" | "y" | "span">, placed: readonly BannerSpot[], sameKindGap: number): boolean {
  for (const q of placed) {
    const d = Math.hypot(q.x - s.x, q.y - s.y);
    if (d < (SPACING.gap + (s.span + q.span) / 2) * M) return false;
    if (q.kind === s.kind && d < sameKindGap * M) return false;
  }
  return true;
}
