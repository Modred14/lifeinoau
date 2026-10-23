// lib/layouts.js
// Floor plans for the homes that have more than one room: Ojaja, off campus and the two flats.
// Pure data and small helpers (no browser APIs, no database), so the server checks every placement with the same plan the 3D room draws.
//
// A plan is a grid of cells (x runs west to east, z runs north to south, like lib/room.js). One cell is one 3D unit, about 0.9 m.
// Every cell belongs to a zone: a room of the home. Walls are the lines between cells of different zones. A `door` joins two cells that
// touch across such a line, and is the only way to walk from one zone to the other. The `entry` is the front door: a cell next to the south wall.
// Windows are only for the 3D picture: { side, at (in cells along that wall), w, h, y }.

const KINDS = {
  B: ["bed", "Bedroom"],
  K: ["kitchen", "Kitchen"],
  P: ["passage", "Hall"],
  T: ["bath", "Bathroom"],
  W: ["toilet", "Toilet"],
  L: ["living", "Living room"],
};

/** rows: one string per row of cells. `legend` maps a letter to [zone id, kind, name]; letters not listed use KINDS (id = kind). */
const plan = ({ rows, legend = {}, doors, entry, goal, windows = [], decor = [] }) => {
  const zones = new Map(), grid = rows.map((r) => [...r].map((ch) => {
    const [id, kind, name] = legend[ch] ?? [KINDS[ch][0], KINDS[ch][0], KINDS[ch][1]];
    if (!zones.has(id)) zones.set(id, { id, kind, name });
    return zones.get(id);
  }));
  const doorKeys = new Set(doors.flatMap(([a, b, c, d]) => [`${a},${b}|${c},${d}`, `${c},${d}|${a},${b}`]));
  return { w: rows[0].length, d: rows.length, grid, zones: [...zones.values()], doors, doorKeys, entry, goal, windows, decor };
};

/**
 * Draws a plan from its rooms: each one is [letter, x, z, width, depth] in cells, so a room is exactly the size it is given here.
 * Whatever no room covers is the hall (the passage that joins the rooms). Rooms may not overlap or leave the plan.
 */
const carve = (W, D, rooms, hall = "P") => {
  const g = Array.from({ length: D }, () => Array(W).fill(null));
  for (const [ch, x, z, w, d] of rooms) for (let j = z; j < z + d; j++) for (let i = x; i < x + w; i++) {
    if (i < 0 || j < 0 || i >= W || j >= D || g[j][i]) throw new Error(`layouts: room ${ch} at ${x},${z} (${w}x${d}) overlaps another room or leaves the ${W}x${D} plan`);
    g[j][i] = ch;
  }
  return g.map((r) => r.map((c) => c ?? hall).join(""));
};

/**
 * The floor plans. The room sizes (width x depth in cells) are the design; each plan is as big as it needs to be to hold them without overlap,
 * and the hall (P) is what is left over, which is also where the front door is (in the 1-bedroom flat the front door is in the living room).
 *
 *   Ojaja        10x11   bedroom and living room together 10x8, kitchen 4x3, bathroom 3x3
 *   Off campus   15x10   bedroom 8x7, living area 7x6, kitchen 4x4, bathroom 3x3 (the living area is its own room here)
 *   1-bed flat   13x16   bedroom 8x8, living room 10x8, kitchen 5x5, bathroom 4x3, separate toilet 3x3
 *   2-bed flat   20x16   main bedroom 9x8, second bedroom 8x7, living room 11x9, kitchen 6x5, bathroom 4x4, separate toilet 3x3
 */
