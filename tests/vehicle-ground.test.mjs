// tests/vehicle-ground.test.mjs: traffic vehicles stand ON the road, not above or below it: their axle table is the models' real one, a vehicle on a ramp has both axles on the ramp's height
// at the point of the road under each axle (not under the lane's own distance, which is trimmed back from the junctions), nothing jumps up or down, and flat roads stay flat.
// Run: node tests/vehicle-ground.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { createTrafficSim, HOT_KINDS } from "../lib3d/trafficsim.js";
import { heightOn, heightOnLane, laneEdgeS } from "../lib3d/roadgraph.js";
import { AXLES } from "../lib3d/vehicleDims.js";
import { makeKeke, makeBus, CAR_WHEELS } from "../lib3d/vehicles.js";

const ok = (m) => console.log("OK   " + m);
const near = (a, b, tol, m) => assert.ok(Math.abs(a - b) <= tol, `${m}: ${a.toFixed(3)} vs ${b.toFixed(3)} (tolerance ${tol})`);

// 1. the axle table is what is drawn
{
  const z = (v) => v.wheels.map((w) => w.parent.position.z), lo = (a) => Math.min(...a), hi = (a) => Math.max(...a);
  near(AXLES.car[0], lo(CAR_WHEELS.map((w) => w[1])), 1e-3, "car rear axle"); near(AXLES.car[1], hi(CAR_WHEELS.map((w) => w[1])), 1e-3, "car front axle");
  const k = makeKeke(), b = makeBus(), kz = z(k), bz = z(b);
  near(AXLES.keke[0], lo(kz), 1e-3, "keke rear axle"); near(AXLES.keke[1], hi(kz), 1e-3, "keke front wheel");
  near(AXLES.bus[0], lo(bz), 1e-3, "bus rear axle"); near(AXLES.bus[1], hi(bz), 1e-3, "bus front axle");
  const sq = 4.7 / 6.08;   // the minibus is the bus drawn shorter (lib3d/traffic.js)
  near(AXLES.minibus[0], lo(bz) * sq, 2e-3, "minibus rear axle"); near(AXLES.minibus[1], hi(bz) * sq, 2e-3, "minibus front axle");
  ok("AXLES match the car, keke, bus and minibus models");
}

const data = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const raw = JSON.parse(fs.readFileSync(new URL("../public/data/oau-roadgraph.json", import.meta.url), "utf8"));
const svc = buildServices(data, raw), g = svc.graph, world = svc.world;
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hot = (data.places ?? []).filter((p) => p.x != null && HOT_KINDS[p.kind] && !p.offmap).map((p) => ({ x: p.x, z: p.z, w: HOT_KINDS[p.kind] }));

// 2. a lane's distance maps back onto its edge's centreline distance, and the two ends agree with the trims
{
  let n = 0;
  for (const L of g.lanes) {
    const e = g.byEdge.get(L.edge); if (!e) continue;
    const a = laneEdgeS(L, e.len, 0), b = laneEdgeS(L, e.len, L.len);
    near(a, L.dir ? e.len - L.trimA : L.trimA, 1e-6, `lane ${L.id} start`); near(b, L.dir ? L.trimB : e.len - L.trimB, 1e-6, `lane ${L.id} end`);
    if (e.h0 !== e.h1) n++;
  }
  assert.ok(n > 0, "there are sloped lanes"); ok(`laneEdgeS is right at both ends of every lane (${n} sloped)`);
}

