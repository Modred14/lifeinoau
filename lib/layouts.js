// lib/layouts.js
// Floor plans for the homes that have more than one room: Ojaja, off campus and the two flats.
// Pure data and small helpers (no browser APIs, no database), so the server checks every placement with the same plan the 3D room draws.
//
// A plan is a grid of cells (x runs west to east, z runs north to south, like lib/room.js). One cell is one 3D unit, about 0.9 m.
// Every cell belongs to a zone: a room of the home. Walls are the lines between cells of different zones. A `door` joins two cells that
// touch across such a line, and is the only way to walk from one zone to the other. The `entry` is the front door: a cell next to the south wall.
// Windows are only for the 3D picture: { side, at (in cells along that wall), w, h, y }.
//
// House rules every plan with a living room follows (tests/houses.test.mjs checks them for every home):
//  - the front door opens straight into the living room (or, in Ojaja, the one room for sleeping and sitting): never through a bedroom, bathroom or kitchen;
//  - in the 2-, 3- and 4-bedroom homes every bedroom has its own private bathroom, reached only through that bedroom, and there is one shared guest toilet off the hall.

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
  if (windows === "auto") windows = autoWindows(grid, entry.at);
  if (decor === "auto") decor = autoDecor(grid, windows);
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
 * Windows for a plan, worked out from its outside walls so they always sit on the room they belong to: a bedroom, living room or kitchen gets a
 * window about every 3.6 cells, a bathroom or toilet one small high window, the hall none, and none beside the front door.
 */
const autoWindows = (grid, entryAt) => {
  const W = grid[0].length, D = grid.length, out = [];
  const walls = { N: [W, (i) => grid[0][i]], S: [W, (i) => grid[D - 1][i]], W: [D, (i) => grid[i][0]], E: [D, (i) => grid[i][W - 1]] };
  for (const [side, [len, at]] of Object.entries(walls)) {
    for (let i = 0; i < len; ) {
      let j = i; const zn = at(i); while (j < len && at(j) === zn) j++;
      const run = j - i, small = zn.kind === "bath" || zn.kind === "toilet";
      if (zn.kind !== "passage" && run >= 2) {
        const n = small ? 1 : Math.max(1, Math.floor(run / 3.6));
        for (let k = 0; k < n; k++) {
          const c = +(i + (run * (k + 0.5)) / n).toFixed(2);
          if (side === "S" && Math.abs(c - entryAt) < 1.7) continue;
          out.push(small ? { side, at: c, w: 0.7, h: 0.6, y: 1.5 } : { side, at: c, w: 1.3, h: 1.25 });
        }
      }
      i = j;
    }
  }
  return out;
};

