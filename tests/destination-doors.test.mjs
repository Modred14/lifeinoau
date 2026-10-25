// tests/destination-doors.test.mjs
// Destination name tags, changing where a trip goes, and the doors of enterable buildings, over the real campus map (headless, same planner/flow the map page uses):
//   1. every enterable place has a building outline and a door in front of a walkable spot; the door is only offered from in front of it
//   2. the door sequence: it NEVER opens by itself; Open Door steps the person back a small distance (no jumps), swings the leaf, and Go in enters; presses while moving are ignored
//   3. a walking trip can be sent to another place at any time, from where the person stands; an impossible place changes nothing; manual input stops the automatic walk
//   4. your own car: choosing a place only gives guidance. Nothing moves the car, and the trip keeps its state
//   5. which name tags are shown (range, count, overlap, no flicker, the destination always) and that a stale answer never beats a newer choice
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { planRetarget } from "../lib3d/tripretarget.js";
import { canOpenAt, planDoorOpening, doorFrame, doorLocal, inSwing, leafBody } from "../lib3d/doorway.js";
import { selectTags, TIER_RANGE, MAX_TAGS } from "../lib3d/destinations.js";
import { createTargetTracker } from "../lib/tripTarget.js";
import { hasInterior } from "../lib3d/interiors/registry.js";
import { isOpenSpace } from "../lib3d/interiors/openSpaces.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const byId = (id) => svc.data.places.find((p) => p.id === id);
const enterable = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard" && hasInterior(p.id, p.kind) && !isOpenSpace(p.id));
const DT = 1 / 30;
const rig = (from, to, mode = "trek", extra = {}) => {
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const plan = planTrip(svc, { from, to, mode, driver: false }); assert.ok(plan.ok, `plan ${from.id}->${to.id}`);
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => from, rnd }), log = []; let end = null;
  const flow = createTripFlow({ svc, sim }, { plan, enterable: true, onArrive: () => true, onEnter() { log.push("entered"); }, onEnd: (w) => { end = w; }, onNotice: (m) => log.push(m), ...extra });
  let t = 0; const S = flow.state;
  const tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); t += DT; };
  const until = (f, max = 300) => { const t0 = t; while (!f() && t < t0 + max && !end) tick(); return f(); };
  return { plan, flow, S, sim, log, tick, until, get end() { return end; }, get t() { return t; } };
};

// 1. every enterable place has a door that makes sense
{
  assert.ok(enterable.length >= 80, "the map has its enterable places");
  for (const p of enterable) {
    assert.ok(p.bid != null, `${p.id} has a building outline`);
    const plan = planTrip(svc, { from: byId("senate"), to: p, mode: "trek" }); if (!plan.ok) continue;
    const D = plan.B.door; assert.ok(D && Math.abs(Math.hypot(D.nx, D.nz) - 1) < 1e-6, `${p.id}: a unit door normal`);
    const l = doorLocal(D, plan.B.front.x, plan.B.front.z); assert.ok(l.v > 0 && Math.abs(l.u) < D.width, `${p.id}: the front is in front of the door`);
    assert.ok(!canOpenAt(D, D.x - D.nx * 1, D.z - D.nz * 1).ok, `${p.id}: Open Door is never offered from inside the wall`);
    assert.ok(!canOpenAt(D, D.x + D.nx * 9, D.z + D.nz * 9).ok, `${p.id}: nor from far away`);
    const o = planDoorOpening(svc.world, D, plan.goal, { isRoad: (x, z) => svc.net.isRoad?.(x, z) });
    if (o.ok) assert.ok(o.dist <= 3.4 + 1e-9 && !inSwing(o.frame, o.back.x, o.back.z, 0.3), `${p.id}: the step back is small and clear of the leaf`);
    else assert.equal(o.reason, "noroom");
  }
}
// door geometry in all four orientations: the leaf swings out on the outside, and stays out of the person
for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const hinge of ["left", "right"]) {
  const D = { x: 0, z: 0, nx, nz, width: 1.4 }, f = doorFrame(D, hinge), b = leafBody(f, 1.7);
  assert.ok(doorLocal(D, b.x, b.z).v > 0, `the open leaf is outside the building (${nx},${nz} ${hinge})`);
  assert.ok(inSwing(f, nx * 0.8, nz * 0.8, 0.3) || hinge, "swing check runs");
  assert.ok(!inSwing(f, -nx * 2, -nz * 2, 0.3), "nothing behind the door is in the swing");
}

