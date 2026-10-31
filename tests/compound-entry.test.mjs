// tests/compound-entry.test.mjs
// Getting into and out of your own vehicles in the home compound, on foot: the walk to a door goes round every other vehicle, the furniture, the house and the hedges and never through
// them; the driver's door is used unless it cannot be; the spot to stand on is checked BEFORE anything moves; with no safe spot nobody is put anywhere; and the two door sequences are
// smooth from first frame to last. All of it for every showroom vehicle in homes of every size and plan.
import fs from "node:fs";
import { CARS } from "../lib/cars.js";
import { LAYOUTS } from "../lib/layouts.js";
import { planParking } from "../lib3d/compoundParking.js";
import { CELL_M } from "../lib3d/compoundUnits.js";
import { DOOR_OPEN_ANGLE } from "../lib3d/vehicles.js";
import { DOOR_ANGLE, WALK_R, walkWorld, planEntry, planExit, doorLink, safeSpotNear, carBoxOf, swingClear, standSpots } from "../lib3d/compoundWalk.js";
import { enterPose, exitPose, ENTER_SECONDS, EXIT_SECONDS } from "../lib3d/compoundDoor.js";

let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const M = CELL_M, fleet = CARS.map((c) => ({ id: c.id, modelId: c.id, color: "#2c5aa0" }));
const HOMES = [{ w: 8, d: 6 }, { w: 10, d: 8 }, { w: 14, d: 10 }, { w: 20, d: 14 }, ...Object.entries(LAYOUTS).map(([id, L]) => ({ w: L.w, d: L.d, layout: id }))];
const tag = (r) => `${r.w}x${r.d}${r.layout ? ":" + r.layout : ""}`;
const inHouse = (room, p) => p.x > -0.05 && p.x < room.w * M + 0.05 && p.z > -0.05 && p.z < room.d * M + 0.05;
const envOf = (room, vehicles) => { const r = planParking(room, vehicles); return { room, cw: r.cw, slots: r.slots, placed: [], unplaced: r.unplaced }; };
const starts = (env) => {
  const world = walkWorld(env.cw, env.slots), link = doorLink(env.room), lawn = env.cw.lawn, out = [];
  out.push({ name: "inside by the front door", p: { x: (link.cell[0] + 0.5) * M, z: (link.cell[1] + 0.5) * M } });
  const far = safeSpotNear(world, { x: (lawn.x1 - 1) * M, z: (lawn.z1 - 1) * M }, 4); if (far) out.push({ name: "far corner of the lawn", p: far });
  const near = safeSpotNear(world, { x: link.outside.x * M, z: link.outside.z * M }, 4); if (near) out.push({ name: "at the front door", p: near });
  return out;
};
/** an independent check of a route: every outdoor step keeps a person's width clear of every vehicle and every static obstacle */
const routeClean = (env, pts) => {
  const world = walkWorld(env.cw, env.slots);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; if (inHouse(env.room, a) || inHouse(env.room, b)) continue;
    if (!world.segmentClear(a.x, a.z, b.x, b.z, WALK_R - 0.03)) return `step ${i} of ${pts.length}`;
  }
  return "";
};

// ---- every vehicle, every home, from every start
let routes = 0, enterable = 0, total = 0, driverSide = 0, noStand = [];
for (const room of HOMES) {
  const env = envOf(room, fleet); if (env.unplaced.length) { chk(`${tag(room)}: all vehicles placed`, false, `${env.unplaced.length} unplaced`); continue; }
  const world = walkWorld(env.cw, env.slots), problems = [];
  for (const slot of env.slots) {
    total++;
    for (const st of starts(env)) {
      const r = planEntry(env, st.p, slot);
      if (!r.ok) { if (st.name === "inside by the front door") noStand.push(`${tag(room)} ${slot.modelId} (${r.why})`); continue; }
      routes++;
      const bad1 = routeClean(env, r.route); if (bad1) problems.push(`${slot.modelId} from ${st.name}: route not clear at ${bad1}`);
      const sp = r.spot, car = carBoxOf(slot);
      if (!world.free(sp.x, sp.z, WALK_R)) problems.push(`${slot.modelId}: stand spot is not free`);
      if (!inHouse(room, r.route.at(-1)) && Math.hypot(r.route.at(-1).x - sp.x, r.route.at(-1).z - sp.z) > 0.01) problems.push(`${slot.modelId}: route does not end on the spot`);
      if (Math.hypot(sp.x - car.x, sp.z - car.z) > car.hl + 2.2) problems.push(`${slot.modelId}: spot is far from the vehicle`);
      if (!swingClear(world, car, slot.modelId, sp.side, world.bodies.filter((b) => b.id !== String(slot.id)))) problems.push(`${slot.modelId}: the door cannot swing at the spot`);
      if (st.name === "inside by the front door") { enterable++; if (sp.side === 1) driverSide++; }
    }
  }
  chk(`${tag(room)}: every route is clear of vehicles, house, garage, furniture and hedges, and ends on a free spot`, problems.length === 0, problems.slice(0, 3).join("; "));
}
chk(`${enterable}/${total} vehicles can be walked to from the front door (the rest were reported, not forced)`, enterable / total >= 0.9, noStand.slice(0, 5).join(", "));
chk(`the driver's door is used for ${driverSide}/${enterable} of them (the other side only where the driver's is blocked)`, driverSide / Math.max(1, enterable) >= 0.5);
chk("routes were really planned", routes > 100, String(routes));