const BASE = {
  // Ojaja: one big room to sleep and sit in, with the kitchen and the bathroom either side of a small hall (the front door is in the hall).
  ojaja: {
    rows: carve(10, 11, [["B", 0, 0, 10, 8], ["K", 0, 8, 4, 3], ["T", 7, 8, 3, 3]]),
    legend: { B: ["bed", "bed", "Bedroom and living room"] },
    doors: [[5, 7, 5, 8], [3, 9, 4, 9], [6, 9, 7, 9]], // room to hall, kitchen to hall, hall to bathroom
    entry: { x: 5, z: 10, at: 5.5 }, goal: [5, 4],
    windows: [
      { side: "N", at: 2.5, w: 1.3, h: 1.25 }, { side: "N", at: 7.5, w: 1.3, h: 1.25 },
      { side: "W", at: 2.5, w: 1.1, h: 1.1 }, { side: "W", at: 5.5, w: 1.1, h: 1.1 }, { side: "W", at: 9.5, w: 0.9, h: 0.9 },
      { side: "E", at: 2.5, w: 1.1, h: 1.1 }, { side: "E", at: 5.5, w: 1.1, h: 1.1 },
      { side: "S", at: 2, w: 1.2, h: 1.1 }, { side: "S", at: 8.5, w: 0.7, h: 0.6, y: 1.5 },
    ],
    decor: [
      { kind: "ac", side: "N", at: 5, y: 2.45 }, { kind: "poster", n: 0, side: "N", at: 0.8 }, { kind: "clock", side: "N", at: 9.3, y: 2.45 },
      { kind: "poster", n: 1, side: "W", at: 4 }, { kind: "poster", n: 2, side: "E", at: 4 },
    ],
  },
  // Off campus: a bedroom and a separate living area, both off the hall, with the kitchen and the bathroom at its two ends.
  offcampus: {
    rows: carve(15, 10, [["L", 0, 0, 7, 6], ["B", 7, 0, 8, 7], ["K", 0, 6, 4, 4], ["T", 12, 7, 3, 3]]),
    legend: { L: ["living", "living", "Living area"] },
    doors: [[5, 5, 5, 6], [9, 6, 9, 7], [3, 8, 4, 8], [11, 8, 12, 8]], // living area, bedroom, kitchen and bathroom each open onto the hall
    entry: { x: 7, z: 9, at: 7.5 }, goal: [3, 3],
    windows: [
      { side: "N", at: 2, w: 1.3, h: 1.25 }, { side: "N", at: 5, w: 1.3, h: 1.25 }, { side: "N", at: 9.2, w: 1.3, h: 1.25 }, { side: "N", at: 13, w: 1.3, h: 1.25 },
      { side: "W", at: 2.5, w: 1.1, h: 1.1 }, { side: "W", at: 7.5, w: 1.0, h: 1.0 },
      { side: "E", at: 2.2, w: 1.1, h: 1.1 }, { side: "E", at: 5, w: 0.9, h: 0.9 }, { side: "E", at: 8.5, w: 0.7, h: 0.6, y: 1.5 },
      { side: "S", at: 2, w: 1.2, h: 1.1 }, { side: "S", at: 5.2, w: 1.3, h: 1.2 }, { side: "S", at: 10, w: 1.3, h: 1.2 },
    ],
    decor: [
      { kind: "ac", side: "N", at: 11.1, y: 2.45 }, { kind: "poster", n: 0, side: "N", at: 3.5 }, { kind: "clock", side: "N", at: 14.5, y: 2.45 },
      { kind: "poster", n: 1, side: "E", at: 3.7 }, { kind: "poster", n: 2, side: "W", at: 4.6 },
    ],
  },
  // 1-bedroom flat: the front door opens into the living room, which leads to the bedroom and to the hall that serves the kitchen, bathroom and toilet.
  flat1: {
    rows: carve(13, 16, [["B", 0, 0, 8, 8], ["K", 8, 0, 5, 5], ["T", 8, 5, 4, 3], ["L", 0, 8, 10, 8], ["W", 10, 13, 3, 3]]),
    doors: [[3, 7, 3, 8], [9, 10, 10, 10], [10, 7, 10, 8], [12, 4, 12, 5], [11, 12, 11, 13]], // bedroom, living room to hall, bathroom, kitchen, toilet
    entry: { x: 4, z: 15, at: 4.5 }, goal: [5, 11],
    windows: [
      { side: "N", at: 1.9, w: 1.3, h: 1.25 }, { side: "N", at: 5.6, w: 1.3, h: 1.25 }, { side: "N", at: 10.5, w: 1.3, h: 1.25 },
      { side: "W", at: 2.5, w: 1.1, h: 1.1 }, { side: "W", at: 5.5, w: 1.1, h: 1.1 }, { side: "W", at: 10.5, w: 1.3, h: 1.25 }, { side: "W", at: 13.5, w: 1.1, h: 1.1 },
      { side: "E", at: 2, w: 1.0, h: 1.0 }, { side: "E", at: 10, w: 1.0, h: 1.0 }, { side: "E", at: 14.5, w: 0.7, h: 0.6, y: 1.5 },
      { side: "S", at: 1.7, w: 1.3, h: 1.2 }, { side: "S", at: 7.5, w: 1.5, h: 1.2 }, { side: "S", at: 11.5, w: 0.7, h: 0.6, y: 1.5 },
    ],
    decor: [{ kind: "ac", side: "N", at: 3.75, y: 2.45 }, { kind: "poster", n: 1, side: "W", at: 4 }, { kind: "clock", side: "S", at: 3.4, y: 2.4 }],
  },
  // 2-bedroom flat: the front door opens into the hall, which leads to the main bedroom, kitchen, toilet, bathroom and the living room;
  // the second bedroom opens off the living room, so the two bedrooms are not joined to each other.
  flat2: {
    rows: carve(20, 16, [["1", 0, 0, 9, 8], ["L", 9, 0, 11, 9], ["K", 0, 8, 6, 5], ["W", 9, 9, 3, 3], ["T", 8, 12, 4, 4], ["2", 12, 9, 8, 7]]),
    legend: { 1: ["bed1", "bed", "Main bedroom"], 2: ["bed2", "bed", "Second bedroom"] },
    doors: [[7, 7, 7, 8], [8, 8, 9, 8], [5, 10, 6, 10], [8, 10, 9, 10], [7, 14, 8, 14], [15, 8, 15, 9]], // main bedroom, living room, kitchen, toilet, bathroom (all on the hall), second bedroom (off the living room)
    entry: { x: 3, z: 15, at: 3.5 }, goal: [14, 4],
    windows: [
      { side: "N", at: 2.2, w: 1.3, h: 1.25 }, { side: "N", at: 6.2, w: 1.3, h: 1.25 }, { side: "N", at: 12, w: 1.5, h: 1.25 }, { side: "N", at: 17, w: 1.5, h: 1.25 },
      { side: "W", at: 2.5, w: 1.1, h: 1.1 }, { side: "W", at: 5.5, w: 1.1, h: 1.1 }, { side: "W", at: 10, w: 1.1, h: 1.1 }, { side: "W", at: 14, w: 1.0, h: 1.0 },
      { side: "E", at: 2.5, w: 1.3, h: 1.25 }, { side: "E", at: 6, w: 1.3, h: 1.25 }, { side: "E", at: 12, w: 1.3, h: 1.25 },
      { side: "S", at: 6.2, w: 1.3, h: 1.2 }, { side: "S", at: 9.5, w: 0.7, h: 0.6, y: 1.5 }, { side: "S", at: 15.5, w: 1.5, h: 1.2 },
    ],
    decor: [
      { kind: "ac", side: "N", at: 4.2, y: 2.45 }, { kind: "ac", side: "N", at: 14.5, y: 2.45 }, { kind: "poster", n: 2, side: "N", at: 0.7 }, { kind: "clock", side: "N", at: 19.4, y: 2.45 },
      { kind: "poster", n: 3, side: "W", at: 4 }, { kind: "clock", side: "S", at: 1.2, y: 2.4 },
    ],
  },
};

