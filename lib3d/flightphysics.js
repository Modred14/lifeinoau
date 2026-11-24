// lib3d/flightphysics.js
// How a flying car (lib/cars.js `flies: true`) leaves the road, flies and comes back down. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// The rules are chosen so that flying can never break the ground game (roads, buildings, traffic, people, the server's view of the player):
//   - TAKE-OFF is vertical, from a stop (under TAKEOFF_MAX_V m/s) on the ground road, with the fans out. The car does not move sideways until it is above CLEARANCE_M, higher than any building,
//     so nothing can be hit on the way up. The fans take FAN_SECONDS to deploy before the climb starts.
//   - FLIGHT above CLEARANCE_M is free of the road and of buildings. Throttle and brake set the speed along the nose (up to AIR_TOP m/s; held at a stop the brake selects reverse, as on the ground),
//     steer turns the nose, climb tips the nose up or down (up to CEILING_M).
//   - Below CLEARANCE_M the car holds its place: it can only go straight down, so LANDING is always vertical onto the spot under it. It descends only if that spot is road clear of
//     buildings and traffic (ctx.landingClear()); otherwise it hovers at CLEARANCE_M and the pilot is told to move over a road.
//   - LANDING ends with the wheels on the road, the fans folded away and the car back in the ground physics (lib3d/carphysics.js), at the speed it had (zero).
// The ground position (x, z) is what the server and other players see; altitude is for the drawing and the camera only (the road follower's own.h, own.road.y).
//
// DIRECTION. Flight uses the SAME convention as the ground cars (lib3d/heading.js): the yaw `own.ang` gives the nose heading (hx, hz) = (sin ang, cos ang), a steer of +1 is a RIGHT turn and makes the yaw
// fall (STEER_TO_YAW), and the car moves along its nose. In three dimensions the nose is forwardVector(own.ang, air.pitch): the speed `own.v` (negative in reverse) is the speed ALONG THE NOSE, so the
// car moves over the ground at v*cos(pitch) along the heading and climbs at v*sin(pitch). The pilot never sets a velocity, only the nose and the throttle, so the way the car points and the way it
// moves cannot disagree. The one exception is the hover: at a standstill the lift fans can raise or lower the car (the climb input) without any nose angle, and that vertical help fades away as the
// airspeed builds (VTOL_BLEND_V, so the climb rate stays between about 8 and 9 m/s at every speed), leaving the nose to do all the climbing: from VTOL_BLEND_V up the car moves EXACTLY along its nose, and
// with no climb input the nose is level and it does at any speed. The attitude for the drawing is air.pitch (+ nose up) and air.roll (+ left side up, so a right bank is positive); the drawing
// takes them from own.road (lib3d/tripflow.js flyOwn) through the same pose the ground cars use (lib3d/heading.js poseRotation).
import { STEER_TO_YAW, headingOf } from "./heading.js";

export const CLEARANCE_M = 40, CEILING_M = 260, CLIMB_MAX = 9, CLIMB_ACCEL = 4, DESCEND_MAX = 7, FAN_SECONDS = 1.6, TAKEOFF_MAX_V = 3, LAND_FINAL_M = 1.2;
export const AIR_TOP = 55, AIR_ACCEL = 14, AIR_BRAKE = 18, AIR_DRAG = 0.012, YAW_MAX = 0.9, BANK_MAX = 0.42;
/** The most the nose may tip (radians, about 29 degrees), how fast it tips (rad/s), the vertical acceleration a change of pitch may cause (m/s2: so it is gentle at speed), and the airspeed (m/s) by which the lift fans' help is gone. */
export const PITCH_MAX = 0.5, PITCH_RATE = 0.5, PITCH_VACC = 6, VTOL_BLEND_V = 16;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toward = (cur, want, d) => (want > cur ? Math.min(want, cur + d) : Math.max(want, cur - d));

/** The most the nose may be tipped at this speed along it, for a climb (up >= 0) or a dive: the same CLIMB_MAX / DESCEND_MAX limits as always, so a fast car tips its nose only a little. */
export function pitchLimit(speed, up = 1) {
  const s = Math.abs(speed); if (s < 1e-6) return PITCH_MAX;
  return Math.min(PITCH_MAX, Math.asin(Math.min(1, (up >= 0 ? CLIMB_MAX : DESCEND_MAX) / s)));
}

/** A new flight record, on the ground. vy: the lift fans' vertical speed; rise: the whole vertical speed (fans plus the climb the nose gives); pitch / roll: the attitude for the drawing (see above). */
export const createAir = () => ({ state: "ground", alt: 0, vy: 0, rise: 0, pitch: 0, roll: 0, fan: 0, spin: 0, why: null });

