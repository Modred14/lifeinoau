// lib3d/carjack.js
// Taking a car from the person driving it (GTA-style), as pure rules: no drawing, no network. lib3d/tripflow.js runs the sequence; lib3d/travel.js draws it.
//
//   1. jackTarget(): which computer-driven car, if any, the player on foot can take right now, and from which side they are standing. Only an ordinary car with a driver's seat
//      (KINDS.car.driver), on the ground, that has slowed to (nearly) a stop, with the player within reach of its body. Never an empty car: the simulation has none, and
//      never a bus, minibus or keke (they have no driver seat model the player can drive from; their own vehicle models are not drivable by the own-car physics).
//   2. jackStand(): where the player stands to do it: at the DRIVER'S door (the left, traffic keeps right), a little behind it, so the driver can step out in front of them and
//      they never overlap. A player on the other side is walked round to it (tripflow "jackwalk").
//   3. createVictim(): the driver's side of the story, over time: startled (hands up) as the door opens, resists for a moment, is pulled out through the door onto a clear spot, then
//      runs away from the car. It moves only through free space (world.moveCircle), and always ends: it never stays in the car, never follows the car, never drives on.
// The times are seconds since the door began to open.
import { KINDS, toWorld } from "./trafficsim.js";
import { WALK_R } from "./walker.js";

export const JACK = {
  reach: 1.5,          // metres from the car's body at which "Steal Vehicle" is offered
  maxSpeed: 1.6,       // the car must have slowed to this (m/s): you stand in front of it and it stops; a car at speed cannot be taken
  rearOffset: 0.85,    // the player stands this far behind the door line, the driver steps out ahead of it
  exitAhead: 0,        // extra metres ahead of the spot the exit finder chose (it already keeps clear of the player: see tripflow)
  startle: 0.6, resist: 1.5, pulled: 2.9,   // stage boundaries (s)
  fleeSecs: 7, fleeSpeed: 3.4,
  walkTimeout: 9,      // going round to the driver's door must not take longer than this (s)
  standTol: 0.55,      // arrived at the stand point
};
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }, lerp = (a, b, k) => a + (b - a) * k;

/** A point in the car's own space ({ x: left+, z: forward+ }) as a world point. `car` = { x, z, hx, hz }. */
const at = (car, l, f) => toWorld(car, { x: l, z: f });
/** Where the player stands to take the driver out: outside the driver's (left) door, a little behind it. */
export function jackStand(car) { const d = KINDS.car; return at(car, (car.wid ?? d.wid) / 2 + 0.55, (d.doorZL ?? d.doorZ) - JACK.rearOffset); }
/** The driver's door line (the opening in the side of the car, in the world) and the driver's seat. */
export function jackDoor(car) { const d = KINDS.car, w = car.wid ?? d.wid; return at(car, w / 2 - 0.12, d.doorZL ?? d.doorZ); }
export function jackSeat(car) { return at(car, KINDS.car.driver.x, KINDS.car.driver.z); }

/** Can this simulated vehicle be taken at all (before asking where the player is)? */
export function takeable(v) {
  return !!v && v.role === "npc" && !v.custom && !v.done && !v.hw && v.kind === "car" && !!KINDS.car.driver && (v.y ?? 0) < 0.8 && Math.abs(v.v ?? 0) <= JACK.maxSpeed;
}

/**
 * The car the player on foot at p = { x, z } can take now, or null: { veh, side, gap, stand }. `side` is +1 when the player is on the driver's (left) side of the car, -1 on the other.
 * The nearest one wins. `gap` is the distance (m) from the player to the car's body.
 */
export function jackTarget(vehicles, p, opts = {}) {
  const reach = opts.reach ?? JACK.reach; let best = null;
  for (const v of vehicles) {
    if (!takeable(v) || (opts.skip && opts.skip(v))) continue;
    if (Math.abs(v.x - p.x) > 8 || Math.abs(v.z - p.z) > 8) continue;
    const dx = p.x - v.x, dz = p.z - v.z, f = dx * v.hx + dz * v.hz, l = dx * v.hz - dz * v.hx, hl = v.len / 2, hw = v.wid / 2;
    const gap = Math.hypot(Math.max(0, Math.abs(f) - hl), Math.max(0, Math.abs(l) - hw));
    if (gap > reach || (best && gap >= best.gap)) continue;
    best = { veh: v, side: l >= 0 ? 1 : -1, gap, stand: jackStand(v) };
  }
  return best;
}

