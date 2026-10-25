// lib3d/vehicleSpecs.js
// The measurements of every car in the YK Autos showroom (lib/cars.js), keyed by car id. Metres, nose +z, y up, wheels on y = 0.
// Each car is described by its SIDE PROFILE (the outline of the body from the tail, over the roof line, to the nose), a few numbers that bend it into shape, its glass, its lamps and
// grille as flat shapes seen from the front or back, and its wheels. lib3d/vehicles.js turns this into a model. Overall sizes are the manufacturers' published ones, and the shapes
// follow the reference photographs of each car (the colour here is the car's colour in those photographs; the player's own paint replaces it).
//   L W H: overall length, width (without mirrors) and height. zf zr: where the front and rear axles are. wr: tyre radius. tw: tyre width. yb: height of the underside.
//   upper: the body outline from the tail to the nose ([z, y] pairs, starting and ending on the underside); the underside and the wheel arches are added.
//   warp: how the slab is bent: tum = how far the sides lean in at the top, sill = tuck under, nCut / tCut = how far the nose / tail corners are rounded in plan.
//   cabin: the glasshouse outline (belt line up to the roof), its width and lean. win: z ranges of the side windows. screens: the slanted edges that carry the windscreen / rear glass.
//   doors: z range [rear, front] of the two that open (left = the driver's) and of the two that stay shut (z0, z1, side).
//   decals: flat shapes on the nose (s: 1) or tail (s: -1), drawn for the left half and mirrored (m: 1). k = which part: lampF, lampR, trim, chrome, paint, accent, plate, dark.
const lamp = (x0, x1, y0, y1, rake = 0.03) => [[x0, y0], [x1, y0 + rake], [x1, y1], [x0, y1 - rake * 0.4]];
const bar = (hw, y, h) => [[-hw, y], [hw, y], [hw, y + h], [-hw, y + h]];
const trap = (y0, y1, w0, w1) => [[-w0, y0], [w0, y0], [w1, y1], [-w1, y1]];
const disc = (cx, cy, r, n = 14) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((i / n) * Math.PI * 2), cy + r * Math.sin((i / n) * Math.PI * 2)]);
const plate = (y, w = 0.26, h = 0.14) => ({ k: "plate", m: 0, s: -1, poly: bar(w, y, h), depth: 0.05 });
/** The three-pointed star on a Mercedes grille. */
const star = (cx, cy, r, s = 1) => [{ k: "chrome", m: 0, s, depth: 0.075, poly: disc(cx, cy, r) }, { k: "dark", m: 0, s, depth: 0.085, poly: disc(cx, cy, r * 0.84) },
  ...[90, 210, 330].map((a) => { const t = (a * Math.PI) / 180, c = Math.cos(t), d = Math.sin(t), w = r * 0.09; return { k: "chrome", m: 0, s, depth: 0.095, poly: [[cx - d * w, cy + c * w], [cx + c * r * 0.78 - d * w, cy + d * r * 0.78 + c * w], [cx + c * r * 0.78 + d * w, cy + d * r * 0.78 - c * w], [cx + d * w, cy - c * w]] }; })];
const sedanSeats = { seat: { x: -0.45, y: 0.5, z: -0.55 }, driver: { x: 0.42, y: 0.5, z: 0.12 } };
const suvSeats = { seat: { x: -0.48, y: 0.68, z: -0.6 }, driver: { x: 0.45, y: 0.68, z: 0.15 } };