/** Can this car take off now? { ok, why }. `onGround`: on the ground road (not a ramp or the expressway deck). */
export function canTakeOff(own, air, onGround) {
  if (!own?.P?.flies) return { ok: false, why: "This car cannot fly." };
  if (air.state !== "ground") return { ok: false, why: "Already flying." };
  if (!onGround) return { ok: false, why: "Take off from a normal road, not a ramp or the expressway." };
  if (Math.abs(own.v) > TAKEOFF_MAX_V) return { ok: false, why: "Slow down to take off." };
  return { ok: true, why: null };
}
export function takeOff(own, air) { air.state = "takeoff"; air.fan = 0; air.vy = 0; air.rise = 0; air.pitch = 0; air.roll = 0; air.alt = Math.max(0, own.h ?? 0); own.v = 0; own.thr = own.brk = 0; own.reversing = false; own.holdT = 0; air.why = null; }
/** Ask to land: from flight or a take-off in progress. */
export function land(air) { if (air.state === "cruise" || air.state === "takeoff") air.state = "landing"; }
export const isAirborne = (air) => air.state !== "ground";
/** Fraction (0..1) the lift fans are out: for the model (v.flight.deploy) and the sound. */
export const fanOut = (air) => clamp(air.fan / FAN_SECONDS, 0, 1);

/**
 * One step of flight. own: a car (lib3d/carphysics.js createCar) with .P and .h; inp: { gas, brake, steer (+1 right), climb (-1 nose down .. +1 nose up) }; ctx.landingClear(): is the road under the car free to
 * land on. Moves own.x/z/ang/hx/hz and sets own.v (the speed along the nose, negative in reverse) and own.h (altitude above the road), air.* (including the attitude air.pitch / air.roll). Returns { landed, notice }.
 */
