// lib3d/impact.js
// What happens to a person a moving vehicle hits. Pure JS (no three.js, no DOM): runs in the browser and in the tests.
// Metres, seconds, kilograms; x east, z south, y up; a heading is (hx, hz) = (sin ang, cos ang), as in lib3d/carphysics.js.
//
//   sweepHit()        did a vehicle, moving from one pose to another during a frame, touch a person on the way? (every <= 0.4 m along the path, so a car at 90 m/s cannot skip a person)
//   vehicleStrike()   the collision itself, as an impulse exchange between the vehicle (mass M, velocity Vc) and the person (mass m, velocity Vp):
//                     - the contact point is the closest point of the vehicle's box to the person and the normal points from it to the person (a corner hit pushes sideways, a face hit straight on),
//                     - along the normal: J = (1 + e) * (M m / (M + m)) * closing speed, so the person leaves at about the vehicle's own speed (a heavy bus gives all of it, a light keke a bit less),
//                     - along the surface: Coulomb friction drags the person on in the direction of travel (it cannot give more than the sliding speed or mu * J),
//                     - the bumper is below the person's centre of mass, so part of the speed becomes lift (more for a low car, less for a high bumper, none below a crawl: a nudge only shoves),
//                     - the same impulse, reversed, slows the vehicle (momentum is conserved: a person costs a car a few percent of its speed, never a stop).
//   createTumble()    the person after the hit, and stepTumble() their flight, bounce, slide, lying and getting up: a point mass with air drag and gravity, a body that spins and comes to lie along the
//                     direction of travel, bounces off the ground (restitution and friction), slides to rest (sliding friction), and is stopped by walls and other vehicles through lib3d/collide.js.
//   tumblePose()      where to put the character: root position, yaw and the tilt about a horizontal axis, for the renderer. The body is pivoted about its centre of mass, and the centre can never be lower
//                     than the body's own half-thickness at that tilt, so a person never clips through the ground and never floats once down.

export const G = 9.81;
export const COM_H = 0.95;           // height of a standing person's centre of mass
export const LIE_H = 0.2;            // height of the centre of mass when lying (half the body's thickness)
export const PERSON_MASS = 75;
export const PERSON_R = 0.32;        // the person's radius on the ground (the same as lib3d/walker.js WALK_R: a test checks they agree; not imported, so the two files never import each other)
export const MAX_LAUNCH = 42;        // m/s: nothing the game's fastest vehicle can do launches anyone harder than this (and the server's own report limit stays a soft clamp)

// ---- the vehicles' mass and how high their front is (a low front lifts the legs and throws the person up; a high one pushes) ----
export const VEHICLE_MASS = { car: 1500, keke: 650, minibus: 3200, bus: 11000 };
const CAR_MASS = { "corolla-2011": 1290, "accord-2014": 1560, "camry-2014": 1530, "is350-2014": 1680, "cclass-2016": 1650, "gle-2018": 2150, "rrsport-2016": 2290, "urus-2025": 2200, "huracan-2025": 1570, "cybertruck-2024": 3100 };
const LIFT = { car: 0.34, keke: 0.26, minibus: 0.16, bus: 0.1 };      // vertical launch per m/s of closing speed above a crawl
const CAR_LIFT = { "huracan-2025": 0.42, "is350-2014": 0.36, "gle-2018": 0.26, "rrsport-2016": 0.25, "urus-2025": 0.28, "cybertruck-2024": 0.2 };
/** Mass (kg) of a vehicle: by car model id when it is known, otherwise by kind ("car", "keke", "minibus", "bus"). */
export const massOf = (kind = "car", id = null) => CAR_MASS[id] ?? VEHICLE_MASS[kind] ?? VEHICLE_MASS.car;
export const liftOf = (kind = "car", id = null) => CAR_LIFT[id] ?? LIFT[kind] ?? LIFT.car;

// ---- tuning: what the body is like ----
const E_BODY = 0.12;          // restitution of the contact with the vehicle (a body wraps and rides, it does not bounce off)
const MU_CONTACT = 0.55;      // friction between the vehicle's surface and clothes: how much of the sliding speed is carried along
const E_GROUND = 0.28, MU_GROUND = 0.7, MU_SLIDE = 0.62;   // bounce, friction in a bounce, and sliding friction on tarmac
const E_WALL = 0.2, WALL_LOSS = 0.8;
const AIR_K = 0.0065;         // quadratic air drag per unit mass (a tumbling body: 0.5 * rho * Cd * A / m)
const GRAZE = 1.2;            // m/s: the least a touching, moving vehicle pushes a person away from its side
const CRAWL = 1.5;            // m/s: closing speed below which a vehicle only shoves
const KNOCKDOWN = 3.0;        // m/s: below this the person staggers and is put down, above it they leave the ground
const VY_MAX = 9;             // the most lift (m/s)
const REST_V = 0.35;          // m/s: slower than this on the ground is at rest
const HIT_AGAIN_S = 1.6;      // s before the same vehicle can strike the same person again
const OTHER_AGAIN_S = 0.35;   // s before a different vehicle can

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hypot = Math.hypot;

