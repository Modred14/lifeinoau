// lib3d/heading.js
// THE direction convention of every vehicle in the game, in one place. Pure maths (no three.js, no DOM): the ground physics (lib3d/carphysics.js), the flight physics (lib3d/flightphysics.js),
// the drawing (lib3d/travel.js) and the tests all take their directions from here, so a car and a flying car can never disagree about which way "forward" or "right" is.
//
//   world:    x east, y up, z south.
//   vehicle:  drawn in metres with its NOSE towards +z; the vehicle's own +x is its LEFT (lib3d/vehicles.js).
//   heading:  the yaw `ang` (radians) gives the nose direction on the ground (hx, hz) = (sin ang, cos ang). So ang = 0 faces +z, and a RISING ang turns the nose towards +x, which is to the LEFT.
//   input:    `steer` is -1..1 with +1 a RIGHT turn (D, the right button, the wheel turned clockwise): it makes ang FALL. STEER_TO_YAW is that sign.
//   pitch:    + is nose UP (the same sense as the road's pitch: + is uphill). roll: + is the vehicle's LEFT side up, so a right-hand bank (right side down) is a positive roll.
//   forward:  forwardVector(ang, pitch) is the unit vector the nose points along in three dimensions; a vehicle that moves along its nose moves along exactly this.
//   drawing:  the vehicle's root is rotated with order "YXZ" by poseRotation(ang, pitch, roll); its nose then points along forwardVector(ang, pitch), which a test checks.

/** The sign that turns a steer input (+1 right) into a change of yaw: a right turn makes `ang` fall. */
export const STEER_TO_YAW = -1;

/** The ground heading (the nose direction in the x-z plane) for a yaw. */
export const headingOf = (ang) => ({ hx: Math.sin(ang), hz: Math.cos(ang) });
/** The yaw for a ground heading. */
export const yawOf = (hx, hz) => Math.atan2(hx, hz);
/** The direction to the vehicle's right on the ground, for a heading. */
export const rightOf = (hx, hz) => ({ x: -hz, z: hx });

/** The unit vector the nose points along, for a yaw and a pitch (+ nose up). pitch 0 is the ground heading with y = 0. */
export function forwardVector(ang, pitch = 0, out = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(pitch);
  out.x = c * Math.sin(ang); out.y = Math.sin(pitch); out.z = c * Math.cos(ang);
  return out;
}

/** The three.js rotation of a vehicle's root for a yaw, pitch (+ nose up) and roll (+ left side up): [x, y, z] for `rotation.set(...)` with `rotation.order = "YXZ"`. */
export const poseRotation = (ang, pitch = 0, roll = 0) => [-pitch, ang, roll];