/** The size of each plan in cells: [width, depth]. */
export const HOME_SIZE = Object.fromEntries(Object.entries(BASE).map(([id, p]) => [id, [p.rows[0].length, p.rows.length]]));

export const LAYOUTS = Object.fromEntries(Object.entries(BASE).map(([id, def]) => [id, plan(def)]));

/** Which plan a home uses (null: a single plain room, drawn from the size alone). Ojaja and off campus have a plan each: only Ojaja has one room for sleeping and sitting. */
export const HOME_LAYOUT = { Ojaja: "ojaja", "Off-campus": "offcampus", "1-Bedroom Flat": "flat1", "2-Bedroom Flat": "flat2" };
export const layoutIdFor = (hostel) => HOME_LAYOUT[hostel] ?? null;
/** The plan of a room object ({ layout: "flat1", ... }), or null for a plain room. */
export const layoutOf = (room) => (room?.layout && LAYOUTS[room.layout]) || null;

/** The zone ({ id, kind, name }) holding a cell, or null outside the plan. */
export const zoneAt = (L, x, z) => L.grid[z]?.[x] ?? null;
const same = (a, b) => a && b && a.id === b.id;

/** May someone step from cell a to the touching cell b? Within a zone always, between zones only through a door. */
export function canStep(L, a, b) {
  const za = zoneAt(L, a[0], a[1]), zb = zoneAt(L, b[0], b[1]);
  if (!za || !zb) return false;
  return same(za, zb) || L.doorKeys.has(`${a[0]},${a[1]}|${b[0]},${b[1]}`);
}

