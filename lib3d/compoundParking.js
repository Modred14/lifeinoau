// lib3d/compoundParking.js
// Where the player's vehicles stand inside the home compound (the plot of lib/plot.js, drawn by lib3d/plot3d.js), and the ground they drive over to leave it.
// Pure JS (no three.js, no DOM): the 3D room (lib3d/compoundFleet.js) draws what this says, and the tests drive every vehicle out with it.
//
// Units: the compound is laid out in room cells (x east, z south, one cell is CELL_M metres), exactly like lib/plot.js. A vehicle's pose is { x, z, yaw } in cells with
// the same heading convention as lib3d/garageDrive.js (the nose points along (sin yaw, cos yaw); yaw 0 is south, towards the road). The driving model itself
// (lib3d/garageDrive.js) works in metres, so `metresWorld` turns the same ground into metres.
//
//   parking ... every owned vehicle gets its own place on the lawn, nose towards the open ground in front of it, clear of the house, the garage, the driveway,
//               the hedges and anything the player has put on the lawn. The vehicle nearest the gate is the first one placed, so a small collection stands by the gate.
//   leaving ... the whole lawn (inside the hedges), the driveway, the gate and the road are drivable; the house, the garage, outdoor furniture and the other
//               parked vehicles are solid. Driving out ends when the whole vehicle is on the carriageway (`onCarriageway`).
import { plotFor } from "../lib/plot.js";
import { ITEMS, sizeOf } from "../lib/furniture.js";
import { isOutside } from "../lib/room.js";
import { garageVehicleSize } from "./garageLayout.js";

export const CELL_M = 0.9; // a room cell is about 0.9 m (lib3d/room.js draws a 1.75 m person 1.95 cells tall)
const HEDGE = 1.5; // the hedges, trees and the wall stand within this distance of the plot's edge: nothing parks or drives there
const GAP = 0.45; // clear space kept between parked vehicles and around anything solid
const STRIP = 2.6; // the free ground a parked vehicle needs straight ahead of its nose, so it can always pull out

const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const grow = (r, m) => ({ x0: r.x0 - m, x1: r.x1 + m, z0: r.z0 - m, z1: r.z1 + m });
const inside = (r, o) => o.x0 >= r.x0 - 1e-9 && o.x1 <= r.x1 + 1e-9 && o.z0 >= r.z0 - 1e-9 && o.z1 <= r.z1 + 1e-9;

/** A vehicle's footprint in cells: length along its nose, width across. */
export function vehicleCells(modelId) { const { length, width } = garageVehicleSize(modelId); return { len: length / CELL_M, wid: width / CELL_M }; }

/** The axis-aligned box a vehicle covers when it stands at (x, z) with this yaw (a quarter-turn multiple is exact; anything else gets its bounding box). */
export function poseBox(x, z, yaw, len, wid) {
  const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw)), hx = (len * s + wid * c) / 2, hz = (len * c + wid * s) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

/**
 * The ground of a home's compound. `items` are the player's placed things ({ key, x, z, rot, placed }); the outdoor ones are solid.
 * Returns { P, W, D, lawn, drive, region, solids, gate, road, target } (all in cells).
 */
export function compoundWorld(room, items = []) {
  const P = plotFor(room), pl = P.plot, W = room.w, D = room.d;
  const lawn = { x0: pl.x0 + HEDGE, x1: pl.x1 - HEDGE, z0: pl.z0 + HEDGE, z1: pl.z1 - HEDGE };
  const ga = P.garage, solids = [
    { x0: -0.45, x1: W + 0.45, z0: -0.45, z1: D + 0.55, kind: "house" },
    { x0: ga.x0 - 0.45, x1: ga.x1 + 0.45, z0: ga.z0 - 0.45, z1: ga.z1 + 0.15, kind: "garage" },
  ];
  for (const it of items) { if (!it || it.placed === false || it.x == null || !ITEMS[it.key] || ITEMS[it.key].flat || !isOutside(room, it)) continue; // whatever stands out on the lawn is solid (a carried-out sofa too), but a rug lies flat and a car drives over it
    const [w, d] = sizeOf(it.key, it.rot ?? 0); solids.push({ x0: it.x - 0.1, x1: it.x + w + 0.1, z0: it.z - 0.1, z1: it.z + d + 0.1, kind: "item" }); }
  const gate = { x0: P.gate.x0 + 0.35, x1: P.gate.x1 - 0.35, z0: pl.z1 - 1.6, z1: P.kerb + 0.1 }; // through the open gate, between its pillars, and across the footpath
  const road = { x0: P.road.x0, x1: P.road.x1, z0: P.road.z0, z1: P.road.z1 - 0.25 };
  const drive = { x0: P.drive.x0 + 0.15, x1: P.drive.x1 - 0.15, z0: Math.max(P.drive.z0, lawn.z0), z1: P.kerb + 0.1 };
  const region = [lawn, drive, gate, road];
  // where a vehicle heads to leave: the middle of the gate, inside the wall
  const target = { x: (P.gate.x0 + P.gate.x1) / 2, z: pl.z1 - 2.2 };
  return { P, W, D, lawn, drive, gate, road, region, solids, target };
}

