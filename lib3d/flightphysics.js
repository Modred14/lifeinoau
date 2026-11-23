// lib3d/flightphysics.js
// How a flying car (lib/cars.js `flies: true`) leaves the road, flies and comes back down. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
//
// The rules are chosen so that flying can never break the ground game (roads, buildings, traffic, people, the server's view of the player):
//   - TAKE-OFF is vertical, from a stop (under TAKEOFF_MAX_V m/s) on the ground road, with the fans out. The car does not move sideways until it is above CLEARANCE_M, higher than any building,
//     so nothing can be hit on the way up. The fans take FAN_SECONDS to deploy before the climb starts.
//   - FLIGHT above CLEARANCE_M is free of the road and of buildings. Throttle and brake set the airspeed (up to AIR_TOP m/s), steer turns the nose, climb moves the altitude (up to CEILING_M).
//   - Below CLEARANCE_M the car holds its place: it can only go straight down, so LANDING is always vertical onto the spot under it. It descends only if that spot is road clear of
//     buildings and traffic (ctx.landingClear()); otherwise it hovers at CLEARANCE_M and the pilot is told to move over a road.
//   - LANDING ends with the wheels on the road, the fans folded away and the car back in the ground physics (lib3d/carphysics.js), at the speed it had (zero).
// The ground position (x, z) is what the server and other players see; altitude is for the drawing and the camera only (the road follower's own.h, own.road.y).
export const CLEARANCE_M = 40, CEILING_M = 260, CLIMB_MAX = 9, CLIMB_ACCEL = 4, DESCEND_MAX = 7, FAN_SECONDS = 1.6, TAKEOFF_MAX_V = 3, LAND_FINAL_M = 1.2;
export const AIR_TOP = 55, AIR_ACCEL = 14, AIR_BRAKE = 18, AIR_DRAG = 0.012, YAW_MAX = 0.9, BANK_MAX = 0.42;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const toward = (cur, want, d) => (want > cur ? Math.min(want, cur + d) : Math.max(want, cur - d));

/** A new flight record, on the ground. */
export const createAir = () => ({ state: "ground", alt: 0, vy: 0, fan: 0, spin: 0, why: null });

/** Can this car take off now? { ok, why }. `onGround`: on the ground road (not a ramp or the expressway deck). */
export function canTakeOff(own, air, onGround) {
  if (!own?.P?.flies) return { ok: false, why: "This car cannot fly." };
  if (air.state !== "ground") return { ok: false, why: "Already flying." };
  if (!onGround) return { ok: false, why: "Take off from a normal road, not a ramp or the expressway." };
  if (Math.abs(own.v) > TAKEOFF_MAX_V) return { ok: false, why: "Slow down to take off." };
  return { ok: true, why: null };
}
export function takeOff(own, air) { air.state = "takeoff"; air.fan = 0; air.vy = 0; air.alt = Math.max(0, own.h ?? 0); own.v = 0; own.thr = own.brk = 0; air.why = null; }
/** Ask to land: from flight or a take-off in progress. */
export function land(air) { if (air.state === "cruise" || air.state === "takeoff") air.state = "landing"; }
export const isAirborne = (air) => air.state !== "ground";
/** Fraction (0..1) the lift fans are out: for the model (v.flight.deploy) and the sound. */
export const fanOut = (air) => clamp(air.fan / FAN_SECONDS, 0, 1);

/**
 * One step of flight. own: a car (lib3d/carphysics.js createCar) with .P and .h; inp: { gas, brake, steer (+1 right), climb (-1 down .. +1 up) }; ctx.landingClear(): is the road under the car free to
 * land on. Moves own.x/z/ang/hx/hz and sets own.v (airspeed along the nose) and own.h (altitude above the road), air.* . Returns { landed, notice }.
 */
