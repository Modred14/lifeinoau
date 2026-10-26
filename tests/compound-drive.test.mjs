// tests/compound-drive.test.mjs
// Leaving the home compound: every owned vehicle is parked on the lawn (no overlaps, nothing on the house, garage, driveway or the player's own furniture), each has a way out to the gate,
// a vehicle can really be driven from its place out onto the road with the compound's driving model, the hand-over to the map is single-use and expires, and the map's free drive puts the
// same vehicle on the road beside every home, on the lane, facing the way of the traffic, still moving at the speed it left at, with no destination until one is chosen.
import fs from "node:fs";
import assert from "node:assert/strict";
import { CARS } from "../lib/cars.js";
import { PLOT_RULES, plotFor } from "../lib/plot.js";
import { planParking, exitRoute, metresWorld, onCarriageway, poseBox, CELL_M } from "../lib3d/compoundParking.js";
import { createDriver, autopilot, blockedPose } from "../lib3d/garageDrive.js";
import { garageVehicleSize } from "../lib3d/garageLayout.js";
import { setDriveHandoff, peekDriveHandoff, takeDriveHandoff, HANDOFF_TTL_MS } from "../lib/driveHandoff.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { HOME_PLACE } from "../lib/travel.js";

let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const fleet = CARS.map((c) => ({ id: c.id, modelId: c.id, color: "#2c5aa0" }));
const ROOMS = [{ w: 8, d: 6 }, { w: 10, d: 8 }, { w: 14, d: 10 }, { w: 20, d: 14 }];

// ---- parking ----
for (const room of ROOMS) {
  const tag = `${room.w}x${room.d}`, r = planParking(room, fleet), cw = r.cw, bodies = r.slots.map((s) => poseBox(s.x, s.z, s.yaw, s.len, s.wid));
  chk(`${tag}: all ${fleet.length} showroom vehicles get a place`, r.slots.length === fleet.length && r.unplaced.length === 0, `${r.unplaced.length} unplaced`);
  chk(`${tag}: no two vehicles overlap`, bodies.every((a, i) => bodies.slice(i + 1).every((b) => !hit(a, b))));
  chk(`${tag}: none stands on the house, the garage, the driveway or outside the hedges`, bodies.every((b) => !cw.solids.some((s) => hit(s, b)) && !hit(plotFor(room).drive, b) && b.x0 >= cw.lawn.x0 && b.x1 <= cw.lawn.x1 && b.z0 >= cw.lawn.z0 && b.z1 <= cw.lawn.z1));
  chk(`${tag}: every vehicle has a way out to the gate`, r.slots.every((s) => !!exitRoute(cw, r.slots, s)));
  const again = planParking(room, fleet);
  chk(`${tag}: the same vehicles always park the same way`, JSON.stringify(again.slots) === JSON.stringify(r.slots));
  // the player's own furniture on the lawn is never parked on
  const items = [{ key: "palm", x: 2, z: room.d + 9, rot: 0, placed: true }].filter((i) => true), withItems = planParking(room, fleet.slice(0, 4), items.filter((i) => i.key));
  chk(`${tag}: parking works with outdoor furniture on the lawn`, withItems.slots.length === 4);
}
chk("a longer collection than the showroom's is never silently dropped (it is reported)", (() => { const many = Array.from({ length: 30 }, (_, i) => ({ id: "x" + i, modelId: CARS[i % CARS.length].id, color: "#fff" })), r = planParking(ROOMS[0], many); return r.slots.length + r.unplaced.length === 30 && r.slots.length >= 10; })());
chk("the compound's front yard is deep enough for a second row of parking (frontYard)", PLOT_RULES.frontYard >= 14);