// ================================================================== detection ==================================================================

/** Closest point of an oriented box ({x, z, hx, hz, hl, hw}) to (px, pz): { cx, cz, d (distance, 0 inside), inside }. */
export function closestOnBox(b, px, pz) {
  const dx = px - b.x, dz = pz - b.z, u = dx * b.hx + dz * b.hz, w = dx * -b.hz + dz * b.hx;
  const cu = clamp(u, -b.hl, b.hl), cw = clamp(w, -b.hw, b.hw), du = u - cu, dw = w - cw;
  return { cx: b.x + b.hx * cu - b.hz * cw, cz: b.z + b.hz * cu + b.hx * cw, d: hypot(du, dw), inside: Math.abs(u) < b.hl && Math.abs(w) < b.hw, u, w };
}

const angOf = (hx, hz) => Math.atan2(hx, hz);
/**
 * Did a moving vehicle touch a person during one frame? `a` and `b` are the vehicle's pose at the start and the end of the frame ({ x, z, hx, hz, v }, v the signed speed along the
 * heading), `len` and `wid` its size. `p0` and `p1` the person's position at the start and the end ({ x, z }; p1 may be omitted for a person who stood still), `r` their radius.
 * The path is sampled at least every 0.4 m (and at least three times along the vehicle's length), so the vehicle cannot step over a person however fast it goes.
 * Returns null, or { t (0..1 when it happened), box (the vehicle then), px, pz (the person then), v (the vehicle's speed then) }.
 */
