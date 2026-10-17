import { MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, nearBuilding, onRoad, type Point } from "../map";
import { SELLER_LOOKS } from "../interior/builder";
import type { Stall } from "../interior/stalls";
import type { Spot } from "../interior/types";
import { GROUND_IDS, PITCHES, pitchOffset, type GroundId } from "./grounds";
import { FORECOURT_LABEL, GYRATION_LABEL, SPECIAL_TRADES, TOUCHLINE_LABEL, type SpecialId, type SpecialTrade } from "./trades";

const M = PX_PER_METER;

export interface FinalistPoint extends Point {
  face: number;
  place: number;
}

export interface Ring extends Point {
  radius: number;
  spots: number[];
}

export interface SocialSites {
  stalls: Partial<Record<SpecialId, number>>;
  touchline: Record<GroundId, number[]>;
  benches: Partial<Record<GroundId, Point>>;
  gyration?: Ring;
  forecourt?: { x: number; y: number; spots: number[] };
  finalists: FinalistPoint[];
  firstSpot: number;
  firstStall: number;
}

export const SOCIAL_SITES: SocialSites = { stalls: {}, touchline: { sports: [], bowl: [] }, benches: {}, finalists: [], firstSpot: -1, firstStall: -1 };

const SITE = {
  edge: 5 * M,
  spotClear: 0.9 * M,
  roadClear: 0.8 * M,
  stallClear: 3 * M,
  searchStep: 1.5 * M,
  searchMax: 45 * M,
  searchTurns: 16,
  stallAlong: 2.6 * M,
  stallDeep: 1.2 * M,
  standOff: 1.5 * M,
  sellerOff: 1 * M,
};
const RISKY = { hall: /awolowo hall/i, toward: /oduduwa hall/i, out: 30 * M };
const HOT = { hall: /alumni hall/i, across: 16 * M };
const UNION = /student union/i;
const BENCH = { seats: 6, gap: 0.7 * M, apron: 4.5 * M, standBack: 0.7 * M, centres: [-0.3, 0.3] };
const GYRATION = { east: 34 * M, south: 22 * M, radius: 3.4 * M, dancers: 10, palmOff: 8 * M };
const FORECOURT = { south: 20 * M, columns: [-3, 0, 3], rows: [0, 3], unit: M };
const FINALISTS = { union: 8, unionRadius: [14 * M, 20 * M], perFaculty: 2, facultyRadius: 9 * M, faculty: /faculty/i, turns: 12 };

type Free = (x: number, y: number) => boolean;

function clear(out: readonly Stall[], x: number, y: number): boolean {
  if (x < SITE.edge || y < SITE.edge || x > MAP_WIDTH_PX - SITE.edge || y > MAP_HEIGHT_PX - SITE.edge) return false;
  if (nearBuilding(x, y, SITE.spotClear) || onRoad(x, y, SITE.roadClear)) return false;
  return out.every((s) => Math.hypot(s.x - x, s.y - y) > SITE.stallClear);
}

function search(target: Point, ok: Free): Point | undefined {
  for (let r = 0; r <= SITE.searchMax; r += SITE.searchStep)
    for (let k = 0; k < SITE.searchTurns; k++) {
      const a = (k / SITE.searchTurns) * Math.PI * 2;
      const x = target.x + Math.cos(a) * r;
      const y = target.y + Math.sin(a) * r;
      if (ok(x, y)) return { x, y };
      if (r === 0) break;
    }
  return undefined;
}

function addStall(spots: Spot[], out: Stall[], trade: SpecialTrade, at: Point, toward: Point): number | undefined {
  const face = Math.round(Math.atan2(toward.y - at.y, toward.x - at.x) / (Math.PI / 2)) * (Math.PI / 2);
  const fx = Math.round(Math.cos(face));
  const fy = Math.round(Math.sin(face));
  const stand = { x: at.x + fx * SITE.standOff, y: at.y + fy * SITE.standOff };
  if (!clear(out, stand.x, stand.y)) return undefined;
  const cw = fx !== 0 ? SITE.stallDeep : SITE.stallAlong;
  const ch = fx !== 0 ? SITE.stallAlong : SITE.stallDeep;
  const spot = spots.length;
  spots.push({ kind: "eat", x: stand.x, y: stand.y, sx: stand.x, sy: stand.y, face: face + Math.PI, label: trade.label, price: trade.price, food: trade.food, fun: trade.fun, place: -1, roadside: true });
  out.push({
    name: trade.label,
    style: trade.style,
    goods: trade.goods,
    roadside: true,
    x: at.x,
    y: at.y,
    face,
    col: { x: at.x - cw / 2, y: at.y - ch / 2, w: cw, h: ch },
    spot,
    npc: { x: at.x - fx * SITE.sellerOff, y: at.y - fy * SITE.sellerOff, face, look: SELLER_LOOKS[out.length % SELLER_LOOKS.length] },
  });
  return out.length - 1;
}

