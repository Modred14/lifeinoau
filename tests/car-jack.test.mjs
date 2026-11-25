// tests/car-jack.test.mjs
// Taking a car from the computer-driven NPC at the wheel (GTA-style), over the real campus map, through the real trip state machine (headless):
//   the prompt (only a car with a driver, stopped, within reach; the side the player stands on is reported), the walk round to the driver's door, the door opening, the driver
//   startled / resisting / pulled out through the door onto a clear spot / running away (never overlapping the player, never teleporting, never stuck in the car), the player getting in
//   through the same door, the door shutting, and control passing to the player on the existing own-car physics, with the NPC car gone from the traffic for good.
//   Also: a car that drives off, no room, a second player going for the same car (only one gets it), and leaving mid-sequence (nothing is left held or half-built).
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim, KINDS, toWorld } from "../lib3d/trafficsim.js";
import { JACK, jackTarget, jackStand, jackDoor, jackSeat, takeable, createVictim, jackStage } from "../lib3d/carjack.js";
import { exitSpots } from "../lib3d/carexit.js";
import { makeVehicle } from "../lib3d/vehicles.js";
import { wheelContacts } from "../lib3d/vehiclepose.js";

let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };
const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), { world } = svc;
const places = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard");
const DT = 1 / 30, hyp = Math.hypot;

// ---------- 1. the pure rules ----------
{
  const car = { id: 1, role: "npc", kind: "car", v: 0, x: 0, z: 0, hx: 0, hz: 1, len: 4.5, wid: 1.85, y: 0 };
  ok("an ordinary stopped NPC car can be taken", takeable(car));
  ok("not a bus, a minibus or a keke (no driver seat the own-car physics can use)", ["bus", "minibus", "keke"].every((k) => !takeable({ ...car, kind: k })));
  ok("not the player's own car or a hired one (custom)", !takeable({ ...car, role: "hero", custom: true }) && !takeable({ ...car, custom: true }));
  ok("not one that is moving", !takeable({ ...car, v: JACK.maxSpeed + 0.5 }) && takeable({ ...car, v: JACK.maxSpeed - 0.1 }));
  ok("not one on the expressway or a ramp", !takeable({ ...car, hw: true }) && !takeable({ ...car, y: 5 }));
  // the car faces +z (hx 0, hz 1): its LEFT is +x (the driver's side), its right (the kerb side) is -x
  const left = jackTarget([car], { x: 1.7, z: 0 }), right = jackTarget([car], { x: -1.7, z: 0 });
  ok("offered from the driver's (left) side, and says so", left?.side === 1); ok("offered from the other side, and says so", right?.side === -1);
  ok("not offered when out of reach", jackTarget([car], { x: 4, z: 0 }) === null && jackTarget([car], { x: 0, z: 6 }) === null);
  ok("the nearest car wins", jackTarget([car, { ...car, id: 2, x: 6 }], { x: 5, z: 0 })?.veh.id === 2);
  const st = jackStand(car), dr = jackDoor(car), seat = jackSeat(car);
  ok("the player stands outside the driver's door, behind its line", st.x > 0.9 && st.z < KINDS.car.doorZL);
  ok("the door line is in the side of the car, the seat inside it", Math.abs(dr.x) < car.wid / 2 && Math.abs(seat.x) < car.wid / 2 && seat.x > 0);
  ok("the stages run in order", [0, 0.7, 2, 3.5].map(jackStage).join() === "startle,resist,pulled,flee");
  // the victim on its own, with nothing in the way
  const exit = { x: 1.6, z: 0.4 }, V = createVictim({ car, exit, world: null }), v = V.V, trace = [];
  let prev = { x: v.x, z: v.z }, maxStep = 0; for (let i = 0; i < 30 * 12 && !v.done; i++) { V.update(DT); maxStep = Math.max(maxStep, hyp(v.x - prev.x, v.z - prev.z)); prev = { x: v.x, z: v.z }; trace.push(v.stage); }
  ok("starts seated, hands up", trace[0] === "startle" && jackSeat(car).x === V.seat.x);
  ok("ends: it runs off and is done, never stays", v.done && trace.includes("flee"));
  ok("never teleports (no step over what a runner covers in a frame)", maxStep < JACK.fleeSpeed * DT * 1.5);
  ok("it is out of the car, away from it, when done", hyp(v.x - car.x, v.z - car.z) > 8);
}

