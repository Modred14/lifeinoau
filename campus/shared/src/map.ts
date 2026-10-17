/**
 * The real OAU campus, shared by client (rendering, minimap) and server
 * (collision). Generated from OpenStreetMap by web/scripts/import-osm.mts.
 *
 * Map data © OpenStreetMap contributors, ODbL. Credit it wherever the map shows.
 *
 * Units: map pixels, 20 px = 1 m. x grows east, y grows south.
 */
import campus from "./data/campus.json";
import buildingStyles from "./data/building-styles.json";
import campusSites from "./data/campus-sites.json";
import buildingHeights from "./data/building-heights.json";

export const MAP_ATTRIBUTION = "Map data © OpenStreetMap contributors";
export const PX_PER_METER = campus.pxPerMeter;
export const MAP_WIDTH_PX = campus.width;
export const MAP_HEIGHT_PX = campus.height;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BuildingKind = "academic" | "hostel" | "residence" | "worship" | "commercial" | "sports" | "civic" | "other";

export interface Building {
  id: number;
  name?: string;
  kind: BuildingKind;
  site?: string;
  preset?: string;
  /** Height in metres. */
  height: number;
  /** Outline as flat [x0, y0, x1, y1, ...], clockwise on screen, not closed. */
  poly: readonly number[];
  bbox: Rect;
}

export interface Road {
  /** Full width in map px. */
  width: number;
  kind: "road" | "path";
  name?: string;
  /** Polyline as flat [x0, y0, x1, y1, ...]. */
  pts: readonly number[];
}

export type AreaKind = "field" | "parking" | "water" | "plaza" | "grass";
export interface Area {
  kind: AreaKind;
  poly: readonly number[];
}

/** A named place: label position + an entrance point on a walkway (GPS target). */
export interface Place {
  id: string;
  name: string;
  kind: BuildingKind | "area" | "food" | "nightlife";
  aliases?: readonly string[];
  housing?: "university" | "private";
  label: Point;
  door: Point;
  /** Index into BUILDINGS when the place is a single building. */
  building?: number;
}

