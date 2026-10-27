// tests/carphysics.test.mjs
// How your own car moves (lib3d/carphysics.js), headless: acceleration, braking, reversing, steering direction and rate, grip, collisions, frame-rate independence,
// plus the steering wheel's maths.
import assert from "node:assert/strict";
import { createCar, stepCar, steerLimit, gentleStop, CAR } from "../lib3d/carphysics.js";
import { steerFromAngle, wrapAngle, WHEEL_LOCK } from "../lib3d/wheelmath.js";
let n = 0; const ok = (name, cond) => { assert.ok(cond, name); n++; };
const run = (fps, sec, inp, car = createCar(), probe = null) => { const f = typeof inp === "function" ? inp : () => inp; for (let i = 0; i < Math.round(sec * fps); i++) stepCar(car, f(i / fps, car), 1 / fps, probe); return car; };

// 1. accelerating: smooth, bounded, capped
{ const c = createCar(), fps = 60; let prev = 0, maxJump = 0, mono = true;
  for (let i = 0; i < fps * 30; i++) { stepCar(c, { gas: 1 }, 1 / fps); maxJump = Math.max(maxJump, Math.abs(c.v - prev)); if (c.v < prev - 1e-9) mono = false; prev = c.v; }
  ok("speed never jumps: at most the engine's own push per frame", maxJump <= (CAR.accel + 0.1) / fps); ok("speed only ever rises under full throttle", mono);
  ok("top speed is capped and a little under the cap is reached", c.v <= CAR.vmax && c.v > CAR.vmax * 0.8); ok("it goes straight ahead: heading unchanged, no sideways drift", c.ang === 0 && Math.abs(c.x) < 1e-9); }
// 2. frame-rate independence
{ const ref = run(240, 6, { gas: 1 }); for (const fps of [15, 24, 30, 60, 144]) { const c = run(fps, 6, { gas: 1 }); ok(`${fps} fps: same speed after 6 s`, Math.abs(c.v - ref.v) < 0.05); ok(`${fps} fps: same distance`, Math.abs(c.z - ref.z) < 0.5); }
  const turn = (fps) => run(fps, 5, (t) => ({ gas: t < 3 ? 1 : 0.3, steer: t > 1 ? 0.7 : 0 })); const a = turn(30), b = turn(120); ok("a turn ends in the same place at 30 and 120 fps", Math.hypot(a.x - b.x, a.z - b.z) < 0.6 && Math.abs(a.ang - b.ang) < 0.03); }
// 3. steering: +1 is RIGHT (heading turns clockwise seen from above: facing south, right is west), rate-limited, no turning on the spot
{ const c = run(60, 3, (t) => ({ gas: 1, steer: t > 1 ? 1 : 0 })); ok("steering right turns the heading to the right (ang falls, car goes west of south)", c.ang < -0.3 && c.x < -1);
  const l = run(60, 3, (t) => ({ gas: 1, steer: t > 1 ? -1 : 0 })); ok("steering left is the mirror image", l.ang > 0.3 && l.x > 1 && Math.abs(l.ang + c.ang) < 1e-6);
  const s = createCar(); stepCar(s, { steer: 1 }, 1 / 60); ok("the wheels do not jump to full lock in one frame", Math.abs(s.steer) < 0.05);
  const still = run(60, 2, { steer: 1 }); ok("no turning on the spot at a standstill", Math.abs(still.ang) < 1e-9 && still.x === 0 && still.z === 0);
  const fast = run(60, 8, { gas: 1, steer: 1 }); ok("less lock at speed: the front wheels turn less the faster you go", Math.abs(fast.steer) <= steerLimit(fast.v) * 1.05 && steerLimit(20) < steerLimit(2) / 2);
  // the body follows the wheels: yaw rate rises gradually, never a step
  const y = createCar(); y.v = 8; let maxD = 0, py = 0; for (let i = 0; i < 120; i++) { stepCar(y, { gas: 0.4, steer: 1 }, 1 / 60); maxD = Math.max(maxD, Math.abs(y.yawRate - py)); py = y.yawRate; } ok("the heading never snaps: the yaw rate changes a little each frame", maxD < 0.08);
  // grip: no sideways acceleration beyond what the tyres hold, whatever you do
  const g = createCar(); g.v = 21; let worst = 0; for (let i = 0; i < 300; i++) { stepCar(g, { gas: 1, steer: i % 120 < 60 ? 1 : -1 }, 1 / 60); worst = Math.max(worst, Math.abs(g.v * g.yawRate)); } ok("sideways acceleration stays within grip (the car runs wide, it does not slide)", worst < CAR.latG * 1.15); }