// ---------- the rig: a real NPC car on the real roads ----------
const dims = (() => { const m = makeVehicle("camry-2014", "#2c5aa0"); return { len: m.length, wid: m.width, id: m.id, seat: m.seat, driver: m.driver, wheels: wheelContacts(m) }; })();
let seed = 21; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const trekPlan = (() => { for (let i = 0; i < 200; i++) { const f = places[(i * 7) % places.length], t = places[(i * 11 + 3) % places.length]; if (f.id === t.id) continue; const p = planTrip(svc, { from: f, to: t, mode: "trek", driver: false }); if (p.ok && p.walk?.len > 200) return p; } return null; })();
assert.ok(trekPlan, "a walk to test with");
const spotFree = (x, z) => !world.blockedAt(x, z, 0.45);
/** A world with the player on foot on the road and a real, stopped NPC car beside them; `side` +1: standing on the driver's side, -1: the other. */
function rig(side, extra = {}) {
  let follow = null;   // the traffic is simulated around the player, as the camera does in the game: a car far from them is despawned
  const sim = createTrafficSim({ graph: svc.graph, world, focus: () => follow?.walker ?? trekPlan.start, rnd }), made = [], notices = [];
  for (let i = 0; i < 90 * 30; i++) sim.update(DT);   // the traffic has been running for 90 s
  const flow = createTripFlow({ svc, sim }, { plan: trekPlan, onEnter() {}, onEnd() {}, onNotice: (m) => notices.push(m), makeStolen: (info) => { made.push(info); return dims; }, ...extra }), S = flow.state;
  const tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); }, until = (cond, secs, inp = {}) => { for (let i = 0; i < secs * 30 && !cond(); i++) tick(typeof inp === "function" ? inp() : inp); return cond(); };
  follow = flow; until(() => S.phase === "trek", 10);
  for (const b of sim.vehicles) if (b.role === "npc") b.hold = true;   // the whole traffic stands still: nobody runs the player over while the sequence is measured
  for (let i = 0; i < 5 * 30; i++) tick();
  let pick = null, spot = null;
  for (const c of sim.vehicles) { if (!takeable(c) || c.done) continue; const sp = toWorld(c, { x: side * (c.wid / 2 + 0.7), z: 1.3 }); if (!spotFree(sp.x, sp.z)) continue;
    const box = (b) => ({ x: b.x, z: b.z, hx: b.hx, hz: b.hz, len: b.len, wid: b.wid }), stand = jackStand(c);   // the driver's door must have a clear place outside it (the same test the game applies)
    if (!exitSpots(box(c), KINDS.car, { world, vehicles: sim.vehicles.filter((b) => b !== c).map(box) }, { preferSide: 1 }).some((q) => q.side === 1 && hyp(q.x - stand.x, q.z - stand.z) > 1.3)) continue;
    pick = c; spot = sp; break; }
  assert.ok(pick, "a stopped NPC car with room beside it on side " + side + " (" + sim.vehicles.length + " vehicles)");
  flow.walker.place(spot.x, spot.z); flow.walker.hx = -side * pick.hz; flow.walker.hz = side * pick.hx;
  for (let i = 0; i < 10; i++) tick();
  return { sim, flow, S, tick, until, pick, spot, made, notices };
}

