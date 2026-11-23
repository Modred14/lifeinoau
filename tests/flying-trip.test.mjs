// tests/flying-trip.test.mjs
// The Tesla Skyhawk through the real trip state machine on the real campus map (headless): a flying car boards like any car, takes off from a stop on the road, climbs straight up,
// flies freely above the buildings, cannot be got out of in the air, comes down vertically onto a clear road and then drives on the road again. An ordinary car cannot take off at all.
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { planTrip } from "../lib3d/tripplan.js";
import { createTripFlow } from "../lib3d/tripflow.js";
import { createTrafficSim } from "../lib3d/trafficsim.js";
import { VEHICLE_DIMS } from "../lib3d/vehicleDims.js";
import { CLEARANCE_M } from "../lib3d/flightphysics.js";

const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json"));
const places = svc.data.places.filter((p) => p.x != null);
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

function session(modelId) {
  let seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let plan = null; for (let i = 0; i < 60 && !plan; i++) { const p = planTrip(svc, { from: places[(i * 7) % places.length], to: places[(i * 13 + 5) % places.length], mode: "car", driver: false }); if (p.ok && p.route?.len > 500) plan = p; }
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => plan.start ?? places[0], rnd }), notices = [], D = VEHICLE_DIMS[modelId];
  const flow = createTripFlow({ svc, sim }, { plan, onArrive: () => true, onEnter() {}, onEnd() {}, onNotice: (m) => notices.push(m), dims: { len: D.length, wid: D.width, id: modelId, seat: { x: -0.4, y: 0.42, z: -0.25 }, driver: { x: 0.4, y: 0.42, z: -0.25 } } });
  const DT = 1 / 30, tick = (inp = {}) => { flow.update(DT, inp); sim.update(DT); }, until = (c, secs, inp = {}) => { for (let i = 0; i < secs * 30 && !c(); i++) tick(typeof inp === "function" ? inp() : inp); return c(); };
  until(() => flow.state.phase === "drive", 120); return { flow, S: flow.state, tick, until, notices };
}

{ const { flow, S, tick, until, notices } = session("tesla-skyhawk-2026"), car = flow.own;
  chk("the Skyhawk boards like any car and reports that it can fly", S.phase === "drive" && !!car && car.P.flies === true && S.canFly === true && S.airborne === false);
  tick({ fly: true }); chk("on the road, stopped, T / Take off starts the take-off", S.airborne === true);
  const x0 = car.x, z0 = car.z; until(() => car.h > 8, 6, { gas: 1, steer: 1 });
  chk("it rises and does not move sideways while below the building clearance height", car.h > 8 && car.h < CLEARANCE_M && car.x === x0 && car.z === z0);
  tick({ exit: true }); chk("you cannot get out in the air", S.phase === "drive" && !S.exiting && notices.some((m) => /flying/i.test(m)));
  until(() => car.h >= CLEARANCE_M + 1, 12); chk("it reaches free-flight height", car.h >= CLEARANCE_M);
  const p1 = { x: car.x, z: car.z }; until(() => false, 8, { gas: 1 });
  chk("it flies forward over the campus, through the air, at a real speed", Math.hypot(car.x - p1.x, car.z - p1.z) > 60 && car.v > 15 && S.alt >= CLEARANCE_M);
  until(() => false, 4, { brake: 1 }); until(() => car.v < 0.5, 6, { brake: 1 });
  const lx = car.x, lz = car.z; tick({ fly: true }); until(() => S.phase !== "drive" || (!S.airborne), 80, {}); const clear = !S.airborne;
  if (!clear) { chk("over a spot with no clear road it hovers instead of landing, and says so", car.h >= CLEARANCE_M - 1e-6 && notices.some((m) => /clear road/i.test(m))); }
  else chk("it came down straight onto the same spot and is on the ground again", car.h === 0 && Math.abs(car.x - lx) < 1e-6 && Math.abs(car.z - lz) < 1e-6);
  console.log("   (landing spot was " + (clear ? "road" : "not road") + ")"); }

// land where it took off (a road): vertical up, vertical down, then it drives on the road again
{ const { flow, S, tick, until } = session("tesla-skyhawk-2026"), car = flow.own, x0 = car.x, z0 = car.z;
  tick({ fly: true }); until(() => car.h >= CLEARANCE_M + 2, 14); tick({ fly: true });
  chk("landing on the spot it took off from works", until(() => !S.airborne, 40) && car.h === 0 && Math.abs(car.x - x0) < 1e-6 && Math.abs(car.z - z0) < 1e-6);
  chk("it can get out again on the ground", (() => { tick({ exit: true }); return S.exiting || S.phase !== "drive"; })());
  // after a flight the car drives exactly like the same car that never left the road (same start, same inputs, same result)
  const drive = (fly) => { const t = session("tesla-skyhawk-2026"), c = t.flow.own; if (fly) { t.tick({ fly: true }); t.until(() => c.h >= CLEARANCE_M + 2, 14); t.tick({ fly: true }); t.until(() => !t.S.airborne, 40); }
    const p = { x: c.x, z: c.z }; t.until(() => false, 3, { gas: 1, steer: 0.4 }); return { c, d: Math.hypot(c.x - p.x, c.z - p.z), h: c.h }; };
  const a1 = drive(true), a0 = drive(false);
  chk("after landing the ordinary driving physics take over: it behaves exactly like the same car that never flew", Math.abs(a1.d - a0.d) < 0.05 && Math.abs(a1.c.v - a0.c.v) < 0.05 && a1.h < 2.5 && a1.c.pen === a0.c.pen); }

// an ordinary car does not fly
{ const { flow, S, tick, notices } = session("corolla-2011");
  chk("an ordinary car is not offered flight and pressing fly does nothing", S.canFly === false); tick({ fly: true }); chk("...it only says so", S.airborne === false && notices.some((m) => /cannot fly/i.test(m))); }
console.log(bad ? `\n${bad} FAILED` : "\nall flying-trip checks passed"); process.exit(bad ? 1 : 0);
