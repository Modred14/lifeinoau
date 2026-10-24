// tests/travel-time.test.mjs
// Trip timing over the real campus map, run through the same planner and trip state machine the map page uses (headless, no drawing):
//   car with a driver 6-9 s, bus 8-10 s, keke 10-15 s (the ride), growing with the road distance; the walk to the vehicle never longer than 5 s.
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim, rideProfile } from "../lib3d/trafficsim.js";
import { RIDE_SECONDS, rideSecondsFor } from "../lib/travel.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null);
let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const WINDOW = { keke: RIDE_SECONDS.keke, bus: RIDE_SECONDS.bus, car: RIDE_SECONDS.driver };
const TOL = 0.2; // the ride is played in 1/30 s steps

// a recorded ride plays over exactly the time asked for, starting and ending at rest, and never goes backwards
{
  const trip = planTrip(svc, { from: places[3], to: places[40], mode: "bus" });
  const prof = rideProfile(trip.route, trip.params, 9);
  assert.equal(prof.dur, 9); assert.equal(prof.at(0).s, 0); assert.equal(prof.at(0).v, 0);
  assert.ok(Math.abs(prof.at(9).s - trip.route.len) < 1e-6 && prof.at(9).v === 0, "it comes to rest at the end of the route");
  let last = -1; for (let t = 0; t <= 9; t += 0.05) { const s = prof.at(t).s; assert.ok(s >= last - 1e-9); last = s; }
}

const done = { keke: [], bus: [], car: [] }; let trips = 0, glided = 0;
for (let i = 0; i < 60 && trips < 90; i++) {
  const a = places[Math.floor(rnd() * places.length)], b = places[Math.floor(rnd() * places.length)]; if (a === b) continue;
  for (const mode of ["keke", "bus", "car"]) {
    const plan = planTrip(svc, { from: a, to: b, mode, driver: true }); if (!plan.ok) continue;
    const [lo, hi] = WINDOW[mode];
    // the plan: the ride is what the distance earns, the walk to the vehicle is capped
    assert.ok(plan.parts.ride >= lo - 1e-9 && plan.parts.ride <= hi + 1e-9, `${mode} ${a.id}->${b.id}: planned ride ${plan.parts.ride} is inside ${lo}-${hi}`);
    assert.ok(Math.abs(plan.parts.ride - rideSecondsFor(mode === "car" ? "driver" : mode, plan.len)) < 1e-9, "the ride time comes from the road distance");
    assert.ok(plan.parts.walkIn + plan.parts.wait <= 5, `${mode} ${a.id}->${b.id}: approach ${plan.parts.walkIn + plan.parts.wait} is at most 5 s`);
    // the trip itself, played out
    const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => a, rnd });
    let end = null; const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => true, onEnter() {}, onEnd: (w) => { end = w; }, onNotice() {} });
    const secs = {}; let t = 0, last = "intro", since = 0;
    while (t < 300 && !end && flow.state.phase !== "inside") {
      flow.update(1 / 30, { interact: flow.state.phase === "door" }); sim.update(1 / 30); t += 1 / 30;
      if (flow.state.phase !== last) { secs[last] = (secs[last] ?? 0) + (t - since); last = flow.state.phase; since = t; }
    }
    secs[last] = (secs[last] ?? 0) + (t - since);
    assert.equal(end, null, `${mode} ${a.id}->${b.id} finished (${end})`); assert.equal(flow.state.phase, "inside", "the trip reached the door");
    assert.ok(secs.ride >= lo - TOL && secs.ride <= hi + TOL, `${mode} ${a.id}->${b.id}: rode ${secs.ride?.toFixed(2)} s, window ${lo}-${hi}`);
    assert.ok(secs.approach <= 5, `${mode} ${a.id}->${b.id}: walked to the vehicle in ${secs.approach?.toFixed(2)} s`);
    if (plan.glide > 0) glided++; done[mode].push({ len: plan.len, ride: secs.ride }); trips++;
  }
}
assert.ok(trips >= 60, "enough trips were tried across the map: " + trips); assert.ok(glided > 0, "some pickups were far enough to need the faster walk");
// longer trips take longer (the shortest third against the longest third), for every vehicle
for (const [mode, list] of Object.entries(done)) {
  list.sort((x, y) => x.len - y.len); const n = Math.floor(list.length / 3), avg = (xs) => xs.reduce((s, r) => s + r.ride, 0) / xs.length;
  assert.ok(avg(list.slice(-n)) > avg(list.slice(0, n)), `${mode}: far trips take longer than near ones`);
}
console.log(`travel timing passed: ${trips} trips over the campus map (keke 10-15 s, bus 8-10 s, car with driver 6-9 s, walk to the vehicle at most 5 s)`);