/** The same ground in metres, in the shape lib3d/garageDrive.js expects ({ region, solids }); `parked` are the other vehicles standing there. */
export function metresWorld(cw, parked = [], skipId = null) {
  const m = (r) => ({ x0: r.x0 * CELL_M, x1: r.x1 * CELL_M, z0: r.z0 * CELL_M, z1: r.z1 * CELL_M });
  const solids = cw.solids.map(m);
  for (const s of parked) { if (skipId != null && String(s.id) === String(skipId)) continue; const b = poseBox(s.x, s.z, s.yaw, s.len, s.wid); solids.push(m(grow(b, -0.12))); }
  return { region: cw.region.map(m), solids };
}

/** Is the whole vehicle on the carriageway of the road in front of the compound (not on the footpath, not still in the gate)? Pose in cells. */
export function onCarriageway(cw, x, z, yaw, len, wid) {
  const b = poseBox(x, z, yaw, len, wid), r = cw.P.road;
  return b.x0 >= r.x0 && b.x1 <= r.x1 && b.z0 >= r.z0 + 0.1 && b.z1 <= r.z1 - 0.3;
}

const FACES = [[0, 1], [1, 0], [-1, 0], [0, -1]]; // south, east, west, north: the four ways a vehicle can stand
const yawOf = ([hx, hz]) => Math.atan2(hx, hz);

/** The ground just ahead of a standing vehicle's nose, as a box. */
function stripAhead(x, z, face, len, wid, STRIP = 2.6) {
  const [hx, hz] = face, w = wid + 0.7, nose = len / 2;
  const cx = x + hx * (nose + STRIP / 2), cz = z + hz * (nose + STRIP / 2), ax = Math.abs(hx), az = Math.abs(hz);
  return { x0: cx - (ax ? STRIP / 2 : w / 2), x1: cx + (ax ? STRIP / 2 : w / 2), z0: cz - (az ? STRIP / 2 : w / 2), z1: cz + (az ? STRIP / 2 : w / 2) };
}

/** Is every part of this box on drivable ground? (the ground is several boxes side by side, so the box is tested point by point) */
const onGround = (cw, box) => { for (let i = 0; i <= 4; i++) for (let j = 0; j <= 2; j++) { const x = box.x0 + (box.x1 - box.x0) * (i / 4), z = box.z0 + (box.z1 - box.z0) * (j / 2); if (!cw.region.some((r) => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && z >= r.z0 - 1e-9 && z <= r.z1 + 1e-9)) return false; } return true; };

/** A grid of the ground where a vehicle of this width fits, reachable from the gate, with the given vehicles standing on it: { has(x, z), route(x, z) }. */
function openGround(cw, bodies, wid, step = 0.5) {
  const R = wid / 2 + 0.35, x0 = cw.lawn.x0, z0 = cw.lawn.z0, x1 = cw.road.x1, z1 = cw.road.z1, obstacles = [...cw.solids, ...bodies];
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), key = (i, j) => i * (nz + 2) + j, pos = (i, j) => [x0 + i * step, z0 + j * step];
  const ok = (x, z) => { const b = { x0: x - R, x1: x + R, z0: z - R, z1: z + R }; return onGround(cw, b) && !obstacles.some((o) => hit(o, b)); };
  const seen = new Map(), q = [], goalX = (cw.gate.x0 + cw.gate.x1) / 2, goalZ = cw.P.road.z0 + 3.2;
  const si = Math.round((goalX - x0) / step), sj = Math.round((goalZ - z0) / step); // start from the road in front of the gate and flood back into the compound
  if (ok(...pos(si, sj))) { seen.set(key(si, sj), true); q.push([si, sj]); }
  for (let h = 0; h < q.length; h++) { const [i, j] = q[h]; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a > nx || b > nz || seen.has(key(a, b))) continue; if (!ok(...pos(a, b))) continue; seen.set(key(a, b), true); q.push([a, b]); } }
  return { has: (x, z) => seen.has(key(Math.round((x - x0) / step), Math.round((z - z0) / step))) };
}

/**
 * Gives every vehicle a place. vehicles: [{ id, modelId, color, ... }] in the order they should be placed (the first stands nearest the gate).
 * Every placed vehicle can pull straight out ahead and reach the gate without touching anything (checked against every other vehicle, as each one is added).
 * Returns { slots: [{ ...vehicle, x, z, yaw, len, wid }], unplaced: [vehicle], cw }. A vehicle that cannot be fitted (the lawn is full of the player's own furniture) is listed in `unplaced`.
 */
