// lib/room.js
// The rules of a room: how big it is, where things may stand, and where a new thing goes. Pure functions, no database and no
// browser APIs, so the server checks every placement with exactly the same code the 3D room uses while you drag.
//
// Coordinates are whole cells. x runs left to right (0 is the west wall), z runs back to front (0 is the north wall).
// An item at (x, z) covers the cells from (x, z) to (x + width - 1, z + depth - 1) once it has been rotated.
import { ITEMS, sizeOf, isOutdoor, canGoOutside } from "./furniture.js";
import { occupantsFor, isSchoolHostel, occupancyKey } from "./rules.js";
import { layoutIdFor, layoutOf, LAYOUTS, zoneAt, canStep, doorCellsOf, zoneBox } from "./layouts.js";
import { plotAllows, lawnSlots, lawnBox, plotFor } from "./plot.js";

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
  house: { floorA: "#ebe3d3", floorB: "#ddd3bf", wall: "#efe6d4", trim: "#fffdf7", accent: "#b88a4a" }, // the family houses: pale stone floors and warm cream walls
};

/**
 * How big a school hostel room is, in cells (a cell is about 0.9 m): roughly TWICE the floor area it used to have (it was 8x6 and, for the two big halls, 9x7).
 * The homes with several rooms are sized by their rooms in lib/layouts.js (each room has a set size in cells, and the plan is as big as it needs to be to hold them).
 * Everything that depends on the size (where things may stand, the walking grid, the 3D walls, floor and camera, the lawn spots for the generator) reads
 * room.w and room.d, so this is the one place a hostel room's size is set.
 */
export const SCHOOL_ROOM = [9, 7];
export const BIG_SCHOOL_ROOM = [10, 8];

/** Size and look of the room for a hostel. `seed` (the player's id) decides how many people share it, inside that hostel's range. */
export function roomFor(hostel, seed = "") {
  const occupants = occupantsFor(hostel, seed), layout = layoutIdFor(hostel);
  // Ojaja, off campus and the flats are several rooms (see lib/layouts.js); `layout` says which plan.
  if (layout) return { w: LAYOUTS[layout].w, d: LAYOUTS[layout].d, theme: hostel === "Ojaja" ? "suite" : hostel === "Off-campus" ? "wood" : layout.startsWith("house") ? "house" : "flat", hostel, occupants, layout };
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

const isFlat = (key) => !!ITEMS[key]?.flat || !!ITEMS[key]?.surface;

// ---- Which room of a home each kind of thing belongs in ----
/** Where a kind of thing likes to stand, best first (zone kinds). In a plain room ("room") everything is welcome everywhere. */
const PREFER = {
  sleep: ["bed", "room"], study: ["bed", "room", "living"], kitchen: ["kitchen", "room", "living"],
  comfort: ["living", "room", "bed"], fun: ["living", "room", "bed"], power: ["bed", "living", "room", "kitchen"],
  bath: ["bath", "room"],
};
/** May this item stand in a room of this kind? The toilet and shower only go in the bathroom, the guest toilet only in the toilet, the cooker and counter only in the kitchen, and the hall stays clear. */
export function canStand(kind, key) {
  const it = ITEMS[key];
  if (!it || kind === "room") return true;
  if (it.surface) return true;
  if (key === "ensuite") return kind === "bath";
  if (key === "toilet") return kind === "toilet";
  if (it.plumbed && kind !== "kitchen" && kind !== "bath" && kind !== "toilet") return false; // plumbing stays in a kitchen or bathroom
  if (kind === "bath" || kind === "toilet") return key === "plant" || key === "mirror" || (kind === "bath" && (it.cat === "bath" || key === "washing_machine"));
  if (kind === "passage") return !!it.flat;
  if (kind === "kitchen") return it.cat === "kitchen" || it.cat === "power" || key === "plant" || key === "plastic_chair" || key === "washing_machine";
  return key !== "counter" && key !== "gas_cooker" && !(it.plumbed && it.cat === "bath");
}
const zoneKindAt = (room, x, z) => { const L = layoutOf(room); return L ? zoneAt(L, x, z)?.kind ?? null : "room"; };
const rankIn = (key, kind) => { const i = (key === "ensuite" ? ["bath"] : key === "toilet" ? ["toilet"] : PREFER[ITEMS[key].cat] ?? []).indexOf(kind); return i < 0 ? 9 : i; };
const boxAt = (room, x, z) => { const L = layoutOf(room); return L ? zoneBox(L, x, z) : { x0: 0, z0: 0, x1: room.w, z1: room.d }; };

// ---- Things that stand outside (the generator, benches, pots, bins, lights ...) ----
// They stand anywhere on the plot's lawn (lib/plot.js): not on the house, the garage, the driveway or the footpath, not through the boundary wall, and
// never two on the same cell. The first eight spots a new thing is offered are the original column beside the east wall.
/** The original eight spots on the lawn beside the east wall, as cells just outside the room (x from room.w on): four to a column, from the south end up. */
export const outdoorSlots = (room) => Array.from({ length: 8 }, (_, i) => [room.w + Math.floor(i / 4), room.d - 2 - (i % 4)]);
export const isOutsideCell = (room, x) => x >= room.w;
/** Does an item of this key at (x, z) turned `rot` touch the house (the room's own floor)? */
export function overlapsHouse(room, key, x, z, rot = 0) { const [w, d] = sizeOf(key, rot); return x < room.w && x + w > 0 && z < room.d && z + d > 0; }
/**
 * Is this item out on the compound? Outdoor things always are. A weatherproof indoor thing (a chair, sofa, table, lamp ...) is outside while it stands
 * off the house, and inside while it stands on the house floor: where it stands decides, so the same piece can be carried out and back in.
 */
export const isOutside = (room, it) => isOutdoor(it.key) || (canGoOutside(it.key) && it.x != null && !overlapsHouse(room, it.key, it.x, it.z, it.rot ?? 0));

/** Cells covered by an item at (x, z) turned `rot` quarter-turns. */
export function cellsOf(key, x, z, rot = 0) {
  const [w, d] = sizeOf(key, rot), out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x + i, z + j]);
  return out;
}

