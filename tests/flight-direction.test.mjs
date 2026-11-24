// tests/flight-direction.test.mjs
// The flying car goes where its nose points. One direction convention (lib3d/heading.js) is shared by the ground cars and the flying car, and these checks hold the flying car to it:
//   forward moves it along its nose, reverse along the opposite, right and left turn it the same way as on the ground, the nose tips up to climb and down to dive, and the way it moves always
//   agrees with the way the REAL MODEL (lib3d/vehicles.js, the Skyhawk, built with its wheels and lift fans) points, however it has turned or tipped. The camera stays behind the nose, the keyboard and
//   the touch controls mean the same thing for flight as for driving, and the ground cars still drive exactly as they did (tests/fixtures/ground-trace.json was recorded BEFORE the change).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { makeVehicle } from "../lib3d/vehicles.js";
import { carProfile, createCar, stepCar } from "../lib3d/carphysics.js";
import { createAir, takeOff, stepAir, pitchLimit, CLEARANCE_M, CEILING_M, CLIMB_MAX, DESCEND_MAX, PITCH_MAX, VTOL_BLEND_V } from "../lib3d/flightphysics.js";
import { STEER_TO_YAW, headingOf, rightOf, yawOf, forwardVector, poseRotation } from "../lib3d/heading.js";
import { followYaw, angDiff } from "../lib3d/tripcam.js";
import { createKeys } from "../lib3d/tripkeys.js";
import { createVehicleReader, driveControls } from "../lib3d/vehicleInput.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

const ID = "tesla-skyhawk-2026", P = carProfile(ID), DT = 1 / 60;
const len = (v) => Math.hypot(v.x, v.y, v.z), dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z, cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
/** The angle (radians) between two 3-D vectors. */
const angleBetween = (a, b) => Math.atan2(len(cross(a, b)), dot(a, b));

/** A flying car in free flight at 50 m, nose at yaw `ang`, at rest. */
function cruiser(ang = 0.5) {
  const own = Object.assign(createCar({ x: 100, z: 50, ang }), { P, h: 0, lv: 0 }), air = createAir();
  takeOff(own, air); for (let i = 0; i < 20 * 60; i++) stepAir(own, air, {}, DT, {});
  assert.equal(air.state, "cruise"); assert.ok(own.h >= CLEARANCE_M); return { own, air };
}
/** One step; says how far it moved (m) and what the nose was doing. */
function frame(own, air, inp) {
  const p0 = { x: own.x, y: own.h, z: own.z }, a0 = own.ang; stepAir(own, air, inp, DT, {});
  return { d: { x: own.x - p0.x, y: own.h - p0.y, z: own.z - p0.z }, aMid: (a0 + own.ang) / 2, pitch: air.pitch, v: own.v };
}
/** The angle between how the car moved this frame and where its nose points (the mid-step heading, the one it moved along), or null when it hardly moved (a hover). Negative speed: against the nose. */
function noseError(f) {
  if (len(f.d) < 1e-6) return null; const n = forwardVector(f.aMid, f.pitch); if (f.v < 0) { n.x = -n.x; n.y = -n.y; n.z = -n.z; }
  return angleBetween(f.d, n);
}
const run = (own, air, inp, secs, each) => { for (let i = 0; i < Math.round(secs * 60); i++) { const f = frame(own, air, typeof inp === "function" ? inp(i * DT, own, air) : inp); each?.(f); } };

// ---------------------------------------------------------------- the convention itself
{ const h = headingOf(0.5), r = rightOf(h.hx, h.hz), f = forwardVector(0.5, 0);
  chk("heading is (sin yaw, cos yaw), as the ground cars have always had it", Math.abs(h.hx - Math.sin(0.5)) < 1e-12 && Math.abs(h.hz - Math.cos(0.5)) < 1e-12 && Math.abs(yawOf(h.hx, h.hz) - 0.5) < 1e-12);
  chk("with no pitch the 3-D forward vector is the ground heading, level", Math.abs(f.x - h.hx) < 1e-12 && Math.abs(f.z - h.hz) < 1e-12 && f.y === 0);
  chk("a RISING yaw turns the nose to the LEFT and a steer of +1 (right) therefore lowers it", STEER_TO_YAW === -1 && (headingOf(0.6).hx - h.hx) * r.x + (headingOf(0.6).hz - h.hz) * r.z < 0);
  chk("pitch + is nose UP: the forward vector rises", forwardVector(0.5, 0.3).y > 0.29 && forwardVector(0.5, -0.3).y < -0.29 && Math.abs(len(forwardVector(0.5, 0.3)) - 1) < 1e-12); }

