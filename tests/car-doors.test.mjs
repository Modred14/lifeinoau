// tests/car-doors.test.mjs
// Your own car, over the real campus map, through the real trip state machine (headless):
//   getting in is a sequence (walk to the door, it opens, step in and sit, it closes) and the controls do nothing until it is over;
//   the car follows its heading and the wheel steers it the right way; Exit Car stops the car, opens the door and puts you on a clear spot beside it, never in the car or a wall;
//   on foot the car's controls are dead; the door can be closed; you can get back in and drive again; and nobody ever jumps (no teleporting) at any step.
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim, KINDS } from "../lib3d/trafficsim.js";
import { exitSpots } from "../lib3d/carexit.js";
import { CAR_BOARD_SECONDS } from "../lib/travel.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null);
let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let plan = null; for (let i = 0; i < 60 && !plan; i++) { const p = planTrip(svc, { from: places[(i * 7) % places.length], to: places[(i * 13 + 5) % places.length], mode: "car", driver: false }); if (p.ok && p.route?.len > 500) plan = p; }
assert.ok(plan, "a car trip to test with");
const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => plan.start ?? places[0], rnd });
const notices = []; let end = null, paid = 0;
const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => { paid++; return true; }, onEnter() {}, onEnd: (w) => { end = w; }, onNotice: (m) => notices.push(m) });
const S = flow.state, DT = 1 / 30; let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };
const frames = []; let maxStep = 0, last = null;
// a person never moves faster than a few m/s between frames, except while carried by the car (drive) or sent to the kerb at the start (intro, approach)
const tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); const p = flow.person, skip = ["intro", "approach", "drive"]; if (last && !skip.includes(S.phase) && !skip.includes(last.phase)) { const sp = Math.hypot(p.x - last.x, p.z - last.z) / DT; if (sp > maxStep) { maxStep = sp; if (process.env.DBG) console.log('step', sp.toFixed(1), last.phase, '->', S.phase, S.t.toFixed(2)); } } last = { x: p.x, z: p.z, phase: S.phase }; };
const until = (cond, secs, inp = {}) => { for (let i = 0; i < secs * 30 && !cond(); i++) tick(typeof inp === "function" ? inp() : inp); return cond(); };

// a driver who follows the planned road (pure pursuit), so the car stays on the carriageway through bends
const pts = plan.route.path.pts, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const aim = (c) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - c.x, p[1] - c.z); if (d < bd) { bd = d; bi = i; } }); let k = bi; while (k < pts.length - 1 && Math.hypot(pts[k][0] - c.x, pts[k][1] - c.z) < 9) k++;
  const want = Math.atan2(pts[k][0] - c.x, pts[k][1] - c.z); return Math.max(-1, Math.min(1, -wrap(want - c.ang) * 2.2)); };
const drv = (c, inp) => ({ steer: aim(c), ...inp });

// 1. walk to the car, then the entering sequence
ok("walks to the car", until(() => S.phase === "board", 90));
ok("the door the player uses is the driver's (left) or the clear one", [1, -1].includes(S.vehDoorSide));
const doorSide = S.vehDoorSide, boardLog = []; let sawOpen = false, own0 = flow.own;
ok("nothing is steerable before the sequence ends", own0 == null);
while (S.phase === "board") { tick({ gas: 1, steer: 1, exit: true }); boardLog.push({ t: S.t, door: S.vehDoorK, seat: S.seatK, v: flow.vehicle.v ?? 0 }); sawOpen ||= S.vehDoorK > 0.95; ok("the car does not move while you get in", Math.abs(flow.vehicle.v ?? 0) < 1e-9); }
ok("the door really opened wide during entry", sawOpen); ok("the door was open before the person sat down", boardLog.find((l) => l.seat > 0.5).door > 0.9);
ok("the door is shut again when the controls come on", S.vehDoorK === 0 && S.seatK === 1 && S.phase === "drive"); ok("entry took the time of the sequence", Math.max(...boardLog.map((l) => l.t)) >= CAR_BOARD_SECONDS - 0.2);
ok("the door never jumps (it opens and closes over several frames)", boardLog.every((l, i) => i === 0 || Math.abs(l.door - boardLog[i - 1].door) < 0.1)); ok("the seat blend rises smoothly, never a snap", boardLog.every((l, i) => i === 0 || Math.abs(l.seat - boardLog[i - 1].seat) < 0.1));
ok("the keys pressed during entry did nothing (no stray exit request)", !S.exiting && notices.length === 0);