export function planParking(room, vehicles = [], items = []) {
  const cw = compoundWorld(room, items), { lawn, drive, target } = cw, slots = [];
  const keepOut = [...cw.solids, grow(drive, 0.35)], bodyOf = (s) => poseBox(s.x, s.z, s.yaw, s.len, s.wid);
  // candidate centres on a half-cell grid over the lawn, nearest the gate first (ties: west to east, so the result never depends on iteration luck)
  const cand = [];
  for (let x = lawn.x0; x <= lawn.x1; x += 0.5) for (let z = lawn.z0; z <= lawn.z1; z += 0.5) cand.push({ x, z, d: Math.hypot(x - target.x, z - target.z) });
  cand.sort((a, b) => a.d - b.d || a.x - b.x || a.z - b.z);
  const front = (x, z, f, len) => [x + f[0] * (len / 2 + 1.7), z + f[1] * (len / 2 + 1.7)];
  // two passes: roomy first, then (only for what did not fit) tighter gaps
  const todo = [...vehicles]; let tight = false;
  for (let pass = 0; pass < 2 && todo.length; pass++, tight = true) {
    const gap = tight ? 0.2 : GAP, strip = tight ? 2.2 : STRIP;
    for (const v of [...todo]) {
      const { len, wid } = vehicleCells(v.modelId); let placed = null;
      const ground = openGround(cw, slots.map(bodyOf), wid);
      for (const c of cand) {
        const faces = [...FACES].sort((a, b) => (b[0] * (target.x - c.x) + b[1] * (target.z - c.z)) - (a[0] * (target.x - c.x) + a[1] * (target.z - c.z)));
        for (const f of faces) {
          const yaw = yawOf(f), box = poseBox(c.x, c.z, yaw, len, wid);
          if (!inside(lawn, box) || keepOut.some((k) => hit(k, grow(box, 0.15))) || slots.some((s) => hit(bodyOf(s), grow(box, gap)))) continue;
          const [fx, fz] = front(c.x, c.z, f, len); if (!ground.has(fx, fz)) continue; // boxed in: there is no way from its nose to the gate
          const ahead = stripAhead(c.x, c.z, f, len, wid, strip);
          if (!onGround(cw, ahead) || cw.solids.some((k) => hit(k, ahead)) || slots.some((s) => hit(bodyOf(s), ahead))) continue;
          const next = { ...v, x: c.x, z: c.z, yaw, len, wid }, after = openGround(cw, [...slots, next].map(bodyOf), 2.2); // and it must not shut anyone else in
          if (![...slots].every((s) => after.has(...front(s.x, s.z, [Math.sin(s.yaw), Math.cos(s.yaw)], s.len)))) continue;
          placed = next; break;
        }
        if (placed) break;
      }
      if (placed) { slots.push(placed); todo.splice(todo.indexOf(v), 1); }
    }
  }
  return { slots, unplaced: todo, cw };
}

/**
 * A way out for one parked vehicle, as points in cells: straight ahead out of its place, then across the compound to the gate and onto the road. It searches a grid of the
 * ground where a vehicle's whole width fits (every other vehicle is an obstacle), so it is also the proof that the vehicle is not boxed in. Returns null when there is none.
 */
export function exitRoute(cw, slots, slot, step = 0.5, extra = 0.35) {
  const others = slots.filter((s) => String(s.id) !== String(slot.id)).map((s) => grow(poseBox(s.x, s.z, s.yaw, s.len, s.wid), -0.05)), obstacles = [...cw.solids, ...others];
  const R = slot.wid / 2 + extra, x0 = cw.lawn.x0, z0 = cw.lawn.z0, x1 = cw.road.x1, z1 = cw.road.z1;
  const ok = (x, z) => { const b = { x0: x - R, x1: x + R, z0: z - R, z1: z + R }; return onGround(cw, b) && !obstacles.some((o) => hit(o, b)); };
  const [hx, hz] = [Math.sin(slot.yaw), Math.cos(slot.yaw)], start = { x: slot.x + hx * (slot.len / 2 + 1.6), z: slot.z + hz * (slot.len / 2 + 1.6) };
  const key = (i, j) => i + "," + j, cell = (p) => [Math.round((p.x - x0) / step), Math.round((p.z - z0) / step)], pos = (i, j) => ({ x: x0 + i * step, z: z0 + j * step });
  const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step), [si, sj] = cell(start), goalZ = cw.P.road.z0 + 3.2;
  if (!ok(start.x, start.z)) return null;
  const came = new Map([[key(si, sj), null]]), q = [[si, sj]]; let goal = null;
  for (let h = 0; h < q.length; h++) {
    const [i, j] = q[h], p = pos(i, j);
    if (p.z >= goalZ && p.x > cw.gate.x0 && p.x < cw.gate.x1) { goal = key(i, j); break; }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj, k = key(a, b); if (a < 0 || b < 0 || a > nx || b > nz || came.has(k)) continue; const pp = pos(a, b); if (!ok(pp.x, pp.z)) continue; came.set(k, key(i, j)); q.push([a, b]); }
  }
  if (!goal) return null;
  const pts = []; for (let k = goal; k; k = came.get(k)) { const [i, j] = k.split(",").map(Number); pts.push([pos(i, j).x, pos(i, j).z]); }
  pts.reverse(); pts.unshift([slot.x, slot.z]);
  // smooth out the grid's staircase: keep a point only where the way really turns
  const out = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const a = out.at(-1), b = pts[i], c = pts[i + 1]; if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b); } out.push(pts.at(-1));
  return out;
}
