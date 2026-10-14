// lib/layouts.js
// Floor plans for the homes that have more than one room: the one-bedroom place Ojaja and off campus share, and the two flats.
// Pure data and small helpers (no browser APIs, no database), so the server checks every placement with the same plan the 3D room draws.
//
// A plan is a grid of cells (x runs west to east, z runs north to south, like lib/room.js). Every cell belongs to a zone: a room of the home.
// Walls are the lines between cells of different zones. A `door` joins two cells that touch across such a line, and is the only way to
// walk from one zone to the other. The `entry` is the front door: a cell next to the south wall.
// Windows are only for the 3D picture: { side, at (in cells along that wall), w, h, y }.

const KINDS = {
  B: ["bed", "Bedroom"],
  K: ["kitchen", "Kitchen"],
  P: ["passage", "Passage"],
  T: ["bath", "Toilet and bathroom"],
  S: ["store", "Store room"],
  L: ["living", "Sitting room"],
  D: ["dining", "Dining and hall"],
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

export const LAYOUTS = {
  // Ojaja and off campus: one bedroom, a kitchen, a toilet and the passage that joins them (and holds the front door).
  studio: plan({
    rows: ["BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "KKKPPTTT", "KKKPPTTT", "KKKPPTTT"],
    doors: [[3, 4, 3, 5], [2, 6, 3, 6], [5, 6, 4, 6]],
    entry: { x: 3, z: 7, at: 4 }, goal: [4, 2],
    windows: [
      { side: "N", at: 2, w: 1.3, h: 1.25 }, { side: "N", at: 6, w: 1.3, h: 1.25 },
      { side: "W", at: 2.5, w: 1.1, h: 1.1 }, { side: "E", at: 2.5, w: 1.1, h: 1.1 },
      { side: "W", at: 6.5, w: 0.9, h: 0.9 }, { side: "E", at: 6.5, w: 0.7, h: 0.6, y: 1.5 },
    ],
    decor: [{ kind: "ac", side: "N", at: 4, y: 2.45 }, { kind: "poster", n: 0, side: "N", at: 0.9 }, { kind: "clock", side: "N", at: 7.1, y: 2.45 }],
  }),
  // One bedroom, a store room, a toilet, a kitchen and a sitting room, around the passage.
  flat1: plan({
    rows: ["BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "BBBBBBBB", "SSSPPTTT", "SSSPPTTT", "KKKLLLLL", "KKKLLLLL", "KKKLLLLL", "KKKLLLLL"],
    doors: [[3, 3, 3, 4], [2, 5, 3, 5], [5, 5, 4, 5], [4, 5, 4, 6], [2, 7, 3, 7]],
    entry: { x: 4, z: 9, at: 4.5 }, goal: [5, 8],
    windows: [
      { side: "N", at: 4, w: 1.5, h: 1.25 }, { side: "W", at: 1.6, w: 1.1, h: 1.1 },
      { side: "S", at: 1.5, w: 1.3, h: 1.2 }, { side: "S", at: 6.4, w: 1.5, h: 1.2 },
      { side: "E", at: 5, w: 0.7, h: 0.6, y: 1.5 },
    ],
    decor: [{ kind: "ac", side: "N", at: 6.6, y: 2.45 }, { kind: "poster", n: 1, side: "N", at: 1.4 }, { kind: "clock", side: "S", at: 3.2, y: 2.4 }],
  }),
  // Two bedrooms, a store room, a toilet, a kitchen, a sitting room, and the dining area that is also the hall.
  flat2: plan({
    rows: ["11112222", "11112222", "11112222", "11112222", "SSDDDDTT", "SSDDDDTT", "KKDDDLLL", "KKDDDLLL", "KKDDDLLL", "KKDDDLLL"],
    legend: { 1: ["bed1", "bed", "Bedroom 1"], 2: ["bed2", "bed", "Bedroom 2"] },
    doors: [[3, 3, 3, 4], [4, 3, 4, 4], [1, 5, 2, 5], [6, 5, 5, 5], [1, 7, 2, 7], [5, 6, 4, 6]],
    entry: { x: 4, z: 9, at: 4.5 }, goal: [3, 7],
    windows: [
      { side: "N", at: 1.8, w: 1.3, h: 1.25 }, { side: "N", at: 6.2, w: 1.3, h: 1.25 },
      { side: "W", at: 1.6, w: 1.1, h: 1.1 }, { side: "E", at: 1.6, w: 1.1, h: 1.1 },
      { side: "W", at: 7.5, w: 1.0, h: 1.0 }, { side: "E", at: 5, w: 0.7, h: 0.6, y: 1.5 },
      { side: "S", at: 1, w: 1.3, h: 1.2 }, { side: "S", at: 6.5, w: 1.5, h: 1.2 },
    ],
    decor: [{ kind: "ac", side: "N", at: 3.2, y: 2.45 }, { kind: "ac", side: "N", at: 4.8, y: 2.45 }, { kind: "poster", n: 2, side: "N", at: 0.7 }, { kind: "poster", n: 3, side: "N", at: 7.3 }, { kind: "clock", side: "S", at: 3.2, y: 2.4 }],
  }),
};

/** Which plan a home uses (null: a single plain room, drawn from the size alone). */
export const HOME_LAYOUT = { Ojaja: "studio", "Off-campus": "studio", "1-Bedroom Flat": "flat1", "2-Bedroom Flat": "flat2" };
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