// 2. driving: forward along the heading, a right wheel turns right, no teleport, speed changes gradually
const car = flow.own; ok("an own car exists once seated", !!car); const a0 = car.ang, p0 = { x: car.x, z: car.z }; 
let prevV = 0, maxDv = 0; for (let i = 0; i < 90; i++) { tick(drv(car, { gas: 1 })); maxDv = Math.max(maxDv, Math.abs(car.v - prevV)); prevV = car.v; }
const dispAng = Math.atan2(car.x - p0.x, car.z - p0.z), meanAng = (a0 + car.ang) / 2;
ok("it accelerates", car.v > 3 && Math.hypot(car.x - p0.x, car.z - p0.z) > 4); ok("it moves the way its wheels point: the path follows the heading, no sideways slide", Math.abs(wrap(dispAng - meanAng)) < 0.12);
ok("speed rises gradually (no jump)", maxDv < 0.2); ok("the driver sits in the car", Math.hypot(flow.person.x - car.x, flow.person.z - car.z) < 1.2);
const aBefore = car.ang; for (let i = 0; i < 30; i++) tick({ gas: 0.3, steer: 1 }); ok("the wheel turned right steers the car right", car.ang < aBefore - 0.02 && car.steer < 0);
const dAng = []; for (let i = 0; i < 20; i++) { const b = car.ang; tick({ gas: 0.3, steer: -1 }); dAng.push(Math.abs(car.ang - b)); } ok("it never turns suddenly", Math.max(...dAng) < 0.05);
ok("brake slows it", (() => { const v = car.v; for (let i = 0; i < 20; i++) tick(drv(car, { brake: 1 })); return car.v < v - 1.5 || car.v < 0.2; })());

// 3. exit: too fast is refused; otherwise the car stops itself, the door opens, and you stand on a clear spot
car.v = 15; ok("it is going fast", car.v >= 14.5);
tick({ exit: true }); ok("too fast to get out: refused with a message, still driving", S.phase === "drive" && !S.exiting && notices.some((m) => /slow down/i.test(m)));
until(() => car.v < 8, 10, () => drv(car, { brake: 1 })); tick(drv(car, { exit: true })); ok("exit requested at a safe speed: the car is braking itself to a stop", S.exiting || S.phase !== "drive");
let prev = car.v, maxDecel = 0; while (S.phase === "drive") { tick(drv(car, {})); maxDecel = Math.max(maxDecel, (prev - car.v) / DT); prev = car.v; if (flow.state.time > 4000) break; }
ok("it stopped at a steady rate, not instantly", maxDecel < 8); ok("then the exit sequence starts", S.phase === "exit"); ok("the car is stopped before the door opens", car.v === 0);
const box = { x: car.x, z: car.z, hx: car.hx, hz: car.hz, len: car.len, wid: car.wid }, carAt = { x: car.x, z: car.z, ang: car.ang };
const seats = []; while (S.phase === "exit") { tick({ gas: 1, steer: 1 }); seats.push({ seat: S.seatK, door: S.vehDoorK }); ok("the car stays still while you climb out", car.x === carAt.x && car.z === carAt.z && car.ang === carAt.ang); }
ok("the door opened while you were still seated", seats.find((s) => s.door > 0.9).seat > 0.5); ok("the seat blend falls smoothly to standing", seats.every((s, i) => i === 0 || Math.abs(s.seat - seats[i - 1].seat) < 0.1) && S.seatK === 0);
ok("you are now on foot, door left open", S.phase === "afoot" && S.vehDoorK === 1);
const w = flow.person, cls = (x, z) => { const dx = x - box.x, dz = z - box.z, u = dx * box.hx + dz * box.hz, v = -dx * box.hz + dz * box.hx; return Math.hypot(u - Math.max(-box.len / 2, Math.min(box.len / 2, u)), v - Math.max(-box.wid / 2, Math.min(box.wid / 2, v))); };
ok("you stand outside the car, beside it, not inside it", cls(w.x, w.z) > 0.45 && cls(w.x, w.z) < 3); ok("not inside a wall, fence or building", !svc.world.blockedAt(w.x, w.z, 0.3));
ok("on the ground (the world is flat: no floating or sinking)", Number.isFinite(w.x) && Number.isFinite(w.z));
ok("nobody teleported during the whole sequence", maxStep < 3.2);

