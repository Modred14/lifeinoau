// lib/room.js
// The rules of a room: how big it is, where things may stand, and where a new thing goes. Pure functions, no database and no
// browser APIs, so the server checks every placement with exactly the same code the 3D room uses while you drag.
//
// Coordinates are whole cells. x runs left to right (0 is the west wall), z runs back to front (0 is the north wall).
// An item at (x, z) covers the cells from (x, z) to (x + width - 1, z + depth - 1) once it has been rotated.
import { ITEMS, sizeOf, isOutdoor } from "./furniture.js";
import { occupantsFor, isSchoolHostel, occupancyKey } from "./rules.js";
import { layoutIdFor, layoutOf, LAYOUTS, zoneAt, canStep, doorCellsOf, zoneBox } from "./layouts.js";

/** Floor and wall colours for each look of room. */
export const THEMES = {
  sage: { floorA: "#d9d2c0", floorB: "#cdc5b0", wall: "#a8c3a0", trim: "#f2efe6", accent: "#5f8f6b" },
  sky: { floorA: "#d7dbe3", floorB: "#c8cdd8", wall: "#9fbfe0", trim: "#f4f6fa", accent: "#4f7fb8" },
  sand: { floorA: "#dcc7a0", floorB: "#cfb88d", wall: "#e3c27a", trim: "#fbf3df", accent: "#b9852f" },
  rose: { floorA: "#e0d3d0", floorB: "#d3c4c1", wall: "#e3a6b4", trim: "#fbf1f3", accent: "#b9566f" },
  wood: { floorA: "#b98a5e", floorB: "#a9794d", wall: "#ece4d6", trim: "#ffffff", accent: "#c27a3a" },
  dorm: { floorA: "#b4b0a4", floorB: "#a8a498", wall: "#b9bfae", trim: "#cfccc0", accent: "#7d8a73" }, // plain school-hostel paint and concrete: nothing stylish
  suite: { floorA: "#e9ecef", floorB: "#d5d9de", wall: "#33496b", trim: "#e9eef6", accent: "#e8a23a" },
  flat: { floorA: "#e6dccb", floorB: "#dacfba", wall: "#e2dccd", trim: "#faf7ef", accent: "#6f8f78" }, // the two flats: warm tiles and cream walls
};

/**
 * How big a school hostel room is, in cells (a cell is about 0.9 m): roughly TWICE the floor area it used to have (it was 8x6 and, for the two big halls, 9x7).
 * The homes with several rooms get the same growth in lib/layouts.js. Everything that depends on the size (where things may stand, the walking grid, the 3D
 * walls, floor and camera, the lawn spots for the generator) reads room.w and room.d, so this is the one place a hostel room's size is set.
 */
export const SCHOOL_ROOM = [16, 9];
export const BIG_SCHOOL_ROOM = [19, 10];

/** Size and look of the room for a hostel. `seed` (the player's id) decides how many people share it, inside that hostel's range. */
export function roomFor(hostel, seed = "") {
  const occupants = occupantsFor(hostel, seed), layout = layoutIdFor(hostel);
  // Ojaja, off campus and the flats are several rooms (see lib/layouts.js); `layout` says which plan.
  if (layout) return { w: LAYOUTS[layout].w, d: LAYOUTS[layout].d, theme: hostel === "Ojaja" ? "suite" : hostel === "Off-campus" ? "wood" : "flat", hostel, occupants, layout };
  if (occupancyKey(hostel) === "bigSchool") return { w: BIG_SCHOOL_ROOM[0], d: BIG_SCHOOL_ROOM[1], theme: "dorm", hostel, occupants }; // Angola and Mozambique: the biggest, fullest rooms
  return { w: SCHOOL_ROOM[0], d: SCHOOL_ROOM[1], theme: "dorm", hostel, occupants };
}

/**
 * How rough the room looks, 0 (spotless) to 1 (wrecked), by how far into the session it is (week 0 to 11).
 * School hostels go rough fast and are only put right at the start of the next session; Ojaja and off campus stay clean most of the time.
 */
export function grimeFor(hostel, weekInSession) {
  const i = Math.max(0, Math.min(11, Math.floor(weekInSession || 0)));
  return isSchoolHostel(hostel) ? Math.min(1, +(0.15 + i * 0.11).toFixed(2)) : +(0.02 + i * 0.012).toFixed(2);
}

/** Cells that must stay clear: the doorway on the west wall (south end) and the step inside it (a plan: next to every door). */
export const doorCells = (room) => { const L = layoutOf(room); return L ? doorCellsOf(L) : [[0, room.d - 1], [1, room.d - 1]]; };
/** Where the player stands when they walk in. */
export const spawnCell = (room) => { const L = layoutOf(room); return L ? [L.entry.x, L.entry.z] : [1, room.d - 1]; };

const isFlat = (key) => !!ITEMS[key]?.flat;

