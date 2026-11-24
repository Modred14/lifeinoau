// tests/vehicle-controls.test.mjs
// Real keyboard events -> the real key binding (lib3d/vehicleInput.js) -> the real per-frame reader -> the real trip state machine (lib3d/tripflow.js) and the real car / flight physics, on the real
// campus map (headless, no three.js), for EVERY vehicle the player can drive: the ten cars and the Tesla Skyhawk flying car. The bus and the keke are passenger rides in this game (you do not drive
// them), so for those it checks that the driving keys do nothing to them.
// The only thing this file mirrors from lib3d/travel.js is the hand-over of the reader's numbers to flow.update (the `inp` object in `frame`): everything else is the engine's own code.
// The on-screen controls (touch) in a real browser are tests/e2e/vehicle-controls.e2e.mjs.
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { VEHICLE_DIMS } from "../lib3d/vehicleDims.js";
import { CARS } from "../lib/cars.js";
import { attachVehicleKeys, createVehicleReader } from "../lib3d/vehicleInput.js";
import { CLEARANCE_M } from "../lib3d/flightphysics.js";
import { placeCar } from "../lib3d/carphysics.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null);
let bad = 0, skipped = 0; const chk = (l, c) => { if (!c) { bad++; process.exitCode = 1; } console.log((c ? "OK   " : "FAIL ") + l); };
const DT = 1 / 30;

// ---- a fake page for the key binding
const key = (code, extra = {}) => ({ code, key: code.replace("Key", "").toLowerCase(), repeat: false, metaKey: false, ctrlKey: false, altKey: false, target: { closest: () => null }, preventDefault() {}, ...extra });
const fire = (t, type, e) => { const ev = new Event(type); for (const [k, v] of Object.entries(e ?? {})) Object.defineProperty(ev, k, { value: v, writable: true, configurable: true }); t.dispatchEvent(ev); return ev; };

function plan(mode, skip = 0) { let n = 0; for (let i = 0; i < 400; i++) { const p = planTrip(svc, { from: places[(i * 7) % places.length], to: places[(i * 13 + 5) % places.length], mode, driver: false }); if (p.ok && p.route?.len > 500 && n++ === skip) return p; } return null; }

/** One player in one vehicle: a flow + traffic sim, a fake window and the reader the engine uses. */
function rig(modelId, mode = "car", skip = 0) {
  const pl = plan(mode, skip); if (!pl) return null;
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => pl.start ?? places[0], rnd }), D = VEHICLE_DIMS[modelId] ?? VEHICLE_DIMS["corolla-2011"], notices = [];
  const seat = { x: -0.4, y: 0.42, z: -0.25 };
  const flow = createTripFlow({ svc, sim }, { plan: pl, onArrive: () => true, onEnter() {}, onEnd() {}, onNotice: (m) => notices.push(m), dims: { len: D.length, wid: D.width, id: modelId, seat, driver: { ...seat, x: 0.4 } } });
  const win = new EventTarget(), doc = new EventTarget(); doc.hidden = false; doc.dialogs = []; doc.querySelectorAll = () => doc.dialogs; let clock = 0;
  const vin = attachVehicleKeys({ win, doc, now: () => clock }), input = {}, reader = createVehicleReader({ vin, input }), S = flow.state;
  const frame = () => {   // = one frame of lib3d/travel.js: read the controls, hand them to the flow, step the world
    const r = reader.read(S.phase === "drive", DT), act = vin.take("act"), flyKey = vin.take("fly"), exitBtn = !!input.exit; input.exit = false;
    flow.update(DT, { gas: r.gas, brake: r.brake, steer: r.steer, climb: r.climb, fly: r.drive && (flyKey || !!input.fly), exit: r.drive && (exitBtn || act) }); input.fly = false; sim.update(DT); clock += DT * 1000;
  };
  const run = (secs, each) => { for (let i = 0; i < Math.round(secs / DT); i++) { frame(); each?.(); } };
  const until = (c, secs) => { for (let i = 0; i < Math.round(secs / DT) && !c(); i++) frame(); return c(); };
  const R = { flow, S, sim, vin, input, win, doc, notices, frame, run, until, down: (c, x) => fire(win, "keydown", key(c, x)), up: (c) => fire(win, "keyup", key(c)), blur: () => fire(win, "blur", {}) };
  R.drive = () => until(() => S.phase === "drive", 120);
  /** Put the car back at the open pose, at rest, wheel straight (so each manoeuvre has road ahead of it and behind it). */
  R.reset = (pose) => { const c = flow.own; placeCar(c, pose); c.v = 0; c.steer = 0; c.yawRate = 0; c.thr = c.brk = 0; c.pen = 0; };
  return R;
}
const sgn = (x) => (Math.abs(x) < 1e-3 ? 0 : Math.sign(x));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// ---- find a start with open road ahead AND behind it (the first plan's kerb faces a wall: a collision, not a control problem, would end every test)
const OPEN = (() => {
  for (let skip = 0; skip < 40; skip++) {
    const R = rig("corolla-2011", "car", skip); if (!R || !R.drive()) continue; const o = R.flow.own, pose = { x: o.x, z: o.z, ang: o.ang };
    const go = (g) => { R.reset(pose); let mv = 0, vmax = 0, min = 99; for (let i = 0; i < 150; i++) { R.flow.update(DT, g); R.sim.update(DT); vmax = Math.max(vmax, Math.abs(o.v)); if (i > 20) min = Math.min(min, o.v); } return { min, vmax, pen: o.pen, d: Math.hypot(o.x - pose.x, o.z - pose.z) }; };
    const f = go({ gas: 1 }), b = go({ brake: 1 });
    R.vin.detach(); if (f.vmax > 14 && f.d > 45 && b.vmax > 1.5 && b.d > 3) return { skip, pose };
  }
  return null;
})();
console.log(OPEN ? `(open road found: plan #${OPEN.skip})` : "(NO open road found)"); if (!OPEN) { bad++; process.exitCode = 1; }

