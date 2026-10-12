// lib/room.js
// The rules of a room: how big it is, where things may stand, and where a new thing goes. Pure functions, no database and no
// browser APIs, so the server checks every placement with exactly the same code the 3D room uses while you drag.
//
// Coordinates are whole cells. x runs left to right (0 is the west wall), z runs back to front (0 is the north wall).
// An item at (x, z) covers the cells from (x, z) to (x + width - 1, z + depth - 1) once it has been rotated.
import { ITEMS, sizeOf } from "./furniture.js";

/** Floor and wall colours for each look of room. */
export const THEMES = {
  sage: { floorA: "#d9d2c0", floorB: "#cdc5b0", wall: "#a8c3a0", trim: "#f2efe6", accent: "#5f8f6b" },
  sky: { floorA: "#d7dbe3", floorB: "#c8cdd8", wall: "#9fbfe0", trim: "#f4f6fa", accent: "#4f7fb8" },
  sand: { floorA: "#dcc7a0", floorB: "#cfb88d", wall: "#e3c27a", trim: "#fbf3df", accent: "#b9852f" },
  rose: { floorA: "#e0d3d0", floorB: "#d3c4c1", wall: "#e3a6b4", trim: "#fbf1f3", accent: "#b9566f" },
  wood: { floorA: "#b98a5e", floorB: "#a9794d", wall: "#ece4d6", trim: "#ffffff", accent: "#c27a3a" },
  suite: { floorA: "#e9ecef", floorB: "#d5d9de", wall: "#33496b", trim: "#e9eef6", accent: "#e8a23a" },
};

const SCHOOL_THEME = { Awo: "sky", Fajuyi: "sage", Angola: "sand", ETF: "sky", Moremi: "rose", Mozambique: "sage", Akintola: "sand", Alumni: "rose" };

/** Size and look of the room for a hostel. Off-campus and Ojaja are bigger. */
export function roomFor(hostel) {
  if (hostel === "Ojaja") return { w: 8, d: 7, theme: "suite", hostel };
  if (hostel === "Off-campus") return { w: 7, d: 6, theme: "wood", hostel };
  return { w: 6, d: 5, theme: SCHOOL_THEME[hostel] ?? "sage", hostel };
}

/** Cells that must stay clear: the doorway on the west wall (south end) and the step inside it. */
export const doorCells = (room) => [[0, room.d - 1], [1, room.d - 1]];
/** Where the player stands when they walk in. */
export const spawnCell = (room) => [1, room.d - 1];

const isFlat = (key) => !!ITEMS[key]?.flat;

/** Cells covered by an item at (x, z) turned `rot` quarter-turns. */
export function cellsOf(key, x, z, rot = 0) {
  const [w, d] = sizeOf(key, rot), out = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) out.push([x + i, z + j]);
  return out;
}

/** Can this item stand here? `placed` is the list of items already in the room (anything with key, x, z, rot, id). */
export function fits(room, placed, key, x, z, rot = 0, ignoreId = null) {
  if (!ITEMS[key] || !Number.isInteger(x) || !Number.isInteger(z) || !Number.isInteger(rot) || rot < 0 || rot > 3) return false;
  const [w, d] = sizeOf(key, rot);
  if (x < 0 || z < 0 || x + w > room.w || z + d > room.d) return false;
  const flat = isFlat(key), mine = cellsOf(key, x, z, rot);
  if (!flat) { const door = new Set(doorCells(room).map((c) => c.join())); if (mine.some((c) => door.has(c.join()))) return false; }
  for (const o of placed) {
    if (String(o.id) === String(ignoreId) || !o.placed || o.x == null) continue;
    if (isFlat(o.key) !== flat) continue; // a rug sits under furniture, but two rugs cannot share a spot
    const theirs = new Set(cellsOf(o.key, o.x, o.z, o.rot).map((c) => c.join()));
    if (mine.some((c) => theirs.has(c.join()))) return false;
  }
  return true;
}

/** Which way an item should face so its front looks into the room: 0 south, 1 west, 2 north, 3 east. */
export function facingRoom(room, key, x, z) {
  let best = 0, bestDist = Infinity;
  for (let rot = 0; rot < 4; rot++) {
    const [w, d] = sizeOf(key, rot);
    // distance from the wall the item's back would touch (its back is opposite its front)
    const dist = [z, room.w - (x + w), room.d - (z + d), x][rot]; // north wall for a south-facing item, east for west-facing, ...
    if (dist < bestDist) { bestDist = dist; best = rot; }
  }
  return best;
}

/** The best free spot for a new item: against a wall, facing in, and nearest the back (north and west) walls first. Null if the room is full. */
export function autoPlace(room, placed, key) {
  let best = null;
  for (let rot = 0; rot < 4; rot++) {
    if (isFlat(key) && rot > 0) break;
    const [w, d] = sizeOf(key, rot);
    for (let x = 0; x + w <= room.w; x++) for (let z = 0; z + d <= room.d; z++) {
      if (!fits(room, placed, key, x, z, rot)) continue;
      const toWall = Math.min(x, z, room.w - (x + w), room.d - (z + d));
      const facing = isFlat(key) ? 0 : facingRoom(room, key, x, z);
      let cost = isFlat(key) ? Math.abs(x + w / 2 - room.w / 2) + Math.abs(z + d / 2 - room.d / 2) : toWall * 10 + (x + z) * 0.5 + (rot === facing ? 0 : 25);
      if (cost < (best?.cost ?? Infinity)) best = { x, z, rot, cost };
    }
  }
  return best && { x: best.x, z: best.z, rot: best.rot };
}

/** Cells a person cannot walk through (everything except flat items). */
export function blockedCells(placed) {
  const s = new Set();
  for (const o of placed) if (o.placed && o.x != null && !isFlat(o.key)) for (const c of cellsOf(o.key, o.x, o.z, o.rot)) s.add(c.join());
  return s;
}

/** Shortest walk between two cells (four directions), as a list of cells without the start. Empty if there is no way. */
export function findPath(room, blocked, from, to) {
  const key = (c) => c.join(), goal = key(to);
  if (blocked.has(goal) || key(from) === goal) return [];
  const prev = new Map([[key(from), null]]), q = [from];
  while (q.length) {
    const cur = q.shift();
    if (key(cur) === goal) { const out = []; for (let k = goal; k && k !== key(from); ) { const [x, z] = k.split(",").map(Number); out.unshift([x, z]); k = prev.get(k); } return out; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = [cur[0] + dx, cur[1] + dz], k = key(n);
      if (n[0] < 0 || n[1] < 0 || n[0] >= room.w || n[1] >= room.d || blocked.has(k) || prev.has(k)) continue;
      prev.set(k, key(cur)); q.push(n);
    }
  }
  return [];
}