export function sweepHit(a, b, len, wid, p0, p1, r = PERSON_R) {
  const hl = len / 2, hw = wid / 2, reach = hl + hw + r + 0.5, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, half = hypot(b.x - a.x, b.z - a.z) / 2 + reach;
  const q1 = p1 ?? p0;
  if (Math.abs((p0.x + q1.x) / 2 - mx) > half + hypot(q1.x - p0.x, q1.z - p0.z) / 2 || Math.abs((p0.z + q1.z) / 2 - mz) > half + hypot(q1.x - p0.x, q1.z - p0.z) / 2) return null;   // broad phase: far away
  const dist = hypot(b.x - a.x, b.z - a.z), n = clamp(Math.ceil(dist / Math.min(0.4, len / 3)), 1, 400), a0 = angOf(a.hx, a.hz);
  let da = angOf(b.hx, b.hz) - a0; da = ((da + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  for (let i = 0; i <= n; i++) {
    const t = i / n, ang = a0 + da * t, box = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, hx: Math.sin(ang), hz: Math.cos(ang), hl, hw };
    const px = p0.x + (q1.x - p0.x) * t, pz = p0.z + (q1.z - p0.z) * t, c = closestOnBox(box, px, pz);
    if (c.d < r) return { t, box, px, pz, v: (a.v ?? 0) + ((b.v ?? a.v ?? 0) - (a.v ?? 0)) * t };
  }
  return null;
}

// ================================================================== the collision ==================================================================

/**
 * The collision of a vehicle with a person.
 *   vehicle: { x, z, hx, hz, v (signed speed along the heading), hl, hw (half length / width), mass, lift }
 *   person:  { x, z, vx, vz, mass? }  (vx, vz: how they are moving: a walker running at the car meets it harder, one running away meets it softer)
 *   opts.travel: { x, z } the direction the person was swept into the vehicle from, used when their centre is already inside the box.
 * Returns null when the vehicle is not closing on the person (they are moving apart or alongside), otherwise
 *   { vx, vy, vz (the person's velocity afterwards), dv (the vehicle's change of speed, along its heading), nx, nz (the contact normal, out of the vehicle), px, pz (the contact point),
 *     closing (m/s along the normal), severity (0..1), kind: "shove" | "knockdown" | "launch", spin (rad/s) }.
 */
export function vehicleStrike(vehicle, person, opts = {}) {
  const M = vehicle.mass ?? VEHICLE_MASS.car, m = person.mass ?? PERSON_MASS, v = vehicle.v ?? 0;
  const Vx = vehicle.hx * v, Vz = vehicle.hz * v, rvx = Vx - (person.vx ?? 0), rvz = Vz - (person.vz ?? 0), rel = hypot(rvx, rvz);
  if (rel < 0.05) return null;
  const c = closestOnBox(vehicle, person.x, person.z); let nx, nz;
  if (!c.inside && c.d > 1e-4) { nx = (person.x - c.cx) / c.d; nz = (person.z - c.cz) / c.d; }
  else {   // the centre is inside the box: leave by the face the person came in through (the one facing against their motion relative to the vehicle)
    const ux = rvx / rel, uz = rvz / rel, rx = -vehicle.hz, rz = vehicle.hx; let best = -Infinity;
    for (const [fx, fz, pen] of [[vehicle.hx, vehicle.hz, vehicle.hl - c.u], [-vehicle.hx, -vehicle.hz, vehicle.hl + c.u], [rx, rz, vehicle.hw - c.w], [-rx, -rz, vehicle.hw + c.w]]) {
      const s = (fx * ux + fz * uz) * 2 - pen * 0.15; if (s > best) { best = s; nx = fx; nz = fz; } }
  }
  let closing = rvx * nx + rvz * nz;      // how fast the vehicle's surface is moving into the person (along the normal)
  // a side-swipe (the vehicle is passing alongside, not at them): the person is touching it while it moves, so it still knocks them aside and drags them along (friction, below)
  if (closing < GRAZE) { if (closing < -0.3 || rel < 1.0) return null; closing = GRAZE; }   // (moving apart, or too slow to matter: no hit)
  const tx = -nz, tz = nx, slide = rvx * tx + rvz * tz;      // the sliding speed along the surface
  const reduced = (M * m) / (M + m), Jn = (1 + E_BODY) * reduced * closing;
  const Jt = clamp(slide * reduced, -MU_CONTACT * Jn, MU_CONTACT * Jn);       // friction: sticks if it can, slips if it cannot
  let vx = (person.vx ?? 0) + (Jn * nx + Jt * tx) / m, vz = (person.vz ?? 0) + (Jn * nz + Jt * tz) / m;
  // the bumper hits below the centre of mass: a part of the speed becomes lift. A nudge (a crawl) only shoves; a hard hit throws the person clear.
  const vh = hypot(vx, vz), over = Math.max(0, closing - CRAWL), vy0 = clamp((vehicle.lift ?? LIFT.car) * over, 0, VY_MAX);
  const k = vh > MAX_LAUNCH ? MAX_LAUNCH / vh : 1; vx *= k; vz *= k;
  // the vehicle gives up the same momentum, along its heading (a person never reverses it: the change stops at zero speed)
  let dv = -(Jn * (nx * vehicle.hx + nz * vehicle.hz) + Jt * (tx * vehicle.hx + tz * vehicle.hz)) / M;
  if (v > 0) dv = Math.max(-v, Math.min(0, dv)); else if (v < 0) dv = Math.min(-v, Math.max(0, dv)); else dv = 0;
  const speed = hypot(vx, vz), sev = clamp((speed - 1) / 25, 0, 1);
  const kind = closing < CRAWL ? "shove" : closing < KNOCKDOWN ? "knockdown" : "launch";
  // the spin the body is thrown with: the feet are taken, so the body rotates about the centre of mass, faster the harder it is hit
  const spin = kind === "launch" ? clamp(0.42 * closing, 1.5, 9) : kind === "knockdown" ? 2.2 : 0;
  return { vx, vy: kind === "launch" ? vy0 : 0, vz, dv, nx, nz, px: c.cx, pz: c.cz, closing, severity: sev, kind, spin };
}

// ================================================================== the body after the hit ==================================================================

/**
 * A person who has been hit. strike: the result of vehicleStrike. at: { x, z, hx, hz } where they were and which way they faced.
 * by: an id for the vehicle that did it (so it is ignored for a moment and cannot hit again at once).
 */
export function createTumble(strike, at, by = null, now = 0) {
  const sp = hypot(strike.vx, strike.vz), tx = sp > 0.05 ? strike.vx / sp : strike.nx, tz = sp > 0.05 ? strike.vz / sp : strike.nz;
  const air = strike.vy > 0.01;
  return { phase: air ? "air" : strike.kind === "knockdown" ? "fall" : "stagger", t: 0, x: at.x, z: at.z, y: COM_H, vx: strike.vx, vy: strike.vy, vz: strike.vz,
    tx, tz,                                   // the horizontal direction the body travels in (its head leads); it is updated as the body turns on the ground
    tilt: 0, omega: strike.spin, yaw: Math.atan2(at.hx ?? 0, at.hz ?? 1), rest: 0, down: 0, stun: stunFor(strike), by, hitAt: now, firstContact: 0, bounces: 0, travelled: 0, kind: strike.kind, severity: strike.severity, wall: 0 };
}
/** How long the person stays down once at rest (s): a shove is a stumble, a hard hit keeps them down for a few seconds. */
export const stunFor = (s) => (s.kind === "shove" ? 0.35 : s.kind === "knockdown" ? 1.3 : 1.8 + 2.6 * s.severity);
const GET_UP_S = 0.9;
/** The nearest way of lying down (an odd number of quarter turns), ties going to +: a body that has tumbled over lands on whichever side it is nearest. */
const lyingTilt = (tilt) => (2 * Math.floor(tilt / Math.PI) + 1) * (Math.PI / 2);   // quarter turns at ..., -pi/2, pi/2, 3pi/2, ...: the one whose interval (a half turn wide) holds the tilt
/** The same orientation as an angle in (-pi, pi]. */
const wrapTilt = (a) => { a = a % (Math.PI * 2); if (a > Math.PI) a -= Math.PI * 2; if (a <= -Math.PI) a += Math.PI * 2; return a; };

/** The lowest the centre of mass can be at a tilt: the body's height when standing, its half-thickness when lying, so it neither clips the ground nor hangs above it. */
export const supportHeight = (tilt) => COM_H * Math.abs(Math.cos(tilt)) + LIE_H * Math.abs(Math.sin(tilt));

/**
 * Advances a tumbling person by dt seconds (in steps of at most 1/90 s, so a frame rate changes nothing). `world` is a CollisionWorld (or null);
 * `opts.ignore` a Set of body ids that are not obstacles (the vehicle that hit them). Returns the body; `b.phase` is
 * "stagger" | "fall" | "air" | "slide" | "down" | "rise" | "done".
 */
export function stepTumble(b, dt, world = null, opts = {}) {
  if (b.phase === "done" || !(dt > 0)) return b;
  const n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n; for (let i = 0; i < n && b.phase !== "done"; i++) sub(b, h, world, opts); return b;
}

function sub(b, h, world, opts) {
  b.t += h; const ph = b.phase;
  if (ph === "down") { b.down += h; b.vx = b.vz = 0; b.omega = 0; if (b.down >= b.stun) { b.phase = "rise"; b.rise = 0; if (world) { const r = world.pushOut(b.x, b.z, PERSON_R, {}); b.x = r.x; b.z = r.z; } } return; }   // getting up inside a vehicle that has stopped on them: they are put clear of it first
  if (ph === "rise") { b.rise += h; const k = clamp(b.rise / GET_UP_S, 0, 1), s = k * k * (3 - 2 * k); b.tilt = b.tiltRest * (1 - s); b.y = supportHeight(b.tilt); if (k >= 1) { b.tilt = 0; b.y = COM_H; b.phase = "done"; } return; }
  const ignore = opts.ignore ?? null;   // the vehicle that threw them is never an obstacle to them: one that catches up with a sliding body goes over it, it must not shove it along ahead of itself
  if (ph === "stagger") {      // a shove: pushed a step or two and stays on the feet, the speed dying away quickly
    const sp = hypot(b.vx, b.vz), d = Math.min(sp, 7 * h); if (sp > 1e-6) { b.vx -= (b.vx / sp) * d; b.vz -= (b.vz / sp) * d; }
    b.tilt = Math.sin(clamp(b.t / 0.4, 0, 1) * Math.PI) * 0.18; b.y = supportHeight(b.tilt);
    moveOn(b, world, ignore, h); if (b.t > 0.4 && hypot(b.vx, b.vz) < REST_V) { b.vx = b.vz = 0; b.tilt = 0; b.y = COM_H; b.phase = "done"; } return;
  }
  // ---- a body in the air, or on the ground and going over ----
  const sp0 = hypot(b.vx, b.vz);
  if (ph === "air" || b.y > supportHeight(b.tilt) + 1e-3 || b.vy > 0) {
    b.phase = "air"; const dragK = AIR_K * hypot(sp0, b.vy);
    b.vx -= b.vx * dragK * h; b.vz -= b.vz * dragK * h; b.vy -= (G + b.vy * dragK) * h; b.y += b.vy * h;
    b.tilt += b.omega * h; b.omega *= 1 - 0.25 * h;
    moveOn(b, world, ignore, h);
    const floor = supportHeight(b.tilt);
    if (b.y <= floor) {   // touch down: bounce a little, lose speed to friction in proportion to how hard the ground was hit, and keep turning towards lying
      const vyn = -b.vy; b.y = floor; b.bounces++;
      if (vyn > 1.2) {
        b.vy = vyn * E_GROUND; const sp = hypot(b.vx, b.vz), take = Math.min(sp, MU_GROUND * (1 + E_GROUND) * vyn);
        if (sp > 1e-6) { b.vx -= (b.vx / sp) * take; b.vz -= (b.vz / sp) * take; } b.omega *= 0.7;
        if (b.vy < 1.0) b.vy = 0;
      } else b.vy = 0;
      if (b.vy === 0) b.phase = "slide";
    }
    return;
  }
  // ---- sliding along the ground, turning to lie along the direction of travel ----
  b.phase = "slide"; const sp = hypot(b.vx, b.vz);
  if (sp > 1e-4) { const d = Math.min(sp, MU_SLIDE * G * h); b.vx -= (b.vx / sp) * d; b.vz -= (b.vz / sp) * d; b.tx = b.vx / (hypot(b.vx, b.vz) || 1) || b.tx; b.tz = b.vz / (hypot(b.vx, b.vz) || 1) || b.tz; }
  // the tilt settles to the nearest lying position (a quarter turn, or three if it has tumbled over)
  const target = lyingTilt(b.tilt);
  b.tilt += (target - b.tilt) * (1 - Math.exp(-h * 9)); b.omega = 0; b.y = supportHeight(b.tilt); b.vy = 0;
  moveOn(b, world, ignore, h);
  if (hypot(b.vx, b.vz) < REST_V) { const rest = wrapTilt(target); b.vx = b.vz = 0; b.tilt = rest; b.tiltRest = rest; b.y = supportHeight(rest); b.phase = "down"; b.down = 0; }
}

/** Moves the body horizontally through the collision world: walls and other vehicles stop it (it rebounds a little and loses most of its speed), and it never ends up inside anything. */
function moveOn(b, world, ignore, h) {
  const dx = b.vx * h, dz = b.vz * h; if (!dx && !dz) return;
  if (!world) { b.x += dx; b.z += dz; b.travelled += hypot(dx, dz); return; }
  const r = world.moveCircle(b.x, b.z, dx, dz, PERSON_R, { ignore });
  b.travelled += r.moved; b.x = r.x; b.z = r.z;
  if (r.hit) { const d = b.vx * r.nx + b.vz * r.nz; if (d < 0) { b.vx -= (1 + E_WALL) * d * r.nx; b.vz -= (1 + E_WALL) * d * r.nz; b.vx *= WALL_LOSS; b.vz *= WALL_LOSS; b.wall++; if (b.phase === "air") b.omega *= 0.6; } }
}

/** Is it all over (back on their feet)? */
export const tumbleDone = (b) => b.phase === "done";
/** Can this body be struck (again) by a vehicle `by` at time `now`? */
export function canBeStruck(b, by, now) {
  if (!b || b.phase === "done") return true;
  // a person lying on the road is driven past, not hit again and again (the traffic stops for them; your own car goes over them): the thrown body only ever has ONE impact from a vehicle
  if (b.phase === "down") return false;
  // a body still being thrown by this vehicle (in the air, sliding, staggering) is not hit again by it, however close it stays to the bumper: that is the same impact
  if (b.by === by) return now - b.hitAt > HIT_AGAIN_S && b.phase === "rise";
  return now - b.hitAt > OTHER_AGAIN_S;      // another vehicle can hit a body that is still moving, after a moment
}

/**
 * Where to draw the character: { x, y, z (the feet's origin, in metres above the ground), yaw (the way the character faces), tilt (radians about the horizontal axis (ax, 0, az)), ax, az, lying }.
 * The character is rotated about their centre of mass by `tilt`, so that a tilt of a quarter turn lays them along (tx, tz) with their head leading; use
 * Quaternion(axis, tilt) * RotationY(yaw), and put the character's origin at (x, y, z). Standing: tilt 0, y 0.
 */
export function tumblePose(b, out = {}) {
  const s = Math.sin(b.tilt), c = Math.cos(b.tilt);
  out.x = b.x - COM_H * b.tx * s; out.z = b.z - COM_H * b.tz * s; out.y = b.y - COM_H * c; out.yaw = b.yaw; out.tilt = b.tilt; out.ax = b.tz; out.az = -b.tx; out.lying = b.phase === "down" || (b.phase === "rise");
  return out;
}
