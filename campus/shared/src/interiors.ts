/**
 * Insides of buildings, things to use (seats, beds, food counters, ATMs...)
 * and outdoor food stalls. Shared so the server validates every interaction
 * and collision exactly the way the client draws it.
 *
 * Interiors live in the same campus room, just east of the map
 * (x >= INTERIOR_X0), one slot per named building. Entering a building
 * teleports you there; everyone inside the same building sees each other.
 * No extra rooms or connections, which keeps it cheap on mobile data.
 *
 * Layout units inside templates are metres, x east, y south, origin at the
 * room's north-west corner. The door is in the middle of the south wall.
 */
import { IMPORTED_PLACE_COUNT, MAP_HEIGHT_PX, MAP_WIDTH_PX, PLACES, PX_PER_METER, forCells, type Place, type Point } from "./map";
import { TEMPLATES, templateFor } from "./interior/rooms";
import { placeStalls, type Stall } from "./interior/stalls";
import { levelAt, type Spot, type Template } from "./interior/types";

export * from "./interior/acts";
export { SEATS, levelAt } from "./interior/types";
export type { Level, Npc, Prop, PropStyle, PropType, SeatSpec, SeatStyle, Spot, Surface, Template, TemplateId } from "./interior/types";
export { HALL, CLASSROOM } from "./interior/hall";
export { LONG_TABLE, PLASTIC_TABLE } from "./interior/canteen";
export { TABLE_TOP } from "./interior/builder";
export { TEMPLATES };
export { ROADSIDE_TRADES } from "./interior/stalls";
export type { Stall };
export type { StallStyle } from "./interior/stalls";

const M = PX_PER_METER;

// ---------------------------------------------------------------- instances

/**
 * Interiors are laid out in a grid of slots east of the campus map (the map
 * already uses almost the whole uint16 height, so the spare room is east).
 */
export const INTERIOR_X0 = Math.ceil((MAP_WIDTH_PX + 2000) / 500) * 500;
const SLOT_Y0 = 1000;
const SLOT_W = 1500;
const SLOT_H = 1200;
const SLOT_COLS = 10;
/** Interior wall thickness (map px), on the inside of the room rectangle. */
const WALL_PX = 0.15 * M;

export interface Interior {
  place: number;
  template: Template;
  /** Room origin (north-west corner) in map px. */
  ox: number;
  oy: number;
  w: number;
  h: number;
  /** Colliders in absolute map px. */
  cols: { x: number; y: number; w: number; h: number }[];
  /** SPOTS index range [spotStart, spotEnd). */
  spotStart: number;
  spotEnd: number;
  entry: Point;
}

export const SPOTS: Spot[] = [];
function makeInterior(p: Place, i: number): Interior | undefined {
  const id = templateFor(p);
  if (!id) return undefined;
  const t = TEMPLATES[id];
  const ox = INTERIOR_X0 + (i % SLOT_COLS) * SLOT_W;
  const oy = SLOT_Y0 + Math.floor(i / SLOT_COLS) * SLOT_H;
  const spotStart = SPOTS.length;
  for (const s of t.spots) {
    SPOTS.push({
      kind: s.kind,
      x: ox + s.x * M,
      y: oy + s.y * M,
      sx: ox + s.sx * M,
      sy: oy + s.sy * M,
      face: s.face,
      label: s.label,
      price: s.price,
      food: s.food,
      fun: s.fun,
      place: i,
      seat: s.seat,
      floor: s.floor,
      surface: s.surface,
      menu: s.menu === undefined ? undefined : spotStart + s.menu,
    });
  }
  return {
    place: i,
    template: t,
    ox,
    oy,
    w: t.w * M,
    h: t.d * M,
    cols: t.cols.map((c) => ({ x: ox + c.x * M, y: oy + c.y * M, w: c.w * M, h: c.d * M })),
    spotStart,
    spotEnd: SPOTS.length,
    entry: { x: ox + t.entry.x * M, y: oy + t.entry.y * M },
  };
}