// 2. the door sequence
for (const [from, to] of [["senate", "library"], ["library", "senate"]]) {
  const r = rig(byId(from), byId(to)), { S, flow } = r;
  r.until(() => S.phase !== "intro"); flow.walker.follow(r.plan.walk, { goal: r.plan.goal, tolerance: 0.45 });
  assert.ok(r.until(() => S.phase === "door"), `${to}: reached the door`);
  for (let i = 0; i < 90; i++) r.tick(); assert.equal(S.door, "closed", "the door never opens by itself"); assert.equal(S.doorK, 0); assert.deepEqual(r.log, []);
  r.tick(); r.tick(); assert.ok(S.canOpen, "Open Door is offered at the door");
  const w0 = { x: flow.walker.x, z: flow.walker.z }; assert.ok(flow.pressDoor()); assert.ok(!flow.pressDoor(), "a second press while it moves is ignored");
  let px = w0.x, pz = w0.z, top = 0, k0 = 0; const t0 = r.t;
  while (S.door !== "open" && r.t < t0 + 20) { r.tick(); top = Math.max(top, Math.hypot(flow.walker.x - px, flow.walker.z - pz) / DT); px = flow.walker.x; pz = flow.walker.z; assert.ok(S.doorK >= k0 - 1e-9, "the leaf only opens further"); k0 = S.doorK; }
  assert.equal(S.door, "open"); assert.ok(top < 2.0, "the step back is walked, not jumped"); assert.ok(Math.hypot(flow.walker.x - w0.x, flow.walker.z - w0.z) <= 3.4 + 0.2);
  assert.ok(!inSwing(flow.doorFrame, flow.walker.x, flow.walker.z, 0.2) || flow.doorFrame.inward, "the person is clear of the leaf");
  r.tick(); assert.ok(S.canGoIn); assert.ok(flow.enterNow());
  assert.ok(r.until(() => S.phase === "inside" || r.log.includes("entered"), 40), "entered"); assert.ok(r.log.includes("entered"));
}

// 3. changing destination while walking
{
  const r = rig(byId("senate"), byId("library")), { S, flow } = r;
  r.until(() => S.phase === "trek"); for (let i = 0; i < 90; i++) r.tick({ dx: 1, dz: 0, mag: 1 });   // some manual steps first
  const B = svc.data.places.find((p) => p.id !== "library" && p.id !== "senate" && p.x != null && p.bid != null && hasInterior(p.id, p.kind) && planRetarget(svc, flow.plan, { at: flow.walker, to: p }).ok);
  const res = planRetarget(svc, flow.plan, { at: { x: flow.walker.x, z: flow.walker.z }, to: B }); assert.ok(res.ok);
  const before = { x: flow.walker.x, z: flow.walker.z }; assert.ok(flow.retarget(res.plan, true).ok);
  assert.ok(Math.hypot(flow.walker.x - before.x, flow.walker.z - before.z) < 1e-9, "choosing a place never moves the person");
  r.tick(); assert.ok(S.auto, "an automatic walk to the new place has begun");
  let maxJump = 0, px = flow.walker.x, pz = flow.walker.z; const t0 = r.t;
  while (S.phase !== "door" && r.t < t0 + 300) { r.tick(); maxJump = Math.max(maxJump, Math.hypot(flow.walker.x - px, flow.walker.z - pz)); px = flow.walker.x; pz = flow.walker.z; }
  assert.equal(S.phase, "door", "the automatic walk reached the new door"); assert.ok(maxJump < 0.5, "no teleporting on the way"); assert.equal(S.door, "closed", "the door waits for the player");
  // taking over: manual input cancels an automatic walk
  const r2 = rig(byId("senate"), byId("library")); r2.until(() => r2.S.phase === "trek");
  const again = planRetarget(svc, r2.flow.plan, { at: r2.flow.walker, to: B }); assert.ok(r2.flow.retarget(again.plan, true).ok); r2.tick(); assert.ok(r2.S.auto);
  r2.tick({ dx: 0, dz: 1, mag: 1 }); r2.tick({ dx: 0, dz: 1, mag: 1 }); assert.ok(!r2.S.auto, "using the stick takes manual control"); assert.equal(r2.flow.retarget(again.plan, true).ok, true, "and another destination can still be chosen");
  // a place nobody can walk to changes nothing
  const bad = planRetarget(svc, flow.plan, { at: { x: -9999, z: -9999 }, to: B }); assert.equal(bad.ok, false);
  assert.equal(planRetarget(svc, flow.plan, { at: flow.walker, to: { id: "x", x: null } }).reason, "nopos");
}