export const CAR_SPECS = {
  // ---------------------------------------------------------------- Toyota Corolla LE (2011): the plain silver compact sedan
  "corolla-2011": {
    name: "Toyota Corolla", ref: "#b9bdc6", L: 4.54, W: 1.76, H: 1.465, zf: 1.32, zr: -1.28, wr: 0.31, tw: 0.205, wheel: { style: "steel", color: null }, yb: 0.17, gap: 0.055, bevel: 0.07,
    upper: [[-2.16, 0.17], [-2.24, 0.3], [-2.27, 0.45], [-2.27, 0.6], [-2.255, 0.8], [-2.17, 0.915], [-1.8, 0.965], [-1.55, 0.955], [0.55, 0.955], [0.66, 0.985], [1.2, 0.93], [1.9, 0.85], [2.2, 0.785], [2.27, 0.7], [2.265, 0.52], [2.22, 0.33], [2.14, 0.17]],
    warp: { y1: 0.5, y2: 0.96, tum: 0.085, sillY: 0.3, sill: 0.05, nz0: 1.5, nCut: 0.2, nTaper: 0.05, tz0: 1.5, tCut: 0.17, tTaper: 0.04 },
    cabin: { pts: [[-1.64, 0.92], [-1.64, 0.97], [-1.14, 1.43], [-0.95, 1.465], [-0.1, 1.468], [0.02, 1.455], [0.7, 0.975], [0.7, 0.92]], hw: 0.79, y0: 0.95, y1: 1.468, tum: 0.26, crown: 0.025, fz0: 0.1, fCut: 0.1, rz0: -1.0, rCut: 0.1 },
    win: [[-0.13, 0.56], [-1.12, -0.24], [-1.42, -1.17]], screens: { f: [[0.7, 0.975], [0.02, 1.455]], r: [[-1.64, 0.97], [-1.14, 1.43]] },
    doors: { left: [-0.15, 0.82], right: [-0.88, -0.18], extra: [[-0.88, -0.18, 1], [-0.15, 0.82, -1]] }, mirror: { z: 0.62, drop: 0.05 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: lamp(0.42, 0.74, 0.6, 0.745, 0.025) }, { k: "trim", m: 0, s: 1, poly: trap(0.5, 0.63, 0.34, 0.38) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.34, 0.585, 0.02) },
      { k: "chrome", m: 0, s: 1, depth: 0.08, poly: disc(0, 0.575, 0.045) }, { k: "trim", m: 0, s: 1, poly: trap(0.24, 0.4, 0.54, 0.6) }, { k: "lampR", m: 1, s: -1, poly: lamp(0.48, 0.76, 0.7, 0.83, 0.02) }, plate(0.5),
    ], ...sedanSeats,
  },
  // ---------------------------------------------------------------- Honda Accord EX-L V6 (2014): long, wide sedan with a sweeping roof and a chrome bar grille
  "accord-2014": {
    name: "Honda Accord", ref: "#5d5f69", L: 4.89, W: 1.85, H: 1.465, zf: 1.465, zr: -1.31, wr: 0.335, tw: 0.225, wheel: { style: "spoke5", color: null }, yb: 0.17, gap: 0.05, bevel: 0.07,
    upper: [[-2.3, 0.17], [-2.38, 0.34], [-2.445, 0.5], [-2.445, 0.62], [-2.43, 0.82], [-2.34, 0.935], [-2.0, 0.985], [-1.72, 0.995], [-1.45, 0.99], [0.5, 0.975], [0.64, 1.0], [1.3, 0.95], [2.0, 0.86], [2.36, 0.785], [2.445, 0.69], [2.44, 0.5], [2.38, 0.33], [2.3, 0.17]],
    warp: { y1: 0.5, y2: 0.98, tum: 0.085, sillY: 0.3, sill: 0.05, nz0: 1.6, nCut: 0.22, nTaper: 0.05, tz0: 1.7, tCut: 0.18, tTaper: 0.04 },
    cabin: { pts: [[-1.8, 0.93], [-1.8, 0.985], [-1.12, 1.425], [-0.92, 1.465], [-0.05, 1.468], [0.1, 1.455], [0.78, 0.985], [0.78, 0.93]], hw: 0.82, y0: 0.975, y1: 1.468, tum: 0.27, crown: 0.025, fz0: 0.1, fCut: 0.1, rz0: -1.05, rCut: 0.1 },
    win: [[-0.1, 0.62], [-1.15, -0.26], [-1.55, -1.2]], screens: { f: [[0.78, 0.985], [0.1, 1.455]], r: [[-1.8, 0.985], [-1.12, 1.425]] },
    doors: { left: [-0.18, 0.85], right: [-0.9, -0.22], extra: [[-0.9, -0.22, 1], [-0.18, 0.85, -1]] }, mirror: { z: 0.75, drop: 0.05 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: lamp(0.4, 0.78, 0.63, 0.77, 0.03) }, { k: "trim", m: 0, s: 1, poly: trap(0.52, 0.66, 0.5, 0.54) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.5, 0.64, 0.045) },
      { k: "dark", m: 0, s: 1, depth: 0.08, poly: disc(0, 0.665, 0.05) }, { k: "chrome", m: 0, s: 1, depth: 0.09, poly: disc(0, 0.665, 0.035) }, { k: "trim", m: 0, s: 1, poly: trap(0.24, 0.46, 0.6, 0.66) },
      { k: "lampR", m: 1, s: -1, poly: lamp(0.46, 0.8, 0.7, 0.86, 0.02) }, plate(0.5),
    ], ...sedanSeats,
  },
  // ---------------------------------------------------------------- Toyota Camry XLE V6 (2014): a boxier sedan with a big lower grille
  "camry-2014": {
    name: "Toyota Camry", ref: "#4c4f57", L: 4.85, W: 1.825, H: 1.47, zf: 1.445, zr: -1.33, wr: 0.33, tw: 0.225, wheel: { style: "spoke5", color: null }, yb: 0.17, gap: 0.05, bevel: 0.07,
    upper: [[-2.29, 0.17], [-2.37, 0.34], [-2.425, 0.5], [-2.425, 0.62], [-2.42, 0.86], [-2.34, 0.95], [-2.0, 0.99], [-1.7, 1.0], [-1.5, 0.995], [0.5, 0.98], [0.62, 1.0], [1.3, 0.94], [2.0, 0.85], [2.34, 0.775], [2.425, 0.68], [2.42, 0.5], [2.37, 0.33], [2.29, 0.17]],
    warp: { y1: 0.5, y2: 0.99, tum: 0.085, sillY: 0.3, sill: 0.05, nz0: 1.6, nCut: 0.2, nTaper: 0.05, tz0: 1.7, tCut: 0.17, tTaper: 0.04 },
    cabin: { pts: [[-1.72, 0.94], [-1.72, 0.99], [-1.15, 1.43], [-0.95, 1.47], [0, 1.472], [0.12, 1.46], [0.76, 0.99], [0.76, 0.94]], hw: 0.8, y0: 0.985, y1: 1.472, tum: 0.27, crown: 0.025, fz0: 0.1, fCut: 0.1, rz0: -1.0, rCut: 0.1 },
    win: [[-0.1, 0.6], [-1.12, -0.25], [-1.5, -1.17]], screens: { f: [[0.76, 0.99], [0.12, 1.46]], r: [[-1.72, 0.99], [-1.15, 1.43]] },
    doors: { left: [-0.18, 0.84], right: [-0.9, -0.22], extra: [[-0.9, -0.22, 1], [-0.18, 0.84, -1]] }, mirror: { z: 0.72, drop: 0.05 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: lamp(0.4, 0.76, 0.62, 0.76, 0.035) }, { k: "trim", m: 0, s: 1, poly: trap(0.5, 0.64, 0.4, 0.44) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.4, 0.625, 0.02) },
      { k: "chrome", m: 0, s: 1, depth: 0.08, poly: disc(0, 0.6, 0.04) }, { k: "trim", m: 0, s: 1, poly: trap(0.22, 0.46, 0.64, 0.7) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.6, 0.36, 0.015) },
      { k: "lampR", m: 1, s: -1, poly: lamp(0.44, 0.78, 0.68, 0.86, 0.03) }, plate(0.5),
    ], ...sedanSeats,
  },
  // ---------------------------------------------------------------- Lexus IS 350 (2014): low sport sedan with the spindle grille and a black B pillar
  "is350-2014": {
    name: "Lexus IS 350", ref: "#b7bbc3", L: 4.665, W: 1.81, H: 1.43, zf: 1.45, zr: -1.35, wr: 0.33, tw: 0.225, wheel: { style: "star", color: null }, yb: 0.15, gap: 0.04, bevel: 0.07,
    upper: [[-2.2, 0.15], [-2.29, 0.3], [-2.33, 0.45], [-2.33, 0.6], [-2.3, 0.82], [-2.22, 0.93], [-1.9, 0.985], [-1.6, 0.995], [-1.35, 0.99], [0.5, 0.975], [0.64, 0.995], [1.25, 0.93], [1.95, 0.82], [2.26, 0.72], [2.333, 0.62], [2.33, 0.45], [2.27, 0.28], [2.2, 0.15]],
    warp: { y1: 0.5, y2: 0.98, tum: 0.09, sillY: 0.3, sill: 0.05, nz0: 1.5, nCut: 0.24, nTaper: 0.06, tz0: 1.5, tCut: 0.2, tTaper: 0.05 },
    cabin: { pts: [[-1.66, 0.93], [-1.66, 0.985], [-1.0, 1.395], [-0.62, 1.43], [-0.1, 1.428], [0.05, 1.415], [0.74, 0.985], [0.74, 0.93]], hw: 0.79, y0: 0.98, y1: 1.43, tum: 0.3, crown: 0.02, fz0: 0.1, fCut: 0.1, rz0: -1.0, rCut: 0.12 },
    win: [[-0.08, 0.58], [-1.1, -0.2], [-1.4, -1.16]], screens: { f: [[0.74, 0.985], [0.05, 1.415]], r: [[-1.66, 0.985], [-1.0, 1.395]] },
    doors: { left: [-0.15, 0.82], right: [-0.88, -0.18], extra: [[-0.88, -0.18, 1], [-0.15, 0.82, -1]] }, mirror: { z: 0.66, drop: 0.05 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.46, 0.62], [0.8, 0.7], [0.8, 0.77], [0.52, 0.72], [0.46, 0.68]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: [[-0.36, 0.26], [0.36, 0.26], [0.52, 0.4], [0.3, 0.56], [0.4, 0.7], [-0.4, 0.7], [-0.3, 0.56], [-0.52, 0.4]] },
      { k: "chrome", m: 0, s: 1, depth: 0.07, poly: [[-0.4, 0.7], [0.4, 0.7], [0.42, 0.725], [-0.42, 0.725]] }, { k: "chrome", m: 0, s: 1, depth: 0.075, poly: disc(0, 0.72, 0.04) },
      { k: "trim", m: 0, s: 1, poly: trap(0.2, 0.3, 0.6, 0.64) }, { k: "lampR", m: 1, s: -1, poly: lamp(0.44, 0.8, 0.72, 0.84, 0.03) }, plate(0.52),
    ], ...sedanSeats,
  },
  // ---------------------------------------------------------------- Mercedes-Benz C-Class (the current W206): a short-overhang white sedan with the star in the grille
  "cclass-2016": {
    name: "Mercedes-Benz C-Class", ref: "#eef0f2", L: 4.751, W: 1.82, H: 1.437, zf: 1.52, zr: -1.345, wr: 0.335, tw: 0.225, wheel: { style: "star", color: null }, yb: 0.16, gap: 0.04, bevel: 0.07,
    upper: [[-2.25, 0.16], [-2.33, 0.3], [-2.375, 0.45], [-2.375, 0.66], [-2.35, 0.88], [-2.25, 0.965], [-1.9, 1.01], [-1.65, 1.02], [-1.4, 1.0], [0.5, 0.97], [0.64, 0.995], [1.3, 0.94], [2.0, 0.85], [2.3, 0.775], [2.375, 0.66], [2.37, 0.48], [2.31, 0.3], [2.22, 0.16]],
    warp: { y1: 0.5, y2: 0.99, tum: 0.085, sillY: 0.3, sill: 0.05, nz0: 1.6, nCut: 0.24, nTaper: 0.06, tz0: 1.6, tCut: 0.2, tTaper: 0.05 },
    cabin: { pts: [[-1.62, 0.96], [-1.62, 1.01], [-1.0, 1.395], [-0.75, 1.437], [-0.08, 1.432], [0.08, 1.42], [0.72, 0.99], [0.72, 0.96]], hw: 0.8, y0: 0.995, y1: 1.437, tum: 0.28, crown: 0.02, fz0: 0.1, fCut: 0.1, rz0: -1.0, rCut: 0.12 },
    win: [[-0.1, 0.56], [-1.12, -0.2], [-1.4, -1.16]], screens: { f: [[0.72, 0.99], [0.08, 1.42]], r: [[-1.62, 1.01], [-1.0, 1.395]] },
    doors: { left: [-0.16, 0.84], right: [-0.9, -0.2], extra: [[-0.9, -0.2, 1], [-0.16, 0.84, -1]] }, mirror: { z: 0.66, drop: 0.05 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.46, 0.7], [0.8, 0.78], [0.8, 0.83], [0.5, 0.775]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: trap(0.46, 0.7, 0.4, 0.46) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.36, 0.62, 0.012) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.38, 0.53, 0.012) },
      ...star(0, 0.675, 0.075), { k: "trim", m: 0, s: 1, poly: trap(0.18, 0.4, 0.62, 0.7) }, { k: "lampR", m: 1, s: -1, poly: lamp(0.46, 0.8, 0.72, 0.84, 0.03) }, plate(0.52),
    ], ...sedanSeats,
  },
  // ---------------------------------------------------------------- Mercedes-Benz GLE 350 (2018): a tall white SUV with chrome roof rails
  "gle-2018": {
    name: "Mercedes-Benz GLE", ref: "#f0f1f3", L: 4.924, W: 1.95, H: 1.772, zf: 1.532, zr: -1.463, wr: 0.39, tw: 0.275, wheel: { style: "spoke10", color: null }, yb: 0.22, gap: 0.06, bevel: 0.08,
    upper: [[-2.3, 0.22], [-2.4, 0.38], [-2.462, 0.5], [-2.462, 0.95], [-2.43, 1.1], [-2.0, 1.16], [-1.6, 1.17], [0.5, 1.155], [0.66, 1.18], [1.5, 1.11], [2.2, 1.03], [2.4, 0.97], [2.462, 0.84], [2.455, 0.55], [2.4, 0.4], [2.3, 0.22]],
    warp: { y1: 0.6, y2: 1.16, tum: 0.07, sillY: 0.35, sill: 0.04, nz0: 1.6, nCut: 0.22, nTaper: 0.05, tz0: 1.7, tCut: 0.2, tTaper: 0.04 }, sillTrim: 0.3,
    cabin: { pts: [[-2.4, 1.12], [-2.4, 1.2], [-2.06, 1.7], [-1.9, 1.77], [-0.05, 1.775], [0.1, 1.762], [0.84, 1.19], [0.84, 1.12]], hw: 0.87, y0: 1.165, y1: 1.775, tum: 0.2, crown: 0.02, fz0: 0.2, fCut: 0.08, rz0: -1.2, rCut: 0.05 },
    win: [[-0.1, 0.74], [-1.2, -0.22], [-2.0, -1.28]], screens: { f: [[0.84, 1.19], [0.1, 1.762]], r: [[-2.4, 1.2], [-2.06, 1.7]] },
    doors: { left: [-0.26, 0.92], right: [-1.0, -0.3], extra: [[-1.0, -0.3, 1], [-0.26, 0.92, -1]] }, mirror: { z: 0.86, drop: 0.03 },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.46, 0.84], [0.84, 0.92], [0.84, 0.99], [0.5, 0.95]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: trap(0.5, 0.86, 0.46, 0.5) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.45, 0.77, 0.014) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.45, 0.66, 0.014) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.45, 0.55, 0.014) },
      ...star(0, 0.76, 0.1), { k: "trim", m: 0, s: 1, poly: trap(0.28, 0.46, 0.7, 0.76) }, { k: "chrome", m: 0, s: 1, depth: 0.06, poly: bar(0.62, 0.3, 0.02) }, { k: "lampR", m: 1, s: -1, poly: lamp(0.5, 0.86, 0.9, 1.02, 0.03) }, plate(0.62), { k: "trim", m: 0, s: -1, poly: trap(0.28, 0.46, 0.7, 0.76) },
    ],
    extras: ({ parts, K }) => { for (const side of [1, -1]) parts.add("chrome", K.strut([side * 0.7, 1.805, -1.85], [side * 0.7, 1.805, -0.15], 0.035, 0.04)); },
    ...suvSeats,
  },
  // ---------------------------------------------------------------- Range Rover Sport HSE (2016): big grey SUV, black glossy roof and pillars, fender vents
  "rrsport-2016": {
    name: "Range Rover Sport", ref: "#7e8186", L: 4.879, W: 1.983, H: 1.803, zf: 1.54, zr: -1.383, wr: 0.405, tw: 0.255, wheel: { style: "spoke5", color: "#303236" }, yb: 0.23, gap: 0.06, bevel: 0.08,
    upper: [[-2.3, 0.23], [-2.39, 0.4], [-2.44, 0.55], [-2.44, 0.98], [-2.41, 1.14], [-2.0, 1.2], [-1.6, 1.205], [0.55, 1.19], [0.72, 1.215], [1.5, 1.13], [2.2, 1.07], [2.4, 1.0], [2.44, 0.9], [2.44, 0.58], [2.39, 0.4], [2.3, 0.23]],
    warp: { y1: 0.6, y2: 1.2, tum: 0.07, sillY: 0.35, sill: 0.04, nz0: 1.6, nCut: 0.2, nTaper: 0.05, tz0: 1.7, tCut: 0.18, tTaper: 0.04 }, sillTrim: 0.3,
    cabin: { pts: [[-2.35, 1.17], [-2.35, 1.22], [-1.95, 1.7], [-1.78, 1.795], [-0.05, 1.803], [0.15, 1.79], [0.9, 1.23], [0.9, 1.17]], hw: 0.89, y0: 1.2, y1: 1.803, tum: 0.2, crown: 0.02, fz0: 0.3, fCut: 0.06, rz0: -1.2, rCut: 0.05 },
    pickCabin: () => "trim",
    win: [[-0.05, 0.78], [-1.15, -0.2], [-1.95, -1.3]], screens: { f: [[0.9, 1.23], [0.15, 1.79]], r: [[-2.35, 1.22], [-1.95, 1.7]] },
    doors: { left: [-0.26, 0.96], right: [-1.0, -0.3], extra: [[-1.0, -0.3, 1], [-0.26, 0.96, -1]] }, mirror: { z: 0.9, drop: 0.03, k: "trim" },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.5, 0.88], [0.86, 0.92], [0.86, 0.98], [0.54, 0.97]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: trap(0.58, 0.9, 0.48, 0.5) }, { k: "chrome", m: 0, s: 1, depth: 0.06, poly: bar(0.5, 0.88, 0.02) }, { k: "chrome", m: 0, s: 1, depth: 0.06, poly: bar(0.5, 0.57, 0.02) },
      { k: "chrome", m: 0, s: 1, depth: 0.075, poly: bar(0.3, 0.97, 0.03) }, { k: "trim", m: 0, s: 1, poly: trap(0.28, 0.5, 0.74, 0.8) }, { k: "chrome", m: 0, s: 1, depth: 0.06, poly: bar(0.66, 0.31, 0.02) },
      { k: "lampR", m: 1, s: -1, poly: [[0.52, 0.88], [0.86, 0.92], [0.86, 1.04], [0.54, 1.04]] }, plate(0.64), { k: "trim", m: 0, s: -1, poly: trap(0.28, 0.5, 0.74, 0.8) },
    ],
    extras: ({ parts, K, lowX }) => { for (const side of [1, -1]) parts.add("trim", K.sidePatch([[1.05, 0.86], [1.5, 0.82], [1.5, 0.96], [1.05, 1.0]], { xOf: lowX, side, lift: 0.006 })); },
    ...suvSeats,
  },
  // ---------------------------------------------------------------- Lamborghini Urus: a wedge of a super SUV, black wheels, red calipers, black hood vents
  "urus-2025": {
    name: "Lamborghini Urus", ref: "#c9e01c", L: 5.112, W: 2.016, H: 1.638, zf: 1.606, zr: -1.397, wr: 0.395, tw: 0.29, wheel: { style: "spoke10", color: "#16171a" }, caliper: "#c4161c", yb: 0.19, gap: 0.04, bevel: 0.08,
    upper: [[-2.4, 0.19], [-2.5, 0.34], [-2.556, 0.5], [-2.556, 0.95], [-2.52, 1.12], [-2.3, 1.2], [-1.9, 1.26], [-1.4, 1.24], [0.5, 1.19], [0.8, 1.21], [1.4, 1.14], [2.1, 1.03], [2.42, 0.92], [2.556, 0.75], [2.556, 0.5], [2.5, 0.34], [2.4, 0.19]],
    warp: { y1: 0.6, y2: 1.24, tum: 0.09, sillY: 0.35, sill: 0.05, nz0: 1.7, nCut: 0.3, nTaper: 0.08, tz0: 1.8, tCut: 0.22, tTaper: 0.06 },
    pickLower: (cx, cy, cz, nx, ny) => (ny < -0.55 || (cy < 0.28 && Math.abs(nx) > 0.5) || (cy < 0.32 && Math.abs(cz) > 2.2) || (ny > 0.6 && cz > 1.1 && cz < 1.9 && Math.abs(cx) > 0.18 && Math.abs(cx) < 0.5 && cy > 1.0) ? "trim" : "paint"),
    cabin: { pts: [[-2.25, 1.2], [-2.25, 1.27], [-1.1, 1.6], [-0.5, 1.638], [0.2, 1.632], [0.34, 1.61], [1.02, 1.215], [1.02, 1.17]], hw: 0.9, y0: 1.2, y1: 1.638, tum: 0.28, crown: 0.02, fz0: 0.4, fCut: 0.06, rz0: -1.4, rCut: 0.1 },
    pickCabin: (cx, cy, cz, nx, ny) => (ny > 0.55 && cz < 0.1 ? "trim" : "paint"),
    win: [[0.0, 0.92], [-1.15, -0.1], [-1.8, -1.25]], screens: { f: [[1.02, 1.215], [0.34, 1.61]], r: [[-2.25, 1.27], [-1.1, 1.6]] },
    doors: { left: [-0.2, 0.96], right: [-1.0, -0.25], extra: [[-1.0, -0.25, 1], [-0.2, 0.96, -1]] }, mirror: { z: 0.98, drop: 0.02, k: "trim" },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.5, 0.88], [0.96, 0.96], [0.96, 1.0], [0.52, 0.94]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: [[-0.5, 0.42], [0.5, 0.42], [0.62, 0.62], [0.5, 0.86], [-0.5, 0.86], [-0.62, 0.62]] },
      { k: "trim", m: 1, s: 1, depth: 0.05, poly: [[0.62, 0.34], [0.95, 0.4], [0.95, 0.62], [0.66, 0.6]] }, { k: "trim", m: 0, s: 1, poly: bar(0.9, 0.22, 0.1) }, { k: "dark", m: 0, s: 1, depth: 0.07, poly: bar(0.3, 0.62, 0.1) },
      { k: "lampR", m: 0, s: -1, poly: [[-0.95, 0.98], [0.95, 0.98], [0.95, 1.03], [-0.95, 1.03]] }, plate(0.56, 0.28, 0.15), { k: "trim", m: 0, s: -1, poly: bar(0.9, 0.24, 0.3) }, { k: "trim", m: 1, s: -1, poly: [[0.52, 0.3], [0.7, 0.3], [0.7, 0.4], [0.52, 0.4]] },
    ],
    extras: ({ parts, K, F }) => { for (const side of [1, -1]) parts.add("trim", K.surfBox(0.2, 0.012, 0.5, side * 0.34, 1.19, 1.62, F, [1, 1, 3])); },
    seat: { x: -0.48, y: 0.5, z: -0.5 }, driver: { x: 0.45, y: 0.5, z: 0.18 },
  },
  // ---------------------------------------------------------------- Lamborghini Huracan STO: low, wide, blue with orange accents and a big rear wing
  "huracan-2025": {
    name: "Lamborghini Huracan STO", ref: "#2f5da6", accent: "#ff7a1a", L: 4.549, W: 1.945, H: 1.22, zf: 1.37, zr: -1.25, wr: 0.365, tw: 0.29, wheel: { style: "star", color: "#17181b" }, caliper: "#ff7a1a", yb: 0.11, gap: 0.035, bevel: 0.06,
    upper: [[-2.1, 0.11], [-2.27, 0.2], [-2.27, 0.5], [-2.2, 0.72], [-1.9, 0.9], [-1.3, 0.97], [-0.7, 0.99], [-0.2, 0.97], [0.45, 0.82], [1.2, 0.7], [1.9, 0.6], [2.2, 0.5], [2.27, 0.38], [2.27, 0.22], [2.2, 0.11]],
    warp: { y1: 0.4, y2: 0.95, tum: 0.13, sillY: 0.25, sill: 0.08, nz0: 1.3, nCut: 0.42, nTaper: 0.2, nRnd: 2.2, tz0: 1.2, tCut: 0.34, tTaper: 0.14 }, doorLow: 0.2, sillTrim: 0.2,
    pickLower: (cx, cy, cz, nx, ny, nz) => (ny < -0.55 || (cy < 0.2 && Math.abs(nx) > 0.4) ? "trim" : (ny > 0.35 && cz > 0.6 && Math.abs(cx) < 0.42) || (ny > 0.3 && cz < -1.2 && cz > -2.0 && Math.abs(cx) < 0.5 && cy > 0.9) ? "trim" : cy < 0.3 && Math.abs(cz) > 1.9 && Math.abs(nz) > 0.4 ? "accent" : "paint"),
    cabin: { pts: [[-1.35, 0.9], [-1.35, 0.98], [-0.8, 1.17], [-0.45, 1.22], [0.0, 1.205], [0.25, 1.17], [0.75, 0.84], [0.75, 0.78]], hw: 0.72, y0: 0.88, y1: 1.22, tum: 0.28, crown: 0.02, fz0: 0.3, fCut: 0.06, rz0: -0.8, rCut: 0.05 },
    pickCabin: (cx, cy, cz, nx, ny) => (ny > 0.55 && cz < -0.7 ? "trim" : "paint"),
    win: [[-0.05, 0.62], [-1.0, -0.2]], screens: { f: [[0.75, 0.84], [0.25, 1.17]], r: [[-1.35, 0.98], [-0.8, 1.17]] },
    doors: { left: [-0.3, 0.64], right: [-0.3, 0.64], extra: [] }, mirror: { z: 0.55, drop: 0.0, y: 0.98, k: "trim" },
    decals: [
      { k: "lampF", m: 1, s: 1, poly: [[0.42, 0.52], [0.86, 0.58], [0.84, 0.62], [0.44, 0.58]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: [[-0.42, 0.2], [0.42, 0.2], [0.55, 0.34], [0.36, 0.5], [-0.36, 0.5], [-0.55, 0.34]] },
      { k: "accent", m: 1, s: 1, depth: 0.05, poly: [[0.45, 0.14], [0.9, 0.2], [0.9, 0.24], [0.45, 0.18]] }, { k: "trim", m: 1, s: 1, depth: 0.05, poly: [[0.62, 0.26], [0.9, 0.3], [0.88, 0.46], [0.64, 0.44]] },
      { k: "lampR", m: 1, s: -1, poly: [[0.2, 0.55], [0.8, 0.58], [0.8, 0.64], [0.2, 0.62]] }, { k: "trim", m: 0, s: -1, poly: bar(0.7, 0.2, 0.3) }, plate(0.34, 0.26, 0.13), { k: "accent", m: 1, s: -1, poly: [[0.1, 0.14], [0.8, 0.14], [0.8, 0.17], [0.1, 0.17]] },
    ],
    extras: ({ parts, K, F, lowX }) => {
      parts.add("trim", K.surfBox(1.78, 0.035, 0.38, 0, 1.12, -2.1, F, [8, 1, 1]));                     // the wing blade
      for (const side of [1, -1]) { parts.add("accent", K.surfBox(0.03, 0.2, 0.4, side * 0.9, 1.1, -2.1, F, [1, 1, 1])); parts.add("trim", K.strut([side * 0.32, 0.9, -1.85], [side * 0.32, 1.1, -2.08], 0.045)); }
      for (const side of [1, -1]) { parts.add("trim", K.sidePatch([[-0.95, 0.4], [-0.35, 0.44], [-0.35, 0.68], [-0.95, 0.7]], { xOf: lowX, side, lift: 0.006 })); parts.add("accent", K.sidePatch([[-0.1, 0.24], [1.0, 0.24], [1.0, 0.27], [-0.1, 0.27]], { xOf: lowX, side, lift: 0.007 })); }
    },
    seat: { x: -0.38, y: 0.32, z: -0.05 }, driver: { x: 0.38, y: 0.32, z: -0.05 },
  },
  // ---------------------------------------------------------------- Tesla Cybertruck AWD: flat stainless panels, one straight roof line
  "cybertruck-2024": {
    name: "Tesla Cybertruck", ref: "#aeb3ba", L: 5.683, W: 2.027, H: 1.791, zf: 1.88, zr: -1.93, wr: 0.44, tw: 0.285, wheel: { style: "aero", color: "#16181b" }, yb: 0.3, gap: 0.075, bevel: 0.03,
    upper: [[-2.7, 0.3], [-2.84, 0.5], [-2.84, 1.28], [0.55, 1.791], [1.95, 1.09], [2.84, 0.98], [2.84, 0.5], [2.74, 0.3]],
    warp: { y1: 1.2, y2: 1.79, tum: 0.1, sillY: 0.45, sill: 0.04, nz0: 2.5, nCut: 0.12, nTaper: 0.02, tz0: 2.5, tCut: 0.1, tTaper: 0.02 },
    cabin: null, belt: 1.2, upperPoly: [[-2.84, 1.2], [-2.84, 1.265], [0.55, 1.775], [1.95, 1.075], [1.95, 1.2]],
    pickLower: (cx, cy, cz, nx, ny, nz) => (ny < -0.55 || (cy < 0.5 && Math.abs(nx) > 0.5) || (cy < 0.62 && Math.abs(nz) > 0.5) ? "trim" : "paint"),
    sideWin: [[[0.46, 1.2], [0.62, 1.74], [1.6, 1.27], [1.6, 1.2]], [[-1.5, 1.2], [-1.5, 1.45], [0.34, 1.71], [0.34, 1.2]]],
    screens: { f: [[1.95, 1.09], [0.55, 1.791]] },
    doors: { left: [0.44, 1.62], right: [-1.5, 0.36], extra: [[-1.5, 0.36, 1], [0.44, 1.62, -1]] }, mirror: { z: 1.62, drop: 0.03, y: 1.2, k: "trim" },
    decals: [
      { k: "lampF", m: 0, s: 1, poly: bar(0.92, 0.955, 0.04), depth: 0.07 }, { k: "lampR", m: 0, s: -1, poly: bar(0.92, 1.0, 0.045), depth: 0.07 }, plate(0.7, 0.3, 0.15),
    ],
    seat: { x: -0.5, y: 0.78, z: -0.9 }, driver: { x: 0.5, y: 0.78, z: 0.55 },
  },
};