/** Interior per place index (undefined for open areas). */
export const INTERIORS: (Interior | undefined)[] = PLACES.map((p, i) => i < IMPORTED_PLACE_COUNT ? makeInterior(p, i) : undefined);

/** World width including the interior slots (positions are synced as uint16). */
export const WORLD_WIDTH_PX = INTERIOR_X0 + SLOT_COLS * SLOT_W;
if (WORLD_WIDTH_PX > 65535 || SLOT_Y0 + Math.ceil(PLACES.length / SLOT_COLS) * SLOT_H > MAP_HEIGHT_PX) {
  throw new Error("interior slots don't fit in uint16 positions");
}

/** Which interior a map point is in (by slot), or undefined on the campus. */
export function interiorAt(x: number, y: number): Interior | undefined {
  if (x < INTERIOR_X0) return undefined;
  const col = Math.floor((x - INTERIOR_X0) / SLOT_W);
  const row = Math.floor((y - SLOT_Y0) / SLOT_H);
  if (col < 0 || col >= SLOT_COLS || row < 0) return undefined;
  return INTERIORS[row * SLOT_COLS + col];
}

export function floorHeightAt(x: number, y: number): number {
  if (x < INTERIOR_X0) return 0;
  const it = interiorAt(x, y);
  if (!it || !it.template.levels.length) return 0;
  return levelAt(it.template.levels, (x - it.ox) / M, (y - it.oy) / M);
}

/** Collision inside interiors: room walls + furniture. */
export function interiorBlocked(x: number, y: number, r: number): boolean {
  const it = interiorAt(x, y);
  if (!it) return true;
  const lx = x - it.ox;
  const ly = y - it.oy;
  if (lx < WALL_PX + r || ly < WALL_PX + r || lx > it.w - WALL_PX - r || ly > it.h - WALL_PX - r) return true;
  return circleHitsRects(x, y, r, it.cols);
}

function circleHitsRects(x: number, y: number, r: number, rects: readonly { x: number; y: number; w: number; h: number }[]) {
  const rr = r * r;
  for (const c of rects) {
    const nx = x < c.x ? c.x : x > c.x + c.w ? c.x + c.w : x;
    const ny = y < c.y ? c.y : y > c.y + c.h ? c.y + c.h : y;
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy < rr) return true;
  }
  return false;
}

// ---------------------------------------------------------------- outdoor food stalls

export const STALLS: readonly Stall[] = placeStalls(SPOTS);
for (let i = IMPORTED_PLACE_COUNT; i < PLACES.length; i++) INTERIORS[i] = makeInterior(PLACES[i], i);
const stallCells = new Map<number, { x: number; y: number; w: number; h: number }[]>();
for (const s of STALLS)
  forCells(s.col.x, s.col.y, s.col.x + s.col.w, s.col.y + s.col.h, (i) => {
    const list = stallCells.get(i);
    if (list) list.push(s.col);
    else stallCells.set(i, [s.col]);
  });

/** Outdoor stall collision (a handful of rectangles). */
export function stallBlocked(x: number, y: number, r: number): boolean {
  let hit = false;
  forCells(x - r, y - r, x + r, y + r, (i) => {
    const list = hit ? undefined : stallCells.get(i);
    if (list && circleHitsRects(x, y, r, list)) hit = true;
  });
  return hit;
}

/** Spots in the same space as (x, y): the current interior's, or the outdoor stalls'. */
export function spotsNear(x: number, y: number): { start: number; end: number; extra: readonly number[] } {
  const it = interiorAt(x, y);
  if (it) return { start: it.spotStart, end: it.spotEnd, extra: [] };
  return { start: 0, end: 0, extra: STALLS.map((s) => s.spot) };
}

/** A free outdoor spot near a building's door, where you appear when leaving it. */
export function doorPoint(place: Place, blocked: (x: number, y: number) => boolean): Point {
  const d = place.door;
  for (let r = 0; r < 12; r += 0.5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = d.x + Math.cos(a) * r * M;
      const y = d.y + Math.sin(a) * r * M;
      if (!blocked(x, y)) return { x, y };
    }
  }
  return { ...d };
}
