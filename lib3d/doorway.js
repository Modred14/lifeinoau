// lib3d/doorway.js
// How a building's door works, as geometry. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// A door is { x, z, nx, nz, width }: its centre on the outline of the building, the unit normal pointing OUT of the building, and the width of the opening
// (lib3d/roadnet.js doorOf). Its leaf is hinged on one side and swings OUT into the street, so before it moves the person standing in front of it must be clear of
// the swept area. Everything here answers one of three questions:
//   - may this person press "Open Door" from where they stand?              canOpenAt()
//   - how far back must they step, and is there room for the leaf to swing?  planDoorOpening()
//   - is the leaf about to hit them (or has something moved into its way)?   inSwing(), swingBlocked()
// Metres, x east, z south, as everywhere. The leaf's own collision (a thin box that moves with it) is made by the trip flow, so a person can never walk through an open leaf.
import { WALK_R } from "./walker.js";
import { circleHitsBody } from "./collide.js";

/** How far the leaf opens (radians, a little over a right angle so it lies back against the wall of the porch). */
export const SWING = 1.7;
/** How far from the door the Open Door button is offered, and how far to either side of it. */
export const REACH = 3.2, SIDE_REACH = 2.0;
/** The pace of the step back (m/s), the longest straight step back we call "a small step", and the longest we will ever make. */
export const BACK_SPEED = 1.0, SMALL_STEP = 2.2, MAX_STEP = 3.4;
/** The collision body of the leaf is this thick (half-width, metres). */
export const LEAF_HALF = 0.06;
/** The id the leaf's collision body has in the collision world. */
export const LEAF_ID = "door";


/** Where a point is relative to a door: v metres in front of it (out of the building), u metres along it (to the right as seen from outside). */
export function doorLocal(door, x, z) { const dx = x - door.x, dz = z - door.z; return { v: dx * door.nx + dz * door.nz, u: dx * door.nz - dz * door.nx }; }

/** May the person at (x, z) press Open Door? They must be in front of the door (not beside or behind it) and within reach of it. */
export function canOpenAt(door, x, z) {
  const { u, v } = doorLocal(door, x, z);
  return { ok: v >= 0.15 && v <= REACH && Math.abs(u) <= door.width / 2 + SIDE_REACH, u, v };
}
/** Is the person standing in the doorway, close enough to go in? */
export function atThreshold(door, x, z) { const { u, v } = doorLocal(door, x, z); return v <= 1.2 && Math.abs(u) <= door.width / 2; }

/**
 * The frame of a leaf. hinge: "left" or "right" (as seen from outside, swinging out) or "in" (a leaf that swings into the building: used only when the street side has no room at all).
 * Returns { hinge, w, hx, hz (the hinge post), lx, lz (the closed leaf, from the hinge across the opening), sx, sz (the way it swings), inward, door }.
 */
export function doorFrame(door, hinge = "left") {
  const w = door.width, tx = door.nz, tz = -door.nx, right = hinge === "right", sgn = right ? -1 : 1, inward = hinge === "in";
  return { hinge, w, door, inward, hx: door.x - sgn * tx * (w / 2), hz: door.z - sgn * tz * (w / 2), lx: sgn * tx, lz: sgn * tz, sx: inward ? -door.nx : door.nx, sz: inward ? -door.nz : door.nz };
}
/** The leaf at an opening angle a (0 shut, SWING open): its middle, its direction and its tip. */
export function leafAt(f, a) {
  const c = Math.cos(a), s = Math.sin(a), dx = f.lx * c + f.sx * s, dz = f.lz * c + f.sz * s;
  return { dx, dz, mx: f.hx + dx * f.w / 2, mz: f.hz + dz * f.w / 2, tx: f.hx + dx * f.w, tz: f.hz + dz * f.w };
}
/** The collision body of the leaf at angle a, in the form CollisionWorld.setBody takes. A leaf that swings into the building needs none (the building is solid there). */
export function leafBody(f, a) { if (f.inward) return null; const l = leafAt(f, a); return { x: l.mx, z: l.mz, hx: l.dx, hz: l.dz, hl: f.w / 2, hw: LEAF_HALF }; }

/** Would a circle of radius r at (x, z) be touched by the leaf somewhere between shut and the angle `a`? Only a leaf that swings out can touch anyone out here. */
export function inSwing(f, x, z, r, a = SWING) {
  if (f.inward) return false;
  const dx = x - f.hx, dz = z - f.hz, u = dx * f.lx + dz * f.lz, v = dx * f.door.nx + dz * f.door.nz, d = Math.hypot(u, v);
  if (d > f.w + r || v < -r) return false; if (d <= r) return true;
  return Math.atan2(v, u) <= a + Math.asin(Math.min(1, r / d)) + 1e-6;
}