/** Cells next to a door (both sides) and the cell inside the front door. Nothing but a rug may stand on them, so every door stays usable. */
export function doorCellsOf(L) {
  return [...L.doors.flatMap(([a, b, c, d]) => [[a, b], [c, d]]), [L.entry.x, L.entry.z]];
}

/** The smallest box (x0, z0 to x1, z1, end exclusive) around the zone holding a cell. */
export function zoneBox(L, x, z) {
  const zn = zoneAt(L, x, z); let x0 = L.w, z0 = L.d, x1 = 0, z1 = 0;
  for (let j = 0; j < L.d; j++) for (let i = 0; i < L.w; i++) if (same(L.grid[j][i], zn)) { x0 = Math.min(x0, i); z0 = Math.min(z0, j); x1 = Math.max(x1, i + 1); z1 = Math.max(z1, j + 1); }
  return { x0, z0, x1, z1 };
}

/**
 * Every wall inside the home, merged into straight runs: { x1, z1, x2, z2 } in grid-line coordinates (so x 0 to W, z 0 to D),
 * with the doorways left out. `doors` are returned too as { x, z, dir } (the middle of each doorway; dir "h" for a doorway in a
 * horizontal wall, "v" for one in a vertical wall).
 */
export function wallRuns(L) {
  const hs = [], vs = [], doors = [];
  const doorAt = (a, b, c, d) => L.doorKeys.has(`${a},${b}|${c},${d}`);
  for (let z = 1; z < L.d; z++) for (let x = 0; x < L.w; x++) { // wall between (x, z-1) and (x, z)
    if (same(L.grid[z - 1][x], L.grid[z][x])) continue;
    if (doorAt(x, z - 1, x, z)) doors.push({ x: x + 0.5, z, dir: "h" }); else hs.push([z, x]);
  }
  for (let x = 1; x < L.w; x++) for (let z = 0; z < L.d; z++) { // wall between (x-1, z) and (x, z)
    if (same(L.grid[z][x - 1], L.grid[z][x])) continue;
    if (doorAt(x - 1, z, x, z)) doors.push({ x, z: z + 0.5, dir: "v" }); else vs.push([x, z]);
  }
  const merge = (list, horizontal) => {
    list.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out = [];
    for (const [line, at] of list) {
      const last = out[out.length - 1];
      if (last && last.line === line && last.end === at) last.end = at + 1; else out.push({ line, start: at, end: at + 1 });
    }
    return out.map((r) => (horizontal ? { x1: r.start, z1: r.line, x2: r.end, z2: r.line } : { x1: r.line, z1: r.start, x2: r.line, z2: r.end }));
  };
  return { walls: [...merge(hs, true), ...merge(vs, false)], doors };
}
