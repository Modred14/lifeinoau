// lib3d/compoundWalk.js
// Walking about the home compound on foot, and getting into and out of the player's own vehicles. Pure JS (no three.js, no DOM): the 3D room (lib3d/room.js) draws what
// this says, and the tests walk every vehicle of every home through it.
//
//   walkWorld()     what a person cannot walk through: the house, the garage, the player's outdoor furniture, the hedges and the edge of the lawn, and every parked vehicle
//   walkField()     a walking route that goes round all of that with room to spare (a clearance-aware grid search, then the route is pulled straight wherever that is clear)
//   routeFromTo()   a route between any two points, indoors or out: inside the house the existing room planner (lib/room.js findPath), through the front door, then outdoors
//   standSpots()    where a person may stand beside a vehicle's doors (the existing lib3d/carexit.js exitSpots, plus: the door must have room to swing, and the spot is checked
//                   against every wall, vehicle and piece of furniture). The driver's side comes first.
//   planEntry()     which door to walk to, from where the person is now, and the route there (null route -> why not)
//   planExit()      where to step out: a safe spot beside the car that the person can walk on from (it is not a pocket that nothing can reach)
//
// Units: METRES in the plot frame (x east, z south, the origin is the corner of cell (0, 0): a room cell is CELL_M metres, see lib3d/compoundUnits.js). A vehicle is a slot
// of planParking(): { x, z (cells), yaw, len, wid (cells), modelId }. Heading is (sin yaw, cos yaw), the left of a vehicle (its driver's side) is +x in its own space.
import { plotFor } from "../lib/plot.js";
import { blockedCells, findPath } from "../lib/room.js";
import { layoutOf } from "../lib/layouts.js";
import { Heap } from "./roadgraph.js";
import { WALK_R } from "./walker.js";
import { exitSpots } from "./carexit.js";
import { circleHitsBody } from "./collide.js";
import { toWorld } from "./trafficsim.js";
import { CELL_M } from "./compoundUnits.js";
import { CAR_SPECS } from "./vehicleSpecs.js";

const M = CELL_M, FAMILY = "corolla-2011";
/** How far a car door swings open (radians): the same number the model uses (lib3d/vehicles.js DOOR_OPEN_ANGLE; a test keeps the two equal). */
export const DOOR_ANGLE = 1.15;
export { WALK_R };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------------------------------------------------------- vehicles
/** The box a parked vehicle covers, in metres: { x, z, hx, hz, len, wid, hl, hw }. */
export function carBoxOf(slot) {
  const hx = Math.sin(slot.yaw), hz = Math.cos(slot.yaw), len = slot.len * M, wid = slot.wid * M;
  return { x: slot.x * M, z: slot.z * M, hx, hz, len, wid, hl: len / 2, hw: wid / 2 };
}

/** Where the doors and the driver's seat of a model are, in the vehicle's own space (from its spec; an unknown model or the family car is the Corolla). */
export function doorsOf(modelId) {
  const S = CAR_SPECS[modelId] ?? CAR_SPECS[FAMILY], mid = (r) => (r[0] + r[1]) / 2;
  return { W: S.W, left: S.doors.left, right: S.doors.right, zL: mid(S.doors.left), zR: mid(S.doors.right), driver: S.driver ?? { x: 0.45, y: 0.5, z: 0.12 }, seat: S.seat ?? { x: -0.45, y: 0.5, z: -0.55 } };
}

