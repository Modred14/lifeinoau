
 // lib/layouts.js
// Floor plans for Ojaja, off-campus accommodation and the two flats.
// Coordinates: x = west to east; z = north to south.
// Each row is one row of cells. Every doorway connects two adjacent zones.

const KINDS = {
  B: ["bed", "Bedroom"],
  K: ["kitchen", "Kitchen"],
  P: ["passage", "Passage"],
  T: ["bath", "Bathroom"],
  U: ["toilet", "Toilet"],
  L: ["living", "Living room"],
  D: ["dining", "Dining and hall"],
};

const plan = ({
  rows,
  legend = {},
  doors,
  entry,
  goal,
  windows = [],
  decor = [],
}) => {
  const width = rows[0].length;

  if (rows.some((row) => row.length !== width)) {
    throw new Error("Invalid floor plan: all rows must have equal width.");
  }

  const zones = new Map();
  const grid = rows.map((row) =>
    [...row].map((letter) => {
      const definition = legend[letter] ?? KINDS[letter];

      if (!definition) {
        throw new Error(`Unknown floor-plan cell: ${letter}`);
      }

      const [id, kind, name] =
        definition.length === 3
          ? definition
          : [definition[0], definition[0], definition[1]];

      if (!zones.has(id)) zones.set(id, { id, kind, name });
      return zones.get(id);
    }),
  );

  const doorKeys = new Set(
    doors.flatMap(([x1, z1, x2, z2]) => [
      `${x1},${z1}|${x2},${z2}`,
      `${x2},${z2}|${x1},${z1}`,
    ]),
  );

  const layout = {
    w: width,
    d: rows.length,
    grid,
    zones: [...zones.values()],
    doors,
    doorKeys,
    entry,
    goal,
    windows,
    decor,
  };

  validateLayout(layout);
  return layout;
};

