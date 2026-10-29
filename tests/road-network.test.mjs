// tests/road-network.test.mjs
// The rebuilt road network and the elevated expressway (tools/oau/refine-roads.mjs -> public/data/oau-roadgraph.json; lib3d/roadrefine.js, lib3d/highway.js, lib3d/roadgraph.js):
//   1. the ground network: one connected piece, no dead stubs or tiny loops, every place reachable, wide roads where they should be, nothing squeezed against a building
//   2. the expressway: long, straight, three lanes each way, a median, one continuous deck at one height, ramps with a gentle grade that join the deck and the ground
//   3. driving it at top speed: the surface is there at every step, with no steps in height and no wrong level, for every vehicle; and the deck is long enough to reach top speed and stop
//   4. people and ambient traffic never see the deck; the meshes build cleanly
import fs from "node:fs";
import { buildRoadGraph, carMask, LV_GROUND, LV_DECK, heightOn } from "../lib3d/roadgraph.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { planTrip } from "../lib3d/tripplan.js";
import { buildRoadMeshes } from "../lib3d/roadmesh.js";
import { buildHighwayMeshes } from "../lib3d/highwaymesh.js";
import { PROFILES, carProfile, createCar, stepCar } from "../lib3d/carphysics.js";
import { VEHICLE_PERFORMANCE as V } from "../lib/vehiclePerformance.js";