// ---------------------------------------------------------------------------------------------------------------------------- the ground
/** Everything a person on foot cannot walk through, as a collision-world-like object (metres). `skipId`: a vehicle that is not an obstacle (the one being left, when it has already moved). */
export function walkWorld(cw, slots = [], { skipId = null } = {}) {
  const P = cw.P, pl = P.plot, clipZ = (r) => ({ ...r, z1: Math.min(r.z1, pl.z1) }), m = (r) => ({ x0: r.x0 * M, x1: r.x1 * M, z0: r.z0 * M, z1: r.z1 * M });
  // where a person may be: the lawn inside the hedges, the driveway, the footpath and the front walk (never beyond the boundary wall)
  const region = [cw.lawn, clipZ(P.drive), ...P.path.map(clipZ), clipZ(P.link)].map(m);
  // what they may not walk through: the house (its door is handled by routeFromTo), the garage, and every outdoor piece of furniture
  const ga = P.garage, solids = [{ x0: 0, x1: cw.W, z0: 0, z1: cw.D }, { x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, ...cw.solids.filter((s) => s.kind === "item")].map(m);
  const bodies = slots.filter((s) => skipId == null || String(s.id) !== String(skipId)).map((s) => ({ id: String(s.id), ...carBoxOf(s) }));
  const inRegion = (x, z) => { for (const r of region) if (x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && z >= r.z0 - 1e-9 && z <= r.z1 + 1e-9) return true; return false; };
  const RING = [[1, 0], [0.7071, 0.7071], [0, 1], [-0.7071, 0.7071], [-1, 0], [-0.7071, -0.7071], [0, -1], [0.7071, -0.7071]];
  /** A circle of radius r at (x, z) touches the hedges, the edge of the lawn, the house, the garage or a piece of furniture. (Static things only: like CollisionWorld.blockedAt.) */
  const blockedAt = (x, z, r = 0) => {
    if (!inRegion(x, z)) return true;
    if (r > 0) { // the whole circle must be on the ground: quick when it lies inside one rectangle, otherwise its rim is tested point by point
      let within = false; for (const q of region) if (x - r >= q.x0 && x + r <= q.x1 && z - r >= q.z0 && z + r <= q.z1) { within = true; break; }
      if (!within) for (const [dx, dz] of RING) if (!inRegion(x + dx * r, z + dz * r)) return true;
    }
    for (const s of solids) { const dx = Math.max(s.x0 - x, 0, x - s.x1), dz = Math.max(s.z0 - z, 0, z - s.z1); if (Math.hypot(dx, dz) < r || (dx === 0 && dz === 0)) return true; }
    return false;
  };
  const bodyHit = (x, z, r, ignore = null) => bodies.some((b) => !(ignore && ignore.has(b.id)) && circleHitsBody(x, z, r, b));
  const free = (x, z, r = WALK_R) => !blockedAt(x, z, r) && !bodyHit(x, z, r);
  /** Can a circle of radius r go straight from a to b? `opts.bodies === false` leaves the vehicles out; `opts.ignore` is a Set of vehicle ids to leave out. */
  const segmentClear = (ax, az, bx, bz, r, opts) => {
    const l = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(l / Math.max(0.08, r * 0.4)));
    for (let i = 0; i <= n; i++) { const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n; if (blockedAt(x, z, r)) return false; if (opts?.bodies !== false && bodyHit(x, z, r, opts?.ignore)) return false; }
    return true;
  };
  const world = { region, solids, bodies, blockedAt, bodyHit, free, segmentClear, cw, fields: new Map() };
  world.field = (a, o = {}) => { const key = `${o.r ?? "d"}|${a.x.toFixed(2)},${a.z.toFixed(2)}`; let f = world.fields.get(key); if (!f) { f = walkField(world, a, o); world.fields.set(key, f); } return f; };
  return world;
}

// ---------------------------------------------------------------------------------------------------------------------------- walking routes
/**
 * Every place a person can walk to from `a`, found once (Dijkstra over a grid of free points that keep `r` metres from everything solid). `pathTo(b)` is then the route to any
 * point as [{ x, z }...] starting at a and ending at b, or null when b cannot be reached. A straight line is used wherever it is clear, so open ground gives a plain walk.
 */