/** Ensure every internal doorway joins two different, adjacent rooms. */
function validateLayout(layout) {
  for (const [x1, z1, x2, z2] of layout.doors) {
    const a = layout.grid[z1]?.[x1];
    const b = layout.grid[z2]?.[x2];

    if (
      !a ||
      !b ||
      Math.abs(x1 - x2) + Math.abs(z1 - z2) !== 1 ||
      a.id === b.id
    ) {
      throw new Error(
        `Invalid doorway in layout: (${x1}, ${z1}) to (${x2}, ${z2})`,
      );
    }
  }

  if (
    layout.entry.z !== layout.d - 1 ||
    !layout.grid[layout.entry.z]?.[layout.entry.x]
  ) {
    throw new Error("Invalid front-door entry position.");
  }

  // Every zone must be reachable from the entrance through its doorways.
  const start = [layout.entry.x, layout.entry.z];
  const visited = new Set();
  const queue = [start];

  while (queue.length) {
    const [x, z] = queue.shift();
    const key = `${x},${z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = [x + dx, z + dz];
      const nextKey = `${next[0]},${next[1]}`;

      if (visited.has(nextKey)) continue;
      if (canStep(layout, [x, z], next)) queue.push(next);
    }
  }

  const reachableZones = new Set(
    [...visited].map((key) => {
      const [x, z] = key.split(",").map(Number);
      return layout.grid[z]?.[x]?.id;
    }),
  );

  for (const zone of layout.zones) {
    if (!reachableZones.has(zone.id)) {
      throw new Error(`Unreachable room in layout: ${zone.name}`);
    }
  }
}

/**
 * Ojaja: a spacious bedroom/living area, kitchen and bathroom.
 * 12 x 10 cells. The bedroom/living area is the main shared space.
 */
const ojaja = plan({
  rows: [
    "BBBBBBBBKKKK",
    "BBBBBBBBKKKK",
    "BBBBBBBBKKKK",
    "BBBBBBBBKKKK",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBBBBB",
    "BBBBBBBBTTTT",
    "BBBBBBBBTTTT",
  ],
  legend: {
    B: ["bed", "bed", "Bedroom and living area"],
  },
  doors: [
    [7, 1, 8, 1],
    [7, 8, 8, 8],
  ],
  entry: { x: 3, z: 9, at: 3.5 },
  goal: [4, 4],
  windows: [
    { side: "N", at: 2.5, w: 1.5, h: 1.2 },
    { side: "N", at: 5.5, w: 1.5, h: 1.2 },
    { side: "W", at: 3.5, w: 1.1, h: 1.1 },
    { side: "E", at: 3.5, w: 1.1, h: 1.1 },
    { side: "W", at: 7.5, w: 1, h: 1 },
  ],
  decor: [
    { kind: "ac", side: "N", at: 4, y: 2.45 },
    { kind: "poster", n: 0, side: "N", at: 1 },
    { kind: "clock", side: "N", at: 6.5, y: 2.45 },
  ],
});

/**
 * Off-campus: separate bedroom, compact living room, kitchen and bathroom.
 * 12 x 10 cells. The living room is intentionally smaller than the bedroom.
 */
const offCampus = plan({
  rows: [
    "BBBBBBKKKKKK",
    "BBBBBBKKKKKK",
    "BBBBBBKKKKKK",
    "BBBBBBKKKKKK",
    "BBBBBBBBLLLL",
    "BBBBBBBBLLLL",
    "BBBBBBBBLLLL",
    "BBBBBBBTTTTT",
    "BBBBBBBTTTTT",
    "BBBBBBBTTTTT",
  ],
  doors: [
    [5, 1, 6, 1],
    [7, 5, 8, 5],
    [6, 8, 7, 8],
  ],
  entry: { x: 3, z: 9, at: 3.5 },
  goal: [3, 3],
  windows: [
    { side: "N", at: 2.5, w: 1.5, h: 1.2 },
    { side: "N", at: 9.5, w: 1.3, h: 1.1 },
    { side: "W", at: 3.5, w: 1.1, h: 1.1 },
    { side: "E", at: 5.5, w: 1, h: 1 },
    { side: "S", at: 9.5, w: 1.3, h: 1.1 },
  ],
  decor: [
    { kind: "ac", side: "N", at: 3.5, y: 2.45 },
    { kind: "poster", n: 1, side: "N", at: 1 },
    { kind: "clock", side: "E", at: 4, y: 2.4 },
  ],
});

/**
 * One-bedroom flat: bedroom, living room, kitchen, bathroom and separate toilet.
 * 14 x 12 cells. The passage links the kitchen and wet rooms to the living area.
 */
const flat1 = plan({
  rows: [
    "BBBBBBBBLLLLLL",
    "BBBBBBBBLLLLLL",
    "BBBBBBBBLLLLLL",
    "BBBBBBBBLLLLLL",
    "BBBBBBBBLLLLLL",
    "BBBBBBBBLLLLLL",
    "BBBBBBBBPPPPPP",
    "BBBBBBBBPPPPPP",
    "BBBBBBBBPPPPPP",
    "KKKKKPPPTTTUUU",
    "KKKKKPPPTTTUUU",
    "KKKKKPPPTTTUUU",
  ],
  doors: [
    [7, 2, 8, 2],
    [7, 7, 8, 7],
    [4, 9, 5, 9],
    [7, 9, 8, 9],
    [10, 9, 11, 9],
  ],
  entry: { x: 6, z: 11, at: 6.5 },
  goal: [9, 7],
  windows: [
    { side: "N", at: 3.5, w: 1.5, h: 1.2 },
    { side: "N", at: 10.5, w: 1.5, h: 1.2 },
    { side: "W", at: 3, w: 1.1, h: 1.1 },
    { side: "E", at: 3, w: 1.1, h: 1.1 },
    { side: "S", at: 2, w: 1.5, h: 1.2 },
  ],
  decor: [
    { kind: "ac", side: "N", at: 5.5, y: 2.45 },
    { kind: "poster", n: 1, side: "N", at: 1.5 },
    { kind: "clock", side: "E", at: 5, y: 2.4 },
  ],
});

/**
 * Two-bedroom flat: two bedrooms, living room, kitchen, bathroom and separate toilet.
 * 16 x 14 cells. Each bedroom has its own doorway into the shared living/passage area.
 */
const flat2 = plan({
  rows: [
    "1111111122222222",
    "1111111122222222",
    "1111111122222222",
    "1111111122222222",
    "1111111122222222",
    "1111111122222222",
    "PPPPPPPPLLLLLLLL",
    "PPPPPPPPLLLLLLLL",
    "PPPPPPPPLLLLLLLL",
    "PPPPPPPPLLLLLLLL",
    "KKKKKKPPPTTTUUUU",
    "KKKKKKPPPTTTUUUU",
    "KKKKKKPPPTTTUUUU",
    "KKKKKKPPPTTTUUUU",
  ],
  legend: {
    1: ["bed1", "bed", "Bedroom 1"],
    2: ["bed2", "bed", "Bedroom 2"],
  },
  doors: [
    [3, 5, 3, 6],
    [11, 5, 11, 6],
    [7, 7, 8, 7],
    [5, 10, 6, 10],
    [8, 10, 9, 10],
    [11, 10, 12, 10],
  ],
  entry: { x: 7, z: 13, at: 7.5 },
  goal: [7, 8],
  windows: [
    { side: "N", at: 3.5, w: 1.5, h: 1.2 },
    { side: "N", at: 11.5, w: 1.5, h: 1.2 },
    { side: "W", at: 3, w: 1.1, h: 1.1 },
    { side: "E", at: 3, w: 1.1, h: 1.1 },
    { side: "W", at: 8.5, w: 1.1, h: 1.1 },
    { side: "S", at: 2.5, w: 1.5, h: 1.2 },
    { side: "S", at: 13.5, w: 1.5, h: 1.2 },
  ],
  decor: [
    { kind: "ac", side: "N", at: 5, y: 2.45 },
    { kind: "ac", side: "N", at: 10, y: 2.45 },
    { kind: "poster", n: 2, side: "N", at: 1 },
    { kind: "poster", n: 3, side: "N", at: 14.5 },
    { kind: "clock", side: "S", at: 7.5, y: 2.4 },
  ],
});

// Keep the public IDs used by roomFor(), lib/room.js and the 3D room renderer.
export const LAYOUTS = {
  ojaja,
  offCampus,
  flat1,
  flat2,
};

export const HOME_SIZE = Object.fromEntries(
  Object.entries(LAYOUTS).map(([id, layout]) => [id, [layout.w, layout.d]]),
);

export const HOME_LAYOUT = {
  Ojaja: "ojaja",
  "Off-campus": "offCampus",
  "1-Bedroom Flat": "flat1",
  "2-Bedroom Flat": "flat2",
};

export const layoutIdFor = (hostel) => HOME_LAYOUT[hostel] ?? null;

export const layoutOf = (room) =>
  (room?.layout && LAYOUTS[room.layout]) || null;

export const zoneAt = (layout, x, z) => layout.grid[z]?.[x] ?? null;

const same = (a, b) => a && b && a.id === b.id;

/** A player can move within a zone freely, or between zones through a doorway. */
export function canStep(layout, a, b) {
  const zoneA = zoneAt(layout, a[0], a[1]);
  const zoneB = zoneAt(layout, b[0], b[1]);

  if (!zoneA || !zoneB) return false;

  return (
    same(zoneA, zoneB) ||
    layout.doorKeys.has(`${a[0]},${a[1]}|${b[0]},${b[1]}`)
  );
}

/** Cells that must remain clear so internal doors and the entrance stay usable. */
export function doorCellsOf(layout) {
  return [
    ...layout.doors.flatMap(([x1, z1, x2, z2]) => [
      [x1, z1],
      [x2, z2],
    ]),
    [layout.entry.x, layout.entry.z],
  ];
}

/** Bounding box of the room containing a cell; x1 and z1 are exclusive. */
export function zoneBox(layout, x, z) {
  const zone = zoneAt(layout, x, z);

  if (!zone) {
    return { x0: x, z0: z, x1: x + 1, z1: z + 1 };
  }

  let x0 = layout.w;
  let z0 = layout.d;
  let x1 = 0;
  let z1 = 0;

  for (let j = 0; j < layout.d; j++) {
    for (let i = 0; i < layout.w; i++) {
      if (same(layout.grid[j][i], zone)) {
        x0 = Math.min(x0, i);
        z0 = Math.min(z0, j);
        x1 = Math.max(x1, i + 1);
        z1 = Math.max(z1, j + 1);
      }
    }
  }

  return { x0, z0, x1, z1 };
}

/** Merge internal walls into straight runs and leave doorway gaps. */
export function wallRuns(layout) {
  const horizontal = [];
  const vertical = [];
  const doors = [];

  const isDoor = (x1, z1, x2, z2) =>
    layout.doorKeys.has(`${x1},${z1}|${x2},${z2}`);

  // Horizontal walls between rows.
  for (let z = 1; z < layout.d; z++) {
    for (let x = 0; x < layout.w; x++) {
      if (same(layout.grid[z - 1][x], layout.grid[z][x])) continue;

      if (isDoor(x, z - 1, x, z)) {
        doors.push({ x: x + 0.5, z, dir: "h" });
      } else {
        horizontal.push([z, x]);
      }
    }
  }

  // Vertical walls between columns.
  for (let x = 1; x < layout.w; x++) {
    for (let z = 0; z < layout.d; z++) {
      if (same(layout.grid[z][x - 1], layout.grid[z][x])) continue;

      if (isDoor(x - 1, z, x, z)) {
        doors.push({ x, z: z + 0.5, dir: "v" });
      } else {
        vertical.push([x, z]);
      }
    }
  }

  const merge = (cells, isHorizontal) => {
    cells.sort((a, b) => a[0] - b[0] || a[1] - b[1]);

    const runs = [];

    for (const [line, position] of cells) {
      const last = runs[runs.length - 1];

      if (last && last.line === line && last.end === position) {
        last.end = position + 1;
      } else {
        runs.push({
          line,
          start: position,
          end: position + 1,
        });
      }
    }

    return runs.map((run) =>
      isHorizontal
        ? {
            x1: run.start,
            z1: run.line,
            x2: run.end,
            z2: run.line,
          }
        : {
            x1: run.line,
            z1: run.start,
            x2: run.line,
            z2: run.end,
          },
    );
  };

  return {
    walls: [...merge(horizontal, true), ...merge(vertical, false)],
    doors,
  };
}