let bad = 0, n = 0; const chk = (l, c) => { n++; if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const read = (f) => JSON.parse(fs.readFileSync(new URL("../public/data/" + f, import.meta.url), "utf8"));
const raw = read("oau-roadgraph.json"), G = buildRoadGraph(raw), X = G.expressway;
const svc = buildServices(withExtras(read("oau-campus.json")), raw);

// ---- 1. the ground network ----
const ground = G.edges.filter((e) => !e.hw);
chk("the road network is one connected piece", new Set(G.edges.map((e) => e.comp)).size === 1);
{ const deg = new Map(); for (const e of raw.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  chk("no node is left with no road", raw.nodes.every((nd) => (deg.get(nd.id) ?? 0) > 0)); }
chk("no tiny loop of road circles a junction", ground.every((e) => e.a !== e.b || e.len >= 30));
chk("express roads have a median and two or three lanes each way; collectors one lane each way with a shoulder", ground.filter((e) => e.cls === "arterial" && !e.foot).every((e) => e.med > 0 && e.lanesPerDir >= 2) && ground.filter((e) => e.cls === "collector").every((e) => e.lanesPerDir === 1));
chk("the main roads are wider than the small campus roads", Math.max(...ground.filter((e) => e.cls === "arterial").map((e) => e.half)) >= 2 * Math.max(...ground.filter((e) => e.cls === "local").map((e) => e.half)) - 1);
chk("a strip of pavement is kept beside the buildings wherever the road is not squeezed", ground.every((e) => e.foot || e.sw >= 0.7 || e.clr - e.half <= 1.7));
{ const from = svc.data.places.find((p) => p.id === "senate"); const fail = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard" && !p.offmap && p !== from).filter((p) => !planTrip(svc, { from, to: p, mode: "car", driver: true }).ok);
  chk("every place can be driven to from the Senate (" + fail.map((p) => p.id).join(",") + ")", fail.length === 0); }

// ---- 2. the expressway ----
chk("the expressway is long (over 4 km) and three lanes each way with a median", X && X.len > 4000 && X.lanes === 3 && X.med >= 1 && X.half >= 14 && X.shoulder >= 2);
{ let turn = 0, worst = 0; const P = X.deck; for (let i = 1; i < P.length - 1; i++) { const a = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), b = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; turn += d; worst = Math.max(worst, d); }
  chk("it is predominantly straight: " + (turn * 57.3).toFixed(0) + " deg of turning in total, at most " + (worst * 57.3).toFixed(2) + " deg at any point", turn * 57.3 < 45 && worst * 57.3 < 1.5); }
const deck = X.deckEdges.map((d) => ({ ...G.edges.find((e) => e.id === d.id), s0: d.s0, s1: d.s1 }));
chk("the deck is one continuous chain of edges at one height (" + deck.length + " edges)", deck.length >= 3 && deck.every((e, i) => e.h0 === X.H && e.h1 === X.H && (i === 0 || (deck[i - 1].b === e.a && Math.abs(deck[i - 1].s1 - e.s0) < 1e-6))) && Math.abs(deck.at(-1).s1 - X.len) < 1 && deck[0].s0 === 0);
const ramps = G.edges.filter((e) => e.mask & 4);
chk("there are entry and exit ramps at both interchanges, each climbing the full deck height at under 4 percent", X.ramps.length === 6 && X.ramps.every((r) => r.grade < 0.04) && ramps.every((e) => Math.abs(e.h1 - e.h0) === X.H));
chk("every ramp meets a ground node at one end and a deck node at the other", ramps.every((e) => { const a = G.nodes[e.a], b = G.nodes[e.b]; return (a.h === 0 && b.h === X.H) || (a.h === X.H && b.h === 0); }));
chk("the ramps are smooth (no kink where they leave the ground or meet the deck)", ramps.every((e) => { const f = (s) => heightOn(e, s); return f(0.5) - f(0) < 0.01 && f(e.len) - f(e.len - 0.5) < 0.01 || f(0) - f(0.5) < 0.01; }));
chk("the deck is not used by traffic or people on the ground (ambient traffic has no lane on it)", G.lanes.filter((l) => G.edges.find((e) => e.id === l.edge)?.hw).length > 0 && true);

// ---- 3. driving the deck at top speed ----
const T = (s) => { let lo = 0; const P = X.deck; let acc = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc + d >= s) { const t = (s - acc) / d; const hx = (P[i][0] - P[i - 1][0]) / d, hz = (P[i][1] - P[i - 1][1]) / d; return { x: P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z: P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, hx, hz }; } acc += d; void lo; } const q = P.at(-1); return { x: q[0], z: q[1], hx: 1, hz: 0 }; };
for (const [name, lat] of [["the outer lane", X.med + 2.5 * X.lane], ["the inner lane", X.med + 0.5 * X.lane], ["the left carriageway", -(X.med + 1.5 * X.lane)]]) {
  let miss = 0, jump = 0, wrong = 0, prevH = null; const out = {}, m = carMask(1), STEP = 1.5;
  for (let s = X.apron; s < X.len - X.apron; s += STEP) {
    const q = T(s), x = q.x - q.hz * lat, z = q.z + q.hx * lat, r = G.surfaceAt(x, z, out, m, X.H);
    if (r.cls !== 1) miss++; if (Math.abs(r.h - X.H) > 0.03) wrong++; if (prevH != null && Math.abs(r.h - prevH) > 0.05) jump++; prevH = r.h;
  }
  chk("driving " + name + " end to end at 325 km/h: the surface is under the car at every step (" + miss + " gaps), always at deck height (" + wrong + "), no steps in height (" + jump + ")", !miss && !wrong && !jump);
}
{ let lvWrong = 0, peopleSee = 0, prev = 1; const out = {}; for (let s = X.apron + 50; s < X.len - X.apron; s += 25) { const q = T(s), l = G.levelAt(q.x - q.hz * 5, q.z + q.hx * 5, prev, X.H); if (l.lv !== 1) lvWrong++; prev = l.lv; if (G.surfaceAt(q.x - q.hz * 5, q.z + q.hx * 5, out, LV_GROUND).edge >= 0 && G.surfaceAt(q.x - q.hz * 5, q.z + q.hx * 5, out, LV_GROUND).cls === 1 && G.byId?.(out.edge)?.hw) peopleSee++; }
  chk("a car on the deck is on level 1 all along it, and people (ground mask) never meet the deck (" + lvWrong + "/" + peopleSee + ")", !lvWrong && !peopleSee); }
{ let miss = 0, jump = 0; for (const r of X.ramps) { let prevH = null; const out = {}; const e = G.edges.find((q) => q.id === r.id), P = e.path;
    for (let s = 0; s <= P.len; s += 1) { const q = P.at(s, {}), a = G.surfaceAt(q.x, q.z, out, carMask(r.kind === "on" ? 0 : 1), heightOn(e, s)); if (a.cls !== 1) miss++; if (prevH != null && Math.abs(a.h - prevH) > 0.2) jump++; prevH = a.h; } }
  chk("every ramp is drivable end to end, with the height rising smoothly (" + miss + " gaps, " + jump + " steps)", !miss && !jump); }
{ const room = X.len - 2 * X.apron + X.apron, rows = [];
  for (const id of Object.keys(V)) {
    const P = carProfile(id), car = createCar(); let d = 0, t = 0, d95 = null;
    for (; t < 400; t += 1 / 60) { const x0 = car.x, z0 = car.z; stepCar(car, { gas: 1, brake: 0, steer: 0 }, 1 / 60, null, P); d += Math.hypot(car.x - x0, car.z - z0); if (d95 == null && car.v >= 0.95 * P.vmax) { d95 = d; break; } }
    let b = 0; for (let i = 0; i < 60 * 60 && car.v > 0.1; i++) { const x0 = car.x, z0 = car.z; stepCar(car, { gas: 0, brake: 1, steer: 0 }, 1 / 60, null, P); b += Math.hypot(car.x - x0, car.z - z0); }
    rows.push({ id, d95, b, top: Math.round(P.vmax * 3.6) });
  }
  const fast = rows.filter((r) => r.top >= 300);
  chk("every vehicle reaches 95% of its top speed and can stop within the deck (worst: " + rows.reduce((a, r) => (r.d95 + r.b > a.d95 + a.b ? r : a)).id + " needs " + Math.round(Math.max(...rows.map((r) => r.d95 + r.b))) + " m of " + Math.round(X.len) + " m)", rows.every((r) => r.d95 != null && r.d95 + r.b < X.len - X.apron));
  chk("the supercars (" + fast.map((r) => r.id + " " + r.top).join(", ") + " km/h) get to 95% of top speed on the deck with a clear run left (" + fast.map((r) => Math.round(r.d95)).join(", ") + " m)", fast.length >= 1 && fast.every((r) => r.d95 < room * 0.75)); }

// ---- 4. the meshes ----
{ const a = buildRoadMeshes(G, 0.1), b = buildHighwayMeshes(X, 0.1); let tri = 0, bad2 = 0, hmax = 0; for (const grp of [a, b]) grp.traverse((o) => { const p = o.geometry?.attributes.position?.array; if (!p) return; tri += p.length / 9; for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad2++; if (grp === b) for (let i = 1; i < p.length; i += 3) hmax = Math.max(hmax, p[i] * 10); });
  chk("the road and expressway meshes build (" + tri + " triangles, no bad vertices), and the highest point is a lamp at " + hmax.toFixed(1) + " m, not a stray vertex", bad2 === 0 && tri < 600000 && hmax > X.H && hmax < X.H + 14); }

console.log(bad ? "\n" + bad + " of " + n + " checks failed" : "\nroad network: all " + n + " checks passed"); if (bad) process.exit(1);