export function walkField(world, a, { r = WALK_R + 0.1, step = 0.3 } = {}) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const q of world.region) { x0 = Math.min(x0, q.x0); z0 = Math.min(z0, q.z0); x1 = Math.max(x1, q.x1); z1 = Math.max(z1, q.z1); }
  const nx = Math.ceil((x1 - x0) / step) + 1, nz = Math.ceil((z1 - z0) / step) + 1, memo = new Int8Array(nx * nz), px = (i) => x0 + i * step, pz = (j) => z0 + j * step;
  const ok = (i, j) => { if (i < 0 || j < 0 || i >= nx || j >= nz) return false; const k = j * nx + i; let v = memo[k]; if (!v) { v = world.free(px(i), pz(j), r) ? 1 : 2; memo[k] = v; } return v === 1; };
  /** The nearest free grid point that can be reached from p in a straight line (so the first and last leg never clip a corner). */
  const near = (p, ring = 12) => {
    const i0 = Math.round((p.x - x0) / step), j0 = Math.round((p.z - z0) / step); let best = null;
    for (let d = 0; d <= ring; d++) { for (let j = j0 - d; j <= j0 + d; j++) for (let i = i0 - d; i <= i0 + d; i++) {
      if (Math.max(Math.abs(i - i0), Math.abs(j - j0)) !== d || !ok(i, j)) continue; const dd = Math.hypot(px(i) - p.x, pz(j) - p.z); if (best && dd >= best.d) continue;
      if (dd > 0.05 && !world.segmentClear(p.x, p.z, px(i), pz(j), WALK_R + 0.02)) continue; best = { i, j, d: dd };
    } if (best && d * step > best.d + step) break; }
    return best;
  };
  const start = near(a), N = nx * nz, g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1);
  if (start) {
    const heap = new Heap(), s = start.j * nx + start.i; g[s] = 0; heap.push(0, s);
    while (heap.size) {
      const [, cur] = heap.pop(), ci = cur % nx, cj = (cur / nx) | 0, base = g[cur];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const ni = ci + di, nj = cj + dj; if (!ok(ni, nj)) continue;
        if (di && dj && !(ok(ci + di, cj) && ok(ci, cj + dj))) continue; // never cut a corner
        const k = nj * nx + ni, c = base + (di && dj ? Math.SQRT2 : 1) * step; if (c < g[k]) { g[k] = c; from[k] = cur; heap.push(c, k); }
      }
    }
  }
  /** Straightens a route wherever a straight line keeps its clearance. */
  const pull = (pts) => { const out = [pts[0]]; let i = 0; while (i < pts.length - 1) { let j = pts.length - 1; for (; j > i + 1; j--) if (world.segmentClear(pts[i].x, pts[i].z, pts[j].x, pts[j].z, r)) break; out.push(pts[j]); i = j; } return out; };
  return {
    r, reaches: (b) => { if (!start) return false; const t = near(b); return !!t && g[t.j * nx + t.i] < Infinity; },
    pathTo(b) {
      if (!start) return null; if (world.segmentClear(a.x, a.z, b.x, b.z, r)) return [{ x: a.x, z: a.z }, { x: b.x, z: b.z }];
      const t = near(b); if (!t) return null; let k = t.j * nx + t.i; if (g[k] === Infinity) return null;
      const nodes = []; for (; k !== -1; k = from[k]) nodes.push({ x: px(k % nx), z: pz((k / nx) | 0) });
      nodes.reverse(); return pull([{ x: a.x, z: a.z }, ...nodes, { x: b.x, z: b.z }]);
    },
  };
}

/** A route from a to b over open ground: with the comfortable clearance when there is room for it, with the least a person needs when there is not. null when there is no way. */
export function planWalk(world, a, b) {
  for (const r of [WALK_R + 0.14, WALK_R + 0.04]) { const p = world.field(a, { r }).pathTo(b); if (p) return p; }
  return null;
}