/** Can this item stand here? `placed` is the list of items already in the room (anything with key, x, z, rot, id). */
export function fits(room, placed, key, x, z, rot = 0, ignoreId = null) {
  if (!ITEMS[key] || !Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) return false;
  const others = placed.filter((o) => String(o.id) !== String(ignoreId) && o.placed && o.x != null), flat = isFlat(key);
  if (isOutdoor(key) || (canGoOutside(key) && !overlapsHouse(room, key, x, z, rot))) { // outside the house: anywhere on the plot's lawn that is not built on or paved, and not on another outdoor thing
    if (!plotAllows(room, key, x, z, rot)) return false;
    const mineOut = new Set(cellsOf(key, x, z, rot).map((c) => c.join()));
    return !others.some((o) => isOutside(room, o) && isFlat(o.key) === flat && cellsOf(o.key, o.x, o.z, o.rot).some((c) => mineOut.has(c.join()))); // a rug lies under the furniture on it, but two rugs (or two pieces) cannot share a spot
  }
  const [w, d] = sizeOf(key, rot);
  if (x < 0 || z < 0 || x + w > room.w || z + d > room.d) return false;
  const mine = cellsOf(key, x, z, rot), L = layoutOf(room);
  if (L) { // a plan: the whole item must stand in one room of the home, and be the kind of thing that belongs there
    const zn = zoneAt(L, x, z);
    if (mine.some(([cx, cz]) => zoneAt(L, cx, cz)?.id !== zn.id) || !canStand(zn.kind, key)) return false;
  }
  if (!flat) { const door = new Set(doorCells(room).map((c) => c.join())); if (mine.some((c) => door.has(c.join()))) return false; }
  for (const o of others) {
    if (isOutside(room, o) || isFlat(o.key) !== flat) continue; // a rug sits under furniture, but two rugs cannot share a spot
    const theirs = new Set(cellsOf(o.key, o.x, o.z, o.rot).map((c) => c.join()));
    if (mine.some((c) => theirs.has(c.join()))) return false;
  }
  return true;
}

/** Would standing here wall something in? True when the piece would cut off more of the home (a doorway, a room, a piece) than is already cut off. Rugs never do. */
export function blocksWalkway(room, placed, key, x, z, rot = 0, ignoreId = null) {
  if (isFlat(key) || isOutdoor(key) || !overlapsHouse(room, key, x, z, rot)) return false;
  const others = placed.filter((o) => String(o.id) !== String(ignoreId));
  return cutOff(room, [...others, { id: "?", key, placed: true, x, z, rot }]) > cutOff(room, others);
}

