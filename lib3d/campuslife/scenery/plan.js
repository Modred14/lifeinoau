// lib3d/campuslife/scenery/plan.js
// Where the planting stands, in METRES: the real tree and shrub positions of the Campuslife campus, plus rocks, grass tufts and a few flower beds, kept off everything the game's map has: buildings, roads,
// footpaths, water, car parks, pitches, the two grounds, places, billboards and the expressway. Adapted from campus/client/game/scenery/plan.ts (commit c2b9477). Pure JS, deterministic.
// Trees and palms are the same whatever the density (every player must meet the same trunks: lib3d/campuslife/decor.js makes them solid); density only thins the small plants, which stay walk-through.
export const SCATTER_KINDS = ["tree", "palm", "bush", "scrub", "rock", "tuft", "flower", "bed"];
export const SCATTER_STRIDE = 5;   // x, z, scale, yaw, tint
export const SCATTER_CHUNK_M = 250;
export const BED_SIZE = { radiusX: 4.8, radiusZ: 2.1 };
/** Clear distance (m) from roads and from buildings, per kind. */
export const CLEAR = { tree: { road: 2.8, building: 4.2 }, palm: { road: 2.4, building: 3 }, bush: { road: 1.9, building: 1.7 }, scrub: { road: 2.4, building: 2.2 }, rock: { road: 1.9, building: 2 }, tuft: { road: 1.4, building: 1 }, flower: { road: 1.4, building: 1 }, bed: { road: 1.2, building: 1.2 } };
const SEED = 20261006, CELL = 8, GRID = 32;
const BED_PLACES = [["oduduwa", 2], ["sub", 2], ["amphitheatre", 1], ["library", 2], ["senate", 1], ["f_law", 1], ["f_education", 1], ["f_technology", 1], ["f_pharmacy", 1]];

function hash(a, b, c) { let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + SEED) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const treeScale = (h) => Math.min(2.3, Math.max(0.75, 0.55 + h * 0.075)), palmScale = (h) => Math.min(1.5, Math.max(0.8, h / 7)), scrubScale = (h) => 0.9 + h * 0.3;
const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
const segD = (x, z, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };

/** A grid of shapes, so a point only meets the shapes near it. */
function index(shapes) {
  const cells = new Map();
  for (const s of shapes) for (let i = Math.floor(s.x0 / GRID); i <= Math.floor(s.x1 / GRID); i++) for (let j = Math.floor(s.z0 / GRID); j <= Math.floor(s.z1 / GRID); j++) { const k = i * 100003 + j; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(s); }
  return (x, z, test) => (cells.get(Math.floor(x / GRID) * 100003 + Math.floor(z / GRID)) ?? []).some(test);
}
const shape = (pts, pad, extra) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0: x0 - pad, z0: z0 - pad, x1: x1 + pad, z1: z1 + pad, pts, ...extra }; };
const nearRing = (x, z, s, m) => x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1 && (inRing(x, z, s.pts) || (s.holes ?? []).some((h) => h.some((a, i) => segD(x, z, a, h[(i + 1) % h.length]) < m)) || s.pts.some((a, i) => segD(x, z, a, s.pts[(i + 1) % s.pts.length]) < m));

/** Big outlines with holes (the road polygons ring whole blocks), asked "is this point on it, or within m of its edge?". Edges are kept in z bands (for inside) and a grid (for distance), so a question costs a few edges, not thousands. */
function regions(polys, reach = 4) {
  const made = polys.map(({ pts, holes = [] }) => {
    const bands = new Map(), segs = [];
    for (const ring of [pts, ...holes]) for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], e = shape([a, b], reach); segs.push(e);
      for (let j = Math.floor(Math.min(a[1], b[1]) / GRID); j <= Math.floor(Math.max(a[1], b[1]) / GRID); j++) { let l = bands.get(j); if (!l) bands.set(j, (l = [])); l.push(e.pts); }
    }
    return { bands, near: index(segs) };
  });
  const within = (r, x, z) => { let c = false; for (const [a, b] of r.bands.get(Math.floor(z / GRID)) ?? []) if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; return c; };
  return (x, z, m) => made.some((r) => within(r, x, z) || r.near(x, z, (e) => segD(x, z, e.pts[0], e.pts[1]) < m));
}

