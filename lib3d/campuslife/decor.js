// lib3d/campuslife/decor.js
// The solid decoration of the Campuslife look: which trees stand, and where the food stalls, hawkers' trays, banners and the Main Gate are put ON THE GAME'S OWN MAP. Pure JS (no three.js).
// lib3d/worldsvc.js runs it once and makes each of these solid; lib3d/campuslife/index.js draws exactly the same list (graph.campusDecor), so what you see is what you bump into.
//
// The positions come from Campuslife (commit c2b9477). The game's roads, doors and furniture differ from that campus, so nothing may stand on a road or its pavement, against a wall, on a lamp, in front
// of a door or on the walk from a door to its kerb: a stall, tray or banner that would is moved to the nearest clear ground (and left out if there is none close by), a tree is left out. Every solid is tagged { decor: true, at }: a home compound clears the ones in its yard
// (lib3d/homeCompound.js) and the search for a home lot ignores them all (lib3d/homeLot.js).
import { planScatter, SCATTER_STRIDE } from "./scenery/plan.js";
import { BANNER_SIZES } from "./banners.js";
import { destinationOf } from "../roadnet.js";
import { corridorKeepOut, connectorKeepOut } from "../highway.js";

/** Clear room (m) round each building's door and the ground in front of it, and either side of the walk from there to the kerb. */
export const APPROACH = { tree: { door: 7, walk: 3.5 }, prop: { door: 4.5, walk: 2.5 } };
/** Trunk radius (m) at scale 1, as drawn (scenery/meshes.js). */
export const TRUNK = { tree: 0.27, palm: 0.22 };
/** The walking planner may pass this much closer to decoration than to a wall (lib3d/collide.js `soft`). It is still as solid as a wall to everything that moves. */
const SOFT = 0.75;
export const GATE_PILLAR = 3.2, GATEHOUSE = { along: 8, half: 1.5 };
/** How far (m) a prop may be moved from its Campuslife spot to find clear ground, and the room (m) kept between neighbours. */
export const NUDGE = { stall: 18, tray: 12, banner: 14, cross: 24 };
const GAP = { stall: 3.6, tray: 2.5, banner: 2.2 };
export const treeKey = (x, z) => Math.round(x * 100) + "," + Math.round(z * 100);
export const plantingKeepOut = () => corridorKeepOut().concat(connectorKeepOut());

const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };
/** A hash grid of points or short segments: near(x, z, r) is true if any of them lies within r (r up to the cell size). */
function grid(cell = 12) {
  const m = new Map(), key = (i, j) => i * 100003 + j;
  const add = (ax, az, bx = ax, bz = az) => { for (let i = Math.floor((Math.min(ax, bx) - cell) / cell); i <= Math.floor((Math.max(ax, bx) + cell) / cell); i++) for (let j = Math.floor((Math.min(az, bz) - cell) / cell); j <= Math.floor((Math.max(az, bz) + cell) / cell); j++) { const k = key(i, j); let l = m.get(k); if (!l) m.set(k, (l = [])); l.push([ax, az, bx, bz]); } };
  const near = (x, z, r) => (m.get(key(Math.floor(x / cell), Math.floor(z / cell))) ?? []).some(([ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - ax - dx * t, z - az - dz * t) < r; });
  return { add, near };
}

