import { STALLS, stallBlocked } from "../interiors";
import { AREAS, GATE, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, nearBuilding, onRoad, pointInPoly, type Point } from "../map";
import { isBlocked } from "../movement";
import { POLITICS_POINTS } from "../politics/sites";
import { sitesClear } from "../sites-clear";
import { addSolid } from "../solids";
import { SOCIAL_POINTS } from "../social/points";
import { isHostel } from "./water";

const M = PX_PER_METER;

export type ConditionSiteKind = "standpipe" | "clinic" | "chemist";

export interface ConditionSite extends Point {
  id: number;
  kind: ConditionSiteKind;
  name: string;
  place: number;
  face: number;
  stand: Point;
  queue: Point[];
}

export const SITE_RULES = {
  wallMargin: 2.5 * M,
  roadMargin: 2 * M,
  stallMargin: 2 * M,
  stallApart: 6 * M,
  doorClear: 5 * M,
  gateClear: 20 * M,
  apart: 8 * M,
  politicsApart: 9 * M,
  edge: 5 * M,
  standOff: 1.4 * M,
  standRoadMargin: 0.4 * M,
  queueGap: 0.9 * M,
  queueLength: 4,
  ringStep: 1.5,
  ringAngles: 20,
};
export const SITE_REACH = 3 * M;
export const CLINIC_STAY = 9 * M;
export const SITE_NAMES: Record<ConditionSiteKind, string> = { standpipe: "Standpipe", clinic: "Campus clinic", chemist: "Chemist" };

const SITE_SEARCH: Record<ConditionSiteKind, { from: number; to: number }> = {
  standpipe: { from: 7, to: 32 },
  clinic: { from: 12, to: 44 },
  chemist: { from: 10, to: 44 },
};
const CLINIC_ANCHORS = [/^student union building$/i, /sports centre/i];
const WET_AREAS = AREAS.filter((a) => a.kind === "water");
const DOORS = PLACES.map((p) => p.door);
const POLITICS: readonly Point[] = POLITICS_POINTS;
const OTHERS: readonly (readonly Point[])[] = [POLITICS_POINTS, SOCIAL_POINTS];

const farFrom = (list: readonly Point[], x: number, y: number, d: number) => list.every((p) => Math.hypot(p.x - x, p.y - y) >= d);

export function siteIsLegal(x: number, y: number): boolean {
  const R = SITE_RULES;
  if (x < R.edge || y < R.edge || x > MAP_WIDTH_PX - R.edge || y > MAP_HEIGHT_PX - R.edge) return false;
  if (nearBuilding(x, y, R.wallMargin) || onRoad(x, y, R.roadMargin) || stallBlocked(x, y, R.stallMargin) || isBlocked(x, y)) return false;
  if (!farFrom(DOORS, x, y, R.doorClear) || !farFrom(STALLS, x, y, R.stallApart)) return false;
  if (GATE && Math.hypot(GATE.x - x, GATE.y - y) < R.gateClear) return false;
  return !WET_AREAS.some((a) => pointInPoly(x, y, a.poly));
}

export function standIsLegal(x: number, y: number): boolean {
  return !isBlocked(x, y) && !onRoad(x, y, SITE_RULES.standRoadMargin);
}

function place(kind: ConditionSiteKind, anchorPlace: number, taken: ConditionSite[]): ConditionSite | undefined {
  const anchor = PLACES[anchorPlace]?.door;
  if (!anchor) return undefined;
  const R = SITE_RULES;
  const { from, to } = SITE_SEARCH[kind];
  for (let r = from; r <= to; r += R.ringStep) {
    for (let k = 0; k < R.ringAngles; k++) {
      const a = (k / R.ringAngles) * Math.PI * 2 + r;
      const x = Math.round(anchor.x + Math.cos(a) * r * M);
      const y = Math.round(anchor.y + Math.sin(a) * r * M);
      if (!siteIsLegal(x, y) || !farFrom(taken, x, y, R.apart) || !farFrom(POLITICS, x, y, R.politicsApart)) continue;
      const face = Math.round(Math.atan2(anchor.y - y, anchor.x - x) / (Math.PI / 2)) * (Math.PI / 2);
      const fx = Math.round(Math.cos(face));
      const fy = Math.round(Math.sin(face));
      const stand = { x: x + fx * R.standOff, y: y + fy * R.standOff };
      if (!standIsLegal(stand.x, stand.y) || !sitesClear(x, y, OTHERS) || !sitesClear(stand.x, stand.y, OTHERS)) continue;
      const queue: Point[] = [];
      for (let i = 1; i <= R.queueLength; i++) {
        const q = { x: stand.x + fx * i * R.queueGap, y: stand.y + fy * i * R.queueGap };
        if (!standIsLegal(q.x, q.y)) break;
        queue.push(q);
      }
      if (!queue.every((q) => sitesClear(q.x, q.y, OTHERS))) continue;
      return { id: taken.length, kind, name: SITE_NAMES[kind], place: anchorPlace, x, y, face, stand, queue };
    }
  }
  return undefined;
}

function build(): ConditionSite[] {
  const out: ConditionSite[] = [];
  const add = (kind: ConditionSiteKind, anchorPlace: number) => {
    const site = anchorPlace >= 0 ? place(kind, anchorPlace, out) : undefined;
    if (site) out.push(site);
    return !!site;
  };
  PLACES.forEach((_, i) => {
    if (isHostel(i)) add("standpipe", i);
  });
  const anchors = CLINIC_ANCHORS.map((re) => PLACES.findIndex((p) => re.test(p.name)));
  anchors.some((a) => add("clinic", a));
  anchors.some((a) => add("chemist", a));
  return out;
}

export const CONDITION_SITES: readonly ConditionSite[] = build();

export const CHEMIST_KIOSK = { halfWidth: 1.15 * M, halfDepth: 0.75 * M, setBack: 0.15 * M };

for (const site of CONDITION_SITES) {
  if (site.kind !== "chemist") continue;
  const K = CHEMIST_KIOSK;
  addSolid({ name: site.name, x: site.x - Math.cos(site.face) * K.setBack, y: site.y - Math.sin(site.face) * K.setBack, halfAlong: K.halfDepth, halfAcross: K.halfWidth, angle: site.face });
}

export const CONDITION_POINTS: readonly Point[] = CONDITION_SITES.flatMap((s) => [{ x: s.x, y: s.y }, s.stand, ...s.queue]);

export const conditionSite = (id: number): ConditionSite | undefined => CONDITION_SITES[id];

export function standpipeOf(hostel: number): ConditionSite | undefined {
  return CONDITION_SITES.find((s) => s.kind === "standpipe" && s.place === hostel);
}

export function conditionSiteNear(x: number, y: number, reach = SITE_REACH): { site: ConditionSite; distance: number } | undefined {
  let best: { site: ConditionSite; distance: number } | undefined;
  for (const site of CONDITION_SITES) {
    const distance = Math.hypot(site.stand.x - x, site.stand.y - y);
    if (distance <= reach && (!best || distance < best.distance)) best = { site, distance };
  }
  return best;
}
