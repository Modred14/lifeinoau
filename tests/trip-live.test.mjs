// tests/trip-live.test.mjs
// a player at an open door who is not lined up with it walks to the doorway (the leaf is never crossed); everything else waits for them
const doorWalk = (flow) => { const S = flow.state, D = flow.plan.B.door; if (S.phase !== "door" || S.door !== "open" || S.canGoIn) return {}; const x = D.x + D.nx * 0.9 - flow.walker.x, z = D.z + D.nz * 0.9 - flow.walker.z, l = Math.hypot(x, z) || 1; return { dx: x / l, dz: z / l, mag: 0.6 }; };
// Over the real campus map, through the same planner, guide and trip state machine the map page uses (headless):
//   1. the route shown during a trip ALWAYS starts at the traveller's current position (the vehicle while riding, the person otherwise) and ends where they are heading,
//      for every vehicle, through every leg, and it is worked out again when the leg changes;
//   2. a walker who strays from the route gets a new one from where they now stand (never the old one from the start);
//   3. your own car driven off the planned road gets a new road route from where it now is;
//   4. a new trip never inherits anything from a previous one;
//   5. the fare is settled in the background: a slow server does not stop the walk to the door, entering waits for the answer, a refusal ends the trip as "failed".
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { createGuide } from "../lib3d/tripguide.js";
import { Path } from "../lib3d/roadnet.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null);
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const IN_VEHICLE = new Set(["ride", "drive", "paying"]);
const ctxFor = (flow, plan) => { const F = flow.state, veh = plan.mode !== "trek" && IN_VEHICLE.has(F.phase) && flow.vehicle, pos = veh || flow.person, hero = flow.hero;
  return { phase: F.phase, x: pos.x, z: pos.z, goal: flow.approachDoor, ride: hero && ["board", "ride"].includes(F.phase) ? { s: hero.s, path: hero.route?.path } : null }; };

// 1. every leg of every vehicle trip: the route starts under the traveller, ends where they are going, and changes with the leg
let trips = 0;
for (let i = 0; i < 40 && trips < 24; i++) {
  const a = places[Math.floor(rnd() * places.length)], b = places[Math.floor(rnd() * places.length)]; if (a === b) continue;
  for (const mode of ["keke", "bus", "car"]) {
    const plan = planTrip(svc, { from: a, to: b, mode, driver: true }); if (!plan.ok) continue;
    const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => a, rnd }), guide = createGuide({ nav: svc.nav, graph: svc.graph, plan });
    let end = null; const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => true, onEnter() {}, onEnd: (w) => { end = w; }, onNotice() {} });
    const revs = new Set(), kinds = new Set(); let t = 0, shown = 0;
    while (t < 300 && !end && flow.state.phase !== "inside") {
      flow.update(1 / 30, doorWalk(flow)); sim.update(1 / 30); t += 1 / 30;
      if (flow.state.canOpen) flow.pressDoor(); else if (flow.state.canGoIn) flow.enterNow();   // doors never open by themselves: the player presses Open Door, then goes in
      const c = ctxFor(flow, plan), g = guide.update(1 / 30, c);
      assert.ok(Math.hypot(g.pts[0][0] - c.x, g.pts[0][1] - c.z) < 1e-6, `${mode} ${a.id}->${b.id} ${c.phase}: the route starts exactly at the traveller`);
      assert.ok(g.pts.length >= 2 && g.pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])), "a usable route");
      revs.add(g.rev); kinds.add(g.kind); if (g.show) shown++;
      if (c.phase === "ride") { const last = g.pts.at(-1), r = flow.hero.route.path.pts.at(-1); assert.ok(Math.hypot(last[0] - r[0], last[1] - r[1]) < 1e-6, "while riding the route ends where the ride ends"); assert.ok(g.len <= flow.hero.route.len - flow.hero.s + 3, "only the part still ahead is shown"); }
      if (["approach", "walk"].includes(c.phase)) { const last = g.pts.at(-1), goal = g.goal; assert.ok(Math.hypot(last[0] - goal.x, last[1] - goal.z) < 2.5, `${mode} ${c.phase}: the walking route ends at its goal`); }
    }
    assert.equal(end, null); assert.equal(flow.state.phase, "inside");
    assert.ok(revs.size >= 3, `${mode}: the route was worked out again as the legs changed (${revs.size})`); assert.ok(kinds.has("walk") && kinds.has("drive"), "both a walking and a driving route were shown"); assert.ok(shown > 30, "a route was shown");
    trips++;
  }
}
assert.ok(trips >= 18, "enough trips: " + trips);