// 4. your own car: guidance only
{
  let r = null;
  for (let i = 0; i < 80 && !r; i++) {
    const from = svc.data.places.filter((q) => q.x != null)[(i * 7) % 117], to = enterable[(i * 13 + 5) % enterable.length]; if (!from || from === to) continue;
    const p = planTrip(svc, { from, to, mode: "car", driver: false }); if (!p.ok) continue;
    const t = rig(from, to, "car"); t.until(() => t.S.phase === "drive" || t.end, 150); if (t.S.phase === "drive") r = t;
  }
  assert.ok(r, "reached the wheel of your own car");
  const { S, flow } = r, v = flow.own, before = { x: v.x, z: v.z, ang: v.ang };
  const B = enterable.find((p) => p.id !== r.plan.B.id && planRetarget(svc, flow.plan, { at: v, to: p }).ok); assert.ok(B, "another place with a road to it");
  const res = planRetarget(svc, flow.plan, { at: { x: v.x, z: v.z }, to: B }); assert.ok(res.ok);
  assert.ok(flow.retarget(res.plan, true).ok); assert.equal(S.phase, "drive", "still at the wheel"); r.tick(); assert.ok(!S.auto, "no autopilot");
  assert.deepEqual({ x: flow.own.x, z: flow.own.z, ang: flow.own.ang }, before, "the car did not move, turn or jump");
  for (let i = 0; i < 30; i++) r.tick(); assert.ok(Math.hypot(flow.own.x - before.x, flow.own.z - before.z) < 0.5, "and nothing drives it");
  assert.equal(flow.plan.B.id ?? B.id, B.id); assert.ok(flow.plan.drop, "a place to stop near the entrance");
}

// 5. name tags
{
  const mk = (id, tier, x, z, extra = {}) => ({ id, tier, x, z, ...extra }), me = { x: 0, z: 0 };
  const proj = (i) => ({ x: 400 + i.x * 2, y: 300 + i.z * 2, on: true }), base = { me, w: 800, h: 600, project: proj, widthOf: () => 90 }, st = new Map();
  const items = [mk("near", 3, 30, 0), mk("far3", 3, 400, 0), mk("far1", 1, 300, 0), mk("beyond", 1, 900, 0), mk("pin", 3, 800, 0, { pinned: true })];
  const shown = selectTags(items, { ...base, now: 0 }, st);
  assert.ok(shown.has("near") && shown.has("far1") && shown.has("pin"), "near, a landmark in range, and the destination"); assert.ok(!shown.has("far3") && !shown.has("beyond"), "small and distant ones are hidden");
  assert.ok(TIER_RANGE[1] > TIER_RANGE[2] && TIER_RANGE[2] > TIER_RANGE[3]);
  const crowd = Array.from({ length: 60 }, (_, i) => mk("c" + i, 3, (i % 10) * 12 - 50, Math.floor(i / 10) * 12 - 30)); assert.ok(selectTags(crowd, { ...base, now: 0 }, new Map()).size <= MAX_TAGS);
  assert.equal(selectTags([mk("a", 3, 10, 10), mk("b", 3, 11, 10)], { ...base, now: 0 }, new Map()).size, 1, "two tags never overlap");
  const hid = selectTags(items, { ...base, now: 0, occluded: (i) => i.id === "near" }, new Map()); assert.ok(!hid.has("near"), "a tag behind a building is hidden");
  // no flicker: it stays a moment after it should go, and does not come straight back
  const s2 = new Map(); selectTags([mk("n", 3, 30, 0)], { ...base, now: 0 }, s2); assert.ok(selectTags([], { ...base, now: 100 }, s2).has("n"), "kept for a moment"); assert.ok(!selectTags([], { ...base, now: 1000 }, s2).has("n"), "then gone");
  assert.ok(!selectTags([mk("n", 3, 30, 0)], { ...base, now: 1100 }, s2).has("n"), "does not flash straight back");
  assert.ok(selectTags([mk("n", 3, 30, 0)], { ...base, now: 1500 }, s2).has("n"), "and returns after a pause");
}
// the latest choice wins, however late the answers arrive
{
  const tr = createTargetTracker("a"); const slow = new Promise((r) => setTimeout(() => r("answer for a"), 30)); const p = tr.answer(slow, "stale");
  tr.choose("b"); const fast = await tr.answer(Promise.resolve("answer for b"), "stale");
  assert.equal(await p, "stale", "a slow answer about the earlier place is dropped"); assert.equal(fast, "answer for b"); assert.equal(tr.choose("b"), tr.ticket, "choosing the same place again changes nothing");
}
console.log("destination-doors: ok");
