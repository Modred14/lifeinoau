import { MOTOR_PARK } from "../life";
import { GATE, PLACES, PX_PER_METER, ROADS, type Place, type Point } from "../map";
import { LINES } from "../transit";
import { UNION_PLACE, groundFree, nearestPlace, spacedFrom, zoneAt } from "./ground";
import { hash3 } from "./seed";
import { BANNER_KINDS, BANNER_SIZES, CROSS_RULES, type BannerKind, type BannerSpot, type BannerZone } from "./types";

const M = PX_PER_METER;

export const MAX_SPOTS = 200;
export const TARGET_SPOTS = 184;
export const KIND_GAP: Record<BannerKind, number> = { flex: 16, cross: 110, board: 9, aframe: 6, billboard: 60, flags: 40 };

interface Put {
  kind: BannerKind;
  count: number;
  near: number;
  far: number;
  chance?: number;
}

interface ForecourtRule {
  name?: RegExp;
  kinds?: readonly Place["kind"][];
  put: readonly Put[];
}

const FORECOURTS: readonly ForecourtRule[] = [
  { name: /student union/i, put: [{ kind: "board", count: 3, near: 6, far: 24 }, { kind: "aframe", count: 3, near: 5, far: 20 }, { kind: "flex", count: 4, near: 10, far: 48 }] },
  { name: /main gate|senate/i, put: [] },
  { name: /library/i, put: [{ kind: "board", count: 1, near: 6, far: 20 }] },
  { name: /sports centre|main bowl/i, put: [{ kind: "flex", count: 3, near: 8, far: 110 }] },
  { name: /new buka/i, put: [{ kind: "flex", count: 2, near: 8, far: 36 }, { kind: "aframe", count: 1, near: 5, far: 16 }] },
  { name: /oduduwa|amphi/i, put: [{ kind: "flex", count: 2, near: 9, far: 40 }, { kind: "board", count: 1, near: 6, far: 20 }] },
  { kinds: ["hostel"], put: [{ kind: "board", count: 1, near: 6, far: 22 }, { kind: "flex", count: 2, near: 10, far: 42 }, { kind: "aframe", count: 1, near: 5, far: 16 }] },
  { kinds: ["academic"], put: [{ kind: "board", count: 1, near: 5.5, far: 20 }, { kind: "aframe", count: 1, near: 5, far: 14, chance: 0.4 }] },
  { kinds: ["food", "nightlife"], put: [{ kind: "aframe", count: 1, near: 5, far: 14 }, { kind: "flex", count: 1, near: 8, far: 30 }] },
  { kinds: ["sports"], put: [{ kind: "flex", count: 1, near: 8, far: 30 }] },
];

const FLAG_PLACES: readonly RegExp[] = [/university senate building/i, /oau sports centre/i];
const FLAG_RING = { near: 9, far: 60 };
const RING = { step: 1.5, angles: 18 };
const STOP_BOARD: Put = { kind: "board", count: 1, near: 7.5, far: 18 };
const PARK_PUTS: readonly Put[] = [{ kind: "board", count: 1, near: 7, far: 20 }, { kind: "flex", count: 1, near: 8, far: 26 }];
const CAR_PARK = { halls: [/angola/i, /mozambique/i], put: { kind: "flex", count: 4, near: 2, far: 55 } as Put };
const BILLBOARD = { count: 2, minRoad: 6, from: 35, to: 230, step: 15, setback: 4.5, tilt: 0.45 };
const CROSS = { step: 14 };
const CROSS_CAP: Record<BannerZone, number> = { gate: 4, union: 2, hostel: 4, faculty: 2, faith: 1, sport: 1, commerce: 1, road: 1 };
const VERGE_CAP: Record<BannerZone, number> = { gate: 16, union: 12, hostel: 18, faculty: 8, faith: 4, sport: 6, commerce: 6, road: 8 };
const ZONE_RANK: readonly BannerZone[] = ["union", "gate", "hostel", "sport", "faculty", "commerce", "faith", "road"];
const CROSS_CHANCE: Record<BannerZone, number> = { gate: 0.5, union: 0.6, hostel: 0.3, faculty: 0.12, faith: 0.05, sport: 0.2, commerce: 0.12, road: 0.04 };
const VERGE = { step: 12, minRoad: 4.5, setback: 2.4, tilt: 0.3 };
const VERGE_CHANCE: Record<BannerZone, number> = { gate: 0.3, union: 0.5, hostel: 0.3, faculty: 0.06, faith: 0.08, sport: 0.12, commerce: 0.1, road: 0.012 };

interface RoadPick {
  rank: number;
  roll: number;
  x: number;
  y: number;
  face: number;
  span: number;
}

const byRank = (a: RoadPick, b: RoadPick) => a.rank - b.rank || a.roll - b.roll;

interface RoadPoint {
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  road: number;
  n: number;
}

function walkRoads(step: number, minWidth: number, fn: (p: RoadPoint) => void) {
  ROADS.forEach((road, ri) => {
    if (road.kind !== "road" || road.width < minWidth * M) return;
    let carry = step * M * hash3(ri, 1, 0);
    let n = 0;
    for (let i = 0; i + 3 < road.pts.length; i += 2) {
      const ax = road.pts[i], ay = road.pts[i + 1], bx = road.pts[i + 2], by = road.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      let d = carry;
      for (; d < len; d += step * M) fn({ x: ax + ((bx - ax) * d) / len, y: ay + ((by - ay) * d) / len, dx: (bx - ax) / len, dy: (by - ay) / len, width: road.width, road: ri, n: n++ });
      carry = d - len;
    }
  });
}

