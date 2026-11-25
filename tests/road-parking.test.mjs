// tests/road-parking.test.mjs
// A player's own car stays where they left it on the campus road while they are inside a building, and is there when they come out (headless: the real campus map, planner, collision
// world and trip state machine).
//   1. the store (lib/roadParking.js): per player, car and place; stale or foreign records are never used; taking a record consumes it (no second copy of the car)
//   2. the journey: drive to a building, park, go in, come out through the door, walk back to the SAME car, get in and drive away; the car never moves, is never re-spawned, and is reported once
//   3. a LATER trip (after leaving the map page, or the doorstep fallback) that is given the saved pose puts the car back exactly there: no traffic "hero" is spawned, the player walks to it, gets in and drives
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { portalFor } from "../lib3d/buildingPortals.js";
import { hasInterior } from "../lib3d/interiors/registry.js";
import { isOpenSpace } from "../lib3d/interiors/openSpaces.js";
import { createNav } from "../lib3d/walker.js";
import { saveRoadParking, peekRoadParking, takeRoadParking, cleanRoadPose, forgetRoadParking, _resetRoadParking, PARK_TTL_MS } from "../lib/roadParking.js";

let n = 0; const ok = (name, c, more = "") => { assert.ok(c, more ? `${name} (${more})` : name); n++; };

// ---------- 1. the store ----------
{
  const mem = () => { let s = null; return { getItem: () => s, setItem: (_, v) => { s = v; }, removeItem: () => { s = null; }, raw: () => s }; };
  const st = mem(); _resetRoadParking(st);
  const pose = { x: 10, z: -20, hx: 0, hz: 2, len: 4.8, wid: 1.9 }, who = { playerId: "ada", modelId: "camry-2014", placeId: "library" }, t0 = 1_000_000;
  ok("a pose is cleaned (unit heading)", Math.abs(cleanRoadPose(pose).hz - 1) < 1e-9 && cleanRoadPose(pose).hx === 0);
  ok("rubbish poses are refused", [null, {}, { x: NaN, z: 0, hx: 0, hz: 1 }, { x: 0, z: 0, hx: 0, hz: 0 }, { x: 9e9, z: 0, hx: 0, hz: 1 }].every((p) => cleanRoadPose(p) === null));
  ok("saving needs a player, a car, a place and a pose", saveRoadParking({ ...who, playerId: "", pose }, t0) === null && saveRoadParking({ ...who, pose: null }, t0) === null);
  ok("a good save is stored", saveRoadParking({ ...who, color: "#c0392b", pose }, t0)?.pose.x === 10);
  ok("the same player, car and place get it back", peekRoadParking(who, t0 + 1000)?.pose.z === -20);
  ok("peeking does not consume it", !!peekRoadParking(who, t0 + 2000));
  ok("another place does not get it", peekRoadParking({ ...who, placeId: "senate" }, t0) === null);
  ok("another car does not get it", peekRoadParking({ ...who, modelId: "accord-2014" }, t0) === null);
  ok("another player does not get it", peekRoadParking({ ...who, playerId: "bayo" }, t0) === null);
  ok("it survives a reload (sessionStorage)", (() => { const keep = st.raw(); _resetRoadParking(mem()); const s2 = mem(); s2.setItem("oau:roadPark:v1", keep); _resetRoadParking(s2); return !!peekRoadParking(who, t0 + 3000); })());
  ok("it goes stale", peekRoadParking(who, t0 + PARK_TTL_MS + 1) === null);
  saveRoadParking({ ...who, pose }, t0);
  ok("taking it consumes it: a car can never be put in the world twice", !!takeRoadParking(who, t0 + 10) && takeRoadParking(who, t0 + 11) === null);
  saveRoadParking({ ...who, pose }, t0); saveRoadParking({ ...who, placeId: "senate", pose: { ...pose, x: 99 } }, t0);
  ok("parking somewhere else replaces the old place (one car, one place)", peekRoadParking(who, t0) === null && peekRoadParking({ ...who, placeId: "senate" }, t0)?.pose.x === 99);
  forgetRoadParking(); ok("it can be forgotten", peekRoadParking({ ...who, placeId: "senate" }, t0) === null);
  const bad = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } }; _resetRoadParking(bad);
  ok("a browser that blocks storage still works from memory", saveRoadParking({ ...who, pose }, t0) && !!peekRoadParking(who, t0));
  _resetRoadParking(mem());
}