const askFor = (placeAt, b) => placeAt.get(b.id) ?? { id: "bld_" + b.id, bid: b.id };
/** The doors of the hostel compounds (the buildings the look draws as separate blocks inside a wall): the map draws a gate there. */
function compoundDoors(data, look, net) {
  const probe = { ...net, doors: new Map(net.doors) }, placeAt = new Map(); for (const p of data.places) if (p.bid != null && !placeAt.has(p.bid)) placeAt.set(p.bid, p);
  return look.buildings.filter((r) => r.parts).flatMap((r) => { const b = data.buildings.find((q) => inRing(r.x, r.z, q.pts)), d = b && destinationOf(probe, askFor(placeAt, b)); return d ? [{ x: d.door.x, z: d.door.z, nx: d.door.nx, nz: d.door.nz }] : []; });
}
/** Where people come and go: the door fronts and the walks to the kerb, of every building and every place. */
function approaches(data, net) {
  const doors = grid(), walks = grid(), probe = { ...net, doors: new Map(net.doors) };   // (a copy of the door cache: asking here must not decide what the game is told later)
  const placeAt = new Map(); for (const p of data.places) if (p.bid != null && !placeAt.has(p.bid)) placeAt.set(p.bid, p);
  const asks = data.buildings.map((b) => askFor(placeAt, b)).concat(data.places.filter((p) => p.bid == null && p.kind !== "billboard"));
  for (const ask of asks) {
    const d = destinationOf(probe, ask); if (!d) continue;
    doors.add(d.door.x, d.door.z); doors.add(d.front.x, d.front.z);
    if (Math.hypot(d.kerb.x - d.front.x, d.kerb.z - d.front.z) < 80) walks.add(d.front.x, d.front.z, d.kerb.x, d.kerb.z);
  }
  return (x, z, kind) => doors.near(x, z, APPROACH[kind].door) || walks.near(x, z, APPROACH[kind].walk);
}

/** The posts of a banner and what of it blocks the way, in metres: { posts: [[x, z, r]], rect: ring or null, feet: [[x, z]] } for { k, x, z, f, s }. */
export function bannerShape(b) {
  const size = BANNER_SIZES[b.k], hw = size.width / 2, ax = -Math.sin(b.f), az = Math.cos(b.f), at = (u, v = 0) => [b.x + ax * u + Math.cos(b.f) * v, b.z + az * u + Math.sin(b.f) * v];
  const post = (u, r) => [...at(u), r];
  if (b.k === "cross") { const posts = [-1, 1].map((s) => post((s * b.s) / 2, 0.1)); return { posts, rect: null, feet: posts }; }
  if (b.k === "billboard") { const posts = [-1, 1].map((s) => post(s * hw * 0.55, 0.2)); return { posts, rect: null, feet: [at(-hw), at(0), at(hw)] }; }
  if (b.k === "flags") { const posts = Array.from({ length: size.cols }, (_, i) => post(-hw + (i * size.width) / Math.max(1, size.cols - 1), 0.08)); return { posts, rect: null, feet: posts }; }
  const half = hw + 0.1, thick = b.k === "aframe" ? 0.3 : 0.1, n = Math.ceil(half), feet = Array.from({ length: n * 2 + 1 }, (_, i) => at((i / n - 1) * half));
  return { posts: [], rect: [at(-half, -thick), at(half, -thick), at(half, thick), at(-half, thick)], feet };
}

/** The points of a prop that decide whether it is in somebody's yard (collision and drawing both ask this). */
export const stallPoints = ([x, z, , , , [x0, z0, x1, z1]]) => [[x, z], [x0, z0], [x1, z0], [x1, z1], [x0, z1]];
export const bannerPoints = (b) => [[b.x, b.z], ...bannerShape(b).feet];
export const pointsOf = (p) => [[p.x, p.z], ...p.ring];

/**
 * The Main Gate across the entrance road, level with where Campuslife has it: a pillar outside each edge of the road (both carriageways), one on a wide enough median, a gatehouse beside it.
 * free(x, z, clear) says whether ground is clear. Returns { x, z, yaw (turns +x across the road), pillars: [{ x, z, tall, ring }], house: { x, z, ring } | null } or null where it does not fit.
 */