function special(spots: Spot[], out: Stall[], free: Free, id: SpecialId, target: Point | undefined, toward: Point | undefined) {
  if (!target || !toward) return;
  for (let tries = 0; tries < 4; tries++) {
    const at = search({ x: target.x + tries * SITE.searchStep, y: target.y }, free);
    const index = at ? addStall(spots, out, SPECIAL_TRADES[id], at, toward) : undefined;
    if (index !== undefined) {
      SOCIAL_SITES.stalls[id] = index;
      return;
    }
  }
}

const door = (name: RegExp): Point | undefined => PLACES.find((p) => name.test(p.name))?.door;

function nightFood(spots: Spot[], out: Stall[], free: Free) {
  const awo = door(RISKY.hall);
  const academics = door(RISKY.toward);
  if (awo && academics) {
    const d = Math.hypot(academics.x - awo.x, academics.y - awo.y) || 1;
    special(spots, out, free, "risky", { x: awo.x + ((academics.x - awo.x) / d) * RISKY.out, y: awo.y + ((academics.y - awo.y) / d) * RISKY.out }, awo);
  }
  const alumni = PLACES.find((p) => HOT.hall.test(p.name));
  if (alumni) {
    const d = Math.hypot(alumni.door.x - alumni.label.x, alumni.door.y - alumni.label.y) || 1;
    special(spots, out, free, "hot", { x: alumni.door.x + ((alumni.door.x - alumni.label.x) / d) * HOT.across, y: alumni.door.y + ((alumni.door.y - alumni.label.y) / d) * HOT.across }, alumni.door);
  }
}

function touchlines(spots: Spot[], out: readonly Stall[]) {
  for (const ground of GROUND_IDS) {
    const pitch = PITCHES[ground];
    if (!pitch) continue;
    const from = PLACES[pitch.place].door;
    const sides = [1, -1].sort((a, b) => {
      const pa = pitchOffset(pitch, 0, a * pitch.width);
      const pb = pitchOffset(pitch, 0, b * pitch.width);
      return Math.hypot(pa.x - from.x, pa.y - from.y) - Math.hypot(pb.x - from.x, pb.y - from.y);
    });
    for (const side of sides) {
      const seats: Spot[] = [];
      for (const centre of BENCH.centres)
        for (let k = 0; k < BENCH.seats; k++) {
          const along = centre * pitch.length + (k - (BENCH.seats - 1) / 2) * BENCH.gap;
          const seat = pitchOffset(pitch, along, side * (pitch.width / 2 + BENCH.apron));
          const stand = pitchOffset(pitch, along, side * (pitch.width / 2 + BENCH.apron + BENCH.standBack));
          const face = Math.atan2(pitch.cy - pitchOffset(pitch, 0, side * pitch.width).y, pitch.cx - pitchOffset(pitch, 0, side * pitch.width).x);
          if (clear(out, seat.x, seat.y) && clear(out, stand.x, stand.y)) seats.push({ kind: "tv", x: seat.x, y: seat.y, sx: stand.x, sy: stand.y, face, label: TOUCHLINE_LABEL, place: -1, seat: "bench" });
        }
      if (seats.length < BENCH.seats) continue;
      SOCIAL_SITES.benches[ground] = { x: seats[0].sx, y: seats[0].sy };
      for (const seat of seats) {
        SOCIAL_SITES.touchline[ground].push(spots.length);
        spots.push(seat);
      }
      break;
    }
  }
}