// ---------------------------------------------------------------- the real model
const model = makeVehicle(ID, "#e8e8e8"); model.root.rotation.order = "YXZ";
const wp = (i) => model.wheels[i].getWorldPosition(new THREE.Vector3());
/** Where the model's nose really points, with the car posed as the game draws it: from the middle of the rear axle to the middle of the front axle, in the world. */
function modelNose(yaw, pitch, roll = 0) {
  model.root.rotation.set(...poseRotation(yaw, pitch, roll)); model.root.updateMatrixWorld(true);
  const f = wp(0).add(wp(1)).multiplyScalar(0.5), r = wp(2).add(wp(3)).multiplyScalar(0.5), n = f.sub(r).normalize(); return { x: n.x, y: n.y, z: n.z };
}
chk("the model's front axle is ahead of its rear axle along +z (the nose is +z, as for every car)", model.front[0].position.z > 1 && model.wheels[0].parent.position.z > model.wheels[2].parent.position.z);
{ let worst = 0; for (const yaw of [-3, -1.2, 0, 0.5, 2.2, 3.1]) for (const pitch of [-0.5, -0.2, 0, 0.3, 0.5]) for (const roll of [-0.4, 0, 0.4]) worst = Math.max(worst, angleBetween(modelNose(yaw, pitch, roll), forwardVector(yaw, pitch)));
  chk(`the drawn model's nose points exactly along forwardVector(yaw, pitch), whatever the roll (worst error ${worst.toExponential(1)} rad over 90 poses)`, worst < 1e-6); }
{ model.root.rotation.set(...poseRotation(0.5, 0, 0.4)); model.root.updateMatrixWorld(true); const l = wp(1).y, r = wp(0).y;
  chk("a positive roll lifts the model's LEFT side (+x), so a right bank is a positive roll", l > r + 0.1);
  model.root.rotation.set(...poseRotation(0.5, 0.3, 0)); model.root.updateMatrixWorld(true);
  chk("a positive pitch lifts the model's nose", wp(0).y > wp(2).y + 0.3); }

// ---------------------------------------------------------------- forward and reverse
{ const { own, air } = cruiser(0.5), errs = []; run(own, air, { gas: 1 }, 4, (f) => { const e = noseError(f); if (e != null) errs.push(e); });
  const worst = Math.max(...errs); chk(`forward input moves it along its nose, in every frame (worst error ${worst.toExponential(1)} rad), level`, errs.length > 200 && worst < 1e-9 && air.pitch === 0 && own.v > 20); }
{ const { own, air } = cruiser(2.0), x0 = own.x, z0 = own.z, h = headingOf(2.0), errs = []; let minV = 0;
  run(own, air, { brake: 1 }, 7, (f) => { minV = Math.min(minV, f.v); const e = noseError(f); if (e != null) errs.push(e); });
  const d = { x: own.x - x0, z: own.z - z0 };
  chk("held at a standstill the brake selects reverse and it moves BACKWARDS along its heading", own.reversing && own.v < -3 && d.x * h.hx + d.z * h.hz < -3 && Math.abs(d.x * -h.hz + d.z * h.hx) < 1e-9);
  chk(`in reverse every frame is exactly opposite the nose (worst error ${Math.max(...errs).toExponential(1)} rad)`, errs.length > 100 && Math.max(...errs) < 1e-9);
  chk("reverse stays within the car's reverse speed limit", minV >= -P.reverseMax - 1e-9 && minV < -P.reverseMax * 0.8); }
{ const { own, air } = cruiser(0.5); run(own, air, { gas: 1 }, 4); let prev = own.v, jumped = false, stopped = false;
  run(own, air, { brake: 1 }, 5, () => { if (prev > 0.3 && own.v < 0) jumped = true; if (own.v === 0) stopped = true; prev = own.v; });
  chk("braking a moving car stops it first: it never flips into reverse by itself", !jumped && stopped && own.v < 0); }
{ const { own, air } = cruiser(0.5); run(own, air, { brake: 1 }, 3); const v = own.v; run(own, air, { gas: 1 }, 0.5);
  chk("the throttle ends reverse and the car goes forward again", own.reversing === false && own.v > v); }