/** Points along the leaf at several angles (only those clear of the wall plane), for checking that nothing stands in the swept area. */
function sweep(f, a = SWING) {
  const out = [], n = f.door;
  for (let i = 1; i <= 8; i++) for (let j = 1; j <= 6; j++) {
    const ang = (a * i) / 8, rho = (f.w * j) / 6, px = f.hx + (f.lx * Math.cos(ang) + f.sx * Math.sin(ang)) * rho, pz = f.hz + (f.lz * Math.cos(ang) + f.sz * Math.sin(ang)) * rho;
    if ((px - n.x) * n.nx + (pz - n.z) * n.nz >= 0.3) out.push([px, pz]);
  }
  return out;
}
/** Is something solid (a wall, a post, a parked vehicle, anyone but the door's own leaf) in the area the leaf sweeps up to angle a? */
export function swingBlocked(world, f, a = SWING) {
  if (f.inward) return false;
  for (const [x, z] of sweep(f, a)) {
    if (world.blockedAt(x, z, 0.1)) return true;
    for (const b of world.bodies.values()) if (b.id !== LEAF_ID && circleHitsBody(x, z, 0.1, b)) return true;
  }
  return false;
}

/**
 * The smallest step that takes a person clear of the swept area: straight back first (that is the natural step), and only if that is not possible a step that also goes sideways.
 * Every candidate must be free of walls and vehicles, reachable in a straight line, and (when `isRoad` is given) must not put a person on the carriageway who is not on it already.
 * Returns { ok, to: {x, z}, dist } or { ok: false }.
 */
export function planStepBack(world, f, from, { isRoad = null } = {}) {
  const r = WALK_R + 0.1, n = f.door;
  if (!inSwing(f, from.x, from.z, r)) return { ok: true, to: { x: from.x, z: from.z }, dist: 0 };
  const tx = n.nz, tz = -n.nx, onRoadNow = isRoad ? isRoad(from.x, from.z) : false;
  const free = (x, z) => !world.blockedAt(x, z, WALK_R + 0.06) && !(isRoad && !onRoadNow && isRoad(x, z)) && world.segmentClear(from.x, from.z, x, z, WALK_R + 0.02) && !inSwing(f, x, z, r);
  for (const lateral of [[0], [0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2, 2.5, -2.5]]) {
    let best = null; const cap = lateral.length === 1 ? SMALL_STEP : MAX_STEP;
    for (const s of lateral) for (let d = 0; d <= cap; d += 0.1) {
      const x = from.x + n.nx * d + tx * s, z = from.z + n.nz * d + tz * s, dist = Math.hypot(x - from.x, z - from.z); if (dist > cap) break;
      if (!free(x, z)) continue; if (!best || dist < best.dist) best = { ok: true, to: { x, z }, dist }; break;
    }
    if (best) return best;
  }
  return { ok: false };
}

/**
 * Works out how this door will open for the person at `from`: which way it is hinged, where they step back to, and how far. Both hinges are tried (the one that needs the smaller
 * step wins; the left one on a tie). If the street side has no room for either leaf, whatever the person does, the leaf swings into the building instead; if there is room for a leaf
 * but not for this person's step back, the answer is { ok: false, reason: "noroom" } and the door stays shut.
 * Returns { ok, frame, back: {x, z}, dist, hinge } or { ok: false, reason, text }.
 */
export function planDoorOpening(world, door, from, opts = {}) {
  const tries = [];
  for (const hinge of ["left", "right"]) {
    const f = doorFrame(door, hinge); if (swingBlocked(world, f)) continue;
    const s = planStepBack(world, f, from, opts); tries.push({ f, s });
  }
  if (!tries.length) return { ok: true, frame: doorFrame(door, "in"), back: { x: from.x, z: from.z }, dist: 0, hinge: "in" };
  const good = tries.filter((t) => t.s.ok).sort((a, b) => a.s.dist - b.s.dist || (a.f.hinge === "left" ? -1 : 1));
  if (!good.length) return { ok: false, reason: "noroom", text: "There is not enough room to open the door from here. Move to a clearer spot in front of it." };
  const t = good[0]; return { ok: true, frame: t.f, back: t.s.to, dist: t.s.dist, hinge: t.f.hinge };
}

/** The unit direction a person at the door should face to look at it. */
export const facingDoor = (door) => ({ hx: -door.nx, hz: -door.nz });