function placeGate(data, graph, free) {
  const G = data.gate; if (!G) return null;
  let best = null; const at = {};
  for (const e of graph.edges) { if (e.hw || e.lv || e.fixed || !(e.mask & 1)) continue; for (let s = 0; s <= e.len; s += 3) { e.path.at(s, at); const d = Math.hypot(at.x - G.x, at.z - G.z); if (!best || d < best.d) best = { d, e, s }; } }
  if (!best || best.d > 80) return null;
  const surf = {}, e = best.e;
  for (const shift of [0, 6, -6, 12, -12, 18, -18, 24, -24, 32, -32]) {
    const s = best.s + shift; if (s < 2 || s > e.len - 2) continue;
    const c = e.path.at(s, {}), ux = -c.hz, uz = c.hx, px = (u) => [c.x + ux * u, c.z + uz * u];
    // the runs of road and pavement along the line across, joined to the one under the gate when the grass between them is narrow
    const runs = []; for (let u = -60; u <= 60; u += 0.5) { const on = graph.surfaceAt(...px(u), surf).cls !== 0; if (!on) continue; const last = runs.at(-1); if (last && u - last[1] <= 0.75) last[1] = u; else runs.push([u, u]); }
    let lo = runs.findIndex((r) => r[0] <= 0 && r[1] >= 0); if (lo < 0) continue; let hi = lo;
    while (lo > 0 && runs[lo][0] - runs[lo - 1][1] < 30) lo--; while (hi < runs.length - 1 && runs[hi + 1][0] - runs[hi][1] < 30) hi++;
    const off = GATE_PILLAR / 2 + 0.6, spots = [{ u: runs[lo][0] - off, tall: false }, { u: runs[hi][1] + off, tall: false }];
    if (spots[1].u - spots[0].u > 55) continue;   // too wide for an arch
    for (let i = lo; i < hi; i++) if (runs[i + 1][0] - runs[i][1] >= 2 * off) { spots.splice(1, 0, { u: (runs[i][1] + runs[i + 1][0]) / 2, tall: true }); break; }
    const square = (x, z, h) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (a * ux + b * c.hx) * h, z + (a * uz + b * c.hz) * h]);   // turned to stand square to the road
    const fits = (x, z) => [[x, z], ...square(x, z, GATE_PILLAR / 2)].every(([px_, pz_]) => free(px_, pz_, 0.2));
    const pillars = spots.map((p) => { const [x, z] = px(p.u); return { x, z, tall: p.tall }; });
    if (!pillars.every((p) => fits(p.x, p.z))) continue;
    const hx = pillars[0].x + c.hx * GATEHOUSE.along, hz = pillars[0].z + c.hz * GATEHOUSE.along;
    const house = fits(hx, hz) ? { x: hx, z: hz } : null;
    return { x: c.x, z: c.z, yaw: Math.atan2(-uz, ux), pillars: pillars.map((p) => ({ ...p, ring: square(p.x, p.z, GATE_PILLAR / 2) })), house: house && { ...house, ring: square(hx, hz, GATEHOUSE.half) } };
  }
  return null;
}

/**
 * Chooses the decoration and adds its solids to `world`. data: the merged game map; look: oau-campuslife.json; graph: the road graph (with its furniturePlan); net: lib3d/roadnet.js buildRoadNet(data).
 * Returns { trees: Set of treeKey(x, z) for every tree or palm that stands, stalls: [x, z, face, style, goods, rect, number], signs: [x, z, face, which stall], pitches (as in look, where they now stand), banners (look's, moved,
 * each with its number i), gate, doors (of the hostel compounds) }.
 */
