// lib/audio/engineModel.js
// What an engine is doing, from how fast the vehicle goes and how hard the driver is on the throttle: its RPM, which gear an automatic gearbox would be in,
// and how loaded it is. Pure JS (no Web Audio, no DOM): engineVoice.js turns the result into sound and the tests check the behaviour.
//
//   - it idles when the vehicle stands, and revs freely (like a torque converter) when you floor it from a standstill,
//   - in gear the RPM follows the road speed, so the revs climb through each gear and fall at each upshift (the gear changes you hear),
//   - a gear change takes a moment: the throttle is cut, the revs fall (or blip on a downshift) towards the new gear, then power comes back,
//   - the RPM has weight: it rises and falls at a limited rate instead of jumping, and never goes above the redline (it bounces off the limiter),
//   - an electric motor has no gears or idle: its whine rises with speed,
//   - starting: it cranks, catches, and settles at idle; switching off lets the revs fall away.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SHIFT_S = 0.3;

/** A new engine, switched off. */
export function createEngine(P) { return { P, mode: "off", t: 0, rpm: 0, gear: 1, shiftT: 0, shiftDir: 0, load: 0, thr: 0, limiter: 0, wob: Math.random() * 6 }; }

/** Turn the key: it cranks for about half a second, catches, flares and settles to idle. */
export function startEngine(e) { if (e.mode === "run" || e.mode === "crank") return; e.mode = e.P.ev ? "run" : "crank"; e.t = 0; e.gear = 1; e.shiftT = 0; if (e.P.ev) e.rpm = 0; }
/** Switch off: the revs fall away (the voice fades out as rpm reaches 0). */
export function stopEngine(e) { if (e.mode !== "off") { e.mode = "stopping"; e.t = 0; } }
export const isSilent = (e) => e.mode === "off" || (e.mode === "stopping" && e.rpm < 60);

/** The gear for a speed: the lowest one whose top speed is above it (what a gearbox holding revs low would pick). */
function gearRpm(P, gear, speed) {
  const top = P.gears[gear - 1], span = (P.red * 0.94 - P.idle);
  return P.idle + span * clamp(speed / top, 0, 1.12);
}

/**
 * Advance one step. in: { speed (m/s, >= 0), throttle (0..1), dt }. Returns the engine, whose rpm, gear, load (0..1) and rpmN (0..1 between idle and redline) are what the sound needs.
 */
export function stepEngine(e, { speed = 0, throttle = 0, dt = 1 / 60 }) {
  const P = e.P; dt = clamp(dt, 0, 0.25); speed = Math.max(0, speed); throttle = clamp(throttle, 0, 1); e.t += dt; e.thr += (throttle - e.thr) * (1 - Math.exp(-dt * 12));
  if (P.ev) { // a motor: no gears, no idle; the whine follows the speed (with a little extra under load)
    if (e.mode === "stopping") { e.rpmN = Math.max(0, (e.rpmN ?? 0) - dt * 1.6); e.rpm = e.rpmN * 100; if (e.rpmN <= 0) e.mode = "off"; e.load = 0; return e; }
    if (e.mode === "off") { e.rpm = 0; e.rpmN = 0; e.load = 0; return e; }
    const want = clamp(speed / 38, 0, 1) * 0.92 + e.thr * 0.08;
    e.rpmN = (e.rpmN ?? 0) + (want - (e.rpmN ?? 0)) * (1 - Math.exp(-dt * 7)); e.rpm = e.rpmN * 100; e.load = clamp(0.12 + e.thr * 0.88, 0, 1); e.gear = 1; return e;
  }
  const span = P.red - P.idle;
  if (e.mode === "off") { e.rpm = 0; e.load = 0; e.rpmN = 0; return e; }
  if (e.mode === "crank") { // the starter turns it over unevenly, then it catches and flares above idle
    if (e.t < 0.55) { e.rpm = 210 + Math.sin(e.t * 34) * 55 + Math.sin(e.t * 13) * 30; e.load = 0.25; e.rpmN = 0; return e; }
    if (e.t < 0.75) { e.rpm = clamp(e.rpm + (P.idle * 1.5 - e.rpm) * (1 - Math.exp(-dt * 18)), 0, P.red); e.load = 0.5; e.rpmN = (e.rpm - P.idle) / span; return e; }
    e.mode = "run";
  }
  if (e.mode === "stopping") { e.rpm = Math.max(0, e.rpm - (700 + e.rpm * 2.2) * dt); e.load = 0; e.rpmN = clamp((e.rpm - P.idle) / span, 0, 1); if (e.rpm <= 0) e.mode = "off"; return e; }

  // ---- the gearbox ----
  const top = P.gears.length, up = P.idle + span * (0.5 + 0.38 * e.thr), down = P.idle + span * (0.17 + 0.06 * e.thr);
  if (e.shiftT > 0) e.shiftT = Math.max(0, e.shiftT - dt);
  else if (speed > 0.8) {
    const r = gearRpm(P, e.gear, speed);
    if (e.gear < top && r > up) { e.gear++; e.shiftT = SHIFT_S; e.shiftDir = 1; }
    else if (e.gear > 1 && r < down) { e.gear--; e.shiftT = SHIFT_S * 0.8; e.shiftDir = -1; }
    else if (e.gear > 1 && e.thr > 0.9 && gearRpm(P, e.gear - 1, speed) < P.red * 0.8) { e.gear--; e.shiftT = SHIFT_S * 0.8; e.shiftDir = -1; }   // kickdown: floor it and it drops a gear
  } else if (e.gear > 1) { e.gear = 1; e.shiftT = 0; }

  // ---- the revs ----
  const shifting = e.shiftT > 0, inGear = gearRpm(P, e.gear, speed);
  let target;
  if (speed < 1.2) target = P.idle + span * 0.62 * Math.pow(e.thr, 1.2) + (e.thr < 0.04 ? Math.sin((e.wob += dt * 5.5)) * 14 : 0);   // standing: idle, or revving freely
  else if (shifting) target = e.shiftDir > 0 ? Math.max(P.idle * 1.1, inGear * 0.92) : inGear * 1.05;   // between gears: heading for where the new gear will put it
  else target = Math.max(inGear, P.idle + span * 0.45 * e.thr * (speed < 5 ? 1 : 0));
  const rising = target > e.rpm, rate = rising ? 2600 + 7000 * (0.25 + e.thr) : 2400 + e.rpm * 0.9;   // RPM per second: it takes a moment to rev, and a moment to fall
  e.rpm += clamp(target - e.rpm, -rate * dt, rate * dt);
  if (e.rpm > P.red * 0.985) { e.limiter = Math.min(1, e.limiter + dt * 8); e.rpm = P.red * 0.985 - e.limiter * 120; } else e.limiter = Math.max(0, e.limiter - dt * 4);   // bounces off the limiter
  e.rpm = clamp(e.rpm, P.idle * 0.9, P.red);
  e.rpmN = clamp((e.rpm - P.idle) / span, 0, 1);
  // load: how hard it is working. A gear change cuts it; coasting in gear (engine braking) is light; throttle on a loaded engine is heavy
  e.load = clamp((shifting ? 0.12 : 0.1 + 0.9 * e.thr) * (0.75 + 0.25 * e.rpmN), 0, 1);
  return e;
}
