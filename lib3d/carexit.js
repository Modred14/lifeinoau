// lib3d/carexit.js
// Where a person may step out of a car, and which door to use. Pure JS: the trip flow gives it the collision world and the other vehicles.
//
// A spot is acceptable only when ALL of these hold: a person fits there (not inside a wall, a fence, a tree or a parked vehicle), nothing solid lies on the straight way
// from the door to it, it is clear of every other vehicle on the road and of the car itself, and it is not in the air or underground (the world is flat: y is always the ground).
// Among the acceptable spots the one on the pavement or open ground wins over one in the carriageway; ties go to the driver's side, then to the spot nearest the door.
import { toWorld } from "./trafficsim.js";
import { boxesOverlap } from "./collide.js";
import { WALK_R } from "./walker.js";

const PERSON = 0.33;                                  // the clearance a standing person needs
const OFFSETS = [0.62, 0.95, 1.4, 1.9];               // metres beyond the side of the car
const ALONG = [0, -0.7, 0.7, -1.4, 1.4];              // metres along the car from the door

/**
 * car: { x, z, hx, hz, len, wid }. kindDef: KINDS[kind] (doorZ / doorZL). ctx: { world, vehicles: [{x,z,hx,hz,len,wid}], onRoad(x, z) -> boolean }.
 * Returns [{ x, z, side, door: {x, z}, road }] best first (empty when there is nowhere safe to get out).
 */
export function exitSpots(car, kindDef, ctx, { preferSide = 1 } = {}) {
  const { world, vehicles = [], onRoad = () => false } = ctx, hl = car.len / 2, hw = car.wid / 2, me = { x: car.x, z: car.z, hx: car.hx, hz: car.hz, hl, hw }, out = [];
  for (const side of [preferSide, -preferSide]) {
    const z0 = side > 0 ? kindDef.doorZL ?? kindDef.doorZ : kindDef.doorZ;
    const door = toWorld(car, { x: side * hw, z: z0 });
    ALONG.forEach((dz, ai) => OFFSETS.forEach((off, oi) => {
      const p = toWorld(car, { x: side * (hw + off), z: z0 + dz });
      if (world.blockedAt(p.x, p.z, WALK_R + 0.06)) return;                                            // a wall, a fence, something solid
      if (world.segmentClear && !world.segmentClear(door.x, door.z, p.x, p.z, PERSON, { bodies: false })) return; // something solid in the way
      // clear of the car itself and of every other vehicle (a person is a small box)
      const guy = { x: p.x, z: p.z, hx: car.hx, hz: car.hz, hl: PERSON, hw: PERSON };
      if (boxesOverlap(guy, me, 0.1)) return;
      for (const b of vehicles) { if (Math.abs(b.x - p.x) > 9 || Math.abs(b.z - p.z) > 9) continue; if (boxesOverlap(guy, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, 0.35)) return; }
      out.push({ x: p.x, z: p.z, side, door: { x: door.x, z: door.z }, road: !!onRoad(p.x, p.z), rank: (onRoad(p.x, p.z) ? 100 : 0) + (side === preferSide ? 0 : 20) + oi * 2 + ai });
    }));
  }
  return out.sort((a, b) => a.rank - b.rank);
}

/** The best spot to step out at, or null. */
export const pickExit = (car, kindDef, ctx, opts) => exitSpots(car, kindDef, ctx, opts)[0] ?? null;

/**
 * Which door to get in by: the driver's (left) when there is room to stand beside it, otherwise the right one (and then you slide across to the wheel).
 * `stand(side)` is the world point just outside that door. Returns +1 (left) or -1 (right).
 */
export function pickDoorSide(stand, world, vehicles = [], car = null) {
  for (const side of [1, -1]) {
    const p = stand(side); if (world.blockedAt(p.x, p.z, WALK_R + 0.05)) continue;
    let free = true; for (const b of vehicles) { if (Math.hypot(b.x - p.x, b.z - p.z) > 8) continue; if (boxesOverlap({ x: p.x, z: p.z, hx: car?.hx ?? 0, hz: car?.hz ?? 1, hl: PERSON, hw: PERSON }, { x: b.x, z: b.z, hx: b.hx, hz: b.hz, hl: b.len / 2, hw: b.wid / 2 }, 0.2)) { free = false; break; } }
    if (free) return side;
  }
  return -1;
}