export function addCampusDecor(world, { data, look, graph, net }) {
  const keepOut = plantingKeepOut(), plan = planScatter(data, look, { keepOut, treesOnly: true }), busy = approaches(data, net), surf = {};
  const furniture = grid(8); for (const [x, z] of graph.furniturePlan?.taken ?? []) furniture.add(x, z);
  const away = grid(32); for (const [x, z, r] of keepOut) for (let dx = -r; dx <= r; dx += 8) for (let dz = -r; dz <= r; dz += 8) if (Math.hypot(dx, dz) <= r) away.add(x + dx, z + dz);
  const hard = ["water", "pitch", "parking", "sports"].flatMap((k) => (data.areas[k] ?? []).map((a) => a.pts));
  for (const G of Object.values(data.grounds ?? {})) if (Number.isFinite(G?.x0)) hard.push([[G.x0 - 6, G.z0 - 6], [G.x1 + 6, G.z0 - 6], [G.x1 + 6, G.z1 + 14], [G.x0 - 6, G.z1 + 14]]);
  const hardBox = hard.map((p) => ({ p, x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), z0: Math.min(...p.map((q) => q[1])), z1: Math.max(...p.map((q) => q[1])) }));
  const onHard = (x, z) => hardBox.some((h) => x >= h.x0 && x <= h.x1 && z >= h.z0 && z <= h.z1 && inRing(x, z, h.p));
  const offRoad = (x, z, m) => [[0, 0], [m, 0], [-m, 0], [0, m], [0, -m], [m * 0.7, m * 0.7], [-m * 0.7, m * 0.7], [m * 0.7, -m * 0.7], [-m * 0.7, -m * 0.7]].every(([dx, dz]) => graph.surfaceAt(x + dx, z + dz, surf).cls === 0);
  const boards = data.places.filter((p) => p.kind === "billboard");
  const free = (x, z, m) => offRoad(x, z, m) && world.inside(x, z) < 0 && !world.blockedAt(x, z, m) && !onHard(x, z) && !away.near(x, z, 4);
  // `pts`: if any of these is in a home's yard, the whole thing makes way. `seeThrough`: only the gate is big enough to make the trip camera move round it (lib3d/collide.js raycast).
  const tag = (kind, pts) => ({ kind, decor: true, soft: SOFT, pts, seeThrough: !kind.startsWith("gate") });

  const gate = placeGate(data, graph, free);
  if (gate) {
    for (const p of gate.pillars) world.addPolygon(p.ring, tag("gate", pointsOf(p)));
    if (gate.house) world.addPolygon(gate.house.ring, tag("gatehouse", pointsOf(gate.house)));
  }
  const placed = grid(8);
  const clearFor = (pts, m) => pts.every(([x, z]) => !busy(x, z, "prop") && !boards.some((b) => Math.hypot(b.x - x, b.z - z) < 18) && free(x, z, m));
  /** The first shift [dx, dz] (m), nearest first, at which fits() holds and no other prop is within `gap` of (x, z); null if there is none within `reach`. */
  const shift = (x, z, reach, gap, fits) => {
    for (let r = 0; r <= reach; r += 1.5) for (let k = 0, n = r ? Math.ceil(r * 2.5) : 1; k < n; k++) { const a = (k / n) * Math.PI * 2, dx = Math.cos(a) * r, dz = Math.sin(a) * r; if (!placed.near(x + dx, z + dz, gap) && fits(dx, dz)) { placed.add(x + dx, z + dz); return [dx, dz]; } }
    return null;
  };

  const stalls = [], signs = [];
  (look.stalls ?? []).forEach(([x, z, face, style, goods, [x0, z0, x1, z1]], i) => {
    const ring = (dx, dz) => [[x0 + dx, z0 + dz], [x1 + dx, z0 + dz], [x1 + dx, z1 + dz], [x0 + dx, z1 + dz]];
    const by = shift(x, z, NUDGE.stall, GAP.stall, (dx, dz) => clearFor([[x + dx, z + dz], ...ring(dx, dz)], 0.6)); if (!by) return;
    const [dx, dz] = by, s = [x + dx, z + dz, face, style, goods, [x0 + dx, z0 + dz, x1 + dx, z1 + dz], i];
    world.addPolygon(ring(dx, dz), tag("stall", stallPoints(s))); stalls.push(s);
    for (const [sx, sz, sface] of look.signs ?? []) if (Math.hypot(sx - x, sz - z) < 1) signs.push([sx + dx, sz + dz, sface, stalls.length - 1]);   // a business centre's sign goes with its stall
  });

  const banners = [];
  /** A banner strung over a road: slid along the road, its posts set just beyond whatever road lies under it now. */
  const strung = (b) => {
    const nx = Math.cos(b.f), nz = Math.sin(b.f), ax = -nz, az = nx;
    for (const t of [0, 3, -3, 6, -6, 10, -10, 15, -15, NUDGE.cross, -NUDGE.cross]) {
      const cx = b.x + nx * t, cz = b.z + nz * t, on = (u) => graph.surfaceAt(cx + ax * u, cz + az * u, surf).cls !== 0;
      let start = null; for (const u of [0, 2, -2, 4, -4, 6, -6, 9, -9]) if (on(u)) { start = u; break; }
      if (start === null) continue;
      const edge = (dir) => { let u = start; while (Math.abs(u - start) < 26 && on(u)) u += dir * 0.5; return u + dir * 1.1; };
      const lo = edge(-1), hi = edge(1), mid = (lo + hi) / 2, span = hi - lo; if (span > 24) continue;
      const moved = { ...b, x: cx + ax * mid, z: cz + az * mid, s: span };
      if (placed.near(moved.x, moved.z, GAP.banner) || !clearFor(bannerShape(moved).feet, 0.5)) continue;
      placed.add(moved.x, moved.z); return moved;
    }
    return null;
  };
  (look.banners ?? []).forEach((b, i) => {
    let moved = null;
    if (b.k === "cross") moved = strung(b);
    else { const by = shift(b.x, b.z, NUDGE.banner, GAP.banner, (dx, dz) => clearFor(bannerShape({ ...b, x: b.x + dx, z: b.z + dz }).feet, 0.7)); if (by) moved = { ...b, x: b.x + by[0], z: b.z + by[1] }; }
    if (!moved) return;
    const shape = bannerShape(moved), t = tag("banner", bannerPoints(moved));
    for (const [x, z, r] of shape.posts) world.addPost(x, z, r, t);
    if (shape.rect) world.addPolygon(shape.rect, t);
    banners.push({ ...moved, i });
  });
  const pitches = [];
  for (const [x, z, yaw] of look.pitches ?? []) {
    const by = shift(x, z, NUDGE.tray, GAP.tray, (dx, dz) => clearFor([[x + dx, z + dz]], 0.8)); if (!by) continue;
    const at = [x + by[0], z + by[1]]; world.addPost(at[0], at[1], 0.45, tag("tray", [at])); pitches.push([...at, yaw]);
  }

  // trees: keep their trunks off the roads (2.4 m, as drawn), the furniture, the ways in and out, and the props
  const props = grid(); for (const i of world.decor) { const p = world.polys[i]; for (let k = 0; k < p.pts.length; k++) { const a = p.pts[k], b = p.pts[(k + 1) % p.pts.length]; props.add(a[0], a[1], b[0], b[1]); } }
  const trees = new Set(), planted = [];
  for (const chunk of plan.chunks) for (const kind of ["tree", "palm"]) {
    const items = chunk.items[kind];
    for (let i = 0; i < items.length; i += SCATTER_STRIDE) {
      const x = items[i], z = items[i + 1], r = TRUNK[kind] * items[i + 2];
      if (!offRoad(x, z, 2.4) || furniture.near(x, z, 3) || busy(x, z, "tree") || props.near(x, z, r + 1.6) || (gate && gate.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < 8)) || world.blockedAt(x, z, r + 0.3)) continue;
      planted.push([x, z, r, kind]); trees.add(treeKey(x, z));
    }
  }
  for (const [x, z, r, kind] of planted) world.addPost(x, z, r, tag("planted-" + kind, [[x, z]]));
  return { trees, stalls, signs, banners, pitches, gate, doors: compoundDoors(data, look, net) };
}