// ---------- the rig ----------
const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard");
const enterable = places.filter((p) => hasInterior(p.id, p.kind) && !isOpenSpace(p.id));
const DT = 1 / 30, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let plan = null, from = null, to = null;
for (let i = 0; i < 400 && !plan; i++) {
  const f = places[(i * 7) % places.length], t = enterable[(i * 5 + 1) % enterable.length]; if (f.id === t.id) continue;
  const p = planTrip(svc, { from: f, to: t, mode: "car", driver: false });
  if (p.ok && p.route?.len > 300 && p.route.len < 900 && portalFor(svc, t).ok) { plan = p; from = f; to = t; }
}
assert.ok(plan, "a car trip to a building to test with");

const rig = (extra = {}) => {
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => plan.start, rnd }), left = [], notices = []; let end = null, entered = 0;
  const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => true, onEnter: () => { entered++; }, onEnd: (w) => { end = w; }, onNotice: (m) => notices.push(m), onCarLeft: (pose, info) => left.push({ pose, info }), ...extra });
  const S = flow.state, tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); };
  const until = (cond, secs, inp = {}) => { for (let i = 0; i < secs * 30 && !cond(); i++) tick(typeof inp === "function" ? inp() : inp); return cond(); };
  return { sim, flow, S, left, notices, tick, until, get end() { return end; }, get entered() { return entered; } };
};
const heroes = (sim) => sim.vehicles.filter((v) => v.role === "hero" && !v.done).length;

// ---------- 2. drive there, park, go in, come out, same car ----------
const A = rig(), { flow, S, tick, until } = A;
ok("walks to the car", until(() => S.phase === "board", 90));
until(() => S.phase === "drive", 10); ok("at the wheel", S.phase === "drive" && !!flow.own);
const car = flow.own, pts = plan.route.path.pts;
const aim = (c) => { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = Math.hypot(p[0] - c.x, p[1] - c.z); if (d < bd) { bd = d; bi = i; } }); let k = bi; while (k < pts.length - 1 && Math.hypot(pts[k][0] - c.x, pts[k][1] - c.z) < 9) k++; return Math.max(-1, Math.min(1, -wrap(Math.atan2(pts[k][0] - c.x, pts[k][1] - c.z) - c.ang) * 2.2)); };
const drive = () => { const d = Math.hypot(car.x - plan.drop.x, car.z - plan.drop.z), vmax = d > 40 ? 7 : d > 22 ? 4 : 2; return { steer: aim(car), gas: d < 14 ? 0 : car.v < vmax ? 0.8 : 0, brake: car.v > vmax + 1.5 ? 1 : d < 14 && car.v > 0.05 ? 0.7 : 0 }; };
ok("drives to the building and stops at the kerb", until(() => S.phase !== "drive", 240, drive));
ok("no car was reported as left while it was being driven", A.left.length === 0);
ok("the trip steps out and walks to the door", until(() => S.phase === "door", 60) || S.phase === "door");
const park = { x: car.x, z: car.z, hx: car.hx, hz: car.hz };
until(() => S.canOpen, 10); flow.pressDoor(); ok("the door opens", until(() => S.door === "open", 10));
{ const D = flow.plan.B.door; flow.enterNow(); ok("goes in", until(() => S.phase === "inside", 30, () => ({ dx: -D.nx, dz: -D.nz, mag: 1 }))); }
ok("the page was told exactly once, and that it had arrived", A.left.length === 1 && A.left[0].info.arrived === true);
ok("the reported pose is exactly where the car stands", Math.hypot(A.left[0].pose.x - park.x, A.left[0].pose.z - park.z) < 1e-9 && Math.abs(A.left[0].pose.hx - park.hx) < 1e-9);
// inside the building: time passes, the world goes on; the car does not move, vanish or get replaced
for (let i = 0; i < 30 * 20; i++) tick();
ok("the car is still the same body, in the same place, after 20 s inside", flow.own === car && car.x === park.x && car.z === park.z && car.v === 0);
ok("no traffic hero was spawned for it meanwhile", heroes(A.sim) === 0);
const out = flow.exitBuilding(portalFor(svc, to)); ok("walks out of the door", out.ok);
ok("comes out on foot beside the street", until(() => S.phase === "roam", 30));
ok("the car is where it was left", flow.own === car && car.x === park.x && car.z === park.z && heroes(A.sim) === 0);
// walk back to the car (the way a player does: towards it) and get in
// walk back the way the game walks a player to a place: along a planned route (a straight line can be held up by a building)
{
  const nav = createNav({ world: svc.world, graph: svc.graph }), r = nav.plan(flow.walker.x, flow.walker.z, car.x, car.z, { ignore: new Set(["own"]) });
  ok("a way back to the car exists", r.ok, `from ${flow.walker.x.toFixed(1)},${flow.walker.z.toFixed(1)}`);
  flow.walker.follow(r, { goal: { x: car.x, z: car.z }, tolerance: 2 });
}
ok("the car is offered when the player reaches it (Get in car)", until(() => S.canEnter, 150), `walker ${flow.walker.x.toFixed(1)},${flow.walker.z.toFixed(1)} car ${car.x.toFixed(1)},${car.z.toFixed(1)}`);
tick({ enter: true }); ok("pressing enter walks to the door", S.phase === "reenter");
ok("and sits in it", until(() => S.phase === "board", 20) && until(() => S.phase === "drive", 10));
ok("same car object, same place: it is driveable again", flow.own === car && Math.hypot(car.x - park.x, car.z - park.z) < 1e-9);
for (let i = 0; i < 45; i++) tick({ gas: 1 }); ok("and it drives away", car.v > 3);
ok("the trip never ended on its own", A.end === null);