/** The OAU shuttle bus: a white Dongfeng C-series minibus (4.50 x 1.68 x 1.96 m, 3.05 m wheelbase, as in the reference photograph) with a sliding door on the kerb (right) side. */
export const BUS_SPEC = {
  name: "OAU Shuttle Bus", ref: "#f2f3f5", slide: true, L: 4.5, W: 1.68, H: 1.96, zf: 1.53, zr: -1.52, wr: 0.32, tw: 0.195, wheel: { style: "steel", color: "#cfd3d9" }, yb: 0.2, gap: 0.05, bevel: 0.06,
  upper: [[-2.1, 0.2], [-2.25, 0.34], [-2.25, 1.76], [-2.2, 1.92], [-2.0, 1.96], [0.9, 1.96], [1.0, 1.94], [1.55, 1.1], [2.0, 1.04], [2.2, 0.98], [2.25, 0.88], [2.25, 0.42], [2.14, 0.2]],
  warp: { y1: 0.5, y2: 1.96, tum: 0.05, sillY: 0.3, sill: 0.04, nz0: 1.7, nCut: 0.14, nTaper: 0.03, tz0: 1.7, tCut: 0.1, tTaper: 0.02 }, sillTrim: 0.28,
  cabin: null, belt: 1.0, upperPoly: [[-2.25, 1.0], [-2.25, 1.74], [-2.18, 1.9], [-2.0, 1.94], [0.9, 1.94], [1.0, 1.92], [1.55, 1.12], [1.55, 1.0]],
  sideWin: [[[0.36, 1.03], [0.36, 1.8], [1.05, 1.8], [1.12, 1.7], [1.42, 1.2], [1.42, 1.03]], [[-1.1, 1.03], [-1.1, 1.8], [0.22, 1.8], [0.22, 1.03]], [[-2.12, 1.03], [-2.12, 1.76], [-1.2, 1.8], [-1.2, 1.03]]],
  screens: { f: [[1.55, 1.1], [1.0, 1.94]], r: [[-2.25, 1.03], [-2.25, 1.8]] }, screenOpts: { f: { kx: 0.9, from: 0.04, to: 0.95 }, r: { kx: 0.88, from: 0, to: 1, dir: -1 } },
  doors: { left: [0.3, 1.14], right: [-1.12, 0.22], extra: [[0.3, 1.14, -1]] }, mirror: { z: 1.38, y: 1.28, out: 0.1, k: "trim" }, handle: "chrome",
  pickLower: (cx, cy, cz, nx, ny, nz) => (ny < -0.55 || (cy < 0.28 && Math.abs(nx) > 0.5) || (cy < 0.36 && Math.abs(nz) > 0.5 && Math.abs(cz) > 2.1) ? "trim" : "paint"),
  decals: [
    { k: "lampF", m: 1, s: 1, poly: [[0.46, 0.6], [0.8, 0.62], [0.8, 0.86], [0.46, 0.86]] }, { k: "trim", m: 0, s: 1, depth: 0.05, poly: [[-0.42, 0.56], [0.42, 0.56], [0.42, 0.86], [-0.42, 0.86]] },
    { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.4, 0.78, 0.03) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.4, 0.69, 0.03) }, { k: "chrome", m: 0, s: 1, depth: 0.07, poly: bar(0.4, 0.6, 0.03) },
    { k: "chrome", m: 0, s: 1, depth: 0.085, poly: disc(0, 0.72, 0.075) }, { k: "dark", m: 0, s: 1, depth: 0.095, poly: disc(0, 0.72, 0.05) },
    { k: "trim", m: 0, s: 1, poly: trap(0.34, 0.5, 0.7, 0.74) }, { k: "lampF", m: 1, s: 1, poly: [[0.62, 0.38], [0.76, 0.38], [0.76, 0.46], [0.62, 0.46]], depth: 0.055 },
    { k: "lampR", m: 1, s: -1, poly: [[0.62, 0.7], [0.8, 0.7], [0.8, 1.45], [0.62, 1.45]] }, plate(0.52, 0.26, 0.13), { k: "trim", m: 0, s: -1, poly: bar(0.7, 0.3, 0.1) },
  ],
  seat: { x: -0.45, y: 0.62, z: -0.4 }, driver: { x: 0.4, y: 0.7, z: 1.0 },
};
export const specFor = (id) => CAR_SPECS[id] ?? null;
