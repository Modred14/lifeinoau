// lib/plot.js
// The residential plot a home stands on: a square compound with the house at the back, a garage beside it, a paved driveway from the garage
// door straight out through a vehicle gate to the road, a footpath from the front door to a pedestrian gate, and a lawn for the owner's
// outdoor things. Pure functions, no database and no browser APIs: the server checks every outdoor placement with exactly the same rules the
// 3D room uses while you drag, and the tests walk a car down the driveway with the same numbers the scene draws.
//
// Coordinates are the room's own cells (x east, z south, the room itself covers [0, w] x [0, d]). Cells outside the room have negative
// numbers to the west and north, so a plot is described in the same grid the furniture lives in. One cell is one scene unit of the room view.
// The road runs along the south edge of the plot; the front door and the garage door both face it.
import { layoutOf } from "./layouts.js";
import { ITEMS, sizeOf, isOutdoor } from "./furniture.js";

export const PLOT_RULES = Object.freeze({
  westYard: 4, // lawn west of the house (the plain-room front door is on the west wall)
  eastGap: 3, // lawn between the house and the garage
  garageW: 5, garageD: 7, doorW: 4, // garage: outside size, and the width of its open door
  driveW: 6, // the driveway: a car is about 2.2 cells wide, so two could pass; it is as wide as the vehicle gate
  eastYard: 2, frontYard: 18, backMin: 3, // lawn beside the garage, in front of the house (garage door to fence), and at least behind it
  fence: 1, // the boundary wall is one cell thick; things stand inside it
  pavement: 2, roadW: 7, // the footpath between the fence and the kerb, and the carriageway
  gateW: 6, footGateW: 2,
});

const CACHE = new Map();

/** Everything about the plot of a home with this room. Cached by size and floor plan. */
export function plotFor(room) {
  const key = `${room.w}x${room.d}:${room.layout ?? ""}`;
  if (CACHE.has(key)) return CACHE.get(key);
  const R = PLOT_RULES, W = room.w, D = room.d, L = layoutOf(room);
  // the garage stands east of the house, its door in line with the front of the house
  const garage = { x0: W + R.eastGap, x1: W + R.eastGap + R.garageW, z1: D + 1, z0: D + 1 - R.garageD };
  const doorC = (garage.x0 + garage.x1) / 2;
  const door = { x0: doorC - R.doorW / 2, x1: doorC + R.doorW / 2, z: garage.z1 }; // the opening in the garage's south wall
  const x0 = -R.westYard, x1 = garage.x1 + R.eastYard, z1 = garage.z1 + R.frontYard;
  const side = Math.max(x1 - x0, z1 - (Math.min(0, garage.z0) - R.backMin)); // a square: whichever side is longer
  const plot = { x0: x1 - side, x1, z0: z1 - side, z1, side }; // widen to the west or deepen to the north to make it square
  // the road: along the plot's south side, beyond a footpath; it is wider than the plot so it clearly continues past both neighbours
  const road = { x0: plot.x0 - 14, x1: plot.x1 + 14, z0: plot.z1 + R.pavement, z1: plot.z1 + R.pavement + R.roadW };
  const kerb = road.z0;
  const drive = { x0: doorC - R.driveW / 2, x1: doorC + R.driveW / 2, z0: garage.z1, z1: kerb }; // garage door -> vehicle gate -> footpath -> carriageway edge
  const gate = { x0: doorC - R.gateW / 2, x1: doorC + R.gateW / 2, z: plot.z1 }; // the vehicle gate, left open, in the front wall
  // the footpath: from the front door to the pedestrian gate
  let doorOut, path;
  if (L) { const at = L.entry.at ?? L.entry.x + 0.5; doorOut = { x: at, z: D }; path = [{ x0: at - 1, x1: at + 1, z0: D, z1: kerb }]; }
  else { doorOut = { x: -0.5, z: D - 1 }; path = [{ x0: -3, x1: 0, z0: D - 2, z1: D }, { x0: -3, x1: -1, z0: D, z1: kerb }]; }
  const footX = (path.at(-1).x0 + path.at(-1).x1) / 2;
  const footGate = { x0: footX - R.footGateW / 2, x1: footX + R.footGateW / 2, z: plot.z1 };
  const house = { x0: 0, x1: W, z0: 0, z1: D };
  // a front walk joins the footpath to the driveway, so the garage can be reached on foot from the front door without crossing the lawn
  const link = { x0: path.at(-1).x1, x1: drive.x0, z0: garage.z1 + 1.5, z1: garage.z1 + 3 };
  // what outdoor things may never stand on
  const reserved = [house, garage, drive, ...path, link];
  const out = { room: { w: W, d: D }, plot, link, road, kerb, house, garage, door, drive, gate, footGate, path, doorOut, reserved, doorC, apron: { x0: drive.x0 - 0.8, x1: drive.x1 + 0.8, z0: plot.z1, z1: kerb } };
  CACHE.set(key, out);
  return out;
}

const hits = (r, x, z, w, d) => x < r.x1 && x + w > r.x0 && z < r.z1 && z + d > r.z0; // does the cell block [x, x+w) x [z, z+d) touch rectangle r?

/** The lawn: every cell an outdoor thing may stand on, as a rectangle (inside the boundary wall). */
export function lawnBox(room) { const p = plotFor(room).plot, f = PLOT_RULES.fence; return { x0: p.x0 + f, x1: p.x1 - f, z0: p.z0 + f, z1: p.z1 - f }; }

/** Can an outdoor thing of this key, turned `rot` quarter-turns, stand at (x, z)? Only the plot's rules: other items are checked by the caller. */
export function plotAllows(room, key, x, z, rot = 0) {
  if (!ITEMS[key] || !isOutdoor(key) || !Number.isInteger(x) || !Number.isInteger(z)) return false;
  const [w, d] = sizeOf(key, rot), lb = lawnBox(room), pl = plotFor(room);
  if (x < lb.x0 || z < lb.z0 || x + w > lb.x1 || z + d > lb.z1) return false;
  return !pl.reserved.some((r) => hits(r, x, z, w, d));
}

/** Spots for a new outdoor thing, best first: a column of eight beside the east wall (as before), then the rest of the lawn row by row. */
export function lawnSlots(room) {
  const lb = lawnBox(room), pl = plotFor(room), out = [], seen = new Set(), add = (x, z) => { const k = x + "," + z; if (!seen.has(k)) { seen.add(k); out.push([x, z]); } };
  for (let i = 0; i < 8; i++) add(room.w + Math.floor(i / 4), room.d - 2 - (i % 4)); // the original eight, beside the east wall
  for (let z = lb.z0; z < lb.z1; z++) for (let x = lb.x0; x < lb.x1; x++) add(x, z);
  return out.filter(([x, z]) => !pl.reserved.some((r) => hits(r, x, z, 1, 1)));
}

// ---- driving: the same numbers the 3D scene uses ----
/** Cells a car may be in on its way out: the garage's inside, the driveway (with its flared mouth) and the road. */
export function driveable(room) { const p = plotFor(room), R = PLOT_RULES; return [{ x0: p.garage.x0 + 0.5, x1: p.garage.x1 - 0.5, z0: p.garage.z0 + 0.5, z1: p.garage.z1 }, p.drive, p.apron, p.road]; }
/** The waypoints a car follows from the middle of the garage to the middle of the near lane of the road, always on the driveway's centre line. */
export function driveRoute(room) { const p = plotFor(room), c = p.doorC; return [[c, (p.garage.z0 + p.garage.z1) / 2], [c, p.garage.z1], [c, p.plot.z1], [c, p.kerb], [c, p.kerb + 1.8]]; }