/** data: the merged game map. treesOnly: just the trees and palms. look: oau-campuslife.json. keepOut: [[x, z, radius]] circles to leave bare. density 0..1. Returns { chunks: [{ cx, cz, items: { kind: [x, z, scale, yaw, tint, ...] } }], counts, beds }. */
export function planScatter(data, look, { density = 1, keepOut = [], treesOnly = false, chunkSize = SCATTER_CHUNK_M } = {}) {
  const b = data.bounds;
  const buildings = index(data.buildings.map((q) => shape(q.pts, 5)));
  const onRoad = regions(data.roads);   // (inside a hole, away from its edge, is not on the road)
  const pathSegs = []; for (const p of look.paths) for (let i = 0; i + 1 < p.pts.length; i++) pathSegs.push(shape([p.pts[i], p.pts[i + 1]], p.w / 2 + 3, { half: p.w / 2 }));
  const paths = index(pathSegs), onPath = (x, z, m) => paths(x, z, (s) => segD(x, z, s.pts[0], s.pts[1]) < s.half + m);
  const hardShapes = ["water", "pitch", "parking", "sports"].flatMap((k) => (data.areas[k] ?? []).map((a) => shape(a.pts, 2)));
  for (const G of Object.values(data.grounds ?? {})) if (Number.isFinite(G?.x0)) hardShapes.push(shape([[G.x0 - 6, G.z0 - 6], [G.x1 + 6, G.z0 - 6], [G.x1 + 6, G.z1 + 14], [G.x0 - 6, G.z1 + 14]], 2));
  const hard = index(hardShapes), lawns = index((data.areas.park ?? []).map((a) => shape(a.pts, 0)));
  const circles = [...keepOut];
  for (const p of data.places) circles.push([p.x, p.z, p.kind === "billboard" ? 30 : 5]);
  if (data.gate) circles.push([data.gate.x, data.gate.z, 22]);
  const bare = index(circles.map(([x, z, r]) => ({ x0: x - r, z0: z - r, x1: x + r, z1: z + r, x, z, r })));
  const clear = (kind, x, z) => {
    if (x < b.x0 + 2 || z < b.z0 + 2 || x > b.x1 - 2 || z > b.z1 - 2) return false;
    const c = CLEAR[kind];
    return !onRoad(x, z, c.road) && !onPath(x, z, Math.min(c.road, 1.6)) && !buildings(x, z, (s) => nearRing(x, z, s, c.building)) && !hard(x, z, (s) => nearRing(x, z, s, kind === "tuft" ? 0.1 : 1)) && !bare(x, z, (s) => Math.hypot(s.x - x, s.z - z) < s.r);
  };

  const chunks = new Map(), counts = Object.fromEntries(SCATTER_KINDS.map((k) => [k, 0])), beds = [];
  const bedPoint = (bed, x, z) => { const c = Math.cos(bed.yaw), s = Math.sin(bed.yaw); return [bed.x + x * c + z * s, bed.z - x * s + z * c]; };
  const inBed = (bed, x, z, m) => { const dx = x - bed.x, dz = z - bed.z, c = Math.cos(bed.yaw), s = Math.sin(bed.yaw); return ((dx * c - dz * s) / (BED_SIZE.radiusX + m)) ** 2 + ((dx * s + dz * c) / (BED_SIZE.radiusZ + m)) ** 2 <= 1; };
  const bedFits = (bed) => { if (beds.some((o) => Math.hypot(o.x - bed.x, o.z - bed.z) < 15)) return false; for (let x = -BED_SIZE.radiusX; x <= BED_SIZE.radiusX + 0.01; x += 1.2) for (let z = -BED_SIZE.radiusZ; z <= BED_SIZE.radiusZ + 0.01; z += 0.7) if (!clear("bed", ...bedPoint(bed, x, z))) return false; return true; };
  for (const [id, count] of BED_PLACES) {
    const p = data.places.find((q) => q.id === id); if (!p) continue;
    let made = 0;
    for (let r = 14; r <= 60 && made < count; r += 4) for (let k = 0; k < 16 && made < count; k++) { const a = (k / 16) * Math.PI * 2, bed = { x: p.x + Math.sin(a) * r, z: p.z + Math.cos(a) * r, yaw: a, place: id }; if (bedFits(bed)) { beds.push(bed); made++; } }
  }
  const put = (kind, x, z, scale, yaw, tint) => {
    if (!clear(kind, x, z)) return;
    if ((kind === "rock" || kind === "tuft" || kind === "scrub") && lawns(x, z, (s) => inRing(x, z, s.pts))) return;
    if (kind !== "bed" && kind !== "flower" && kind !== "bush" && beds.some((bed) => inBed(bed, x, z, kind === "tree" || kind === "palm" ? 4.5 * scale : 1.5 * scale))) return;
    const i = Math.floor(x / chunkSize), j = Math.floor(z / chunkSize), key = i + "," + j;
    let chunk = chunks.get(key); if (!chunk) chunks.set(key, (chunk = { cx: (i + 0.5) * chunkSize, cz: (j + 0.5) * chunkSize, items: Object.fromEntries(SCATTER_KINDS.map((k) => [k, []])) }));
    chunk.items[kind].push(x, z, scale, yaw, tint); counts[kind]++;
  };
  for (const [i, bed] of treesOnly ? [] : beds.entries()) {
    put("bed", bed.x, bed.z, 1, bed.yaw, 0.5);
    for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) put("bush", ...bedPoint(bed, x, -0.85), 0.62, bed.yaw, 0.5);
    const spacing = density < 1 ? 0.8 : 0.55;
    for (let row = 0; row < 3; row++) for (let x = -3.6 + ((row % 2) * spacing) / 2, col = 0; x <= 3.6; x += spacing, col++) { const z = -0.05 + row * 0.55; if ((x / 4.1) ** 2 + (z / 1.45) ** 2 > 1) continue; put("flower", ...bedPoint(bed, x, z), 0.9 + hash(i, row, col) * 0.2, bed.yaw + hash(i, col, row) * 0.4, hash(i, row, col + 10)); }
  }
  for (let i = 0; i < look.trees.length; i += 3) {
    const mx = look.trees[i], mz = look.trees[i + 1], h = look.trees[i + 2], r = (n) => hash(mx, mz, n);
    const palm = h >= 6 && h <= 16 && r(40) < 0.22;
    put(palm ? "palm" : "tree", mx + r(31), mz + r(32), palm ? palmScale(h) : treeScale(h), r(34) * Math.PI * 2, r(35));
  }
  for (let i = 0; i < (treesOnly ? 0 : look.shrubs.length); i += 3) { const mx = look.shrubs[i], mz = look.shrubs[i + 1], r = (n) => hash(mx, mz, n); if (r(60) >= density) continue; put("scrub", mx + r(61), mz + r(62), scrubScale(look.shrubs[i + 2]) * (0.9 + r(63) * 0.2), r(64) * Math.PI * 2, r(65)); }
  // rocks and grass tufts: more of them beside roads and paths
  const verge = (x, z) => onRoad(x, z, 3.9) || onPath(x, z, 3);
  for (let gz = 0; !treesOnly && gz * CELL < b.z1; gz++) for (let gx = 0; gx * CELL < b.x1; gx++) {
    const r = (n) => hash(gx, gz, n), x0 = gx * CELL, z0 = gz * CELL;
    if (r(50) >= 0.016 * density && r(80) >= 0.2 * density) continue;
    const near = verge(x0 + CELL / 2, z0 + CELL / 2), lawn = lawns(x0 + CELL / 2, z0 + CELL / 2, (s) => inRing(x0 + CELL / 2, z0 + CELL / 2, s.pts)); if (lawn) continue;
    if (r(50) < (near ? 0.012 : 0.016) * density) { const n = 1 + Math.floor(r(51) * 2.4), bx = x0 + r(52) * CELL, bz = z0 + r(53) * CELL; for (let k = 0; k < n; k++) put("rock", bx + (r(54 + k) - 0.5) * 2.2, bz + (r(58 + k) - 0.5) * 2.2, 0.5 + r(62 + k) * 1.3, r(66 + k) * Math.PI * 2, r(70 + k)); }
    if (r(80) < (near ? 0.2 : 0.04) * density) { const n = 1 + Math.floor(r(81) * 2.5); for (let k = 0; k < n; k++) put("tuft", x0 + r(86 + k) * CELL, z0 + r(90 + k) * CELL, 0.7 + r(94 + k) * 0.8, r(98 + k) * Math.PI * 2, r(106 + k) * 0.99); }
  }
  return { chunks: [...chunks.values()], counts, beds, chunkSize };
}