// ---- Which room of a home each kind of thing belongs in ----
/** Where a kind of thing likes to stand, best first (zone kinds). In a plain room ("room") everything is welcome everywhere. */
const PREFER = {
  sleep: ["bed", "room", "store"], study: ["bed", "room", "store", "living", "dining"], kitchen: ["kitchen", "room", "dining", "living"],
  comfort: ["living", "room", "dining", "bed", "store"], fun: ["living", "room", "dining", "bed", "store"], power: ["bed", "living", "room", "dining", "store", "kitchen"],
};
/** May this item stand in a room of this kind? The toilet only goes in the bathroom, the cooker and counter only in the kitchen, and the passage stays clear. */
export function canStand(kind, key) {
  const it = ITEMS[key];
  if (!it || kind === "room") return true;
  if (key === "ensuite") return kind === "bath";
  if (kind === "bath") return key === "plant" || key === "mirror";
  if (kind === "passage") return !!it.flat;
  if (kind === "kitchen") return it.cat === "kitchen" || it.cat === "power" || key === "plant" || key === "plastic_chair";
  return key !== "counter" && key !== "gas_cooker";
}
const zoneKindAt = (room, x, z) => { const L = layoutOf(room); return L ? zoneAt(L, x, z)?.kind ?? null : "room"; };
const rankIn = (key, kind) => { const i = (key === "ensuite" ? ["bath"] : PREFER[ITEMS[key].cat] ?? []).indexOf(kind); return i < 0 ? 9 : i; };
const boxAt = (room, x, z) => { const L = layoutOf(room); return L ? zoneBox(L, x, z) : { x0: 0, z0: 0, x1: room.w, z1: room.d }; };

// ---- Things that stand outside (the generator) ----
/** Spots on the lawn beside the east wall, as cells just outside the room (x from room.w on): four to a column, from the south end up. */
export const outdoorSlots = (room) => Array.from({ length: 8 }, (_, i) => [room.w + Math.floor(i / 4), room.d - 2 - (i % 4)]);
export const isOutsideCell = (room, x) => x >= room.w;

/** Cells covered by an item at (x, z) turned `rot` quarter-turns. */
export function cellsOf(key, x, z, rot = 0) {
  const [w, d] = sizeOf(key, rot), out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x + i, z + j]);
  return out;
}

/** Can this item stand here? `placed` is the list of items already in the room (anything with key, x, z, rot, id). */
export function fits(room, placed, key, x, z, rot = 0, ignoreId = null) {
  if (!ITEMS[key] || !Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) return false;
  const others = placed.filter((o) => String(o.id) !== String(ignoreId) && o.placed && o.x != null);
  if (isOutdoor(key)) { // outside the house: only on one of the lawn spots, one item to a spot
    if (!outdoorSlots(room).some(([sx, sz]) => sx === x && sz === z)) return false;
    return !others.some((o) => isOutdoor(o.key) && o.x === x && o.z === z);
  }
  const [w, d] = sizeOf(key, rot);
  if (x < 0 || z < 0 || x + w > room.w || z + d > room.d) return false;
  const flat = isFlat(key), mine = cellsOf(key, x, z, rot), L = layoutOf(room);
  if (L) { // a plan: the whole item must stand in one room of the home, and be the kind of thing that belongs there
    const zn = zoneAt(L, x, z);
    if (mine.some(([cx, cz]) => zoneAt(L, cx, cz)?.id !== zn.id) || !canStand(zn.kind, key)) return false;
  }
  if (!flat) { const door = new Set(doorCells(room).map((c) => c.join())); if (mine.some((c) => door.has(c.join()))) return false; }
  for (const o of others) {
    if (isOutdoor(o.key) || isFlat(o.key) !== flat) continue; // a rug sits under furniture, but two rugs cannot share a spot
    const theirs = new Set(cellsOf(o.key, o.x, o.z, o.rot).map((c) => c.join()));
    if (mine.some((c) => theirs.has(c.join()))) return false;
  }
  return true;
}

/** Which way an item should face so its front looks into the room: 0 south, 1 west, 2 north, 3 east. */
export function facingRoom(room, key, x, z) {
  const b = boxAt(room, x, z);
  let best = 0, bestDist = Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const [w, d] = sizeOf(key, rot);
    // distance from the wall the item's back would touch (its back is opposite its front)
    const dist = [z - b.z0, b.x1 - (x + w), b.z1 - (z + d), x - b.x0][rot]; // north wall for a south-facing item, east for west-facing, ...
    if (dist < bestDist) { bestDist = dist; best = rot; }
  }
  return best;
}

/**
 * The best free spot for a new item: against a wall, facing in, and nearest the back (north and west) walls first. Null if the room is full.
 * In a home with several rooms the item goes in the room it belongs in (a bed in a bedroom, a fridge in the kitchen); `zone` names a room
 * (its id from lib/layouts.js) to insist on. The generator goes on the next free spot outside.
 */