// ---------- 3. a later trip, given the saved pose ----------
// (what the page does after the map was left, or for the doorstep fallback: the car is put where it was left and the player walks to it)
{
  const B = rig({ parked: { ...park, len: car.len, wid: car.wid } });
  ok("the saved car exists at once, exactly where it was left", !!B.flow.own && Math.hypot(B.flow.own.x - park.x, B.flow.own.z - park.z) < 1e-9);
  B.until(() => B.S.phase === "approach", 5);
  for (let i = 0; i < 10; i++) B.tick();
  ok("no second car is spawned on the kerb (no hero)", heroes(B.sim) === 0 && B.flow.hero === null);
  ok("the player walks to the saved car's door and gets in", B.until(() => B.S.phase === "board", 120));
  ok("still the same single car", B.until(() => B.S.phase === "drive", 10) && heroes(B.sim) === 0 && Math.hypot(B.flow.own.x - park.x, B.flow.own.z - park.z) < 1e-6);
  for (let i = 0; i < 45; i++) B.tick({ gas: 1 }); ok("and it drives", B.flow.own.v > 2);
  ok("it was not reported as parked while moving", B.left.length === 0);
  ok("the trip is intact", B.end === null && B.notices.length === 0);
  // the car cancelled while waiting at the kerb is reported again (still parked there), so it is never lost
  const C = rig({ parked: { ...park, len: car.len, wid: car.wid } }); C.until(() => C.S.phase === "approach", 5); C.tick(); C.flow.dispose();
  ok("a trip ended before the player got in still reports the car as standing there", C.left.length === 1 && Math.hypot(C.left[0].pose.x - park.x, C.left[0].pose.z - park.z) < 1e-9 && C.left[0].info.arrived === false);
  // a manual Exit Car mid-journey is reported as NOT at a place (so it is never offered at the wrong building)
  const D = rig(); D.until(() => D.S.phase === "board", 90); D.until(() => D.S.phase === "drive", 10);
  for (let i = 0; i < 60; i++) D.tick({ gas: 1, steer: 0 }); D.until(() => D.flow.own.v > 3, 5, { gas: 1 }); D.tick({ brake: 1 });
  D.until(() => D.flow.own.v < 6, 10, { brake: 1 }); D.tick({ exit: true }); D.until(() => D.S.phase === "afoot", 30, { brake: 1 }); D.flow.dispose();
  ok("leaving the car mid-journey reports it, but not as arrived", D.left.length === 1 && D.left[0].info.arrived === false);
}
console.log(`road parking passed: ${n} checks (${from.id} -> ${to.id}, ${Math.round(plan.route.len)} m)`);