for (const side of [1, -1]) {
  const R = rig(side), { sim, flow, S, tick, until, pick } = R, id = pick.id; let car0 = null;
  const tag = side > 0 ? "[driver's side] " : "[far side] ";
  ok(tag + "the prompt is offered beside a stopped NPC car", S.canJack && S.jackSide === side);
  ok(tag + "not offered 6 m away", (() => { const p = flow.walker, keep = { x: p.x, z: p.z }; flow.walker.place(keep.x + 6 * pick.hx, keep.z + 6 * pick.hz); tick(); const c = S.canJack; flow.walker.place(keep.x, keep.z); tick(); return !c && S.canJack; })());
  ok(tag + "not offered for a moving car", (() => { const v = pick.v; pick.hold = false; pick.v = 6; flow.update(0.0001, {}); const c = S.canJack; pick.v = v; pick.hold = true; return !c; })());
  const wasHeld = sim.vehicles.includes(pick);
  tick({ jack: true }); ok(tag + "pressing it starts the walk to the driver's door", S.phase === "jackwalk" && wasHeld && sim.vehicles.includes(pick));
  tick({ jack: true }); tick({ jack: true }); ok(tag + "pressing it again changes nothing (one take at a time)", S.phase === "jackwalk");
  const W = flow.walker, steps = []; let last = { x: W.x, z: W.z }, minGap = 9, carMoved = 0;
  const watch = () => { steps.push(hyp(W.x - last.x, W.z - last.z)); last = { x: W.x, z: W.z }; const V = flow.victim; if (V) minGap = Math.min(minGap, hyp(V.x - W.x, V.z - W.z)); };
  while (S.phase === "jackwalk") { tick(); watch(); if (steps.length > 30 * 12) break; }
  ok(tag + "reaches the driver's door", S.phase === "jack");
  ok(tag + "the NPC car is out of the traffic for good, nothing drives it any more", !sim.vehicles.some((b) => b.id === id) && R.made.length === 1);
  car0 = { x: pick.x, z: pick.z, hx: pick.hx, hz: pick.hz, len: pick.len, wid: pick.wid };   // where the NPC car stood the moment it was taken (it may creep while the player walks round)
  const own = flow.own; ok(tag + "it is the player's car now, in the very same place and heading", !!own && hyp(own.x - car0.x, own.z - car0.z) < 1e-6 && hyp(own.hx - car0.hx, own.hz - car0.hz) < 1e-6 && S.stolen && own.v === 0);
  ok(tag + "it has the model's real size and the existing physics", own.len === dims.len && own.wid === dims.wid && !!own.P);
  ok(tag + "the door that opens is the driver's (left)", S.vehDoorSide === 1);
  const V = flow.victim; ok(tag + "the driver is in the seat", !!V && V.seated && V.stage === "startle" && hyp(V.x - jackSeat(car0).x, V.z - jackSeat(car0).z) < 1e-6);
  const stages = [], doors = [], vsteps = []; let vprev = { x: V.x, z: V.z }, sawResist = false, ranOut = false;
  const inCar = (x, z) => { const dx = x - own.x, dz = z - own.z, u = dx * own.hx + dz * own.hz, w = dx * own.hz - dz * own.hx; return Math.abs(u) < own.len / 2 - 0.05 && Math.abs(w) < own.wid / 2 - 0.05; };
  while (S.phase === "jack") {
    tick(); watch(); const vv = flow.victim; if (!stages.length || stages.at(-1) !== vv.stage) stages.push(vv.stage); doors.push(S.vehDoorK); vsteps.push(hyp(vv.x - vprev.x, vv.z - vprev.z)); vprev = { x: vv.x, z: vv.z };
  }
  ok(tag + "startled, then resisting, then pulled out, then running (in that order)", /^startle,resist,pulled(,flee)?$/.test(stages.join()));
  ok(tag + "the door opened wide, smoothly", Math.max(...doors) > 0.99 && doors.every((d, i) => i === 0 || Math.abs(d - doors[i - 1]) < 0.1));
  ok(tag + "the driver never teleports while being pulled out", Math.max(...vsteps) < 0.12);
  ok(tag + "the player stood still at the door meanwhile", steps.slice(-90).every((s) => s < 0.2));
  ok(tag + "the player never teleported", Math.max(...steps) < 0.25);
  ok(tag + "the driver is out of the car and on the ground by the time the player gets in", (() => { const vv = flow.victim; return !!vv && !vv.seated && !inCar(vv.x, vv.z); })());
  ok(tag + "ordinary getting-in takes over (step in, sit, door shuts)", S.phase === "board" && S.vehDoorSide === 1);
  const door2 = []; let victimRan = 0, runSteps = [], vp = null;
  while (S.phase === "board") { tick(); watch(); door2.push(S.vehDoorK); const vv = flow.victim; if (vv) { if (vv.gait === "run") victimRan++; if (vp) runSteps.push(hyp(vv.x - vp.x, vv.z - vp.z)); vp = { x: vv.x, z: vv.z }; ok(tag + "the driver is never back inside the car", !inCar(vv.x, vv.z)); } }
  ok(tag + "the driver ran away while the player got in", victimRan > 20 && Math.max(...runSteps) < JACK.fleeSpeed * DT * 1.6);
  ok(tag + "the door shut as they sat", door2.at(-1) === 0 && Math.max(...door2) > 0.9);
  ok(tag + "the driver and the player never overlapped", minGap > 0.5);
  ok(tag + "the player has control: at the wheel, door shut, seated", S.phase === "drive" && S.seatK === 1 && S.vehDoorK === 0 && flow.own === own);
  ok(tag + "nobody else is driving it: it stays put with no input", (() => { const p = { x: own.x, z: own.z }; for (let i = 0; i < 60; i++) tick(); return hyp(own.x - p.x, own.z - p.z) < 1e-6 && !sim.vehicles.some((b) => b.id === id); })());
  for (let i = 0; i < 45; i++) tick({ gas: 1 }); ok(tag + "accelerates", own.v > 3);
  for (let i = 0; i < 20; i++) tick({ gas: 1, steer: 1 }); ok(tag + "steers right", own.steer < 0);
  until(() => own.v < 0.3, 10, { brake: 1 }); for (let i = 0; i < 60; i++) tick({ brake: 1 }); ok(tag + "brakes, then reverses", own.v < -0.3 || own.reversing);
  until(() => Math.abs(own.v) < 0.3, 10, { gas: 0, brake: 0 });
  ok(tag + "gear and speed come from the existing controller", Number.isFinite(own.v) && S.speed === own.v);
  ok(tag + "the driver is gone when it is over (never lingers)", (() => { for (let i = 0; i < 30 * 8; i++) tick(); return flow.victim === null; })());
  tick({ exit: true }); until(() => S.phase === "afoot", 20, { brake: 1 }); ok(tag + "can get out normally afterwards", S.phase === "afoot" || S.phase === "exit" || S.exiting);
  const outer = hyp(0, 0); R.flow.dispose(); ok(tag + "leaving removes the car from the world", !world.bodies.has("own"));
}