/** Which part of the story the driver is in, t seconds after the door began to open. */
export function jackStage(t) { return t < JACK.startle ? "startle" : t < JACK.resist ? "resist" : t < JACK.pulled ? "pulled" : "flee"; }

/**
 * The driver, over time. `car` = { x, z, hx, hz, len, wid } as it stands; `exit` = the world spot just outside the driver's door that was found clear (lib3d/carexit.js); `world` the
 * collision world (movement is through free space only; `ignore` is a Set of body ids that are not obstacles: the car it has just left). update(dt) moves it; the object it returns is read by the drawing:
 *   { x, z, hx, hz, seated, stage, gait: "handsUp" | "run" | "idle", speed, done, t }
 * `gait` names an animation the drawing plays when the character has it (lib3d/avatar/jackClips.js); `seated` blends the sit pose (the drawing lifts the body to the seat height).
 */
export function createVictim({ car, exit, world, ignore = null }) {
  const seat = jackSeat(car), door = jackDoor(car), out = { x: exit.x + car.hx * JACK.exitAhead, z: exit.z + car.hz * JACK.exitAhead };
  // away from the car, and a little forward (the way the traffic was going), so it runs along the kerb and not into the player behind the door
  let ax = out.x - car.x, az = out.z - car.z; { const l = Math.hypot(ax, az) || 1; ax = ax / l + car.hx * 0.8; az = az / l + car.hz * 0.8; const m = Math.hypot(ax, az) || 1; ax /= m; az /= m; }
  const V = { x: seat.x, z: seat.z, hx: car.hx, hz: car.hz, seated: true, stage: "startle", gait: "handsUp", speed: 0, done: false, t: 0, blocked: 0 };
  let fleeDir = { x: ax, z: az };
  const face = (x, z, k) => { const l = Math.hypot(x, z); if (l < 1e-6) return; const m = 1 - Math.exp(-k); let hx = V.hx + (x / l - V.hx) * m, hz = V.hz + (z / l - V.hz) * m; const q = Math.hypot(hx, hz) || 1; V.hx = hx / q; V.hz = hz / q; };
  function update(dt) {
    if (V.done) return V; V.t += dt; const t = V.t; V.stage = jackStage(t); V.speed = 0;
    if (V.stage === "startle") { V.x = seat.x; V.z = seat.z; V.gait = "handsUp"; V.seated = true; }
    else if (V.stage === "resist") { // clinging to the wheel: a small shudder
      const s = Math.sin(t * 38) * 0.035 * smooth((t - JACK.startle) / 0.2); V.x = seat.x + car.hz * s; V.z = seat.z - car.hx * s; V.gait = "handsUp"; V.seated = true;
    } else if (V.stage === "pulled") { // out of the seat, through the door, onto the spot
      const k = smooth((t - JACK.resist) / (JACK.pulled - JACK.resist)), m = 0.55;
      if (k < m) { const q = k / m; V.x = lerp(seat.x, door.x, q); V.z = lerp(seat.z, door.z, q); } else { const q = (k - m) / (1 - m); V.x = lerp(door.x, out.x, q); V.z = lerp(door.z, out.z, q); }
      V.seated = k < 0.35; V.gait = "handsUp"; V.speed = 1.4; face(out.x - seat.x, out.z - seat.z, 0.3);
    } else { // runs
      V.seated = false; V.gait = "run"; const sp = JACK.fleeSpeed, step = sp * dt; let moved = 0;
      for (const a of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) { // the first direction that is free (it turns along a wall rather than stopping at it)
        const c = Math.cos(a), s = Math.sin(a), dx = fleeDir.x * c - fleeDir.z * s, dz = fleeDir.x * s + fleeDir.z * c, r = world ? world.moveCircle(V.x, V.z, dx * step, dz * step, WALK_R, { ignore }) : { x: V.x + dx * step, z: V.z + dz * step, moved: step };
        if (r.moved >= step * 0.6) { V.x = r.x; V.z = r.z; moved = r.moved; if (a) fleeDir = { x: dx, z: dz }; break; }
      }
      V.speed = moved / Math.max(dt, 1e-6); V.blocked = moved < step * 0.3 ? V.blocked + dt : 0; face(fleeDir.x, fleeDir.z, 12);
      if (t >= JACK.pulled + JACK.fleeSecs || V.blocked > 0.8) { V.done = true; V.gait = "idle"; V.speed = 0; }
    }
    if (V.stage !== "pulled" && V.stage !== "flee") face(car.hx, car.hz, 8);
    return V;
  }
  return { V, update, seat, door, out };
}