export function autoPlace(room, placed, key, zone = null) {
  if (isOutdoor(key)) {
    const free = outdoorSlots(room).find(([sx, sz]) => fits(room, placed, key, sx, sz, 3));
    return free ? { x: free[0], z: free[1], rot: 3 } : null; // rot 3: its front faces away from the house
  }
  const L = layoutOf(room), before = !isFlat(key) ? cutOff(room, placed) : 0;
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    if (isFlat(key) && rot > 0) break;
    const [w, d] = sizeOf(key, rot);
    for (let x = 0; x + w <= room.w; x++) for (let z = 0; z + d <= room.d; z++) {
      if (!fits(room, placed, key, x, z, rot)) continue;
      const b = boxAt(room, x, z), toWall = Math.min(x - b.x0, z - b.z0, b.x1 - (x + w), b.z1 - (z + d));
      const facing = isFlat(key) ? 0 : facingRoom(room, key, x, z);
      let cost = isFlat(key) ? Math.abs(x + w / 2 - (b.x0 + b.x1) / 2) + Math.abs(z + d / 2 - (b.z0 + b.z1) / 2) : toWall * 10 + (x + z) * 0.5 + (rot === facing ? 0 : 25);
      if (L) cost += zone ? (zoneAt(L, x, z).id === zone ? 0 : 10_000) : rankIn(key, zoneKindAt(room, x, z)) * 60;
      if (!isFlat(key)) cost += Math.max(0, cutOff(room, [...placed, { id: "?", key, placed: true, x, z, rot }]) - before) * 300; // never wall in a doorway, a room or another piece (a plain room too: the door must stay usable however full it gets)
      if (cost < (best?.cost ?? Infinity)) best = { x, z, rot, cost };
    }
  }
  return best && { x: best.x, z: best.z, rot: best.rot };
}

/**
 * How much the furniture cuts the home up: free floor nobody can walk to from the front door, plus two for every piece with no reachable free
 * cell beside it to stand at. 0 means everything can be reached. New things are put where this does not get worse. (A plain room is one open
 * floor: the same count, with no walls to cross.)
 */
export function cutOff(room, items) {
  const L = layoutOf(room), W = room.w, D = room.d;
  const inside = (x, z) => (L ? !!zoneAt(L, x, z) : x >= 0 && z >= 0 && x < W && z < D), step = (a, b) => (L ? canStep(L, a, b) : true);
  const placed = items.filter((i) => i.placed && i.x != null && !isOutdoor(i.key)), bl = blockedCells(placed), start = spawnCell(room), seen = new Set([start.join()]), q = [start];
  while (q.length) {
    const c = q.shift();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz], k = n.join(); if (inside(n[0], n[1]) && !seen.has(k) && !bl.has(k) && step(c, n)) { seen.add(k); q.push(n); } }
  }
  let cut = 0;
  for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) if (!bl.has(x + "," + z) && !seen.has(x + "," + z)) cut++;
  for (const o of placed) if (!isFlat(o.key) && !cellsOf(o.key, o.x, o.z, o.rot).some((fc) => [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dz]) => { const n = [fc[0] + dx, fc[1] + dz]; return seen.has(n.join()) && step(n, fc); }))) cut += 2;
  return cut;
}

/** Cells a person cannot walk through (everything except flat items). */
export function blockedCells(placed) {
  const s = new Set();
  for (const o of placed) if (o.placed && o.x != null && !isFlat(o.key) && !isOutdoor(o.key)) for (const c of cellsOf(o.key, o.x, o.z, o.rot)) s.add(c.join());
  return s;
}

/** Shortest walk between two cells (four directions), as a list of cells without the start. Empty if there is no way. */
export function findPath(room, blocked, from, to) {
  const key = (c) => c.join(), goal = key(to), L = layoutOf(room);
  if (blocked.has(goal) || key(from) === goal) return [];
  const prev = new Map([[key(from), null]]), q = [from];
  while (q.length) {
    const cur = q.shift();
    if (key(cur) === goal) { const out = []; for (let k = goal; k && k !== key(from); ) { const [x, z] = k.split(",").map(Number); out.unshift([x, z]); k = prev.get(k); } return out; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [cur[0] + dx, cur[1] + dz], k = key(n);
      if (n[0] < 0 || n[1] < 0 || n[0] >= room.w || n[1] >= room.d || blocked.has(k) || prev.has(k) || (L && !canStep(L, cur, n))) continue; // walls: only through a door
      prev.set(k, key(cur)); q.push(n);
    }
  }
  return [];
}

/** Does every placed item still stand legally in this room? False after a home changes shape (a move, or a new floor plan). */
export function consistent(room, items) {
  const placed = items.filter((i) => i.placed && i.x != null);
  return placed.every((it) => fits(room, placed, it.key, it.x, it.z, it.rot, it.id));
}