// =====================================================================================================================================================
// every ground car
for (const car of CARS.filter((c) => !c.flies)) {
  const id = car.id, R = OPEN && rig(id, "car", OPEN.skip); if (!R) { skipped++; console.log("SKIP " + id + " (no plan)"); continue; }
  const { S, flow } = R; if (!R.drive()) { chk(id + ": boards and reaches the driver's seat", false); continue; }
  const o = flow.own, tag = id.padEnd(18);
  R.t0 = 0; const P = OPEN.pose, back = () => R.reset(P);
  // acceleration
  R.down("KeyW"); R.run(2.5); const v1 = o.v; R.run(1.0); chk(`${tag} W accelerates (v ${v1.toFixed(1)} -> ${o.v.toFixed(1)} m/s)`, v1 > 2 && o.v > v1);
  // release: no more acceleration
  R.up("KeyW"); const vr = o.v; R.run(0.5); const vAfter = o.v; chk(`${tag} releasing W stops accelerating (coasts down)`, vAfter <= vr + 1e-6);
  // brake
  back(); R.down("KeyW"); R.run(3); R.up("KeyW"); const vb = o.v; R.down("KeyS"); R.run(1.0); chk(`${tag} S brakes (v ${vb.toFixed(1)} -> ${o.v.toFixed(1)})`, o.v < vb - 1);
  // Space brakes too (the handbrake-style stop; this game has no separate handbrake)
  R.up("KeyS"); R.down("KeyW"); R.run(3); R.up("KeyW"); const vs = o.v; R.down("Space"); R.run(1.0); chk(`${tag} Space brakes`, o.v < vs - 1); R.up("Space");
  // reverse: brake from a stop
  R.until(() => Math.abs(o.v) < 0.05, 15); R.down("KeyS"); R.run(3.5); chk(`${tag} holding S from a stop reverses (v ${o.v.toFixed(2)})`, o.v < -0.3); R.up("KeyS"); R.until(() => Math.abs(o.v) < 0.1, 15);
  // steering: D and A turn opposite ways, and the same way as the wheel's own +1 / -1
  const turn = (code) => { back(); R.down("KeyW"); R.run(1.2); const a0 = o.ang; R.down(code); R.run(0.7); const d = wrap(o.ang - a0); R.up(code); R.up("KeyW"); R.until(() => Math.abs(o.v) < 0.1, 20); return d; };
  const dR = turn("KeyD"), dL = turn("KeyA"); chk(`${tag} D and A steer opposite ways (right ${dR.toFixed(2)} rad, left ${dL.toFixed(2)} rad)`, sgn(dR) !== 0 && sgn(dL) !== 0 && sgn(dR) === -sgn(dL));
  // simultaneous gas + steer
  back(); R.down("KeyW"); R.run(1.5); const p0 = { x: o.x, z: o.z }, a0 = o.ang; let vTop = 0; R.down("ArrowRight"); R.run(0.9, () => { vTop = Math.max(vTop, o.v); }); chk(`${tag} W + Right held together: keeps accelerating and turns (top ${vTop.toFixed(1)} m/s, ${wrap(o.ang - a0).toFixed(2)} rad)`, vTop > 5 && Math.abs(wrap(o.ang - a0)) > 0.005 && Math.hypot(o.x - p0.x, o.z - p0.z) > 1);
  // key release straightens the wheel
  R.up("ArrowRight"); R.up("KeyW"); R.run(1.0); chk(`${tag} releasing the steering key straightens the wheel (steer ${o.steer.toFixed(3)})`, Math.abs(o.steer) < 0.02);
  // a key held while the window loses focus: nothing keeps driving
  back(); R.down("KeyW"); R.run(1.5); const vF = o.v; R.blur(); R.run(3); chk(`${tag} window blur drops W: the car no longer accelerates`, R.vin.keys.held === 0 && o.v < vF + 1e-6);
  // a dialog opening over the game
  back(); R.down("KeyW"); R.run(1.5); R.doc.dialogs = [{ closest: () => null, checkVisibility: () => true }]; R.run(0.4); const vD = o.v; R.run(2); chk(`${tag} an open dialog stops the held W driving the car`, R.vin.keys.held === 0 && o.v < vD + 1e-6);
  R.doc.dialogs = []; R.up("KeyW");
  // exit: E while moving. The car stops itself, you get out, and a still-held key no longer drives anything
  back(); R.down("KeyW"); R.run(2.5); R.up("KeyW"); R.input.brake = 1; R.until(() => o.v < 5, 10); R.down("KeyE"); R.up("KeyE"); R.run(0.1); chk(`${tag} E asks to get out`, S.exiting === true || S.phase !== "drive");
  R.input.brake = 1; chk(`${tag} gets out (phase "${S.phase}")`, R.until(() => S.phase === "afoot", 40));
  R.run(0.1); chk(`${tag} leaving the vehicle clears the on-screen controls`, !R.input.brake && !R.input.gas && !R.input.steer);
  const px = o.x, pz = o.z; R.down("KeyW"); R.down("KeyD"); R.run(2); chk(`${tag} keys held after getting out do not move the parked car`, Math.hypot(o.x - px, o.z - pz) < 0.05 && Math.abs(o.v) < 0.05 && S.phase === "afoot");
  R.vin.detach();
}