/** Air conditioners and clocks on the outside walls of the bedrooms and the living room, clear of the windows. */
const autoDecor = (grid, windows) => {
  const W = grid[0].length, D = grid.length, out = [], seen = new Set();
  const walls = { N: [W, (i) => grid[0][i]], W: [D, (i) => grid[i][0]], E: [D, (i) => grid[i][W - 1]] };
  const clear = (side, c) => !windows.some((w) => w.side === side && Math.abs(w.at - c) < w.w / 2 + 0.9) && !out.some((d) => d.side === side && Math.abs(d.at - c) < 1.6);
  for (const [side, [len, at]] of Object.entries(walls)) {
    for (let i = 0; i < len; ) {
      let j = i; const zn = at(i); while (j < len && at(j) === zn) j++;
      if ((zn.kind === "bed" || zn.kind === "living") && j - i >= 4 && !seen.has(zn.id + side)) {
        for (const c of [i + 0.8, j - 0.8, (i + j) / 2]) if (clear(side, c)) { out.push({ kind: seen.has(zn.id) ? "clock" : "ac", side, at: +c.toFixed(2), y: 2.45 }); seen.add(zn.id); seen.add(zn.id + side); break; }
      }
      i = j;
    }
  }
  return out;
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
  // Ojaja: one big room to sleep and sit in, and the front door opens straight into it. The kitchen and the bathroom are at the back, either side of a small hall.
  ojaja: {
    rows: carve(10, 11, [["B", 0, 3, 10, 8], ["K", 0, 0, 4, 3], ["T", 7, 0, 3, 3]]),
    legend: { B: ["bed", "bed", "Bedroom and living room"] },
    doors: [[5, 2, 5, 3], [3, 1, 4, 1], [6, 1, 7, 1]], // room to hall, kitchen to hall, hall to bathroom
    entry: { x: 5, z: 10, at: 5.5 }, goal: [5, 6],
    windows: "auto", decor: "auto",
  },
  // Off campus: the front door opens into the living area, which leads to the bedroom, the kitchen and the hall that serves the bathroom.
  offcampus: {
    rows: carve(15, 10, [["L", 0, 4, 7, 6], ["B", 7, 3, 8, 7], ["K", 0, 0, 4, 4], ["T", 12, 0, 3, 3]]),
    legend: { L: ["living", "living", "Living area"] },
    doors: [[6, 6, 7, 6], [2, 3, 2, 4], [5, 3, 5, 4], [3, 1, 4, 1], [11, 1, 12, 1], [9, 2, 9, 3]], // living area to bedroom, to kitchen and to the hall; kitchen, bathroom and bedroom (second door) open on the hall
    entry: { x: 3, z: 9, at: 3.5 }, goal: [3, 6],
    windows: "auto", decor: "auto",
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
  // 2-bedroom house: the front door opens into the living room. The main bedroom opens off the living room and the second bedroom off the hall (the living
  // room leads to the hall and the kitchen); each bedroom has its own bathroom, reached only through it, and the guest toilet is off the hall.
  flat2: {
    rows: carve(22, 17, [["1", 0, 0, 9, 8], ["a", 9, 0, 4, 4], ["b", 9, 4, 4, 4], ["2", 13, 0, 9, 8], ["L", 0, 8, 13, 9], ["K", 13, 12, 6, 5], ["W", 19, 14, 3, 3]]),
    legend: { 1: ["bed1", "bed", "Main bedroom"], 2: ["bed2", "bed", "Second bedroom"], a: ["bath1", "bath", "Main bedroom bathroom"], b: ["bath2", "bath", "Second bedroom bathroom"], W: ["toilet", "toilet", "Guest toilet"] },
    doors: [[8, 1, 9, 1], [12, 5, 13, 5], [4, 7, 4, 8], [12, 9, 13, 9], [17, 7, 17, 8], [12, 14, 13, 14], [20, 13, 20, 14]], // two ensuites, main bedroom, living room to hall, second bedroom, kitchen, guest toilet
    entry: { x: 6, z: 16, at: 6.5 }, goal: [6, 12],
    windows: "auto", decor: "auto",
  },
  // 3-bedroom house: the front door opens into the living room; a long hall joins the living room to the two bedrooms at the back, the guest toilet and the third
  // bedroom. The kitchen opens off the living room. Every bedroom has its own bathroom (the third has a walk-in wardrobe too).
  house3: {
    rows: carve(26, 20, [["1", 0, 0, 9, 7], ["a", 9, 0, 4, 4], ["b", 13, 0, 4, 4], ["2", 17, 0, 9, 7], ["L", 0, 10, 12, 10], ["W", 12, 10, 3, 3], ["K", 12, 15, 6, 5], ["3", 18, 10, 8, 7], ["c", 18, 17, 8, 3]]),
    legend: { 1: ["bed1", "bed", "Main bedroom"], 2: ["bed2", "bed", "Second bedroom"], 3: ["bed3", "bed", "Third bedroom"], a: ["bath1", "bath", "Main bedroom bathroom"], b: ["bath2", "bath", "Second bedroom bathroom"], c: ["bath3", "bath", "Third bedroom bathroom"], W: ["toilet", "toilet", "Guest toilet"] },
    doors: [[8, 2, 9, 2], [16, 2, 17, 2], [19, 16, 19, 17], [4, 6, 4, 7], [21, 6, 21, 7], [5, 9, 5, 10], [9, 9, 9, 10], [13, 9, 13, 10], [11, 17, 12, 17], [17, 12, 18, 12]],
    entry: { x: 5, z: 19, at: 5.5 }, goal: [5, 14],
    windows: "auto", decor: "auto",
  },
  // 4-bedroom house: the front door opens into a very large living room with a bedroom either side (each also on the hall); the hall leads to the main
  // bedroom, the second bedroom, the kitchen and the guest toilet at the back. Every bedroom has its own bathroom, and the two at the front a walk-in wardrobe.
  house4: {
    rows: carve(31, 20, [["1", 0, 0, 9, 7], ["a", 9, 0, 4, 4], ["W", 9, 4, 3, 3], ["K", 13, 0, 5, 7], ["b", 18, 0, 4, 4], ["2", 22, 0, 9, 7], ["3", 0, 10, 9, 7], ["c", 0, 17, 9, 3], ["L", 9, 10, 13, 10], ["4", 22, 10, 9, 7], ["d", 22, 17, 9, 3]]),
    legend: { 1: ["bed1", "bed", "Main bedroom"], 2: ["bed2", "bed", "Second bedroom"], 3: ["bed3", "bed", "Third bedroom"], 4: ["bed4", "bed", "Fourth bedroom"], a: ["bath1", "bath", "Main bedroom bathroom"], b: ["bath2", "bath", "Second bedroom bathroom"], c: ["bath3", "bath", "Third bedroom bathroom"], d: ["bath4", "bath", "Fourth bedroom bathroom"], W: ["toilet", "toilet", "Guest toilet"] },
    doors: [[8, 1, 9, 1], [21, 2, 22, 2], [1, 16, 1, 17], [28, 16, 28, 17], [4, 6, 4, 7], [26, 6, 26, 7], [15, 6, 15, 7], [10, 6, 10, 7], [12, 9, 12, 10], [18, 9, 18, 10], [4, 9, 4, 10], [26, 9, 26, 10], [8, 13, 9, 13], [21, 13, 22, 13]],
    entry: { x: 15, z: 19, at: 15.5 }, goal: [15, 14],
    windows: "auto", decor: "auto",
  },
};

/** The size of each plan in cells: [width, depth]. */
export const HOME_SIZE = Object.fromEntries(Object.entries(BASE).map(([id, p]) => [id, [p.rows[0].length, p.rows.length]]));

export const LAYOUTS = Object.fromEntries(Object.entries(BASE).map(([id, def]) => [id, plan(def)]));

/** Which plan a home uses (null: a single plain room, drawn from the size alone). Ojaja and off campus have a plan each: only Ojaja has one room for sleeping and sitting. */
export const HOME_LAYOUT = { Ojaja: "ojaja", "Off-campus": "offcampus", "1-Bedroom Flat": "flat1", "2-Bedroom Flat": "flat2", "3-Bedroom House": "house3", "4-Bedroom House": "house4" };
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
