// lib3d/garageDrive.js
// Driving a car out of the home garage: a small bicycle-model vehicle, the compound's solid things and drivable area, and an autopilot the tests use to prove
// that every car can leave its bay, cross the driveway, pass the gate and end up on the road. Pure JS (no three.js, no DOM): runs in the browser and in Node.
//
// The drivable area is a union of rectangles from the layout (the compound, the gate corridor and the road). A pose is allowed when every point of the car's
// footprint is inside that area and the car overlaps no parked car or carport post. A move that would break that is simply not made (the car stops
// against it, and can always reverse away), so there are no invisible walls beyond the real ones, no teleporting, and no way to get wedged into something.
import { garageVehicleSize, G } from "./garageLayout.js";

const EPS = 1e-6;
const inRect = (r, x, z) => x >= r.x0 - EPS && x <= r.x1 + EPS && z >= r.z0 - EPS && z <= r.z1 + EPS;

/** The drivable rectangles and the solid boxes of a layout. `skipId` is the car being driven (it does not collide with its own empty bay). */
export function driveWorld(layout, skipId = null) {
  const L = layout, wall = G.WALL / 2, gate = L.front.gate;
  const region = [
    { x0: -L.halfW + 0.45, x1: L.halfW - 0.45, z0: L.houseZ + 0.35, z1: L.frontZ - wall }, // inside the compound
    { x0: gate[0] + 0.15, x1: gate[1] - 0.15, z0: L.frontZ - wall - 0.1, z1: L.road.z0 + 0.1 }, // through the open gate, across the footpath (a dropped kerb)
    { x0: L.road.x0, x1: L.road.x1, z0: L.road.z0, z1: L.road.z1 - 0.2 }, // the carriageway
  ];
  const solids = [];
  for (const s of L.slots) { if (skipId != null && String(s.id) === String(skipId)) continue; const { length, width } = garageVehicleSize(s.modelId); solids.push({ x0: s.x - length / 2, x1: s.x + length / 2, z0: s.z - width / 2, z1: s.z + width / 2 }); }
  for (const p of L.posts) solids.push({ x0: p.x - p.r, x1: p.x + p.r, z0: p.z - p.r, z1: p.z + p.r });
  return { region, solids, layout: L };
}

/** The corners and a grid of points over a car's footprint. */
export function footprint(x, z, yaw, length, width, nL = 5, nW = 3) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx, pts = [];
  for (let i = 0; i < nL; i++) for (let j = 0; j < nW; j++) { const u = (i / (nL - 1) - 0.5) * length, w = (j / (nW - 1) - 0.5) * width; pts.push([x + fx * u + rx * w, z + fz * u + rz * w]); }
  return pts;
}

// does the car's oriented box overlap an axis-aligned box? (separating axis test)
function obbHitsBox(x, z, yaw, length, width, b) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx, hl = length / 2, hw = width / 2, bx = (b.x0 + b.x1) / 2, bz = (b.z0 + b.z1) / 2, bhx = (b.x1 - b.x0) / 2, bhz = (b.z1 - b.z0) / 2;
  const dx = bx - x, dz = bz - z;
  if (Math.abs(dx) > bhx + hl * Math.abs(fx) + hw * Math.abs(rx) - EPS) return false;
  if (Math.abs(dz) > bhz + hl * Math.abs(fz) + hw * Math.abs(rz) - EPS) return false;
  for (const [ax, az, h] of [[fx, fz, hl], [rx, rz, hw]]) { if (Math.abs(dx * ax + dz * az) > h + bhx * Math.abs(ax) + bhz * Math.abs(az) - EPS) return false; }
  return true;
}

/** Why a pose is not allowed ("area" = part of it would leave the drivable ground, "solid" = it would hit a parked car or post), or null if it is fine. */
export function blockedPose(world, x, z, yaw, length, width) {
  for (const [px, pz] of footprint(x, z, yaw, length, width)) if (!world.region.some((r) => inRect(r, px, pz))) return "area";
  for (const b of world.solids) if (obbHitsBox(x, z, yaw, length, width, b)) return "solid";
  return null;
}

/** Is the whole car on the carriageway? (This is "out of the garage and onto the road".) */
export function onRoad(layout, x, z, yaw, length, width) { const r = layout.road; return footprint(x, z, yaw, length, width).every(([px, pz]) => px >= r.x0 && px <= r.x1 && pz >= r.z0 + 0.1 && pz <= r.z1 - 0.2); }