export function stepAir(own, air, inp, dt, ctx = {}) {
  let landed = false, notice = null;
  if (air.state === "ground") return { landed, notice };
  const up = clamp(inp.climb ?? 0, -1, 1), gas = clamp(inp.gas ?? 0, 0, 1), brk = clamp(inp.brake ?? 0, 0, 1);
  const fansReady = air.fan >= FAN_SECONDS;
  if (air.state !== "landing" || !fansReady) air.fan = Math.min(FAN_SECONDS, air.fan + dt);
  air.spin = air.state === "ground" ? 0 : fansReady ? 1 : air.fan / FAN_SECONDS;

  // ---- vertical ----
  let want = 0;
  if (!fansReady) want = 0;
  else if (air.state === "takeoff") want = CLIMB_MAX * (up < -0.3 ? 0 : 1);                 // a take-off climbs by itself to the clearance height
  else if (air.state === "landing") want = -clamp(air.alt * 0.9, LAND_FINAL_M, DESCEND_MAX * 0.8);      // fast from high up, a gentle final approach onto the road
  else want = up > 0 ? CLIMB_MAX * up : DESCEND_MAX * up;
  if (air.state === "cruise" && up === 0) want = 0;
  air.vy = toward(air.vy, want, CLIMB_ACCEL * dt);
  let alt = air.alt + air.vy * dt;

  const high = alt >= CLEARANCE_M;
  if (air.state === "takeoff" && high) air.state = "cruise";
  // below the clearance height the car may only go straight down onto a clear road
  if (alt < CLEARANCE_M && air.state !== "takeoff" && air.vy < 0 && air.alt >= CLEARANCE_M - 1e-6 && !(ctx.landingClear?.() ?? true)) {
    alt = CLEARANCE_M; air.vy = 0; notice = "There is no clear road to land on here. Move over a road and try again.";
    if (air.state === "landing") air.state = "cruise";
  }
  if (alt < CLEARANCE_M && air.state === "cruise") air.state = "landing";                    // descending below the clearance height is a landing: no sideways flight there
  alt = clamp(alt, 0, CEILING_M);
  if (alt <= 0.02 && air.vy < 0) { alt = 0; air.vy = 0; air.state = "ground"; air.fan = 0; air.spin = 0; own.v = 0; landed = true; }
  air.alt = alt; own.h = alt;

  // ---- horizontal: only in free flight (at or above the clearance height) ----
  const free = air.state === "cruise" && alt >= CLEARANCE_M - 1e-6;
  if (free) {
    let v = own.v; const a = gas * AIR_ACCEL - brk * AIR_BRAKE - AIR_DRAG * v * v * Math.sign(v);
    v = clamp(v + a * dt - (gas === 0 && brk === 0 ? Math.sign(v) * Math.min(Math.abs(v), 2.5 * dt) : 0), 0, Math.min(AIR_TOP, own.P.airTop ?? AIR_TOP)); own.v = v;
    const rate = clamp(inp.steer ?? 0, -1, 1) * YAW_MAX * (0.35 + 0.65 * clamp(v / 10, 0, 1)); own.ang += rate * dt; own.yawRate = rate;
    own.hx = Math.sin(own.ang); own.hz = Math.cos(own.ang); own.x += own.hx * v * dt; own.z += own.hz * v * dt; own.distance += v * dt;
    own.roll = toward(own.roll ?? 0, -clamp(inp.steer ?? 0, -1, 1) * BANK_MAX * clamp(v / 20, 0, 1), 1.5 * dt); own.pitch = toward(own.pitch ?? 0, -(gas - brk) * 0.12 * (v > 1 ? 1 : 0), 0.6 * dt);
  } else { own.v = toward(own.v, 0, 20 * dt); own.roll = toward(own.roll ?? 0, 0, 1.5 * dt); own.pitch = toward(own.pitch ?? 0, 0, 0.6 * dt); own.yawRate = 0; }
  if (notice) air.why = notice;      // the last thing the pilot was told, kept until the next take-off
  return { landed, notice };
}