// ---------- 3. things that go wrong ----------
{ // the car drives off while the player walks round to the door
  const R = rig(-1), { sim, flow, S, tick, pick } = R; tick({ jack: true }); ok("[off] starts", S.phase === "jackwalk");
  pick.hold = false; pick.v = 9; pick.x += 3; for (let i = 0; i < 5; i++) tick(); ok("[off] the car drove off: nothing is taken, the player is back on foot with a message", S.phase === "trek" && !flow.own && !S.stolen && R.notices.some((m) => /drove off/i.test(m)) && R.made.length === 0);
  ok("[off] the player is free again", (() => { flow.walker.ignore === null; tick({ dx: 1, dz: 0, mag: 1 }); return S.phase === "trek"; })());
}
{ // leaving (a disconnect, closing the page) in the middle of going round: the car is let go
  const R = rig(-1), { sim, flow, S, tick, pick } = R; tick({ jack: true }); ok("[leave] walking round", S.phase === "jackwalk" && pick.hold === true);
  flow.dispose(); ok("[leave] the car is let go, still an ordinary NPC car", pick.hold === false && sim.vehicles.includes(pick) && !pick.custom);
}
{ // leaving in the middle of the pull: nothing half-built is left in the world
  const R = rig(1), { sim, flow, S, tick, until } = R; tick({ jack: true }); until(() => S.phase === "jack", 12); for (let i = 0; i < 40; i++) tick();
  ok("[leave] mid-pull", S.phase === "jack" && !!flow.victim); flow.dispose(); ok("[leave] the own car is removed from the world and the traffic", !world.bodies.has("own") && !sim.vehicles.some((b) => b.id === R.pick.id));
}
{ // not offered without a way to draw the full car (no model, no take), and not when the player already has a car out
  const R = rig(1, { makeStolen: undefined }); ok("[no model] no prompt without a way to build the car", !R.S.canJack);
}
{ // two players go for the same car at the same moment: exactly one gets it
  const R = rig(1), simShared = R.sim, A = R.flow, car = R.pick;
  const flowB = createTripFlow({ svc, sim: simShared }, { plan: trekPlan, onEnter() {}, onEnd() {}, onNotice() {}, makeStolen: () => dims }), SB = flowB.state;
  for (let i = 0; i < 40 && SB.phase !== "trek"; i++) flowB.update(DT, {});
  const spot = toWorld(car, { x: -(car.wid / 2 + 0.7), z: 1.3 }); flowB.walker.place(spot.x, spot.z); flowB.update(DT, {});
  ok("[race] both are offered the car", R.S.canJack && SB.canJack);
  for (let i = 0; i < 30 * 14; i++) { A.update(DT, { jack: i === 0 }); flowB.update(DT, { jack: i === 0 }); simShared.update(DT); }
  const got = [A.own, flowB.own].filter(Boolean).length; ok("[race] exactly one of them has the car", got === 1);
  ok("[race] the other is back on foot, car or no car, with no second copy", [R.S, SB].filter((s) => s.stolen).length === 1 && !simShared.vehicles.some((b) => b.id === car.id));
  A.dispose(); flowB.dispose();
}
console.log(`car jack passed: ${n} checks`);