function bboxOf(poly: readonly number[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) {
    x0 = Math.min(x0, poly[i]);
    x1 = Math.max(x1, poly[i]);
    y0 = Math.min(y0, poly[i + 1]);
    y1 = Math.max(y1, poly[i + 1]);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface CampusSite {
  name: string;
  kind: BuildingKind;
  aliases?: string[];
  housing?: "university" | "private";
  label: number[];
  door: number[];
  height: number;
  sources: string[];
  blocks: { anchor: number[]; preset?: string; parts?: { poly: number[]; preset?: string }[] }[];
  newBlocks?: { poly: number[]; preset?: string }[];
  paths?: number[][];
}

export const CAMPUS_SITES = campusSites.sites as CampusSite[];
const annotatedBlocks = CAMPUS_SITES.flatMap((site) => site.blocks.map((block) => ({ site, block })));
const extraBuildings: Building[] = [];

const SURVEYED_HEIGHTS: Record<string, number | undefined> = buildingHeights.heights;

const importedBuildings: Building[] = campus.buildings.map((b, id) => {
  const annotation = annotatedBlocks.find(({ block }) => pointInPoly(block.anchor[0], block.anchor[1], b.pts));
  const firstPart = annotation?.block.parts?.[0];
  const poly = firstPart?.poly ?? b.pts;
  const building: Building = {
    id,
    name: b.name,
    kind: annotation?.site.kind ?? b.kind as BuildingKind,
    site: annotation?.site.name,
    preset: annotation ? firstPart?.preset ?? annotation.block.preset ?? annotation.site.name : undefined,
    height: annotation?.site.height ?? SURVEYED_HEIGHTS[id] ?? b.h,
    poly,
    bbox: bboxOf(poly),
  };
  for (const part of annotation?.block.parts?.slice(1) ?? []) {
    extraBuildings.push({ ...building, id: campus.buildings.length + extraBuildings.length, preset: part.preset ?? building.preset, poly: part.poly, bbox: bboxOf(part.poly) });
  }
  return building;
});
for (const site of CAMPUS_SITES) for (const block of site.newBlocks ?? []) {
  extraBuildings.push({ id: campus.buildings.length + extraBuildings.length, kind: site.kind, site: site.name, preset: block.preset ?? site.name, height: site.height, poly: block.poly, bbox: bboxOf(block.poly) });
}
export const BUILDINGS: readonly Building[] = [...importedBuildings, ...extraBuildings];

export const ROADS: readonly Road[] = [...campus.roads.map((r) => ({
  width: r.w * PX_PER_METER,
  kind: r.kind as Road["kind"],
  name: r.name,
  pts: r.pts,
})), ...CAMPUS_SITES.flatMap((site) => (site.paths ?? []).map((pts) => ({ width: 2.2 * PX_PER_METER, kind: "path" as const, pts })))];

export const AREAS: readonly Area[] = campus.areas.map((a) => ({ kind: a.kind as AreaKind, poly: a.pts }));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const IMPORTED_PLACE_COUNT = campus.places.length;

export const PLACES: readonly Place[] = [...campus.places.map((p) => ({
  id: slug(p.name),
  name: p.name,
  kind: p.kind as Place["kind"],
  label: { x: p.label[0], y: p.label[1] },
  door: { x: p.door[0], y: p.door[1] },
  building: p.building,
})), ...CAMPUS_SITES.filter((site) => !campus.places.some((p) => p.name === site.name)).map((site) => ({
  id: slug(site.name),
  name: site.name,
  kind: site.kind,
  aliases: site.aliases,
  housing: site.housing,
  label: { x: site.label[0], y: site.label[1] },
  door: { x: site.door[0], y: site.door[1] },
}))];

/**
 * The Main Gate arch across Road 1 (centred on the median). `angle` is the
 * road direction (map space), `span` the distance between the carriageways'
 * outer edges in metres. Pillars collide; the arch is drawn by the client.
 */
export const GATE: { x: number; y: number; angle: number; span: number } | undefined = (campus as { gate?: { x: number; y: number; angle: number; span: number } }).gate;
export const GATE_PILLAR_RADIUS = 1.6 * PX_PER_METER;
/** Pillar centres: one on each verge, one on the median. */
export const GATE_PILLARS: Point[] = GATE
  ? [-1, 0, 1].map((k) => {
      const off = k * (GATE.span / 2 + 1.5) * PX_PER_METER;
      return { x: GATE.x - Math.sin(GATE.angle) * off, y: GATE.y + Math.cos(GATE.angle) * off };
    })
  : [];

/** Where new players appear: outside the Student Union Building (SUB). */
export const SPAWN_POINT: Point = { x: campus.spawn[0], y: campus.spawn[1] };
/** Radius around SPAWN_POINT new players are scattered in. */
export const SPAWN_RADIUS_PX = 10 * PX_PER_METER;

/**
 * Wall colour + roof palette per building kind (client rendering only).
 * Matched to aerial footage of the campus: white / light-grey concrete with
 * flat grey roofs or pale-green, white and terracotta sheet roofs.
 */
export const BUILDING_STYLE: Record<BuildingKind, { wall: number; roofs: number[] }> = {
  academic: { wall: 0xe9e7e1, roofs: [0x8e8c86, 0x9fd1b0, 0xe6e4de, 0x8e8c86, 0xb35a40] },
  hostel: { wall: 0xeee4cf, roofs: [0xb4503a, 0xa9443a, 0x8e8c86, 0xb4503a] },
  residence: { wall: 0xf1e8dc, roofs: [0xc0574a, 0xb4503a, 0xd47a6a] },
  worship: { wall: 0xf3f0ea, roofs: [0x3f8f6a, 0xe6e4de] },
  commercial: { wall: 0xeef0f0, roofs: [0x2f6f9f, 0x8e8c86, 0xb35a40] },
  sports: { wall: 0xdfe6e9, roofs: [0x9fd1b0, 0xe6e4de] },
  civic: { wall: 0xe6e1d6, roofs: [0x8e8c86, 0xb35a40] },
  other: { wall: 0xe6e2d8, roofs: [0x8e8c86, 0xb4503a, 0xe6e4de, 0xc0574a] },
};

/** Optional look override for a named landmark or for every block of a hall (client rendering only). */
export interface BuildingStylePreset {
  archetype?: string;
  floors?: number;
  roof?: string;
  wall?: string;
  trim?: string;
  roofColor?: string;
  bandStep?: number;
  grooved?: boolean;
  storey?: number;
  tanks?: boolean;
  facade?: string;
}

/** Presets keyed by hall place name and by exact building name. */
export const BUILDING_PRESETS: { halls: Record<string, BuildingStylePreset>; landmarks: Record<string, BuildingStylePreset> } = buildingStyles;

export const GROUND_COLORS = {
  grass: 0x6fa955,
  road: 0x5d5f63,
  path: 0xb07a55,
  field: 0x4f9a48,
  parking: 0x7d7f83,
  water: 0x4f8fbf,
  plaza: 0xb5714f,
} as const;

// ---------------------------------------------------------------- geometry helpers

/** Even-odd point-in-polygon on a flat [x, y, ...] ring. */
export function pointInPoly(x: number, y: number, poly: readonly number[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = poly[i];
    const yi = poly[i + 1];
    const xj = poly[j];
    const yj = poly[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Squared distance from (px, py) to segment a-b. */
export function distSqToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = ax + dx * t - px;
  const ey = ay + dy * t - py;
  return ex * ex + ey * ey;
}

/** Squared distance from a point to a polygon's outline. */
export function distSqToPolyEdge(x: number, y: number, poly: readonly number[]): number {
  let best = Infinity;
  const n = poly.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const d = distSqToSegment(x, y, poly[j], poly[j + 1], poly[i], poly[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- spatial index

/** Uniform grid so lookups only touch nearby buildings/roads. */
export const GRID_CELL = 256; // map px (12.8 m)
export const GRID_W = Math.ceil(MAP_WIDTH_PX / GRID_CELL);
export const GRID_H = Math.ceil(MAP_HEIGHT_PX / GRID_CELL);

export function forCells(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void) {
  const cx0 = Math.max(0, Math.floor(x0 / GRID_CELL));
  const cy0 = Math.max(0, Math.floor(y0 / GRID_CELL));
  const cx1 = Math.min(GRID_W - 1, Math.floor(x1 / GRID_CELL));
  const cy1 = Math.min(GRID_H - 1, Math.floor(y1 / GRID_CELL));
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) fn(cy * GRID_W + cx);
}

/** Building ids per grid cell. */
export const buildingCells: number[][] = Array.from({ length: GRID_W * GRID_H }, () => []);
for (const b of BUILDINGS) forCells(b.bbox.x, b.bbox.y, b.bbox.x + b.bbox.w, b.bbox.y + b.bbox.h, (i) => buildingCells[i].push(b.id));

/** Road segments per grid cell: [roadIndex, pointIndex] packed as roadIndex * 10000 + pointIndex. */
const roadCells: number[][] = Array.from({ length: GRID_W * GRID_H }, () => []);
ROADS.forEach((r, ri) => {
  for (let i = 0; i + 3 < r.pts.length; i += 2) {
    const pad = r.width / 2;
    forCells(
      Math.min(r.pts[i], r.pts[i + 2]) - pad,
      Math.min(r.pts[i + 1], r.pts[i + 3]) - pad,
      Math.max(r.pts[i], r.pts[i + 2]) + pad,
      Math.max(r.pts[i + 1], r.pts[i + 3]) + pad,
      (c) => roadCells[c].push(ri * 10000 + i),
    );
  }
});

/** True if (x, y) is on a road or path surface (optionally widened by `margin` px). */
export function onRoad(x: number, y: number, margin = 0): boolean {
  let hit = false;
  forCells(x, y, x, y, (c) => {
    if (hit) return;
    for (const code of roadCells[c]) {
      const r = ROADS[Math.floor(code / 10000)];
      const i = code % 10000;
      const half = r.width / 2 + margin;
      if (distSqToSegment(x, y, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) <= half * half) {
        hit = true;
        return;
      }
    }
  });
  return hit;
}

export function onCarriageway(x: number, y: number, inset = 0): boolean {
  let hit = false;
  forCells(x, y, x, y, (c) => {
    if (hit) return;
    for (const code of roadCells[c]) {
      const r = ROADS[Math.floor(code / 10000)];
      if (r.kind !== "road") continue;
      const i = code % 10000;
      const half = r.width / 2 - inset;
      if (half > 0 && distSqToSegment(x, y, r.pts[i], r.pts[i + 1], r.pts[i + 2], r.pts[i + 3]) <= half * half) {
        hit = true;
        return;
      }
    }
  });
  return hit;
}

export interface RoadSnap {
  x: number;
  y: number;
  dx: number;
  dy: number;
  width: number;
  distance: number;
}

const CROSS_ROAD_PENALTY = 5 * PX_PER_METER;

export function nearestCarriageway(x: number, y: number, hx = 0, hy = 0): RoadSnap | null {
  let best: RoadSnap | null = null;
  let bestScore = Infinity;
  forCells(x - GRID_CELL, y - GRID_CELL, x + GRID_CELL, y + GRID_CELL, (c) => {
    for (const code of roadCells[c]) {
      const r = ROADS[Math.floor(code / 10000)];
      if (r.kind !== "road") continue;
      const i = code % 10000;
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / (len * len)));
      const px = ax + (bx - ax) * t;
      const py = ay + (by - ay) * t;
      const distance = Math.hypot(x - px, y - py);
      const dx = (bx - ax) / len;
      const dy = (by - ay) / len;
      const score = distance + CROSS_ROAD_PENALTY * (hx || hy ? 1 - Math.abs(dx * hx + dy * hy) : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x: px, y: py, dx, dy, width: r.width, distance };
      }
    }
  });
  return best;
}

/** True if (x, y) is inside or within `margin` px of any building. */
export function nearBuilding(x: number, y: number, margin = 0): boolean {
  let hit = false;
  forCells(x - margin, y - margin, x + margin, y + margin, (c) => {
    if (hit) return;
    for (const id of buildingCells[c]) {
      const b = BUILDINGS[id];
      if (x < b.bbox.x - margin || x > b.bbox.x + b.bbox.w + margin || y < b.bbox.y - margin || y > b.bbox.y + b.bbox.h + margin) continue;
      if (pointInPoly(x, y, b.poly) || (margin > 0 && distSqToPolyEdge(x, y, b.poly) < margin * margin)) {
        hit = true;
        return;
      }
    }
  });
  return hit;
}