// ---------------------------------------------------------------- turning: the same way as on the ground
for (const [name, steer] of [["right", 1], ["left", -1]]) {
  const { own, air } = cruiser(0.5), h0 = headingOf(own.ang), r0 = rightOf(h0.hx, h0.hz), x0 = own.x, z0 = own.z; run(own, air, { gas: 1, steer }, 2);
  const side = (own.x - x0) * r0.x + (own.z - z0) * r0.z, g = createCar({ x: 100, z: 50, ang: 0.5 }); for (let i = 0; i < 120; i++) stepCar(g, { gas: 1, steer }, DT, null, P);
  chk(`${name} input turns the flying car ${name}: it ends up on its ${name}-hand side, and the yaw moves the same way as a ground car's`, Math.sign(side) === steer && Math.sign(own.ang - 0.5) === Math.sign(g.ang - 0.5) && Math.sign(own.ang - 0.5) === STEER_TO_YAW * steer && Math.abs(own.hx ** 2 + own.hz ** 2 - 1) < 1e-9); }
{ const { own, air } = cruiser(0.5), errs = [], pub = []; run(own, air, (t) => ({ gas: 1, steer: t < 3 ? 1 : -1 }), 6, (f) => { const e = noseError(f); if (e != null) errs.push(e); pub.push(Math.abs(angDiff(yawOf(own.hx, own.hz), f.aMid))); });
  chk(`turning while flying forward changes the real direction of travel with the nose, every frame (worst error ${Math.max(...errs).toExponential(1)} rad), so it never slides sideways`, errs.length > 300 && Math.max(...errs) < 1e-9 && Math.max(...pub) <= YAW_STEP(own) + 1e-9); }
function YAW_STEP() { return 0.9 * DT / 2 + 1e-9; }     // the published heading is the end of the step, the movement the middle: at most half a step of the fastest turn apart
{ const { own, air } = cruiser(0.5), a0 = own.ang, hOld = headingOf(a0); run(own, air, { gas: 0, steer: 1 }, 0.1); run(own, air, (t) => ({ gas: 1, steer: own.ang > a0 - Math.PI / 2 ? 1 : 0 }), 8);
  const turned = a0 - own.ang; const x1 = own.x, z1 = own.z, hNew = headingOf(own.ang); run(own, air, { gas: 1 }, 3);
  const d = { x: own.x - x1, y: 0, z: own.z - z1 }, n = { x: hNew.hx, y: 0, z: hNew.hz };
  chk(`after the heading has changed by ${(turned * 180 / Math.PI).toFixed(0)} degrees the car flies along the NEW heading, not the old one`, turned > Math.PI / 2 - 0.1 && angleBetween(d, n) < 1e-6 && d.x * hOld.hx + d.z * hOld.hz < len(d) * 0.1); }