// 2. a walker strays: the new route starts where they stand now, and still leads to the destination
{
  const a = places[3], b = places[40], plan = planTrip(svc, { from: a, to: b, mode: "trek" }), guide = createGuide({ nav: svc.nav, graph: svc.graph, plan });
  const g0 = guide.update(0.016, { phase: "trek", x: plan.start.x, z: plan.start.z }); assert.ok(Math.hypot(g0.pts[0][0] - plan.start.x, g0.pts[0][1] - plan.start.z) < 1e-6);
  const wp = new Path(plan.walk.pts), half = wp.len / 2; let g1 = g0;
  for (let d = 0; d <= half; d += 0.6) { const q = wp.at(d, {}); g1 = guide.update(0.1, { phase: "trek", x: q.x, z: q.z }); assert.ok(Math.hypot(g1.pts[0][0] - q.x, g1.pts[0][1] - q.z) < 1e-6, "the route starts at the walker at every step"); }
  const mid = wp.at(half, {}); assert.equal(g1.rev, g0.rev, "following the route does not replan"); assert.ok(g1.len < g0.len - 5, "the part already walked is gone");
  // now step well off it
  let sx = mid.x + 30, sz = mid.z - 30; // somewhere genuinely away from every part of the route (the route may bend back on itself)
  for (const k of [45, -45, 70, -70, 110, -110]) { const x = mid.x - mid.hz * k, z = mid.z + mid.hx * k; let near = 1e9; for (let d = 0; d <= wp.len; d += 2) { const q = wp.at(d, {}); near = Math.min(near, Math.hypot(q.x - x, q.z - z)); } if (near > 12 && !svc.world.blockedAt(x, z, 0.3)) { sx = x; sz = z; break; } } const g2 = guide.update(1, { phase: "trek", x: sx, z: sz });
  assert.ok(g2.rev > g1.rev, "leaving the route plans a new one"); assert.ok(Math.hypot(g2.pts[0][0] - sx, g2.pts[0][1] - sz) < 1e-6, "from where the walker now stands"); assert.ok(Math.hypot(g2.pts.at(-1)[0] - plan.goal.x, g2.pts.at(-1)[1] - plan.goal.z) < 3, "to the same destination");
  assert.ok(g2.len >= Math.hypot(sx - plan.goal.x, sz - plan.goal.z) - 1, "no shorter than the straight line");
  // a different destination (the leg changed) also plans again at once
  const c = places[60], plan2 = planTrip(svc, { from: a, to: c, mode: "trek" }); if (plan2.ok) { const guide2 = createGuide({ nav: svc.nav, graph: svc.graph, plan: plan2 }), h = guide2.update(0.016, { phase: "trek", x: sx, z: sz }); assert.ok(Math.hypot(h.pts.at(-1)[0] - plan2.goal.x, h.pts.at(-1)[1] - plan2.goal.z) < 3, "a new trip's route knows nothing of the previous one"); assert.ok(Math.hypot(h.pts[0][0] - sx, h.pts[0][1] - sz) < 1e-6); }
}

