// lib3d/carphysics.js
// How your own car moves. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// A kinematic bicycle model with the things that make a car feel like a car:
//   - the car goes where its front wheels point: it turns about a point on the rear axle, so there is no sideways slide and no turning on the spot,
//   - the wheels take time to turn (a rate, not a jump) and turn less the faster you go,
//   - the body takes time to start turning (a short lag on the yaw rate), and a tight turn at speed is limited by grip (the car runs wide instead of sliding),
//   - the throttle and brake pedals ramp in; the engine pushes with at most the tyres' launch limit and then with constant POWER (a = power / speed, as a real car does), drag grows with
//     the square of the speed and brings full throttle to rest exactly at the vehicle's real top speed; rolling resistance and engine braking slow a coasting car,
//     (power, drag and the top speed come from the vehicle's real figures: lib/vehiclePerformance.js),
//   - the brake stops the car and never reverses it by itself; holding the brake once stopped (a moment later) selects reverse, as in a driving game,
//   - everything is integrated in equal sub-steps of at most MAX_STEP seconds AND at most MAX_STEP_M metres, so the result hardly depends on the frame rate and a car at 90 m/s still
//     checks for a wall every half metre (it can never skip through one).
// Convention: x east, z south, heading (hx, hz) = (sin ang, cos ang). `steer` on the car is the front wheel angle, positive = LEFT (the car's own +x is its left).
// Input: { gas 0..1, brake 0..1, steer -1..1 } where steer +1 is a RIGHT turn (D / the wheel turned clockwise).
import { OWN_CAR_MAX } from "../lib/travel.js";
import { VEHICLE_PERFORMANCE, STANDARD_VEHICLE, deriveLongitudinal, PEDAL_UP } from "../lib/vehiclePerformance.js";

/** The lock available at speed falls to a half at this speed (m/s): a faster vehicle keeps its lock to a higher speed, so a supercar is as steerable at its own speeds as a family car is at its. */
const lockRef = (vmax) => 12 * Math.sqrt(Math.max(1, vmax / 22));

export const CAR = {
  wheelbase: 2.7, reverseMax: 5,
  reverseAccel: 2.4,
  engineBrake: 1.1,      // m/s2 when coasting in gear
  steerMax: 0.56,        // rad at a crawl (about 32 degrees)
  steerRate: 1.5,        // rad/s turning in
  steerReturn: 2.3,      // rad/s coming back to straight
  latG: 7.0,             // m/s2 of sideways acceleration the tyres hold
  yawLag: 0.09,          // s: how long the body takes to follow the wheels
  pedalUp: PEDAL_UP, pedalDown: 14, // 1/s: how fast a pedal ramps in / out
  reverseDelay: 0.22,    // s stopped with the brake held before reverse is engaged
  maxStep: 1 / 90,
  ...deriveLongitudinal(STANDARD_VEHICLE),   // vmax, accel (the launch limit, m/s2), power, drag, rolling, brake
  steerSpeedRef: lockRef(deriveLongitudinal(STANDARD_VEHICLE).vmax),
};
/** The longest distance (m) a car may move in one sub-step, however fast it goes: the collision probe is asked at least this often along the way. */
export const MAX_STEP_M = 0.5, MAX_SUBSTEPS = 400;

// Every vehicle drives differently. Its LONGITUDINAL performance (top speed, power, drag, launch, brakes) comes from lib/vehiclePerformance.js, from the real figures; what is here is its HANDLING:
// wheelbase, steering lock, grip, how fast the body follows the wheels, and reverse. The top speed never goes above OWN_CAR_MAX (the server's cap on what a driven vehicle may report,
// itself the fastest vehicle in the table). Wheelbases are the real ones, the same as in lib3d/vehicleSpecs.js (a test checks they agree).
const HANDLING = {
  "corolla-2011":    { wheelbase: 2.60, steerMax: 0.58, latG: 6.4, yawLag: 0.10 },
  "accord-2014":     { wheelbase: 2.776, steerMax: 0.56, latG: 6.8, yawLag: 0.10 },
  "camry-2014":      { wheelbase: 2.775, steerMax: 0.56, latG: 6.6, yawLag: 0.10 },
  "is350-2014":      { wheelbase: 2.80, steerMax: 0.55, latG: 7.6, yawLag: 0.08 },
  "cclass-2016":     { wheelbase: 2.865, steerMax: 0.55, latG: 7.2, yawLag: 0.09 },
  "gle-2018":        { wheelbase: 2.995, steerMax: 0.52, latG: 6.0, yawLag: 0.12 },
  "rrsport-2016":    { wheelbase: 2.923, steerMax: 0.52, latG: 6.0, yawLag: 0.12 },
  "urus-2025":       { wheelbase: 3.003, steerMax: 0.52, latG: 8.0, yawLag: 0.09 },
  "huracan-2025":    { wheelbase: 2.62, steerMax: 0.52, latG: 9.4, yawLag: 0.07, reverseMax: 4 },
  "cybertruck-2024": { wheelbase: 3.80, steerMax: 0.50, latG: 6.0, yawLag: 0.13 },
  keke:              { wheelbase: 1.95, steerMax: 0.70, latG: 4.2, yawLag: 0.10, reverseMax: 2.5, reverseAccel: 1.2, steerSpeedRef: 7 },
  bus:               { wheelbase: 4.12, steerMax: 0.43, latG: 4.4, yawLag: 0.14, reverseMax: 3, reverseAccel: 1.2, steerSpeedRef: 9 },
};
export const PROFILES = Object.fromEntries(Object.entries(HANDLING).map(([id, h]) => {
  const L = deriveLongitudinal(VEHICLE_PERFORMANCE[id]);
  return [id, { ...h, ...L, steerSpeedRef: h.steerSpeedRef ?? lockRef(L.vmax) }];
}));
/** The handling of a vehicle by its id (a car id, "keke" or "bus"); an unknown id drives like the standard car. */
export function carProfile(id) { const o = PROFILES[id]; if (!o) return CAR; const P = { ...CAR, ...o }; P.vmax = Math.min(P.vmax, OWN_CAR_MAX); return P; }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const approach = (cur, want, maxD) => (want > cur ? Math.min(want, cur + maxD) : Math.max(want, cur - maxD));

