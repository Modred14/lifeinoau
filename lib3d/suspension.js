// lib3d/suspension.js
// The suspension of a driven vehicle model: the BODY can lean (squat under power, dive under the brake, roll in a corner) while the WHEELS stay where the road puts them.
// Every vehicle model (lib3d/vehicles.js, vehicleUtility.js) is a root with the wheel pivots and everything else (body, glass, lamps, doors, the driver, the bus shell) as its children.
// rigSuspension moves everything that is not a wheel pivot into one `body` group; the root carries the ride that puts the tyres on the road (lib3d/vehiclepose.js) and the body group carries the lean,
// about the tyres' ground level, limited to what the wheel arches allow: the body never moves more than TRAVEL metres at an axle, so it never meets a tyre.
import * as THREE from "three";
import { wheelContacts, stance } from "./vehiclepose.js";

/** How far the body may move up or down relative to the wheels at an axle or a side (m): less than the gap between a tyre and its arch. */
export const TRAVEL = 0.04;

/** Splits a model into wheels (on the root) and body (in vehicle.body). Returns the body group. Safe to call once per model. */
export function rigSuspension(vehicle) {
  if (vehicle.body) return vehicle.body;
  const root = vehicle.root, pivots = new Set((vehicle.wheels ?? []).map((w) => w.parent)), body = new THREE.Group(); body.name = "body"; body.rotation.order = "YXZ";
  for (const c of [...root.children]) if (!pivots.has(c)) body.add(c);
  root.add(body);
  const st = stance(wheelContacts(vehicle));
  body.userData.lean = { pitch: Math.min(0.06, TRAVEL / Math.max(0.3, st.wheelbase / 2)), roll: Math.min(0.06, TRAVEL / Math.max(0.3, st.halfTrack)) };
  vehicle.body = body; return body;
}

/** Leans the body: pitch (+ nose DOWN in three.js terms, as carphysics gives it: it is negative under power) and roll (+ left side up), each held to the travel the arches allow. */
export function leanBody(vehicle, pitch = 0, roll = 0) {
  const b = vehicle.body; if (!b) return;
  const L = b.userData.lean, cl = (v, m) => (v > m ? m : v < -m ? -m : v);
  b.rotation.x = cl(pitch, L.pitch); b.rotation.z = cl(roll, L.roll);
}