export function stepAir(own, air, inp, dt, ctx = {}) {
  let landed = false, notice = null;
  if (air.state === "ground") return { landed, notice };
  const up = clamp(inp.climb ?? 0, -1, 1), gas = clamp(inp.gas ?? 0, 0, 1), brk = clamp(inp.brake ?? 0, 0, 1), steer = clamp(inp.steer ?? 0, -1, 1);
  const P = own.P ?? {}, top = Math.min(AIR_TOP, P.airTop ?? AIR_TOP), revMax = P.reverseMax ?? 5, revAcc = P.reverseAccel ?? 2.4, revDelay = P.reverseDelay ?? 0.22;
  const fansReady = air.fan >= FAN_SECONDS;
  if (air.state !== "landing" || !fansReady) air.fan = Math.min(FAN_SECONDS, air.fan + dt);
  air.spin = air.state === "ground" ? 0 : fansReady ? 1 : air.fan / FAN_SECONDS;
  const s0 = own.v ?? 0;                                   // the speed along the nose at the start of the step
  const flying = air.state === "cruise" && air.alt >= CLEARANCE_M - 1e-6;      // free flight: the nose has a say

  // ---- the nose: the climb input tips it up or down; it levels out when let go, and under the clearance height or in a take-off / landing it is level ----
  let wantPitch = flying ? up * pitchLimit(s0, up) : 0;
  if (air.alt >= CEILING_M - 1e-6 && wantPitch > 0) wantPitch = 0;                 // at the ceiling the nose levels out rather than pointing up while the car cannot rise
  air.pitch = toward(air.pitch ?? 0, wantPitch, Math.min(PITCH_RATE, PITCH_VACC / Math.max(Math.abs(s0) * Math.cos(air.pitch ?? 0), 6)) * dt);

  // ---- the speed along the nose for this step: throttle pushes forward, the brake slows, and the brake held at a standstill selects reverse (the ground rule, lib3d/carphysics.js).
  // Worked out first, so the climb and the movement over the ground below use the SAME speed and the car moves along its nose exactly ----
  let vNext = s0;
  if (flying) {
    if (gas > 0.05) { own.reversing = false; own.holdT = 0; }
    else if (brk > 0.05 && s0 < 0.3 && !own.reversing) { own.holdT = (own.holdT ?? 0) + dt; if (own.holdT >= revDelay) own.reversing = true; }
    else if (brk <= 0.05) { own.holdT = 0; if (s0 > -0.05) own.reversing = false; }
    let a = 0;
    if (!own.reversing) { a += gas * AIR_ACCEL; if (s0 > 0) a -= brk * AIR_BRAKE; }
    else { a -= revAcc * brk * Math.max(0, 1 - Math.abs(s0) / revMax); if (s0 < 0) a += AIR_BRAKE * gas; }
    a -= AIR_DRAG * s0 * Math.abs(s0);
    vNext = s0 + a * dt - (gas === 0 && brk === 0 ? Math.sign(s0) * Math.min(Math.abs(s0), 2.5 * dt) : 0);
    if ((s0 > 0 && vNext < 0) || (s0 < 0 && vNext > 0)) vNext = 0;      // the forces never push through zero into the other direction by themselves: it stops, and the next step decides
    vNext = clamp(vNext, -revMax, top);
  }

  // ---- vertical: the lift fans (take-off, landing, and a hover) plus the climb the nose gives at speed ----
  const blend = clamp(Math.abs(s0) / VTOL_BLEND_V, 0, 1);
  let want = 0;
  if (!fansReady) want = 0;
  else if (air.state === "takeoff") want = CLIMB_MAX * (up < -0.3 ? 0 : 1);                 // a take-off climbs by itself to the clearance height
  else if (air.state === "landing") want = -clamp(air.alt * 0.9, LAND_FINAL_M, DESCEND_MAX * 0.8);      // fast from high up, a gentle final approach onto the road
  else want = (up > 0 ? CLIMB_MAX * up : DESCEND_MAX * up) * (1 - blend);                    // a hover climbs on its fans; with speed the nose does it
  air.vy = toward(air.vy, want, CLIMB_ACCEL * dt);
  const rise = air.vy + (flying ? vNext * Math.sin(air.pitch) : 0);                              // moving along a tipped nose climbs or dives
  air.rise = rise;
  let alt = air.alt + rise * dt;

  const high = alt >= CLEARANCE_M;
  if (air.state === "takeoff" && high) air.state = "cruise";
  // below the clearance height the car may only go straight down onto a clear road
  if (alt < CLEARANCE_M && air.state !== "takeoff" && rise < 0 && air.alt >= CLEARANCE_M - 1e-6 && !(ctx.landingClear?.() ?? true)) {
    alt = CLEARANCE_M; air.vy = 0; air.rise = 0; notice = "There is no clear road to land on here. Move over a road and try again.";
    if (air.state === "landing") air.state = "cruise";
  }
  if (alt < CLEARANCE_M && air.state === "cruise") air.state = "landing";                    // descending below the clearance height is a landing: no sideways flight there
  alt = clamp(alt, 0, CEILING_M);
  if (alt <= 0.02 && rise < 0) { alt = 0; air.vy = 0; air.rise = 0; air.pitch = 0; air.roll = 0; air.state = "ground"; air.fan = 0; air.spin = 0; own.v = 0; own.reversing = false; own.holdT = 0; landed = true; }
  air.alt = alt; own.h = alt;

  // ---- horizontal: only in free flight (at or above the clearance height) ----
  const free = air.state === "cruise" && alt >= CLEARANCE_M - 1e-6;
  if (free) {
    const v = vNext; own.v = v;
    // steering: the same sign as the ground (a right turn makes the yaw fall), and reversing turns the nose the other way, as a car does
    const turn = (v < -0.3 ? -1 : 1) * steer, rate = STEER_TO_YAW * turn * YAW_MAX * (0.35 + 0.65 * clamp(Math.abs(v) / 10, 0, 1));
    // moved along the heading at the middle of the step (so a turn is not cut short, as on the ground), the heading afterwards is the end one
    const mid = headingOf(own.ang + (rate * dt) / 2), along = v * Math.cos(air.pitch);          // along the nose, over the ground (the climb v * sin(pitch) was done above)
    own.ang += rate * dt; own.yawRate = rate; const h = headingOf(own.ang); own.hx = h.hx; own.hz = h.hz;
    own.x += mid.hx * along * dt; own.z += mid.hz * along * dt; own.distance += Math.abs(along) * dt;
    air.roll = toward(air.roll ?? 0, turn * BANK_MAX * clamp(Math.abs(v) / 20, 0, 1), 1.5 * dt);   // into the turn: a right turn banks right side down, which is a positive roll
  } else { own.v = toward(own.v, 0, 20 * dt); own.reversing = false; own.holdT = 0; air.roll = toward(air.roll ?? 0, 0, 1.5 * dt); own.yawRate = 0; }
  own.roll = toward(own.roll ?? 0, 0, 1.5 * dt); own.pitch = toward(own.pitch ?? 0, 0, 0.6 * dt);     // the suspension lean (the ground body lean) settles; the flight attitude is air.pitch / air.roll
  if (notice) air.why = notice;      // the last thing the pilot was told, kept until the next take-off
  return { landed, notice };
}