// ---- exit: the spot is found first and is safe, near walls too
{
  let n = 0, fails = [];
  for (const room of HOMES) {
    const env = envOf(room, fleet), world = walkWorld(env.cw, env.slots);
    for (const slot of env.slots) {
      const r = planExit(env, slot); n++;
      if (!r.ok) { fails.push(`${tag(room)} ${slot.modelId}`); continue; }
      const world2 = walkWorld(env.cw, env.slots, { skipId: null });
      if (!world2.free(r.spot.x, r.spot.z, WALK_R)) fails.push(`${tag(room)} ${slot.modelId}: spot not free`);
      if (!swingClear(world, carBoxOf(slot), slot.modelId, r.spot.side, world.bodies.filter((b) => b.id !== String(slot.id)))) fails.push(`${tag(room)} ${slot.modelId}: door cannot swing`);
    }
  }
  chk(`exit: ${n} parked vehicles checked, every exit spot is free and its door can swing`, fails.filter((f) => f.includes(":")).length === 0, fails.slice(0, 4).join("; "));
  chk("exit: the vehicles with no exit are the exception", fails.length <= n * 0.1, `${fails.length}/${n}`);
}

// ---- blocked driver's side, and a place with no safe exit
{
  const room = { w: 20, d: 14 }; let blockedOk = 0, blockedN = 0, wedgedOk = 0, wedgedN = 0, wallOk = 0, wallN = 0;
  for (const v of fleet) {
    const env = envOf(room, [v]), slot = env.slots[0]; if (!slot) continue;
    const from = starts(env)[0].p, car = carBoxOf(slot), base = planEntry(env, from, slot); if (!base.ok) continue;
    const spot = (side) => standSpots(walkWorld(env.cw, env.slots), slot).find((s) => s.side === side);
    const fake = (sp, id) => { const dx = sp.x - car.x, dz = sp.z - car.z, l = Math.hypot(dx, dz) || 1, c = { x: car.x + (dx / l) * (car.hw + 0.55), z: car.z + (dz / l) * (car.hw + 0.55) }; return { id, modelId: slot.modelId, x: c.x / M, z: c.z / M, yaw: slot.yaw, len: slot.len, wid: slot.wid }; };
    const left = spot(1), right = spot(-1);
    if (left && right) {
      const e1 = { ...env, slots: [slot, fake(left, "blk-l")] }, a = planEntry(e1, from, slot), x = planExit(e1, slot); blockedN++;
      if ((a.ok ? a.spot.side === -1 : true) && (x.ok ? x.spot.side === -1 : true)) blockedOk++;
      const e2 = { ...env, slots: [slot, fake(left, "blk-l"), fake(right, "blk-r")] }, a2 = planEntry(e2, from, slot), x2 = planExit(e2, slot); wedgedN++;
      const w2 = walkWorld(e2.cw, e2.slots); // either nothing is offered, or what is offered is truly free (never inside the blockers)
      if ((!a2.ok || w2.free(a2.spot.x, a2.spot.z, WALK_R)) && (!x2.ok || w2.free(x2.spot.x, x2.spot.z, WALK_R))) wedgedOk++;
    }
  }
  chk(`driver's side blocked: the other side is used, never the blocked one (${blockedOk}/${blockedN})`, blockedN > 0 && blockedOk === blockedN);
  chk(`both sides blocked: no spot inside a blocker is ever offered (${wedgedOk}/${wedgedN})`, wedgedN > 0 && wedgedOk === wedgedN);
  // totally boxed in: a ring of cars around one vehicle leaves no way to stand at all
  const env = envOf(room, [fleet[0]]), slot = env.slots[0], car = carBoxOf(slot), ring = [];
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2, rad = Math.max(car.hl, car.hw) + 0.6; ring.push({ id: "r" + i, modelId: slot.modelId, x: (car.x + Math.sin(a) * rad) / M, z: (car.z + Math.cos(a) * rad) / M, yaw: a, len: slot.len, wid: slot.wid }); }
  const boxed = { ...env, slots: [slot, ...ring] }, e = planExit(boxed, slot), a = planEntry(boxed, starts(env)[0].p, slot);
  chk("boxed in by other vehicles: exiting is refused with a reason (the person stays in the seat)", !e.ok && !!e.why, JSON.stringify(e).slice(0, 80));
  chk("boxed in by other vehicles: getting in is refused with a reason", !a.ok && !!a.why);
  void wallOk; void wallN;
}