// ---------------------------------------------------------------- climbing and diving: the nose tips and the car moves along it
{ const { own, air } = cruiser(0.5); run(own, air, { gas: 1 }, 5); const h0 = own.h, errs = []; let settled = 0, tipped = 0;
  run(own, air, { gas: 1, climb: 1 }, 3, (f) => { if (own.v >= VTOL_BLEND_V) { const e = noseError(f); if (e != null) errs.push(e); } if (air.pitch > 0.05) tipped++; settled = Math.max(settled, air.pitch); });
  chk(`pitching up produces upward flight: the nose tips up (to ${settled.toFixed(2)} rad), the car gains ${(own.h - h0).toFixed(0)} m, and every frame moves exactly along the tipped nose (worst error ${Math.max(...errs).toExponential(1)} rad)`, own.h > h0 + 12 && settled > 0.1 && tipped > 60 && Math.max(...errs) < 1e-9);
  chk("the model drawn at that attitude points where the car is going", (() => { const a = frame(own, air, { gas: 1, climb: 1 }), n = modelNose(a.aMid, air.pitch, air.roll); return angleBetween(a.d, n) < 1e-6; })());
  run(own, air, { gas: 1 }, 6); chk("letting go levels the nose out and the climb stops", Math.abs(air.pitch) < 1e-9 && Math.abs(air.rise) < 1e-9); }
{ const { own, air } = cruiser(0.5); run(own, air, { gas: 1 }, 3); run(own, air, { gas: 1, climb: 1 }, 6); const h0 = own.h, errs = []; let low = 0;
  run(own, air, { gas: 1, climb: -1 }, 6, (f) => { const e = noseError(f); if (e != null) errs.push(e); low = Math.min(low, air.pitch); });     // the nose takes about three seconds to swing from a climb through level into a dive
  chk(`pitching down produces downward flight along the nose (nose to ${low.toFixed(2)} rad, down ${(h0 - own.h).toFixed(0)} m, worst error ${Math.max(...errs).toExponential(1)} rad)`, own.h < h0 - 8 && low < -0.05 && Math.max(...errs) < 1e-9); }
{ let ok = true; for (let s = 0.5; s <= 60; s += 0.5) { ok &&= s * Math.sin(pitchLimit(s, 1)) <= CLIMB_MAX + 1e-9 && s * Math.sin(pitchLimit(s, -1)) <= DESCEND_MAX + 1e-9 && pitchLimit(s, 1) <= PITCH_MAX; }
  chk("the nose may only tip as far as keeps the climb and dive within their limits at that speed", ok && pitchLimit(0, 1) === PITCH_MAX && pitchLimit(55, 1) < 0.17); }
{ const { own, air } = cruiser(0.5); own.h = air.alt = CEILING_M - 2; run(own, air, { gas: 1, climb: 1 }, 10);
  chk("at the ceiling the car stops climbing and the nose levels out rather than pointing up while it flies level", own.h <= CEILING_M && own.h > CEILING_M - 1 && air.pitch < 1e-9); }
{ const { own, air } = cruiser(0.5); const h0 = own.h; run(own, air, { climb: 1 }, 2); chk("at a hover the lift fans still raise the car with no forward speed (the nose tips, nothing moves sideways)", own.h > h0 + 5 && Math.hypot(own.x - 100, own.z - 50) < 1e-6 && air.pitch > 0.3); }
{ const { own, air } = cruiser(0.5); run(own, air, { climb: 1 }, 1.5); const lift = air.rise, h0 = own.h; run(own, air, { climb: 0 }, 6);
  chk(`a hover that is let go stops where its lift coasts to (about ${(lift * lift / (2 * 4)).toFixed(1)} m on, at the fans' own rate) and then holds its height`, lift > 3 && own.h - h0 > 0 && own.h - h0 < lift * lift / (2 * 4) + 0.5 && Math.abs(air.rise) < 1e-9); }

// ---------------------------------------------------------------- banking: into the turn, as the model is drawn
{ const { own, air } = cruiser(0.5); run(own, air, { gas: 1 }, 5); run(own, air, { gas: 1, steer: 1 }, 3); model.root.rotation.set(...poseRotation(own.ang, air.pitch, air.roll)); model.root.updateMatrixWorld(true);
  chk(`a right turn banks the car into it: right side down (roll ${air.roll.toFixed(2)}), and it is turning right`, air.roll > 0.15 && wp(1).y > wp(0).y + 0.2 && own.yawRate < 0);
  run(own, air, { gas: 1, steer: -1 }, 4); chk("a left turn banks left side down", air.roll < -0.15 && own.yawRate > 0); }

