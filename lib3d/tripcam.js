// lib3d/tripcam.js
// The shape of the third-person camera used on a trip: how far behind and above the traveller it sits, how far the player may zoom, how it keeps out of walls, and how it
// eases. Pure maths (no three.js, no DOM) so it can be tested.

/** Base framing. `back` / `height` are metres behind / above the target, `lead` is how far ahead of a moving traveller the camera looks. */
export const CAM = {
  walk: { back: 7.4, height: 3.5, aim: 1.4, fov: 50, lead: 2.6, min: 0.55, max: 1.85 },
  veh: { back: 11.5, height: 4.6, aim: 1.5, fov: 54, lead: 0, min: 0.7, max: 1.9 },
};
export const PITCH = { min: -0.35, max: 0.75 }; // extra height as a fraction of the distance (negative looks up from nearer the ground)
const MIN_BACK = 2.2; // never closer than this, however the player zooms or whatever is in the way

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const clampZoom = (z, kind) => clamp(z, CAM[kind].min, CAM[kind].max);
/** Pinch / wheel -> zoom. `scale` > 1 means fingers moved apart (closer); wheel deltaY > 0 means away. */
export const zoomByPinch = (z, scale, kind) => clampZoom(z / clamp(scale, 0.5, 2), kind);
export const zoomByWheel = (z, deltaY, kind) => clampZoom(z * Math.exp(clamp(deltaY, -240, 240) * 0.0012), kind);

/** Frame-rate independent approach of `cur` to `want` with rate `k` (per second). */
export const ease = (cur, want, k, dt) => cur + (want - cur) * (1 - Math.exp(-k * dt));

const TAU = Math.PI * 2;
/**
 * The shortest signed turn from angle `a` to angle `b`, in [-PI, PI], however many whole turns apart the two numbers are. (The old formula only held while b - a stayed above -3 PI:
 * a camera angle that had been wound up by a few left-hand loops then took the LONG way round to find the road behind the car, so the view spun the wrong way.)
 */
export function angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; }
/** How fast the chase camera swings in behind a vehicle (per second): quicker at speed, and quickest while riding as a passenger. */
export const swingRate = (speed, ride = false) => (ride ? 5 : 2.6 + Math.min(1.6, Math.abs(speed) * 0.1));
/**
 * One step of the chase camera's heading (the direction from the vehicle back to the camera) towards `want`, the opposite of the vehicle's own heading. Takes the short way round
 * every time, and hands back an angle within half a turn of `want`, so it can never wind up however long the player drives in circles.
 */
export function followYaw(cur, want, speed, dt, ride = false) {
  const next = cur + angDiff(cur, want) * (1 - Math.exp(-swingRate(speed, ride) * dt));
  return want + angDiff(want, next);
}

/** The wanted framing for this moment: distance behind, height above, and the field of view. Faster vehicles pull the camera back a little. */
export function frame({ inVeh, speed = 0, zoom = 1, pitch = 0 }) {
  const c = inVeh ? CAM.veh : CAM.walk, back = Math.max(MIN_BACK, (c.back + (inVeh ? Math.min(5, Math.abs(speed) * 0.12) : 0)) * zoom);
  const height = c.height * (0.55 + 0.45 * zoom) + clamp(pitch, PITCH.min, PITCH.max) * back;
  return { back, height, aim: c.aim, fov: c.fov + (inVeh ? Math.min(8, Math.abs(speed) * 0.18) : 0) };
}

/**
 * How far back the camera may go from the target (tx, tz) looking along the unit vector (bx, bz) pointing from the target to the camera, so it stays outside walls.
 * Three rays (centre, and a little to each side) so a corner is cleared as well as a flat wall. `world.raycast(ax, az, bx, bz)` gives t in [0, 1] or null.
 */
export function clearBack(world, tx, tz, bx, bz, want, margin = 0.7, side = 0.5) {
  if (!world?.raycast) return want;
  let best = want; const rx = -bz, rz = bx;
  for (const o of [0, -side, side]) {
    const ax = tx + rx * o, az = tz + rz * o, t = world.raycast(ax, az, ax + bx * (want + margin), az + bz * (want + margin));
    if (t != null) best = Math.min(best, t * (want + margin) - margin);
  }
  return Math.max(MIN_BACK * 0.6, best);
}

/** Smoothly move the camera's actual distance toward the allowed one: in quickly when a wall is in the way (never inside it), out slowly. */
export const followBack = (cur, allowed, dt) => allowed < cur ? ease(cur, allowed, 16, dt) : ease(cur, allowed, 2.2, dt);