const VMAX = 9, VREV = 3.4, ACC = 4.2, BRAKE = 9, DRAG = 2.4, REV_ACC = 3;

/** A car at a pose. step(input, dt) moves it; input = { throttle: -1..1 (negative reverses), steer: -1..1 (right is positive) }. */
export function createDriver(world, pose, size) {
  const S = { x: pose.x, z: pose.z, yaw: pose.yaw, v: 0, steer: 0, hit: null, travelled: 0 }, wheelbase = size.length * 0.6;
  const maxSteer = (v) => 0.62 - 0.3 * Math.min(1, Math.abs(v) / VMAX);
  function sub(input, dt) {
    const th = Math.max(-1, Math.min(1, input.throttle ?? 0)), st = Math.max(-1, Math.min(1, input.steer ?? 0));
    if (th > 0) S.v += (S.v < 0 ? BRAKE : ACC * (1 - Math.max(0, S.v) / VMAX)) * th * dt;
    else if (th < 0) S.v -= (S.v > 0 ? BRAKE : REV_ACC * (1 - Math.max(0, -S.v) / VREV)) * -th * dt;
    else { const d = DRAG * dt; S.v = Math.abs(S.v) <= d ? 0 : S.v - Math.sign(S.v) * d; }
    S.v = Math.max(-VREV, Math.min(VMAX, S.v));
    const target = st * maxSteer(S.v); S.steer += Math.max(-4 * dt, Math.min(4 * dt, target - S.steer));
    const yaw = S.yaw - (S.v / wheelbase) * Math.tan(S.steer) * dt, // a positive steer turns right (towards -x when facing +z)
       x = S.x + Math.sin((S.yaw + yaw) / 2) * S.v * dt, z = S.z + Math.cos((S.yaw + yaw) / 2) * S.v * dt;
    const why = blockedPose(world, x, z, yaw, size.length, size.width);
    if (why) { S.hit = why; S.v = 0; return 0; } // stop against it: the car stays where it was
    S.hit = null; const moved = Math.hypot(x - S.x, z - S.z); S.x = x; S.z = z; S.yaw = yaw; S.travelled += moved; return moved * Math.sign(S.v || 1);
  }
  return { state: S, size, step(input, dt) { let moved = 0, left = Math.min(dt, 0.25); while (left > 1e-9) { const h = Math.min(left, 1 / 90); moved += sub(input, h); left -= h; } return moved; } };
}

/**
 * The route a car takes from its bay to the road: out of the bay, a quarter turn into the lane (wide enough for the biggest car), straight down the lane
 * through the gate and out across the footpath onto the carriageway. Returned as a dense list of points; the autopilot follows it.
 */
export function routeOut(layout, slot) {
  const side = slot.x < 0 ? -1 : 1, r = Math.abs(slot.x), pts = []; // a quarter circle whose far end is the lane's centre line, heading for the road
  for (let i = 0; i <= 24; i++) { const t = (i / 24) * (Math.PI / 2); pts.push([slot.x - side * r * Math.sin(t), slot.z + r - r * Math.cos(t)]); }
  const endZ = pts.at(-1)[1], goalZ = layout.road.z0 + 3.5;
  for (let z = endZ + 0.5; z <= goalZ + 0.01; z += 0.5) pts.push([0, z]);
  return pts;
}

/** An autopilot that follows a point list with pure pursuit. Returns input(state) -> { throttle, steer }, and done(state). */
export function autopilot(route, size, { speed = 3.2, lookahead = 3.4 } = {}) {
  const wheelbase = size.length * 0.6; let idx = 0;
  return (S) => {
    while (idx < route.length - 1 && Math.hypot(route[idx][0] - S.x, route[idx][1] - S.z) < 0.9) idx++;
    let j = idx; while (j < route.length - 1 && Math.hypot(route[j][0] - S.x, route[j][1] - S.z) < lookahead) j++;
    const [tx, tz] = route[j], dx = tx - S.x, dz = tz - S.z, ang = Math.atan2(dx, dz), a = Math.atan2(Math.sin(ang - S.yaw), Math.cos(ang - S.yaw));
    const delta = Math.atan2(2 * wheelbase * Math.sin(a), Math.max(1, Math.hypot(dx, dz))), steer = Math.max(-1, Math.min(1, -delta / 0.5)); // delta > 0 means the heading must grow, which is a turn to the left
    const slow = Math.abs(steer) > 0.6 ? 0.7 : 1, throttle = Math.max(-1, Math.min(1, (speed * slow - S.v) * 1.5));
    return { throttle, steer };
  };
}