// ---------------------------------------------------------------- the flight attitude reaches the drawing the way the ground ride does
{ const src = readFileSync(new URL("../lib3d/tripflow.js", import.meta.url), "utf8"), trav = readFileSync(new URL("../lib3d/travel.js", import.meta.url), "utf8");
  chk("tripflow hands the flight attitude to the drawing as the car's road pose (own.road pitch / roll)", /own\.road = \{ y: own\.h, pitch: a\.pitch, roll: a\.roll \}/.test(src));
  chk("the drawing poses every vehicle with the one shared poseRotation, and in the YXZ order", /rotation\.set\(\.\.\.poseRotation\(yaw,/.test(trav) && /rotation\.order = "YXZ"/.test(trav)); }

// ---------------------------------------------------------------- the camera stays behind the nose
{ const { own, air } = cruiser(0.5); let cam = yawOf(own.hx, own.hz) + Math.PI, worst = 0, steady = 0;
  const behind = () => ({ x: Math.sin(cam), z: Math.cos(cam) });
  run(own, air, (t) => ({ gas: 1, steer: t < 4 ? 1 : t < 8 ? -1 : 0 }), 12, () => { cam = followYaw(cam, yawOf(own.hx, own.hz) + Math.PI, own.v, DT, false); worst = Math.max(worst, Math.abs(angDiff(cam, yawOf(own.hx, own.hz) + Math.PI))); });
  run(own, air, { gas: 1 }, 4, () => { cam = followYaw(cam, yawOf(own.hx, own.hz) + Math.PI, own.v, DT, false); }); const b = behind(); steady = b.x * own.hx + b.z * own.hz;
  chk(`the chase camera stays behind the nose through full turns (never more than ${(worst * 180 / Math.PI).toFixed(0)} degrees off) and settles exactly behind`, worst < 0.35 && Math.abs(steady + 1) < 1e-6); }
{ const { own, air } = cruiser(1.0); let cam = yawOf(own.hx, own.hz) + Math.PI; run(own, air, { brake: 1 }, 3, () => { cam = followYaw(cam, yawOf(own.hx, own.hz) + Math.PI, own.v, DT, false); }); const b = { x: Math.sin(cam), z: Math.cos(cam) };
  chk("in reverse the camera stays behind the nose too (the car backs away from it)", own.v < -2 && b.x * own.hx + b.z * own.hz < -0.999); }

// ---------------------------------------------------------------- the keyboard and the touch controls (the real reader lib3d/travel.js calls every frame: lib3d/vehicleInput.js)
{ const key = (code) => ({ code, key: "", target: null, metaKey: false, ctrlKey: false, altKey: false });
  /** Fly with the keys held and/or the on-screen controls (input, as the HUD writes it), through the real createVehicleReader; the same numbers go to stepAir as travel.js sends. */
  const fly = (codes, secs, input = {}, start = {}) => { const keys = createKeys(), vin = { keys, blocked: () => false }, rd = createVehicleReader({ vin, input }); codes.forEach((c) => keys.press(key(c)));
    const { own, air } = cruiser(0.5); if (start.h) own.h = air.alt = start.h; const a0 = own.ang, h0 = own.h;
    run(own, air, () => { const d = rd.read(true, DT); return { gas: d.gas, brake: d.brake, steer: d.steer, climb: d.climb }; }, secs); return { own, air, a0, h0 }; };
  let r = fly(["KeyW", "KeyD"], 2); chk("keyboard W + D: forward and a right turn (yaw falls)", r.own.v > 10 && r.own.ang < r.a0 - 0.2);
  r = fly(["KeyW", "ArrowLeft"], 2); chk("keyboard W + the left arrow: forward and a left turn (yaw rises)", r.own.v > 10 && r.own.ang > r.a0 + 0.2);
  r = fly(["KeyW", "KeyQ"], 3); chk("keyboard Q pitches up and climbs", r.air.pitch > 0.05 && r.own.h > r.h0 + 5);
  r = fly(["KeyW", "KeyZ"], 4, {}, { h: 120 }); chk("keyboard Z pitches down and descends", r.air.pitch < -0.05 && r.own.h < r.h0 - 3);
  r = fly(["KeyS"], 7); chk("keyboard S held from a stop reverses", r.own.v < -3 && r.own.reversing);
  const kb = createKeys(); kb.press(key("KeyD")); chk("the keys read D as +1 steer (right), exactly as for driving", kb.read().steer === 1 && kb.read().climb === 0);
  // touch: the HUD writes input.gas / input.brake / input.steer / input.climbUp / input.climbDown (components/TripHud.js, SteerButtons.js); the on-screen controls add up with the keys
  r = fly([], 3, { gas: 1, climbUp: true }); chk("touch: the UP button climbs the flying car (nose up) exactly as the Q key does", r.air.pitch > 0.05 && r.own.h > r.h0 + 5);
  r = fly([], 4, { gas: 1, climbDown: true }, { h: 120 }); chk("touch: the DOWN button dives it (nose down) exactly as the Z key does", r.air.pitch < -0.05 && r.own.h < r.h0 - 3);
  r = fly([], 2, { gas: 1, steer: 1 }); chk("touch: a right steering button (input.steer +1) turns the flying car right, as D does", r.own.v > 10 && r.own.ang < r.a0 - 0.2);
  r = fly([], 2, { gas: 1, steer: -1 }); chk("touch: a left steering button (input.steer -1) turns it left, as A does", r.own.ang > r.a0 + 0.2);
  r = fly([], 7, { brake: 1 }); chk("touch: the brake pedal held from a stop reverses it, as S does", r.own.v < -3 && r.own.reversing);
  const both = driveControls(createKeys().read(), { climbUp: true, climbDown: true }); chk("touch: UP and DOWN together cancel out", both.climb === 0); }

// ---------------------------------------------------------------- flight stays smooth and frame-rate independent
{ const a = cruiser(0.5), b = cruiser(0.5), seq = (t) => ({ gas: 1, steer: t < 3 ? 0.6 : -0.6, climb: t > 2 && t < 5 ? 1 : 0 });
  for (let t = 0; t < 8; t += 1 / 30) stepAir(a.own, a.air, seq(t), 1 / 30, {}); for (let t = 0; t < 8; t += 1 / 120) stepAir(b.own, b.air, seq(t), 1 / 120, {});
  chk(`a climbing turn gives the same flight at 30 and 120 fps (position within ${Math.max(Math.abs(a.own.x - b.own.x), Math.abs(a.own.z - b.own.z), Math.abs(a.own.h - b.own.h)).toFixed(2)} m)`, Math.abs(a.own.x - b.own.x) < 3 && Math.abs(a.own.z - b.own.z) < 3 && Math.abs(a.own.h - b.own.h) < 1.5 && Math.abs(a.own.ang - b.own.ang) < 0.05); }
{ const { own, air } = cruiser(0.5); let maxAll = 0, maxFast = 0, prev = 0; run(own, air, (t) => ({ gas: 1, climb: t < 4 ? 1 : 0 }), 8, () => { const a = Math.abs(air.rise - prev) / DT; maxAll = Math.max(maxAll, a); if (own.v > 25) maxFast = Math.max(maxFast, a); prev = air.rise; });
  const bound = 4 + 14 * Math.sin(PITCH_MAX) + 6;     // the fans' share, accelerating along a tipped nose, and a change of pitch (PITCH_VACC): the most the three can add up to
  chk(`the vertical speed changes gently: at most ${maxAll.toFixed(1)} m/s2 even slamming throttle and climb together from a standstill (design bound ${bound.toFixed(1)}), and ${maxFast.toFixed(1)} m/s2 at cruising speed`, maxAll < bound && maxFast < 10); }

// ---------------------------------------------------------------- ground vehicles: exactly as they were before this change
{ const SCRIPT = [[2, { gas: 1 }], [2, { gas: 1, steer: 1 }], [2, { gas: 1, steer: -1 }], [1.5, { gas: 0 }], [1.5, { brake: 1 }], [2, { brake: 1 }], [2, { brake: 1, steer: 1 }], [2, { brake: 1, steer: -1 }], [1, { gas: 1 }], [3, { gas: 0.6, steer: 0.5 }]];
  const gold = JSON.parse(readFileSync(new URL("./fixtures/ground-trace.json", import.meta.url), "utf8")); let n = 0, same = 0;
  for (const id of Object.keys(gold)) { const Pp = carProfile(id), c = createCar({ x: 100, z: -40, ang: 0.7 }); let k = 0;
    for (const [secs, inp] of SCRIPT) { for (let i = 0; i < Math.round(secs * 60); i++) stepCar(c, inp, DT, null, Pp);
      const row = [c.x, c.z, c.ang, c.hx, c.hz, c.v, c.steer, c.yawRate, c.pitch, c.roll, c.distance, c.reversing ? 1 : 0].map((v) => +v.toFixed(9)); n++; if (JSON.stringify(row) === JSON.stringify(gold[id][k])) same++; k++; } }
  chk(`all ${Object.keys(gold).length} ground vehicles (cars, supercar, truck, the Skyhawk on the road, keke, bus) drive identically to the recording made before the change: ${same} of ${n} checkpoints`, same === n && n === 70); }

model.dispose();
console.log(bad ? `\n${bad} FAILED` : "\nall flight-direction checks passed"); process.exit(bad ? 1 : 0);