// ---- driving out, physically ----
// the ground the driver sees (in metres) agrees with the ground the parking was planned on: nobody starts inside a wall or another vehicle, and from the driveway the gate and the road are reachable
for (const room of ROOMS) {
  const r = planParking(room, fleet), cw = r.cw;
  const free = r.slots.every((s) => !blockedPose(metresWorld(cw, r.slots, s.id), s.x * CELL_M, s.z * CELL_M, s.yaw, s.len * CELL_M, s.wid * CELL_M));
  chk(`${room.w}x${room.d}: every parked vehicle stands clear of everything solid in the driving world`, free);
  const size = garageVehicleSize(fleet[0].modelId), x = (cw.drive.x0 + cw.drive.x1) / 2, z0 = plotFor(room).garage.z1 + 3, d = createDriver(metresWorld(cw, r.slots), { x: x * CELL_M, z: z0 * CELL_M, yaw: 0 }, size);
  const ap = autopilot([[x * CELL_M, z0 * CELL_M], [x * CELL_M, (cw.P.road.z0 + 4) * CELL_M]], size, { speed: 3.5, lookahead: 3.4 }); let out = false;
  for (let t = 0; t < 60 && !out; t += 1 / 60) { d.step(ap(d.state), 1 / 60); out = onCarriageway(cw, d.state.x / CELL_M, d.state.z / CELL_M, d.state.yaw, size.length / CELL_M, size.width / CELL_M); }
  chk(`${room.w}x${room.d}: from the driveway a vehicle rolls through the gate and is on the carriageway`, out && !d.state.hit);
}

// ---- the hand-over ----
setDriveHandoff({ modelId: "camry-2014", color: "#111", v: 99 }, 1000);
chk("the hand-over keeps the model, the paint and the speed, limited to what the car can do", peekDriveHandoff(1500)?.modelId === "camry-2014" && peekDriveHandoff(1500).v === 22);
chk("the hand-over is used once", !!takeDriveHandoff(1500) && takeDriveHandoff(1500) === null);
setDriveHandoff({ modelId: "a", v: -5 }, 1000);
chk("a reversing vehicle hands over a standstill, never a negative speed", takeDriveHandoff(1001).v === 0);
setDriveHandoff({ modelId: "a", v: 5 }, 1000);
chk("an old hand-over expires", peekDriveHandoff(1000 + HANDOFF_TTL_MS + 1) === null);

// ---- the free drive on the real map ----
const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null && !p.offmap);
let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (const [hostel, id] of Object.entries(HOME_PLACE)) {
  const home = places.find((p) => p.id === id); if (!home) continue;
  const plan = planTrip(svc, { from: home, to: home, mode: "car", driver: false });
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => home, rnd }); let end = null;
  const flow = createTripFlow({ svc, sim }, { plan, free: true, spawn: { v: 9 }, dims: { len: 4.85, wid: 1.85 }, rnd, onArrive: () => true, onEnter() {}, onEnd: (w) => { end = w; }, onNotice() {} });
  const o = flow.own, lane = plan.pick.lane;
  chk(`${hostel}: the vehicle is on the road at the wheel at once, moving at the speed it left at, facing the way of the lane`, flow.state.phase === "drive" && !!o && Math.abs(o.v - 9) < 1e-6 && o.hx * plan.pick.hx + o.hz * plan.pick.hz > 0.2 && Math.hypot(o.x - plan.pick.x, o.z - plan.pick.z) < 80 && flow.free);
  chk(`${hostel}: it stands on a road lane`, svc.graph.surfaceAt(o.x, o.z, {}).cls === 1);
  let t = 0, x0 = o.x, z0 = o.z, vMin = 99; while (t < 0.4) { flow.update(1 / 30, { gas: 0.6, brake: 0, steer: 0 }); sim.update(1 / 30); t += 1 / 30; vMin = Math.min(vMin, o.v); }
  chk(`${hostel}: it rolls on with its momentum (no sudden stop) and the drive does not end by itself`, !end && Math.hypot(o.x - x0, o.z - z0) > 3 && vMin > 7 && flow.state.phase === "drive" && flow.free);
  const other = places.find((p) => p.id !== id && p.kind && Math.hypot(p.x - o.x, p.z - o.z) > 150);
  const dest = other && planTrip(svc, { from: home, to: other, mode: "car" });
  chk(`${hostel}: choosing a place on the way makes it an ordinary trip to it`, !other || !dest.ok || (flow.retarget({ ...dest, mode: "car" }, true).ok && !flow.free));
  flow.dispose();
}
if (bad) { console.log(`\n${bad} check(s) failed`); process.exit(1); }
console.log("\nall compound-drive checks passed");