// 3. the traffic on the sloped roads: both axles on the road, no jumps, flat roads flat
const project = (e, x, z, around) => { let best = Infinity, bs = 0; for (let s = Math.max(0, around - 12); s <= Math.min(e.len, around + 12); s += 0.5) { const p = e.path.at(s, {}), d = Math.hypot(p.x - x, p.z - z); if (d < best) { best = d; bs = s; } } return bs; };
// traffic is seeded round the west interchange's ramps (a fixed point (-493, 759) on the old map, which is outside the frame of the new map)
const rampFocus = (ic) => { const r = raw.expressway.ramps.find((q) => q.ic === ic) ?? raw.expressway.ramps[0], p = r.pts[r.pts.length >> 1]; return { x: p[0], z: p[1] }; };
const sim = createTrafficSim({ graph: g, world, focus: () => rampFocus("west"), rnd: rng(7), density: { vehicles: 70, hwVehicles: 44, peds: 0, hotspots: hot, limits: { car: 80, keke: 10, bus: 8, minibus: 12 } } });
const last = new Map(); let onSlope = 0, worst = 0, flat = 0, maxStepY = 0, maxStepP = 0; const kinds = new Set();
for (let i = 0; i < 30 * 420; i++) {
  sim.update(1 / 30);
  for (const a of sim.vehicles) {
    if (a.role !== "npc" || a.done) continue;
    const prev = last.get(a.id); last.set(a.id, { y: a.y, p: a.pitch });
    if (prev) { maxStepY = Math.max(maxStepY, Math.abs(a.y - prev.y)); maxStepP = Math.max(maxStepP, Math.abs(a.pitch - prev.p)); }
    const sg = a.route.segs[a.si]; if (sg.kind !== "lane") continue;
    const L = g.lanes[sg.id], e = g.byEdge.get(L.edge), ax = AXLES[a.kind] ?? AXLES.car;
    if (e.h0 === e.h1) { if (a.s + ax[0] >= sg.start && a.s + ax[1] <= sg.end) { assert.equal(a.pitch, 0, "a level road: no pitch"); near(a.y, e.h0, 1e-9, "a level road: its height"); flat++; } continue; }
    if (i % 3) continue;
    for (const [k, zA] of [[0, ax[0]], [1, ax[1]]]) {
      const px = a.x + a.hx * zA, pz = a.z + a.hz * zA, s = project(e, px, pz, laneEdgeS(L, e.len, a.laneS + zA));
      if (s <= 1 || s >= e.len - 1) continue;   // the very end of an edge: the junction takes over
      const wheelY = a.y + Math.sin(a.pitch) * zA, road = heightOn(e, s); worst = Math.max(worst, Math.abs(wheelY - road)); onSlope++; kinds.add(a.kind);
    }
  }
}
assert.ok(onSlope > 200 && flat > 1000, `enough samples (${onSlope} on slopes, ${flat} level)`);
assert.ok(worst < 0.1, `a tyre is never more than 10 cm off the ramp (worst ${(worst * 100).toFixed(1)} cm over ${onSlope} axle samples)`);
assert.ok(maxStepY < 0.08, `no vertical jump between two ticks (largest ${(maxStepY * 100).toFixed(1)} cm)`);
assert.ok(maxStepP < 0.03, `no sudden tilt between two ticks (largest ${maxStepP.toFixed(3)} rad)`);
ok(`ramps: worst axle ${(worst * 100).toFixed(1)} cm from the road over ${onSlope} samples (${[...kinds].join(", ")}); largest step ${(maxStepY * 100).toFixed(1)} cm / ${maxStepP.toFixed(3)} rad; ${flat} level samples exactly flat`);

// 4. through a junction a vehicle does not step: the height is continuous from the lane before to the lane after
{
  let c = 0;
  for (const cn of g.conns) {
    const A = g.lanes[cn.from], B = g.lanes[cn.to], ea = g.byEdge.get(A.edge), eb = g.byEdge.get(B.edge);
    if (!ea || !eb) continue; const ha = heightOnLane(A, ea, A.len), hb = heightOnLane(B, eb, 0);
    if (Math.abs(ha - hb) > 0.05) { c++; assert.ok(Math.abs(ha - hb) < 0.5, `connector ${cn.id}: the road steps ${(ha - hb).toFixed(2)} m across the junction`); }
  }
  ok(`no connector joins two lanes of different height by more than half a metre (${c} slightly eased)`);
}