function gyration(spots: Spot[], out: Stall[], free: Free, union: Point) {
  const ring = (x: number, y: number) => {
    if (!free(x, y)) return false;
    for (let k = 0; k < GYRATION.dancers; k++) {
      const a = (k / GYRATION.dancers) * Math.PI * 2;
      if (!clear(out, x + Math.cos(a) * (GYRATION.radius + M), y + Math.sin(a) * (GYRATION.radius + M))) return false;
    }
    return true;
  };
  const centre = search({ x: union.x + GYRATION.east, y: union.y + GYRATION.south }, ring);
  if (!centre) return;
  const site: Ring = { ...centre, radius: GYRATION.radius, spots: [] };
  for (let k = 0; k < GYRATION.dancers; k++) {
    const a = (k / GYRATION.dancers) * Math.PI * 2;
    const x = centre.x + Math.cos(a) * GYRATION.radius;
    const y = centre.y + Math.sin(a) * GYRATION.radius;
    site.spots.push(spots.length);
    spots.push({ kind: "dance", x, y, sx: x, sy: y, face: a + Math.PI, label: GYRATION_LABEL, place: -1 });
  }
  SOCIAL_SITES.gyration = site;
  const far = (x: number, y: number) => free(x, y) && Math.hypot(x - centre.x, y - centre.y) >= GYRATION.palmOff;
  special(spots, out, far, "palm", { x: centre.x + GYRATION.palmOff, y: centre.y }, centre);
}

function forecourt(spots: Spot[], out: readonly Stall[], union: Point) {
  const grid = (x: number, y: number) => FORECOURT.columns.every((cx) => FORECOURT.rows.every((cy) => clear(out, x + cx * FORECOURT.unit, y + cy * FORECOURT.unit)));
  const ring = SOCIAL_SITES.gyration;
  const apart = (x: number, y: number) => grid(x, y) && (!ring || Math.hypot(ring.x - x, ring.y - y) > ring.radius + 8 * M);
  const origin = search({ x: union.x, y: union.y + FORECOURT.south }, apart);
  if (!origin) return;
  const site = { ...origin, spots: [] as number[] };
  for (const cy of FORECOURT.rows)
    for (const cx of FORECOURT.columns) {
      const x = origin.x + cx * FORECOURT.unit;
      const y = origin.y + cy * FORECOURT.unit;
      site.spots.push(spots.length);
      spots.push({ kind: "play", x, y, sx: x, sy: y, face: Math.PI / 2, label: FORECOURT_LABEL, place: -1 });
    }
  SOCIAL_SITES.forecourt = site;
}

function finalists(out: readonly Stall[], spots: readonly Spot[], from: number) {
  const taken: Point[] = spots.slice(from).map((s) => ({ x: s.x, y: s.y }));
  const stand = (place: number, radius: number, turn: number) => {
    const d = PLACES[place].door;
    const a = (turn / FINALISTS.turns) * Math.PI * 2 + place;
    const x = d.x + Math.cos(a) * radius;
    const y = d.y + Math.sin(a) * radius;
    if (!clear(out, x, y) || taken.some((p) => Math.hypot(p.x - x, p.y - y) < 2 * M)) return false;
    taken.push({ x, y });
    SOCIAL_SITES.finalists.push({ x, y, face: Math.atan2(d.y - y, d.x - x), place });
    return true;
  };
  const union = PLACES.findIndex((p) => UNION.test(p.name));
  if (union >= 0) {
    let placed = 0;
    for (let turn = 0; turn < FINALISTS.turns * 2 && placed < FINALISTS.union; turn++) if (stand(union, FINALISTS.unionRadius[turn % 2], turn)) placed++;
  }
  PLACES.forEach((p, place) => {
    if (!FINALISTS.faculty.test(p.name)) return;
    let placed = 0;
    for (let turn = 0; turn < FINALISTS.turns && placed < FINALISTS.perFaculty; turn++) if (stand(place, FINALISTS.facultyRadius, turn)) placed++;
  });
}

export function placeSocial(spots: Spot[], out: Stall[], free: Free) {
  SOCIAL_SITES.firstSpot = spots.length;
  SOCIAL_SITES.firstStall = out.length;
  nightFood(spots, out, free);
  const union = door(UNION);
  if (union) gyration(spots, out, free, union);
  touchlines(spots, out);
  if (union) forecourt(spots, out, union);
  finalists(out, spots, SOCIAL_SITES.firstSpot);
}