/** A new car at rest. pose: { x, z, ang }. */
export function createCar({ x = 0, z = 0, ang = 0 } = {}) {
  return { x, z, ang, hx: Math.sin(ang), hz: Math.cos(ang), v: 0, steer: 0, yawRate: 0, thr: 0, brk: 0, reversing: false, holdT: 0, accel: 0, lat: 0, pitch: 0, roll: 0, pen: 0, impact: 0, grip: 1, distance: 0 };
}

/** The most the front wheels may turn at this speed. */
export const steerLimit = (v, P = CAR) => P.steerMax / (1 + (v / P.steerSpeedRef) ** 2);

/**
 * probe(x, z, hx, hz) -> null when the car may be there, or { pen: number } (a bigger pen is a worse place: off the road, in a wall, in another car).
 * A move that is blocked is refused unless it is no worse than where the car already is (so a car that starts half off the kerb, or is nudged by traffic, can always drive out).
 */
function sub(c, inp, h, probe, P) {
  // ---- pedals ----
  const gasIn = clamp(inp.gas ?? 0, 0, 1), brkIn = clamp(inp.brake ?? 0, 0, 1);
  c.thr += (gasIn - c.thr) * (1 - Math.exp(-h * (gasIn > c.thr ? P.pedalUp : P.pedalDown)));
  c.brk += (brkIn - c.brk) * (1 - Math.exp(-h * (brkIn > c.brk ? P.pedalUp * 1.6 : P.pedalDown)));
  if (c.thr < 0.002) c.thr = 0; if (c.brk < 0.002) c.brk = 0;

  // ---- reverse is selected by holding the brake at a standstill ----
  if (gasIn > 0.05) { c.reversing = false; c.holdT = 0; }
  else if (brkIn > 0.05 && c.v < 0.3 && !c.reversing) { c.holdT += h; if (c.holdT >= P.reverseDelay) c.reversing = true; }
  else if (brkIn <= 0.05) { c.holdT = 0; if (c.v > -0.05) c.reversing = false; }

  // ---- speed ----
  const v0 = c.v; let a = 0, pedal = false;
  if (v0 >= 0 && !c.reversing) {
    a += c.thr * Math.min(P.accel, P.power / Math.max(v0, 0.1)); pedal ||= c.thr > 0;   // the tyres' launch limit, then constant power; drag (below) holds it at the top speed
    if (c.brk > 0 && v0 > 0.02) { a -= P.brake * c.brk; pedal = true; }
    if (v0 > 0) a -= P.drag * v0 * v0 + P.rolling + (c.thr < 0.05 && c.brk < 0.05 ? P.engineBrake : 0);
  } else {
    // reversing, or still rolling backwards
    if (c.reversing) { a -= P.reverseAccel * c.brk * Math.max(0, 1 - Math.abs(v0) / P.reverseMax); pedal ||= c.brk > 0; }
    if (c.thr > 0 && v0 < 0) { a += P.brake * c.thr; pedal = true; }                    // the throttle stops a car rolling backwards
    if (v0 < 0) a += P.drag * v0 * v0 + P.rolling + (c.thr < 0.05 && c.brk < 0.05 ? P.engineBrake : 0);
  }
  let v1 = v0 + a * h;
  // forces and the brake never push a car through zero into the other direction by themselves: it stops, and the next step decides what happens
  if ((v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0)) v1 = 0;
  if (!pedal && Math.abs(v1) < 0.06) v1 = 0;
  v1 = clamp(v1, -P.reverseMax, P.vmax);

  // ---- steering: the wheels turn at a limited rate, towards an angle that shrinks with speed ----
  const lim = steerLimit(Math.abs((v0 + v1) / 2), P), want = -clamp(inp.steer ?? 0, -1, 1) * lim;
  const toward = Math.abs(want) >= Math.abs(c.steer) && Math.sign(want || 1) === Math.sign(c.steer || want || 1) ? P.steerRate : P.steerReturn;
  c.steer = approach(c.steer, want, toward * h); c.steer = clamp(c.steer, -lim, lim);

  // ---- turning: the yaw rate the wheels ask for, held to what the tyres can grip, followed with a short lag ----
  const vm = (v0 + v1) / 2, curv = Math.tan(c.steer) / P.wheelbase; let yawWant = vm * curv, grip = 1;
  const ay = vm * yawWant; if (Math.abs(ay) > P.latG) { grip = P.latG / Math.abs(ay); yawWant *= grip; }
  c.grip += (grip - c.grip) * Math.min(1, h * 8);
  c.yawRate += (yawWant - c.yawRate) * (1 - Math.exp(-h / P.yawLag)); if (Math.abs(vm) < 0.02 && Math.abs(yawWant) < 1e-4) c.yawRate *= 0.5;

  // ---- move (the heading at the middle of the step, so a fast turn is not cut short) ----
  const angMid = c.ang + (c.yawRate * h) / 2, ang1 = c.ang + c.yawRate * h, dist = vm * h, mx = Math.sin(angMid), mz = Math.cos(angMid);
  const nx = c.x + mx * dist, nz = c.z + mz * dist, hx = Math.sin(ang1), hz = Math.cos(ang1);
  const hit = probe ? probe(nx, nz, hx, hz) : null;
  let free = !hit || hit.pen <= c.pen + 1e-6;
  if (!free) {
    // c.pen is how bad the last accepted place was. Something else may have moved since (a car driving into ours head-on, a door, a nudge), so where we stand NOW can be worse than c.pen says.
    // Judged against the stale number every move, even straight backwards out of the overlap, looked "worse" and the car was pinned for good. Measure where we really are, and let any move that
    // is no worse than that (so reversing away from what we hit) go through; only moves that dig deeper in are refused.
    const here = probe(c.x, c.z, c.hx, c.hz)?.pen ?? 0; c.pen = here; free = hit.pen <= here + 1e-6;
  }
  if (free) {
    c.x = nx; c.z = nz; c.ang = ang1; c.hx = hx; c.hz = hz; c.v = v1; c.pen = hit ? hit.pen : 0; c.distance += Math.abs(dist);
  } else {
    // something solid: stay where we are, lose the speed at once, and give a little back so the car is never pinned (the kerb, a wall or another car)
    const fast = Math.abs(v0);
    c.impact = Math.max(c.impact, fast); c.v = fast > 1.5 ? -Math.sign(v0) * Math.min(1.2, fast * 0.12) : 0; c.yawRate *= 0.4; c.thr *= 0.5; a = (c.v - v0) / h;
  }
  // ---- the body: pitches under acceleration, rolls in a corner (drawing only) ----
  c.accel += (a - c.accel) * Math.min(1, h * 6); c.lat += (vm * c.yawRate - c.lat) * Math.min(1, h * 6);
  c.pitch += (clamp(-c.accel * 0.0055, -0.045, 0.045) - c.pitch) * Math.min(1, h * 7); c.roll += (clamp(c.lat * 0.0042, -0.05, 0.05) - c.roll) * Math.min(1, h * 7);
}