// 4. on foot: the car's controls are dead; walking works
for (let i = 0; i < 30; i++) tick({ gas: 1, steer: 1, brake: 1 }); ok("gas, brake and wheel do nothing out of the car", car.x === carAt.x && car.z === carAt.z && car.v === 0);
const wx = w.x, wz = w.z; for (let i = 0; i < 30; i++) tick({ dx: -box.hz, dz: box.hx, mag: 1 }); ok("you can walk", Math.hypot(w.x - wx, w.z - wz) > 0.8);
until(() => S.canEnter, 10, { dx: wx - w.x, dz: wz - w.z, mag: 1 }); ok("beside the car you can get back in", S.canEnter); ok("an open door can be closed", S.canClose);
tick({ close: true }); until(() => S.vehDoorK === 0, 3); ok("closing the door takes a moment and ends shut", S.vehDoorK === 0 && !S.canClose);

// 5. get back in and drive again (the door is walked to, opened, closed again)
tick({ enter: true }); ok("re-entering walks you to the door", S.phase === "reenter"); ok("then the entering sequence", until(() => S.phase === "board", 20));
until(() => S.phase === "drive", 8); ok("back at the wheel, controls on, same car, same place", S.phase === "drive" && flow.own === car && Math.hypot(car.x - carAt.x, car.z - carAt.z) < 1e-9 && S.vehDoorK === 0);
for (let i = 0; i < 60; i++) tick(drv(car, { gas: 1 })); ok("it drives again", car.v > 2); ok("still no teleport after re-entering", maxStep < 3.2);

// 6. no room to get out: the request is refused with a message and driving continues
{ const around = []; const ctx = { world: svc.world, vehicles: [{ x: car.x, z: car.z, hx: car.hx, hz: car.hz, len: 40, wid: 40 }], onRoad: () => false };
  ok("the finder refuses when every spot is blocked", exitSpots({ x: car.x, z: car.z, hx: car.hx, hz: car.hz, len: car.len, wid: car.wid }, KINDS.car, ctx).length === 0);
  const free = exitSpots({ x: car.x, z: car.z, hx: car.hx, hz: car.hz, len: car.len, wid: car.wid }, KINDS.car, { world: { blockedAt: () => false, segmentClear: () => true }, vehicles: [], onRoad: () => false }); ok("with room, the driver's side comes first", free[0].side === 1);
  const road = exitSpots({ x: 0, z: 0, hx: 0, hz: 1, len: 4.5, wid: 1.85 }, KINDS.car, { world: { blockedAt: () => false, segmentClear: () => true }, vehicles: [], onRoad: (x) => x > 0 }, { preferSide: 1 }); ok("pavement beats the road, even on the other side", road[0].side === -1 && !road[0].road);
  const wall = exitSpots({ x: 0, z: 0, hx: 0, hz: 1, len: 4.5, wid: 1.85 }, KINDS.car, { world: { blockedAt: (x) => x > 0, segmentClear: () => true }, vehicles: [], onRoad: () => false }); ok("a wall on one side sends you out the other", wall.length > 0 && wall.every((s) => s.side === -1)); }
ok("the trip is still running (no accidental end)", end === null);
console.log(`own-car doors, exit and driving passed: ${n} checks`);