export function planBanners(): BannerSpot[] {
  const out: BannerSpot[] = [];
  const add = (kind: BannerKind, x: number, y: number, face: number, span: number, place = -1): boolean => {
    if (out.length >= MAX_SPOTS) return false;
    const draft = { kind, x, y, face, span };
    if (!spacedFrom(draft, out, KIND_GAP[kind]) || !groundFree(draft)) return false;
    out.push({ id: out.length, kind, x, y, face, span, place: place >= 0 ? place : nearestPlace(x, y).index, zone: zoneAt(x, y), slots: BANNER_SIZES[kind].slots });
    return true;
  };
  const ring = (anchor: Point, place: number, put: Put, seed: number) => {
    if (put.chance !== undefined && hash3(seed, BANNER_KINDS.indexOf(put.kind), 5) > put.chance) return;
    const turn = hash3(seed, BANNER_KINDS.indexOf(put.kind), 6) * Math.PI * 2;
    let made = 0;
    for (let r = put.near; r <= put.far && made < put.count; r += RING.step)
      for (let k = 0; k < RING.angles && made < put.count; k++) {
        const a = (k / RING.angles) * Math.PI * 2 + turn + r;
        const x = anchor.x + Math.cos(a) * r * M;
        const y = anchor.y + Math.sin(a) * r * M;
        if (add(put.kind, x, y, Math.atan2(anchor.y - y, anchor.x - x), BANNER_SIZES[put.kind].width, place)) made++;
      }
  };

  for (const re of FLAG_PLACES) {
    const i = PLACES.findIndex((p) => re.test(p.name));
    if (i >= 0) ring(PLACES[i].door, i, { kind: "flags", count: 1, near: FLAG_RING.near, far: FLAG_RING.far }, i);
  }

  if (GATE) {
    const gate = GATE;
    let boards = 0;
    walkRoads(BILLBOARD.step, BILLBOARD.minRoad, (p) => {
      const d = Math.hypot(gate.x - p.x, gate.y - p.y) / M;
      if (boards >= BILLBOARD.count || d < BILLBOARD.from || d > BILLBOARD.to) return;
      const side = hash3(p.road, p.n, 31) < 0.5 ? 1 : -1;
      const nx = -p.dy * side;
      const ny = p.dx * side;
      const off = p.width / 2 + BILLBOARD.setback * M;
      const face = Math.atan2(-ny, -nx) + (boards % 2 ? -1 : 1) * BILLBOARD.tilt;
      if (add("billboard", p.x + nx * off, p.y + ny * off, face, BANNER_SIZES.billboard.width)) boards++;
    });
  }

  const order = [...PLACES.keys()].sort((a, b) => Number(b === UNION_PLACE) - Number(a === UNION_PLACE) || Number(PLACES[b].kind === "hostel") - Number(PLACES[a].kind === "hostel") || a - b);
  for (const i of order) {
    const place = PLACES[i];
    const rule = FORECOURTS.find((r) => (r.name ? r.name.test(place.name) : !!r.kinds && r.kinds.includes(place.kind)));
    if (rule) for (const put of rule.put) ring(place.door, i, put, i);
  }

  const halls = CAR_PARK.halls.map((re) => PLACES.findIndex((p) => re.test(p.name)));
  if (halls.every((i) => i >= 0)) {
    const a = PLACES[halls[0]].door;
    const b = PLACES[halls[1]].door;
    ring({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, halls[0], CAR_PARK.put, 401);
  }
  PARK_PUTS.forEach((put) => ring(MOTOR_PARK, -1, put, 402));
  LINES.forEach((line, li) => line.stops.forEach((stop, si) => ring(stop.kerb, -1, STOP_BOARD, 500 + li * 40 + si)));

  const crossPicks: RoadPick[] = [];
  walkRoads(CROSS.step, CROSS_RULES.minRoadWidth, (p) => {
    const zone = zoneAt(p.x, p.y);
    const roll = hash3(p.road, p.n, 11);
    if (roll < CROSS_CHANCE[zone]) crossPicks.push({ rank: ZONE_RANK.indexOf(zone), roll, x: p.x, y: p.y, face: Math.atan2(p.dy, p.dx), span: p.width / M + CROSS_RULES.setback * 2 });
  });
  const crossMade = new Array<number>(ZONE_RANK.length).fill(0);
  for (const c of crossPicks.sort(byRank)) if (crossMade[c.rank] < CROSS_CAP[ZONE_RANK[c.rank]] && add("cross", c.x, c.y, c.face, c.span)) crossMade[c.rank]++;

  const vergePicks: RoadPick[] = [];
  walkRoads(VERGE.step, VERGE.minRoad, (p) => {
    for (const side of [1, -1]) {
      const nx = -p.dy * side;
      const ny = p.dx * side;
      const off = p.width / 2 + VERGE.setback * M;
      const x = p.x + nx * off;
      const y = p.y + ny * off;
      const zone = zoneAt(x, y);
      const roll = hash3(p.road, p.n, 20 + side);
      if (roll > VERGE_CHANCE[zone]) continue;
      vergePicks.push({ rank: ZONE_RANK.indexOf(zone), roll, x, y, face: Math.atan2(-ny, -nx) + (hash3(p.road, p.n, 40 + side) - 0.5) * 2 * VERGE.tilt, span: BANNER_SIZES.flex.width });
    }
  });
  const vergeMade = new Array<number>(ZONE_RANK.length).fill(0);
  for (const v of vergePicks.sort(byRank)) if (out.length < TARGET_SPOTS && vergeMade[v.rank] < VERGE_CAP[ZONE_RANK[v.rank]] && add("flex", v.x, v.y, v.face, v.span)) vergeMade[v.rank]++;

  return out;
}

export const BANNER_SPOTS: readonly BannerSpot[] = planBanners();