// =====================================================================================================================================================
// the flying car
{ const id = "tesla-skyhawk-2026", R = OPEN && rig(id, "car", OPEN.skip); if (!R) { skipped++; console.log("SKIP " + id); } else { R.drive(); const { S, flow } = R, o = flow.own, tag = id.padEnd(18);
  chk(`${tag} drives on the road like a car: W accelerates, releasing stops it`, (() => { R.down("KeyW"); R.run(2.5); const v = o.v; R.up("KeyW"); const ok = v > 2; R.until(() => Math.abs(o.v) < 0.1, 20); return ok; })());
  chk(`${tag} T takes off`, (() => { R.down("KeyT"); R.up("KeyT"); R.run(0.2); return S.airborne === true; })());
  R.until(() => o.h >= CLEARANCE_M + 1, 20); R.run(1); const hq = o.h; R.down("KeyQ"); R.run(3); const h1 = o.h;  chk(`${tag} Q climbs (h ${hq.toFixed(1)} -> ${h1.toFixed(1)} m)`, h1 > hq + 3);
  R.up("KeyQ"); R.run(2.5); const h2 = o.h; R.run(1.5); chk(`${tag} releasing Q stops the climb`, Math.abs(o.h - h2) < 0.05);
  R.down("KeyQ"); R.run(1.5); R.blur(); R.run(2.5); const hs = o.h; R.run(2); chk(`${tag} window blur drops Q: it stops climbing (held keys ${R.vin.keys.held})`, R.vin.keys.held === 0 && Math.abs(o.h - hs) < 0.05);
  R.until(() => o.h >= CLEARANCE_M + 1, 14); const h3 = o.h; R.down("KeyZ"); R.run(1.2); chk(`${tag} Z descends (h ${h3.toFixed(1)} -> ${o.h.toFixed(1)})`, o.h < h3 - 1); R.up("KeyZ"); R.run(2);
  R.down("KeyW"); R.run(4); chk(`${tag} W flies forward in the air (v ${o.v.toFixed(1)})`, o.v > 5); R.up("KeyW");
  R.down("KeyE"); R.up("KeyE"); R.run(0.2); chk(`${tag} E cannot get you out in the air`, S.phase === "drive" && !S.exiting);
  chk(`${tag} T lands it`, (() => { R.until(() => o.v < 0.5, 20); R.down("KeyT"); R.up("KeyT"); return R.until(() => !S.airborne || S.phase !== "drive", 90) || o.h > 0; })());
  R.vin.detach(); } }

// =====================================================================================================================================================
// the bus and the keke: passenger rides, so the driving keys do nothing to them
for (const mode of ["bus", "keke"]) {
  const R = rig("corolla-2011", mode); if (!R) { skipped++; console.log(`SKIP ${mode}: no plan found on this map`); continue; }
  const { S, flow } = R; R.until(() => S.phase === "ride", 120); const reached = S.phase === "ride";
  chk(`${mode.padEnd(18)} you ride as a passenger (phase "${S.phase}")`, reached);
  for (const c of ["KeyW", "KeyD", "Space", "KeyE"]) R.down(c); R.run(3);
  chk(`${mode.padEnd(18)} W / D / Space / E do not drive it or get you out of it`, S.phase !== "drive" && !flow.own);
  R.vin.detach();
}

console.log(bad ? `\n${bad} FAILED` : `\nall vehicle control checks passed${skipped ? ` (${skipped} skipped: no plan)` : ""}`);