/** The nearest spot to p (within `max` metres) where a person fits, or null. */
export function safeSpotNear(world, p, max = 6) {
  if (world.free(p.x, p.z, WALK_R + 0.04)) return { x: p.x, z: p.z };
  let best = null;
  for (let r = 0.25; r <= max; r += 0.25) { for (let a = 0; a < 24; a++) { const x = p.x + Math.sin((a / 24) * Math.PI * 2) * r, z = p.z + Math.cos((a / 24) * Math.PI * 2) * r; if (world.free(x, z, WALK_R + 0.04) && (!best || dist({ x, z }, p) < dist(best, p))) best = { x, z }; } if (best) return best; }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------- the front door
/** The front door of a home, in cells: the floor cell inside it, the doorway, and a spot just outside (clear of the house wall, on the footpath). */
export function doorLink(room) {
  const L = layoutOf(room), D = room.d;
  if (L) { const at = L.entry.at ?? L.entry.x + 0.5; return { cell: [L.entry.x, L.entry.z], through: { x: at, z: D }, outside: { x: at, z: D + 0.9 } }; }
  return { cell: [0, D - 1], through: { x: 0, z: D - 0.5 }, outside: { x: -0.9, z: D - 0.5 } }; // a plain room: the door is in the west wall, at its south end
}
const inHouse = (env, p) => p.x > -0.05 && p.x < env.room.w * M + 0.05 && p.z > -0.05 && p.z < env.room.d * M + 0.05;

/**
 * A route between two points of the plot (metres), indoors or out. env: { room, cw, slots, placed }. Inside the house the existing room planner is used (furniture, walls and
 * doorways), the front door joins it to the yard, and the yard is planned by walkField. Returns { ok, pts: [{ x, z }...] (starts at `from`), why }.
 */
export function routeFromTo(env, from, to, { world = null, snap = false } = {}) {
  world ??= walkWorld(env.cw, env.slots);
  const W = env.room.w, D = env.room.d, link = doorLink(env.room), bl = blockedCells(env.placed, env.room);
  const cellOf = (p) => [clamp(Math.floor(p.x / M), 0, W - 1), clamp(Math.floor(p.z / M), 0, D - 1)], centre = (c) => ({ x: (c[0] + 0.5) * M, z: (c[1] + 0.5) * M }), cm = (p) => ({ x: p.x * M, z: p.z * M });
  const fail = (why) => ({ ok: false, pts: [], why }), done = (pts) => ({ ok: true, pts });
  const fin = inHouse(env, from), tin = inHouse(env, to);
  if (!tin && snap) { const s = safeSpotNear(world, to, 3); if (!s) return fail("blocked"); to = s; }
  const inside = (a, b) => { const ca = cellOf(a), cb = cellOf(b); if (ca[0] === cb[0] && ca[1] === cb[1]) return []; const p = findPath(env.room, bl, ca, cb); return p.length ? p.map(centre) : null; };
  if (!fin && !tin) { const p = planWalk(world, from, to); return p ? done(p) : fail("unreachable"); }
  if (fin && tin) { const p = inside(from, to); return p ? done([{ x: from.x, z: from.z }, ...p]) : fail("unreachable"); }
  const door = centre(link.cell), through = cm(link.through), outside = cm(link.outside);
  if (fin) { // out of the house: to the door cell, through the doorway, then across the yard
    const a = inside(from, door); if (!a) return fail("unreachable");
    const yard = planWalk(world, outside, to); if (!yard) return fail("unreachable");
    return done([{ x: from.x, z: from.z }, ...a, door, through, ...yard]);
  }
  const yard = planWalk(world, from, outside); if (!yard) return fail("unreachable"); // into the house: across the yard, through the doorway, then to the cell
  const b = inside(door, to); if (!b) return fail("unreachable");
  return done([...yard, through, door, ...b]);
}

// ---------------------------------------------------------------------------------------------------------------------------- doors and the places to stand
/** Does the open door of this side have room to swing (no wall, hedge, furniture or other vehicle where the leaf goes)? */
export function swingClear(world, car, modelId, side, others = world.bodies) {
  const d = doorsOf(modelId), range = side > 0 ? d.left : d.right, z0 = Math.min(...range), z1 = Math.max(...range), len = z1 - z0, hinge = z1, hw = d.W / 2;
  for (const f of [0.5, 1]) for (let i = 1; i <= 6; i++) {
    const t = i / 6, a = DOOR_ANGLE * f, p = toWorld(car, { x: side * (hw + Math.sin(a) * len * t), z: hinge - Math.cos(a) * len * t });
    if (world.blockedAt(p.x, p.z, 0.04)) return false; if (others.some((b) => circleHitsBody(p.x, p.z, 0.04, b))) return false;
  }
  return true;
}

/**
 * Where a person may stand at a vehicle's doors, best first: the driver's (left) side before the other, nearest the door first. Each is { x, z, side, door: { x, z } }. A spot is
 * on the ground, clear of every wall, the furniture, the car itself and every other vehicle, with nothing solid on the way from the door to it, and the door can swing open.
 */
export function standSpots(world, slot, { first = false } = {}) {
  const car = carBoxOf(slot), d = doorsOf(slot.modelId), self = String(slot.id), others = world.bodies.filter((b) => b.id !== self), swing = new Map();
  const roomToSwing = (side) => { if (!swing.has(side)) swing.set(side, swingClear(world, car, slot.modelId, side, others)); return swing.get(side); };
  const ctx = { world: { blockedAt: world.blockedAt, segmentClear: (ax, az, bx, bz, r, o) => world.segmentClear(ax, az, bx, bz, r, o) }, vehicles: others, onRoad: () => false, accept: (s) => roomToSwing(s.side) };
  return exitSpots({ ...car, wid: d.W }, { doorZ: d.zR, doorZL: d.zL }, ctx, { preferSide: 1, first });
}

/** Is there anywhere to stand at one of this vehicle's doors? (the same rules as standSpots, but it stops at the first spot) */
export const hasStandSpot = (world, slot) => standSpots(world, slot, { first: true }).length > 0;

/** The pose of a person at a door, for the door sequences (lib3d/compoundDoor.js): where they stand, the doorway, the driver's seat (all metres) and the vehicle's heading. */
export function doorGeometry(slot, spot) {
  const car = carBoxOf(slot), d = doorsOf(slot.modelId), seat = toWorld(car, { x: d.driver.x, z: d.driver.z });
  return { side: spot.side, spot: { x: spot.x, z: spot.z }, door: { x: spot.door.x, z: spot.door.z }, seat: { x: seat.x, z: seat.z, y: d.driver.y }, hx: car.hx, hz: car.hz };
}

/** Is this stand spot still a good one (nothing has been put on it, the door can still swing)? */
export function spotStillValid(env, slot, spot) {
  const world = walkWorld(env.cw, env.slots); return standSpots(world, slot).some((s) => s.side === spot.side && Math.hypot(s.x - spot.x, s.z - spot.z) < 0.05);
}

/**
 * Getting in: which door to walk to from `from`, and the route. The driver's door is used whenever the person can get to it; otherwise the other one.
 * Returns { ok: true, spot, route: [{ x, z }...], geom } or { ok: false, why: "no-stand" (no safe place beside any door) | "unreachable" (there is one, but no way to it from here) }.
 */
export function planEntry(env, from, slot) {
  const world = walkWorld(env.cw, env.slots), spots = standSpots(world, slot);
  if (!spots.length) return { ok: false, why: "no-stand" };
  for (const side of [1, -1]) for (const sp of spots.filter((s) => s.side === side).slice(0, 4)) {
    const r = routeFromTo(env, from, { x: sp.x, z: sp.z }, { world }); if (r.ok) return { ok: true, spot: sp, route: r.pts, geom: doorGeometry(slot, sp) };
  }
  return { ok: false, why: "unreachable" };
}

/**
 * Getting out of a vehicle that stands at `slot`: the safe spot to step onto, worked out BEFORE anything moves. The driver's side first; if that is blocked, the other side. A
 * spot must also lead somewhere (the person can walk from it to the front door), so nobody is put in a pocket they cannot leave.
 * Returns { ok: true, spot, geom } or { ok: false, why: "no-stand" | "unreachable" }.
 */
export function planExit(env, slot) {
  const world = walkWorld(env.cw, env.slots), spots = standSpots(world, slot);
  if (!spots.length) return { ok: false, why: "no-stand" };
  const link = doorLink(env.room), home = safeSpotNear(world, { x: link.outside.x * M, z: link.outside.z * M }, 3);
  if (!home) return { ok: false, why: "unreachable" };
  const field = world.field(home, { r: WALK_R + 0.04 });
  for (const side of [1, -1]) for (const sp of spots.filter((s) => s.side === side)) if (field.reaches({ x: sp.x, z: sp.z })) return { ok: true, spot: sp, geom: doorGeometry(slot, sp) };
  return { ok: false, why: "unreachable" };
}