/**
 * Why a piece cannot stand here, in words for the player, or null when it can (the same answer as fits() and blocksWalkway(), with a reason).
 * Rules: pieces stay on the player's own property (the house floor, or the lawn inside the boundary wall), never on the house wall, the garage,
 * the driveway or the paths, never inside another piece, never in a doorway, and never so they wall in a room or the way to something.
 * (Geometry only: that the home's own fixtures cannot be moved at all is checked where a move starts, by isFixture().)
 */
export function placementIssue(room, placed, key, x, z, rot = 0, ignoreId = null) {
  const it = ITEMS[key];
  if (!it) return "That item does not exist.";
  if (!Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) return "That is not a valid spot.";
  const outside = isOutdoor(key) || (canGoOutside(key) && !overlapsHouse(room, key, x, z, rot)), [w, d] = sizeOf(key, rot);
  if (outside) {
    const lb = lawnBox(room), pl = plotFor(room);
    if (x < lb.x0 || z < lb.z0 || x + w > lb.x1 || z + d > lb.z1) return "That is outside your property.";
    if (pl.reserved.some((r) => x < r.x1 && x + w > r.x0 && z < r.z1 && z + d > r.z0)) return "Keep the house, garage, driveway and paths clear.";
    return fits(room, placed, key, x, z, rot, ignoreId) ? null : "Something is already standing there.";
  }
  if (x < 0 || z < 0 || x + w > room.w || z + d > room.d) return canGoOutside(key) ? "Put it fully inside the house or fully out on the compound, not across the wall." : `${it.name} stays indoors: the weather would ruin it.`;
  const L = layoutOf(room);
  if (L) { const zn = zoneAt(L, x, z); if (cellsOf(key, x, z, rot).some(([cx, cz]) => zoneAt(L, cx, cz)?.id !== zn.id)) return "It cannot stand across a wall."; if (!canStand(zn.kind, key)) return `${it.name} does not belong in the ${zn.name.toLowerCase()}.`; }
  if (!fits(room, placed, key, x, z, rot, ignoreId)) return !isFlat(key) && cellsOf(key, x, z, rot).some((c) => doorCells(room).some((dc) => dc[0] === c[0] && dc[1] === c[1])) ? "That would block a doorway." : "Something is already standing there.";
  return blocksWalkway(room, placed, key, x, z, rot, ignoreId) ? "That would block the way through your home." : null;
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
export function autoPlace(room, placed, key, zone = null, { outdoors = false } = {}) {
  if (isOutdoor(key) || (outdoors && canGoOutside(key))) {
    const east = new Set(outdoorSlots(room).map((c) => c.join())), big = ITEMS[key].w * ITEMS[key].d > 1, flat = isFlat(key);
    const near = placed.filter((o) => o.placed && o.x != null && isOutside(room, o) && !isFlat(o.key));
    // pass 1 leaves a one-cell gap round every other solid piece (a garden should breathe); pass 2, only when the lawn is that full, packs them tight
    const gap = (x, z, rot) => { if (flat) return true; const mine = cellsOf(key, x, z, rot); return !near.some((o) => cellsOf(o.key, o.x, o.z, o.rot).some((c) => mine.some((m) => Math.abs(m[0] - c[0]) <= 1 && Math.abs(m[1] - c[1]) <= 1))); };
    for (const roomy of [true, false]) {
      for (const [sx, sz] of lawnSlots(room, big)) {
        // beside the east wall it faces away from the house (as before); in the front garden it faces the house; behind the house it faces the road
        const want = east.has(sx + "," + sz) ? 3 : sz >= room.d ? 2 : 0;
        for (const rot of [want, 0, 1, 2, 3]) if (fits(room, placed, key, sx, sz, rot) && (!roomy || !big || gap(sx, sz, rot))) return { x: sx, z: sz, rot };
      }
    }
    return null;
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
  const placed = items.filter((i) => i.placed && i.x != null && !isOutside(room, i)), bl = blockedCells(placed, room), start = spawnCell(room), seen = new Set([start.join()]), q = [start];
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
export function blockedCells(placed, room = null) {
  const s = new Set();
  for (const o of placed) if (o.placed && o.x != null && !isFlat(o.key) && !isOutdoor(o.key) && !(room && isOutside(room, o))) for (const c of cellsOf(o.key, o.x, o.z, o.rot)) s.add(c.join());
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
