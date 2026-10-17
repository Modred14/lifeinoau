import { STALLS } from "../interiors";
import { AREAS, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, nearBuilding, onRoad, type Point } from "../map";
import { isBlocked } from "../movement";
import { sitesClear } from "../sites-clear";
import { SOCIAL_POINTS } from "../social/points";
import { RALLY_SITE_COUNT } from "./calendar";
import { FACULTY_HOMES, SUB_UNIT, unitOfFaculty } from "./faculty";
import type { GatheringSite } from "./posts";

const M = PX_PER_METER;
const FOOTPRINT_M = 2.5;
const ROAD_MARGIN_M = 1.5;
const WALL_MARGIN_M = 2;
const RING_STEP_M = 2;
const RING_ANGLES = 16;
const APART_M = 9;
const STALL_CLEAR_M = 6;
const FOOTPRINT: readonly [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];

export const POLITICS_REACH = 7 * M;
export const RELIEF_RADIUS = 12 * M;

const nearStall = (x: number, y: number): boolean => STALLS.some((s) => Math.hypot(s.x - x, s.y - y) < STALL_CLEAR_M * M || Math.hypot(s.npc.x - x, s.npc.y - y) < STALL_CLEAR_M * M);

export function siteIsClear(x: number, y: number): boolean {
  if (nearStall(x, y)) return false;
  return FOOTPRINT.every(([dx, dy]) => {
    const px = x + dx * FOOTPRINT_M * M;
    const py = y + dy * FOOTPRINT_M * M;
    if (px < M || py < M || px > MAP_WIDTH_PX - M || py > MAP_HEIGHT_PX - M) return false;
    return !onRoad(px, py, ROAD_MARGIN_M * M) && !nearBuilding(px, py, WALL_MARGIN_M * M) && !isBlocked(px, py);
  });
}

const taken: Point[] = [];

function claim(centre: Point, minM: number, maxM: number): Point {
  for (let r = minM; r <= maxM; r += RING_STEP_M)
    for (let k = 0; k < RING_ANGLES; k++) {
      const a = (k / RING_ANGLES) * Math.PI * 2 + r;
      const x = Math.round(centre.x + Math.cos(a) * r * M);
      const y = Math.round(centre.y + Math.sin(a) * r * M);
      if (!siteIsClear(x, y) || !sitesClear(x, y, [SOCIAL_POINTS]) || taken.some((p) => Math.hypot(p.x - x, p.y - y) < APART_M * M)) continue;
      taken.push({ x, y });
      return { x, y };
    }
  return { x: centre.x, y: centre.y };
}

const placeIndex = (re: RegExp) => PLACES.findIndex((p) => re.test(p.name));
const facing = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);

export interface PoliticsSite extends Point {
  id: string;
  name: string;
  place: number;
  face: number;
}

function siteAt(id: string, name: string, place: number, minM: number, maxM: number, centre?: Point): PoliticsSite {
  const door = centre ?? PLACES[place]?.door ?? { x: MAP_WIDTH_PX / 2, y: MAP_HEIGHT_PX / 2 };
  const spot = claim(door, minM, maxM);
  return { id, name, place, ...spot, face: facing(spot, door) };
}

export const SUB_PLACE = placeIndex(/^Student Union Building$/);
export const AMPHI_PLACE = placeIndex(/^Amphi Theatre$/);

export const FORM_DESK: PoliticsSite = siteAt("desk", "SUIEC desk", SUB_PLACE, 5, 30);

export const POLL_UNITS: readonly PoliticsSite[] = [
  siteAt(SUB_UNIT, "Student Union Building", SUB_PLACE, 6, 34),
  ...FACULTY_HOMES.map((h) => {
    const place = placeIndex(h.place);
    return siteAt(h.unit, h.name, place, 5, 34);
  }).filter((u) => u.place >= 0),
];

export const pollUnit = (id: string): PoliticsSite => POLL_UNITS.find((u) => u.id === id) ?? POLL_UNITS[0];
export const unitForFaculty = (facultyKey: string): PoliticsSite => pollUnit(unitOfFaculty(facultyKey));

const HALLS: readonly [id: string, name: string, place: RegExp][] = [
  ["awo", "Awolowo Hall", /^Awolowo Hall$/],
  ["fajuyi", "Fajuyi Hall", /Fajuyi/],
  ["moremi", "Moremi Hall", /^Moremi Hall$/],
  ["moz", "Mozambique Hall", /^Mozambique Hall$/],
  ["angola", "Angola Hall", /^Angola Hall$/],
  ["etf", "ETF Hall", /^ETF Hall$/],
  ["alumni", "Alumni Hall", /^Alumni Hall$/],
  ["pg", "Postgraduate Hall", /^Postgraduate Hall$/],
];
const ANGLO_MOZ_NAME = "Anglo-Moz car park";

function angloMozCentre(): Point {
  const a = PLACES[placeIndex(/^Angola Hall$/)]?.door;
  const b = PLACES[placeIndex(/^Mozambique Hall$/)]?.door;
  if (!a || !b) return { x: MAP_WIDTH_PX / 2, y: MAP_HEIGHT_PX / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let best = mid;
  let bestD = Infinity;
  for (const area of AREAS) {
    if (area.kind !== "parking") continue;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < area.poly.length; i += 2) {
      sx += area.poly[i];
      sy += area.poly[i + 1];
    }
    const c = { x: sx / (area.poly.length / 2), y: sy / (area.poly.length / 2) };
    const d = Math.hypot(c.x - mid.x, c.y - mid.y);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return bestD < Math.hypot(a.x - b.x, a.y - b.y) ? best : mid;
}

export const RALLY_POINTS: readonly PoliticsSite[] = [
  ...HALLS.map(([id, name, re]) => siteAt(id, name, placeIndex(re), 5, 40)),
  siteAt("anglomoz", ANGLO_MOZ_NAME, placeIndex(/^Angola Hall$/), 0, 40, angloMozCentre()),
].slice(0, RALLY_SITE_COUNT);

export const rallyPoint = (id: string): PoliticsSite | undefined => RALLY_POINTS.find((r) => r.id === id);

export const GATHERING_SITES: Record<GatheringSite, PoliticsSite> = {
  sub: FORM_DESK,
  awo: RALLY_POINTS[0],
  anglomoz: RALLY_POINTS[RALLY_POINTS.length - 1],
};

export const DEBATE_SITE: PoliticsSite = siteAt("amphi", PLACES[AMPHI_PLACE]?.name ?? "Amphi Theatre", AMPHI_PLACE, 7, 34);

export const CONGRESS_GROUND: PoliticsSite = siteAt("congress", HALLS[0][1], placeIndex(HALLS[0][2]), 5, 40);

export const POLITICS_POINTS: readonly Point[] = [FORM_DESK, DEBATE_SITE, CONGRESS_GROUND, ...POLL_UNITS, ...RALLY_POINTS];

export const withinReach = (p: Point, site: Point, reach = POLITICS_REACH): boolean => Math.hypot(p.x - site.x, p.y - site.y) <= reach;