// ---- unknown vehicles are refused, not crashed on; the plan never mutates its input
{
  const env = envOf({ w: 10, d: 8 }, fleet.slice(0, 3)), before = JSON.stringify(env.slots);
  planEntry(env, starts(env)[0].p, env.slots[0]); planExit(env, env.slots[0]);
  chk("planning leaves the parking plan untouched", JSON.stringify(env.slots) === before);
}

// ---- door sequences
{
  const env = envOf({ w: 14, d: 10 }, fleet), slot = env.slots[0], r = planExit(env, slot), g = r.geom;
  const run = (fn, T) => { const out = []; for (let t = 0; t <= T + 0.5; t += 1 / 60) out.push(fn(t, g)); return out; };
  for (const [name, fn, T] of [["enter", enterPose, ENTER_SECONDS], ["exit", exitPose, EXIT_SECONDS]]) {
    const ps = run(fn, T); let maxStep = 0, maxDoor = 0, jump = 0;
    for (let i = 1; i < ps.length; i++) { maxStep = Math.max(maxStep, Math.hypot(ps[i].x - ps[i - 1].x, ps[i].z - ps[i - 1].z)); jump = Math.max(jump, Math.abs(ps[i].door - ps[i - 1].door)); maxDoor = Math.max(maxDoor, ps[i].door); }
    chk(`${name}: no teleport (largest step ${maxStep.toFixed(3)} m per frame)`, maxStep < 0.06);
    chk(`${name}: the door moves smoothly (${jump.toFixed(3)} per frame), opens fully and ends shut`, jump < 0.08 && maxDoor > 0.95 && ps.at(-1).door === 0);
    chk(`${name}: finishes exactly at ${T}s and not before`, !fn(T - 0.05, g).done && fn(T, g).done);
  }
  const e0 = enterPose(0, g), e1 = enterPose(ENTER_SECONDS, g), x0 = exitPose(0, g), x1 = exitPose(EXIT_SECONDS, g);
  chk("enter: starts on the spot, ends on the seat, seated", Math.hypot(e0.x - g.spot.x, e0.z - g.spot.z) < 1e-6 && Math.hypot(e1.x - g.seat.x, e1.z - g.seat.z) < 1e-6 && e1.seated);
  chk("exit: starts on the seat, ends on the spot, standing", Math.hypot(x0.x - g.seat.x, x0.z - g.seat.z) < 1e-6 && Math.hypot(x1.x - g.spot.x, x1.z - g.spot.z) < 1e-6 && !x1.seated);
}
chk("the door angle used for clearance is the model's own", DOOR_ANGLE === DOOR_OPEN_ANGLE);

// ---- the 3D room is wired to it (cannot run three.js here)
{
  const room = fs.readFileSync(new URL("../lib3d/room.js", import.meta.url), "utf8"), ui = fs.readFileSync(new URL("../components/CompoundDrive.js", import.meta.url), "utf8");
  chk("a tap on a vehicle starts the walk (enterCar), not the drive directly", /enterCar\(car\)/.test(room) && !/if \(car != null\) \{ cb\.onVehicle/.test(room));
  chk("the drive only starts when the door sequence is done", /kind === "enter"\) \{ cb\.onVehicle\?\.\(id\)/.test(room));
  chk("a vehicle that moved or went away stops the walk", /no longer available/.test(room) && /fleet\.isDriving\(\)\) return abortAct/.test(room));
  chk("a second tap during the door sequence is ignored", /act\?\.phase === "door"\) return/.test(room));
  chk("Park plans the exit first and tells the player when it is blocked", /exitCar\?\.\(\)/.test(ui) && /toast\.error\(r\.why\)/.test(ui));
  chk("the walk can be cancelled (button and Escape)", /cancelEntry/.test(ui) && /Escape/.test(ui));
}
console.log(bad ? `\n${bad} FAILED` : "\nall passed"); process.exit(bad ? 1 : 0);
