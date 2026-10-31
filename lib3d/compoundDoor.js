// lib3d/compoundDoor.js
// The two door sequences of your own vehicle in the home compound, as pure functions of time (no three.js, no DOM), so the 3D room only has to draw them and the tests can check
// every frame. They are the same sequences as the trip flow's (lib3d/tripflow.js boardCar / exitCar: same times, same easing), so getting in and out looks the same everywhere.
//
//   enterPose(t, g)   standing at the door -> the door opens -> step through it and sit -> the door closes (CAR_BOARD_SECONDS)
//   exitPose(t, g)    sitting -> the door opens -> climb out onto the chosen spot -> the door closes (CAR_ALIGHT_SECONDS)
//
// g comes from lib3d/compoundWalk.js doorGeometry(): { side, spot, door, seat: { x, z, y }, hx, hz }. A pose is { x, z, fx, fz (the way the person faces), door (0 shut .. 1 open),
// seat (0 standing .. 1 seated), seated, hidden (inside a shut car: nothing to see), moved (metres since the sequence began), done }. Metres, x east, z south.
import { CAR_BOARD_SECONDS, CAR_ALIGHT_SECONDS } from "../lib/travel.js";

export const ENTER_SECONDS = CAR_BOARD_SECONDS, EXIT_SECONDS = CAR_ALIGHT_SECONDS;
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const lerp = (a, b, k) => a + (b - a) * k;

/** t seconds into getting in. The person stands at the spot beside the door while it opens, steps through it, sits, and the door closes behind them. */
export function enterPose(t, g) {
  const T = ENTER_SECONDS, a = smooth((t - 1.1) / 0.9), b = smooth((t - 1.9) / 1.0), seat = smooth((t - 1.8) / 1.2);
  const x = lerp(lerp(g.spot.x, g.door.x, a), g.seat.x, b), z = lerp(lerp(g.spot.z, g.door.z, a), g.seat.z, b);
  const door = t >= T ? 0 : smooth((t - 0.4) / 0.7) * (1 - smooth((t - (T - 1.1)) / 0.8)), seated = seat >= 0.5;
  const toward = t < 1.1 ? { x: g.door.x - g.spot.x, z: g.door.z - g.spot.z } : { x: g.hx, z: g.hz };
  return { x, z, fx: toward.x, fz: toward.z, door, seat: t >= T ? 1 : seat, seated, hidden: seat >= 0.98 && door <= 0.03 && t > 1.9, moved: Math.hypot(x - g.spot.x, z - g.spot.z), done: t >= T };
}

/** t seconds into getting out. The door opens while they are still seated, they climb out through it onto the spot, and the door closes. */
export function exitPose(t, g) {
  const T = EXIT_SECONDS, a = smooth((t - 0.7) / 0.9), b = smooth((t - 1.5) / 0.9), seat = 1 - smooth((t - 0.7) / 1.0);
  const x = lerp(lerp(g.seat.x, g.door.x, a), g.spot.x, b), z = lerp(lerp(g.seat.z, g.door.z, a), g.spot.z, b);
  const door = t >= T ? 0 : smooth(t / 0.7) * (1 - smooth((t - (T - 0.8)) / 0.6)), moving = t > 0.7 && t < 2.4;
  const toward = moving ? { x: g.spot.x - g.seat.x, z: g.spot.z - g.seat.z } : { x: g.hx, z: g.hz };
  return { x, z, fx: toward.x, fz: toward.z, door, seat: t >= T ? 0 : seat, seated: seat >= 0.5, hidden: seat >= 0.98 && door <= 0.03 && t < 0.7, moved: Math.hypot(x - g.seat.x, z - g.seat.z), done: t >= T };
}