// 4. braking, reversing, coasting
{ const c = run(60, 4, { gas: 1 }); const v0 = c.v; run(60, 0.5, { brake: 1 }, c); ok("the brake slows the car harder than coasting", c.v < v0 - 2.5);
  const b = run(60, 10, (t) => (t < 4 ? { gas: 1 } : { brake: 1 }), createCar()); ok("holding the brake brings it to a stop and then reverses (a moment later)", b.v < -0.5 && b.reversing);
  const b2 = createCar(); run(60, 3, { gas: 1 }, b2); let minV = 1e9; for (let i = 0; i < 60 * 4; i++) { stepCar(b2, { brake: i < 60 * 0.5 ? 1 : 0 }, 1 / 60); minV = Math.min(minV, b2.v); } ok("a tap on the brake never reverses the car by itself", minV >= -0.001);
  const r = run(60, 10, { brake: 1 }); ok("reverse is slow and capped", r.v < -2 && r.v >= -CAR.reverseMax - 1e-9);
  const t = createCar(); run(60, 3, (x) => (x < 1.5 ? { brake: 1 } : { gas: 1 }), t); ok("the throttle takes the car out of reverse and forward again", t.v > 0 || t.reversing === false);
  const co = createCar(); run(60, 3, { gas: 1 }, co); const cv = co.v; run(60, 15, {}, co); ok("a coasting car slows by itself and stops", co.v < cv && co.v === 0);
  const c0 = run(60, 3, { gas: 1 }); const sp = c0.v, dist = c0.z; run(60, 0.3, {}, c0); ok("it keeps rolling in its heading while it slows (momentum)", c0.z > dist + sp * 0.2); }
// 5. collisions: never through a wall, never pinned
{ const wallZ = 30, probe = (x, z, hx, hz) => { const front = z + hz * 2.25; return front > wallZ ? { pen: 100 } : null; };
  const c = createCar(); c.pen = 0; let maxFront = 0; for (let i = 0; i < 60 * 12; i++) { stepCar(c, { gas: 1 }, 1 / 60, probe); maxFront = Math.max(maxFront, c.z + c.hz * 2.25); }
  ok("the car stops at a wall and never goes through it", maxFront <= wallZ + 1e-6); ok("it is stopped at the wall, not bouncing about", Math.abs(c.v) < 1.5);
  run(60, 6, (t) => ({ brake: 1 }), c, probe); ok("it can reverse away from the wall (never pinned)", c.z + c.hz * 2.25 < wallZ - 3);
  // started half inside something: it can drive out, but not deeper in
  const deep = (x, z) => ({ pen: Math.max(0, 10 - z) }), d = createCar({ z: 4 }); d.pen = 6; run(60, 5, { gas: 1 }, d, deep); ok("a car that starts overlapping can drive out of it", d.z > 10); }
// 5b. something drives INTO a stopped car (a head-on hit): the car now overlaps it, and the player must still be able to reverse out
{ let obsZ = 99; const probe = (x, z, hx, hz) => { const over = z + hz * 2.25 - obsZ; return over > 0 ? { pen: 50 + Math.round(20 * over) } : null; };
  const c = createCar(); c.pen = 0; run(60, 1, {}, c, probe);                 // standing still, nothing in the way
  obsZ = c.z + 1.5;                                                          // the other car arrives and ends up inside ours
  run(60, 0.5, { gas: 1 }, c, probe); ok("pushing on into the car that hit us does not drive us far into it", c.z + c.hz * 2.25 - obsZ < 1.2);
  const z0 = c.z; run(60, 5, { brake: 1 }, c, probe); ok("after a head-on hit the player can hold the brake and reverse out (never locked in place)", c.z < z0 - 1.5 && c.reversing); }
// 6. asking to get out: the assistant stops the car at a steady rate
{ const c = createCar(); run(60, 4, { gas: 1 }, c); let prev = c.v, maxDrop = 0; for (let i = 0; i < 60 * 8 && c.v > 0.2; i++) { stepCar(c, gentleStop(c, 4.5), 1 / 60); maxDrop = Math.max(maxDrop, prev - c.v); prev = c.v; } ok("the car comes to a gentle stop", c.v <= 0.2 && maxDrop < 7 / 60); }
// 7. the wheel
ok("the wheel at rest steers nothing", steerFromAngle(0) === 0 && steerFromAngle(0.02) === 0); ok("clockwise is right, and full lock is 1", steerFromAngle(WHEEL_LOCK) === 1 && steerFromAngle(-WHEEL_LOCK) === -1 && steerFromAngle(WHEEL_LOCK * 3) === 1);
ok("steering grows steadily with the wheel", steerFromAngle(0.4) < steerFromAngle(0.8) && steerFromAngle(0.8) < steerFromAngle(1.4)); ok("crossing the top of the wheel does not flip the angle", Math.abs(wrapAngle(3.1 - -3.1)) < 0.1 && Math.abs(wrapAngle(0.1 - 6.2)) < 0.2);
console.log(`car physics passed: ${n} checks`);