/** Moves the car on by dt seconds (in equal sub-steps). Returns the car. */
export function stepCar(c, inp, dt, probe = null, P = CAR) {
  if (!(dt > 0)) return c;
  // sub-steps: short enough in time, and short enough in distance that the collision probe is asked every MAX_STEP_M metres however fast the car is going
  const reach = (Math.abs(c.v) + P.accel * dt) * dt, n = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / P.maxStep), Math.ceil(reach / MAX_STEP_M))), h = dt / n; c.impact = 0;
  for (let i = 0; i < n; i++) sub(c, inp, h, probe, P);
  return c;
}

/** Puts the car at a pose at rest, ready to drive (what getting in does). */
export function placeCar(c, { x, z, ang }, probe = null) {
  Object.assign(c, createCar({ x, z, ang }));
  if (probe) c.pen = probe(x, z, c.hx, c.hz)?.pen ?? 0;
  return c;
}

/** The pedals that stop the car smoothly from where it is, at a constant comfortable deceleration (what the car does by itself when you ask to get out). Rolling forwards it brakes;
 *  rolling backwards the throttle holds it back. Steering goes straight. */
export function gentleStop(c, decel = 4, P = CAR) {
  const k = clamp(decel / P.brake, 0, 1);
  return { gas: c.v < -0.05 ? clamp(decel / P.brake, 0, 0.6) : 0, brake: c.v > 0.05 ? k : 0, steer: 0 };
}