// 3. your own car leaves the planned road: a road route from where it now is
{
  let plan = null; for (let i = 0; i < 30 && !plan; i++) { const p = planTrip(svc, { from: places[(i * 7) % places.length], to: places[(i * 13 + 5) % places.length], mode: "car", driver: false }); if (p.ok && p.route?.len > 500) plan = p; }
  assert.ok(plan, "an own-car plan");
  const guide = createGuide({ nav: svc.nav, graph: svc.graph, plan }), P = plan.route.path, s0 = P.at(5, {}); const g0 = guide.update(0.016, { phase: "drive", x: s0.x, z: s0.z });
  assert.ok(Math.hypot(g0.pts[0][0] - s0.x, g0.pts[0][1] - s0.z) < 1e-6);
  const q = P.at(P.len * 0.5, {}), nx = -q.hz, nz = q.hx, x = q.x + nx * 40, z = q.z + nz * 40; // 40 m off the road
  const g1 = guide.update(2, { phase: "drive", x, z });
  assert.ok(g1.rev > g0.rev, "driving off the route plans a new one"); assert.ok(Math.hypot(g1.pts[0][0] - x, g1.pts[0][1] - z) < 1e-6, "from where the car now is");
  const d = plan.drop, last = g1.pts.at(-1); assert.ok(Math.hypot(last[0] - d.x, last[1] - d.z) < 12, "still to the drop-off");
}

// 5. the fare: settled in the background
function runToDoor(onArrive) {
  const a = places[3], b = places[40], plan = planTrip(svc, { from: a, to: b, mode: "keke", driver: true }), sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => a, rnd });
  const ev = { end: null, entered: false, t: 0, doorAt: null, arrivedAt: null }; const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => { ev.arrivedAt = ev.t; return onArrive(ev); }, onEnter() { ev.entered = true; }, onEnd: (w) => { ev.end = w; }, onNotice() {} });
  const step = () => { if (flow.state.canOpen) flow.pressDoor(); else if (flow.state.canGoIn) flow.enterNow(); flow.update(1 / 30, doorWalk(flow)); sim.update(1 / 30); ev.t += 1 / 30; if (flow.state.phase === "door" && ev.doorAt == null) ev.doorAt = ev.t; };
  return { flow, ev, step };
}
{ // instant answer: the baseline
  const { flow, ev, step } = runToDoor(() => true); while (ev.t < 300 && !ev.end && !ev.entered) step(); assert.ok(ev.entered && !ev.end, "a paid trip goes in"); var baseDoor = ev.doorAt;
}
{ // a server that has not answered: the traveller still steps out and walks to the door at the same moment; only entering waits
  let settle; const { flow, ev, step } = runToDoor(() => new Promise((r) => { settle = r; }));
  while (ev.t < 300 && !ev.end && flow.state.phase !== "door") step(); assert.equal(flow.state.phase, "door", "reached the door with the fare still unanswered"); assert.ok(Math.abs(ev.doorAt - baseDoor) < 0.25, `a slow server did not hold the walk up (${ev.doorAt.toFixed(2)} s vs ${baseDoor.toFixed(2)} s)`);
  for (let i = 0; i < 30 * 12; i++) step(); assert.equal(ev.entered, false, "does not go in before the server has answered"); assert.equal(flow.state.pay, "pending"); assert.equal(ev.end, null);
  settle(true); await Promise.resolve(); for (let i = 0; i < 30 * 8 && !ev.entered; i++) step(); assert.ok(ev.entered && !ev.end, "goes in once the fare is confirmed"); assert.equal(flow.state.pay, "paid");
}
await refused();
async function refused() {
  { // the server refuses while the traveller is still walking: the trip ends as failed, no one goes in
    let settle; const { flow, ev, step } = runToDoor(() => new Promise((r) => { settle = r; }));
    while (ev.t < 300 && !ev.end && flow.state.phase !== "walk" && flow.state.phase !== "alight") step(); settle(false); await Promise.resolve(); await Promise.resolve(); for (let i = 0; i < 60; i++) step();
    assert.equal(ev.end, "failed"); assert.equal(ev.entered, false, "a refused fare never gets you inside");
  }
  { // the request itself fails (network down): the same safe outcome
    const { ev, step } = runToDoor(() => Promise.reject(new Error("offline"))); while (ev.t < 300 && !ev.end && !ev.entered) step(); await Promise.resolve(); for (let i = 0; i < 90 && !ev.end; i++) step();
    assert.equal(ev.end, "failed"); assert.equal(ev.entered, false);
  }
  console.log(`live trip passed: ${trips} vehicle trips (route always from the traveller), off-route replans, own-car replan, background fare (slow, refused, failed)`);
}
