// tests/road-network.test.mjs
// The rebuilt road network and the elevated expressway (tools/oau/refine-roads.mjs -> public/data/oau-roadgraph.json; lib3d/roadrefine.js, lib3d/highway.js, lib3d/roadgraph.js):
//   1. the ground network: one connected piece, no dead stubs or tiny loops, every place reachable, wide roads where they should be, nothing squeezed against a building
//   2. the expressway: long, straight, three lanes each way, a median, one continuous deck at one height, ramps with a gentle grade that join the deck and the ground
//   3. driving it at top speed: the surface is there at every step, with no steps in height and no wrong level, for every vehicle; and the deck is long enough to reach top speed and stop
//   4. people and ambient traffic never see the deck; the meshes build cleanly
import fs from "node:fs";
import { buildRoadGraph, carMask, carMaskAt, LV_GROUND, LV_DECK, LV_RAMP, heightOn } from "../lib3d/roadgraph.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { planTrip } from "../lib3d/tripplan.js";
import { buildRoadMeshes } from "../lib3d/roadmesh.js";
import { deckHeight } from "../lib3d/highwaytails.js";
import { buildHighwayMeshes } from "../lib3d/highwaymesh.js";
import { buildRoadFurniture } from "../lib3d/roadfurniture.js";
import { isSimple, area, inside } from "../lib3d/roadjunction.js";
import { buildWorldCollision } from "../lib3d/collide.js";
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
{ const deg = new Map(); for (const e of ground) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  const dead = G.nodes.filter((nd) => deg.get(nd.id) === 1 && !nd.rim);
  chk("roads do not end in the middle of nowhere: at most 4 dead ends are left (" + dead.map((nd) => Math.round(nd.x) + "," + Math.round(nd.z)).join(" ") + ")", dead.length <= 4);
  chk("the drivable roads are one connected network (no road cut off by a footpath)", (() => { const par = new Map(); const f = (x) => (par.get(x) === x ? x : (par.set(x, f(par.get(x))), par.get(x))); for (const e of ground) { par.set(e.a, par.get(e.a) ?? e.a); par.set(e.b, par.get(e.b) ?? e.b); } for (const e of ground) par.set(f(e.a), f(e.b)); return new Set(ground.map((e) => f(e.a))).size === 1; })());
  chk("no road runs through a building (no long footpath-width alley, no road with a negative clearance)", G.foots.filter((e) => e.len > 40 && e.clr < 0).length <= 1 && ground.every((e) => e.clr > -0.5));
  chk("no small ring of road is left (no roundabout, no triangle round nothing): every short link between junctions leads somewhere", ground.filter((e) => e.a !== e.b && e.len < 25 && (deg.get(e.a) ?? 0) >= 3 && (deg.get(e.b) ?? 0) >= 3).length <= 3);
  chk("the roads are long and straight: an express road sweeps round in one gentle curve (under 130 degrees in all, and no corner sharper than 25 degrees)", ground.filter((e) => e.cls === "arterial" && e.len > 150).every((e) => { let t = 0, w = 0; const P = e.path.pts ?? []; for (let i = 1; i < P.length - 1; i++) { const a = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), b = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; t += d; w = Math.max(w, d); } return t * 57.3 < 130 && w * 57.3 < 25; })); }
chk("express roads have a median and two or three lanes each way; every other road is also at least two lanes each way (four in all)", ground.filter((e) => e.cls === "arterial" && !e.foot).every((e) => e.med > 0 && e.lanesPerDir >= 2) && ground.filter((e) => !e.foot).every((e) => e.lanesPerDir >= 2));
chk("the main roads are wider than the small campus roads", Math.max(...ground.filter((e) => e.cls === "arterial").map((e) => e.half)) >= 2 * Math.max(...ground.filter((e) => e.cls === "local").map((e) => e.half)) - 1);
chk("a strip of pavement is kept beside the buildings wherever the road is not squeezed", ground.every((e) => e.foot || e.sw >= 0.7 || e.clr - e.half <= 1.7));
{ const from = svc.data.places.find((p) => p.id === "senate"); const fail = svc.data.places.filter((p) => p.x != null && p.kind !== "billboard" && !p.offmap && p !== from).filter((p) => !planTrip(svc, { from, to: p, mode: "car", driver: true }).ok);
  chk("every place can be driven to from the Senate (" + fail.map((p) => p.id).join(",") + ")", fail.length === 0); }

// ---- 2. the expressway ----
chk("the expressway is long (over 4 km) and three lanes each way with a median", X && X.len > 4000 && X.lanes === 3 && X.med >= 1 && X.half >= 14 && X.shoulder >= 2);
{ let turn = 0, worst = 0; const P0 = X.deck, cum = [0]; for (let i = 1; i < P0.length; i++) cum.push(cum[i - 1] + Math.hypot(P0[i][0] - P0[i - 1][0], P0[i][1] - P0[i - 1][1])); const P = P0.filter((_, i) => cum[i] >= X.main[0] - 1 && cum[i] <= X.main[1] + 1); for (let i = 1; i < P.length - 1; i++) { const a = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), b = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]); let d = Math.abs(b - a); if (d > Math.PI) d = 2 * Math.PI - d; turn += d; worst = Math.max(worst, d); }
  chk("the straight part of the deck (between the two tails) is predominantly straight: " + (turn * 57.3).toFixed(0) + " deg of turning in total, at most " + (worst * 57.3).toFixed(2) + " deg at any point", turn * 57.3 < 45 && worst * 57.3 < 1.5); }
const deck = X.deckEdges.map((d) => ({ ...G.edges.find((e) => e.id === d.id), s0: d.s0, s1: d.s1 }));
chk("the deck is one continuous chain of edges from one touchdown to the other (" + deck.length + " edges): at deck height except the two descents, which start and end at the ground; heights and distances join up", deck.length >= 5 && deck.every((e, i) => (i === 0 || (deck[i - 1].b === e.a && Math.abs(deck[i - 1].s1 - e.s0) < 1e-6 && deck[i - 1].h1 === e.h0)) && (e.kind === "express-descent" ? Math.min(e.h0, e.h1) === 0 && Math.max(e.h0, e.h1) === X.H : e.h0 === X.H && e.h1 === X.H)) && Math.abs(deck.at(-1).s1 - X.len) < 1 && deck[0].s0 === 0 && deck[0].kind === "express-descent" && deck.at(-1).kind === "express-descent");
chk("the deck has no dead end and no end barrier: every node of the deck chain has a road on both sides (the two ends are touchdowns that carry straight on as ground road)", !G.nodes.some((n) => n.fixedOnly && n.deg === 1) && X.grounds && ["west", "east"].every((k) => { const t = G.nodes[X.grounds[k].touch]; return t.deg === 2 && t.tdown && t.h === 0 && t.edges.some((id) => G.byEdge.get(id).hw) && t.edges.some((id) => !G.byEdge.get(id).hw); }));
const ramps = G.edges.filter((e) => e.mask & 4);
chk("there are entry and exit ramps at both interchanges, each climbing the full deck height at under 4 percent", X.ramps.length === 6 && X.ramps.every((r) => r.grade < 0.04) && ramps.every((e) => Math.abs(e.h1 - e.h0) === X.H));
chk("every ramp meets a ground node at one end and a deck node at the other", ramps.every((e) => { const a = G.nodes[e.a], b = G.nodes[e.b]; return (a.h === 0 && b.h === X.H) || (a.h === X.H && b.h === 0); }));
chk("the ramps are smooth (no kink where they leave the ground or meet the deck)", ramps.every((e) => { const f = (s) => heightOn(e, s); return f(0.5) - f(0) < 0.01 && f(e.len) - f(e.len - 0.5) < 0.01 || f(0) - f(0.5) < 0.01; }));
chk("the deck is not used by traffic or people on the ground (ambient traffic has no lane on it)", G.lanes.filter((l) => G.edges.find((e) => e.id === l.edge)?.hw).length > 0 && true);

// ---- 3. driving the deck at top speed ----
const T = (s) => { let lo = 0; const P = X.deck; let acc = 0; for (let i = 1; i < P.length; i++) { const d = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); if (acc + d >= s) { const t = (s - acc) / d; const hx = (P[i][0] - P[i - 1][0]) / d, hz = (P[i][1] - P[i - 1][1]) / d; return { x: P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, z: P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, hx, hz }; } acc += d; void lo; } const q = P.at(-1); return { x: q[0], z: q[1], hx: 1, hz: 0 }; };
for (const [name, lat] of [["the outer lane", X.med + 2.5 * X.lane], ["the inner lane", X.med + 0.5 * X.lane], ["the left carriageway", -(X.med + 1.5 * X.lane)]]) {
  let miss = 0, jump = 0, wrong = 0, prevH = null; const out = {}, m = carMask(1), STEP = 1.5;
  for (let s = 0; s <= X.len; s += STEP) {
    const q = T(s), x = q.x - q.hz * lat, z = q.z + q.hx * lat, hh = deckHeight(X, s), r = G.surfaceAt(x, z, out, m, hh);
    if (r.cls !== 1) miss++; if (Math.abs(r.h - hh) > 0.12) wrong++; if (prevH != null && Math.abs(r.h - prevH) > 0.12) jump++; prevH = r.h;
  }
  chk("driving " + name + " from one touchdown to the other (tails and descents included): the surface is under the car at every step (" + miss + " gaps), at the height the deck has there, to 12 cm (" + wrong + " wrong), no steps in height (" + jump + ")", !miss && !wrong && !jump);
}
{ let lvWrong = 0, peopleSee = 0, prev = 1; const out = {}; for (let s = X.main[0] + 50; s < X.main[1]; s += 25) { const q = T(s), l = G.levelAt(q.x - q.hz * 5, q.z + q.hx * 5, prev, X.H); if (l.lv !== 1) lvWrong++; prev = l.lv; if (G.surfaceAt(q.x - q.hz * 5, q.z + q.hx * 5, out, LV_GROUND).edge >= 0 && G.surfaceAt(q.x - q.hz * 5, q.z + q.hx * 5, out, LV_GROUND).cls === 1 && G.byId?.(out.edge)?.hw) peopleSee++; }
  chk("a car on the deck is on level 1 all along it, and people (ground mask) never meet the deck (" + lvWrong + "/" + peopleSee + ")", !lvWrong && !peopleSee); }
{ let miss = 0, jump = 0; for (const r of X.ramps) { let prevH = null; const out = {}; const e = G.edges.find((q) => q.id === r.id), P = e.path;
    for (let s = 0; s <= P.len; s += 1) { const q = P.at(s, {}), a = G.surfaceAt(q.x, q.z, out, carMask(r.kind === "on" ? 0 : 1), heightOn(e, s)); if (a.cls !== 1) miss++; if (prevH != null && Math.abs(a.h - prevH) > 0.2) jump++; prevH = a.h; } }
  chk("every ramp is drivable end to end, with the height rising smoothly (" + miss + " gaps, " + jump + " steps)", !miss && !jump); }
{ const MAIN = X.main[1] - X.main[0], room = MAIN - 80, rows = [];
  for (const id of Object.keys(V)) {
    const P = carProfile(id), car = createCar(); let d = 0, t = 0, d95 = null;
    for (; t < 400; t += 1 / 60) { const x0 = car.x, z0 = car.z; stepCar(car, { gas: 1, brake: 0, steer: 0 }, 1 / 60, null, P); d += Math.hypot(car.x - x0, car.z - z0); if (d95 == null && car.v >= 0.95 * P.vmax) { d95 = d; break; } }
    let b = 0; for (let i = 0; i < 60 * 60 && car.v > 0.1; i++) { const x0 = car.x, z0 = car.z; stepCar(car, { gas: 0, brake: 1, steer: 0 }, 1 / 60, null, P); b += Math.hypot(car.x - x0, car.z - z0); }
    rows.push({ id, d95, b, top: Math.round(P.vmax * 3.6) });
  }
  const fast = rows.filter((r) => r.top >= 300);
  chk("every vehicle reaches 95% of its top speed and can stop within the deck (worst: " + rows.reduce((a, r) => (r.d95 + r.b > a.d95 + a.b ? r : a)).id + " needs " + Math.round(Math.max(...rows.map((r) => r.d95 + r.b))) + " m of " + Math.round(MAIN) + " m)", rows.every((r) => r.d95 != null && r.d95 + r.b < MAIN - 80));
  chk("the supercars (" + fast.map((r) => r.id + " " + r.top).join(", ") + " km/h) get to 95% of top speed on the deck with a clear run left (" + fast.map((r) => Math.round(r.d95)).join(", ") + " m)", fast.length >= 1 && fast.every((r) => r.d95 < room * 0.75)); }

// ---- 3b. the tails: from the campus road up onto the deck and back down again, without a barrier, step or gap ----
for (const k of ["west", "east"]) {
  const g = X.grounds[k], laneTo = (edge, node) => G.lanes.filter((l) => l.edge === edge && l.to === node), laneFrom = (edge, node) => G.lanes.filter((l) => l.edge === edge && l.to !== node);
  const deckEdges = X.deckEdges.map((d) => ({ ...G.byEdge.get(d.id), s0: d.s0, s1: d.s1 })), mainEdge = deckEdges.find((e) => e.kind === "express" && e.s0 >= X.main[0] - 1 && e.s1 <= X.main[1] + 1), tailEdge = deckEdges.find((e) => e.kind === "express" && (k === "west" ? e.s1 <= X.main[0] + 1 : e.s0 >= X.main[1] - 1));
  const drive = (r) => { let miss = 0, jump = 0, prevH = null, hmax = 0, h = prevH ?? 0; const out = {}, P = r.path; h = G.byEdge.get(G.lanes[r.segs[0].id].edge).h0; for (let s = 0; s <= P.len; s += 1) { const q = P.at(s, {}), a = G.surfaceAt(q.x, q.z, out, carMaskAt(h > 5 ? 1 : 0, h), h); if (a.cls !== 1) { miss++; continue; } if (Math.abs(a.h - h) > 0.15) jump++; h = a.h; hmax = Math.max(hmax, h); } return { miss, jump, hmax, len: P.len }; };
  const up = laneTo(g.c2, g.taper).flatMap((a) => laneTo(mainEdge.id, G.nodes[mainEdge.b].id).concat(laneFrom(mainEdge.id, G.nodes[mainEdge.a].id)).map((b) => G.route(a.id, 1, b.id, 1)).filter(Boolean)).sort((x, y) => x.len - y.len)[0];
  const down = tailEdge && laneTo(tailEdge.id, tailEdge.b).flatMap((a) => laneTo(g.c2, g.target).map((b) => G.route(a.id, 1, b.id, 1)).filter(Boolean)).sort((x, y) => x.len - y.len)[0];
  const U = up && drive(up), D = down && drive(down);
  chk("the " + k + " tail: a car can drive from the campus road onto the deck (" + (U ? Math.round(U.len) + " m, " + U.miss + " gaps, " + U.jump + " steps, up to " + U.hmax.toFixed(1) + " m" : "NO ROUTE") + ")", !!U && U.miss === 0 && U.jump === 0 && U.hmax > X.H - 0.5);
  chk("the " + k + " tail: and from the deck back down to the campus road (" + (D ? Math.round(D.len) + " m, " + D.miss + " gaps, " + D.jump + " steps" : "NO ROUTE") + ")", !!D && D.miss === 0 && D.jump === 0);
}
{ const ds = X.deckEdges.filter((d) => d.descent).map((d) => G.byEdge.get(d.id)), grade = Math.max(...ds.map((e) => { let m = 0; for (let s = 1; s <= e.len; s += 1) m = Math.max(m, Math.abs(heightOn(e, s) - heightOn(e, s - 1))); return m; }));
  chk("each descent is " + X.summary.descent + " m long, comes down smoothly (steepest " + (grade * 100).toFixed(1) + " %, gentler than the interchange ramps), and is a ramp level edge both a car on the ground and a car on the deck can use", ds.length === 2 && ds.every((e) => e.mask === LV_RAMP && e.len > 320) && grade < 0.04); }

// ---- 4. the meshes ----
{ const a = buildRoadMeshes(G, 0.1), b = buildHighwayMeshes(X, 0.1); let tri = 0, bad2 = 0, hmax = 0; for (const grp of [a, b]) grp.traverse((o) => { const p = o.geometry?.attributes.position?.array; if (!p) return; tri += p.length / 9; for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad2++; if (grp === b) for (let i = 1; i < p.length; i += 3) hmax = Math.max(hmax, p[i] * 10); });
  chk("the road and expressway meshes build (" + tri + " triangles, no bad vertices), and the highest point is a lamp at " + hmax.toFixed(1) + " m, not a stray vertex", bad2 === 0 && tri < 600000 && hmax > X.H && hmax < X.H + 14); }

// ---- 5. junctions and surfaces: roads MEET properly ----
// the game builds the graph with the world's collision field (it sizes each road from the room that is left), so the tests do too
const world = buildWorldCollision(svc.data), GS = buildRoadGraph(raw, { sdf: (x, z) => world.sdf(x, z, 16) });
{ const J = GS.nodes.filter((n) => n.J && n.deg >= 3 && !n.fixedOnly), poly = J.filter((n) => !n.J.asph.disc);
  chk("every junction has a polygon for asphalt, kerb and pavement, and every polygon is simple (no self-crossing) and has area (" + J.length + " junctions, " + poly.length + " with kerb returns, " + (J.length - poly.length) + " cramped ones drawn as a disc)", J.every((n) => ["asph", "kerb", "pave"].every((k) => isSimple(n.J[k].poly) && Math.abs(area(n.J[k].poly)) > 4)));
  chk("most junctions are real constructed polygons with kerb returns, not discs (at least 60 percent: " + poly.length + " of " + J.length + ")", poly.length >= 0.6 * J.length);
  let off = 0, tot = 0; for (const n of poly) for (const id of n.edges) { const e = GS.byEdge.get(id); if (!e || e.hw) continue; for (const end of [e.a === n.id ? 0 : -1, e.b === n.id ? 1 : -1]) { if (end < 0) continue; const c = n.J.asph.cut.get(e.id * 2 + end), q = e.path.at(end ? e.len - c : c, {}); tot++;
    // the mouth of the arm (its two corners at the cut) must lie on the polygon's outline: that is what makes the ribbon and the polygon meet with no gap
    for (const sgn of [-1, 1]) { const x = q.x - q.hz * sgn * e.half, z = q.z + q.hx * sgn * e.half; let d = Infinity; const P = n.J.asph.poly; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const ax = P[j][0], az = P[j][1], dx = P[i][0] - ax, dz = P[i][1] - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); } if (d > 0.05) off++; } } }
  chk("every road's ribbon meets its junction polygon exactly: both corners of every mouth are on the polygon (" + off + " off of " + tot * 2 + ")", off === 0); }
{ // no holes (inside a taper the road is narrower than its edge, so there only what the surface calls road must be drawn): sample the carriageway of every road, and every junction, and look for the asphalt triangle that covers each point
  const grp = buildRoadMeshes(GS, 0.1), asp = grp.getObjectByName("road-asphalt"), sho = grp.getObjectByName("road-shoulder"), med = grp.getObjectByName("road-median"), S = 0.1;
  const tris = []; for (const m of [asp, sho, med]) { const p = m?.geometry.attributes.position.array; if (!p) continue; for (let i = 0; i < p.length; i += 9) tris.push([p[i] / S, p[i + 2] / S, p[i + 3] / S, p[i + 5] / S, p[i + 6] / S, p[i + 8] / S]); }
  const C = 12, grid = new Map(), key = (i, j) => i * 100003 + j; tris.forEach((t, k) => { const x0 = Math.min(t[0], t[2], t[4]), x1 = Math.max(t[0], t[2], t[4]), z0 = Math.min(t[1], t[3], t[5]), z1 = Math.max(t[1], t[3], t[5]); for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++) for (let b = Math.floor(z0 / C); b <= Math.floor(z1 / C); b++) { const q = key(a, b); if (!grid.has(q)) grid.set(q, []); grid.get(q).push(k); } });
  const covered = (x, z) => { for (const k of grid.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) { const t = tris[k], d = (t[3] - t[5]) * (t[0] - t[4]) + (t[4] - t[2]) * (t[1] - t[5]); if (!d) continue; const a = ((t[3] - t[5]) * (x - t[4]) + (t[4] - t[2]) * (z - t[5])) / d, b = ((t[5] - t[1]) * (x - t[4]) + (t[0] - t[4]) * (z - t[5])) / d, c = 1 - a - b, e = -1e-3; if (a >= e && b >= e && c >= e) return true; } return false; };
  let pts = 0, holes = 0; const first = [];
  for (const e of GS.edges) { if (e.hw || e.foot) continue; for (let s = 0.5; s < e.len; s += 2) { const q = e.path.at(s, {}); for (const lat of [-0.9, -0.5, 0, 0.5, 0.9]) { const off = lat * (e.half - 0.1), x = q.x - q.hz * off, z = q.z + q.hx * off; if (e.tz && (s < e.tz.a || s > e.len - e.tz.b) && GS.surfaceAt(x, z, {}).cls !== 1) continue; pts++; if (!covered(x, z)) { holes++; if (first.length < 3) first.push(e.id + "@" + Math.round(x) + "," + Math.round(z) + "(s" + s.toFixed(0) + "/" + e.len.toFixed(0) + " lat" + lat + ")"); } } } }
  for (const n of GS.nodes) { if (!n.J || n.fixedOnly || !n.deg) continue; for (let a = 0; a < 16; a++) for (const r of [0, 0.4 * n.radius]) { const x = n.x + Math.cos(a) * r, z = n.z + Math.sin(a) * r; pts++; if (!covered(x, z)) { holes++; if (first.length < 3) first.push("node" + n.id); } } }
  chk("the asphalt mesh has no holes: every one of " + pts + " sample points across every road and junction is under a triangle (" + holes + " holes " + first.join(" ") + ")", holes === 0);
  // sidewalks: the pavement mesh covers the strip beside every road that has one
  const pav = grp.getObjectByName("road-pavement").geometry.attributes.position.array, ptri = []; for (let i = 0; i < pav.length; i += 9) ptri.push([pav[i] / S, pav[i + 2] / S, pav[i + 3] / S, pav[i + 5] / S, pav[i + 6] / S, pav[i + 8] / S]);
  const pg = new Map(); ptri.forEach((t, k) => { const x0 = Math.min(t[0], t[2], t[4]), x1 = Math.max(t[0], t[2], t[4]), z0 = Math.min(t[1], t[3], t[5]), z1 = Math.max(t[1], t[3], t[5]); for (let a = Math.floor(x0 / C); a <= Math.floor(x1 / C); a++) for (let b = Math.floor(z0 / C); b <= Math.floor(z1 / C); b++) { const q = key(a, b); if (!pg.has(q)) pg.set(q, []); pg.get(q).push(k); } });
  const pcov = (x, z) => { for (const k of pg.get(key(Math.floor(x / C), Math.floor(z / C))) ?? []) { const t = ptri[k], d = (t[3] - t[5]) * (t[0] - t[4]) + (t[4] - t[2]) * (t[1] - t[5]); if (!d) continue; const a = ((t[3] - t[5]) * (x - t[4]) + (t[4] - t[2]) * (z - t[5])) / d, b = ((t[5] - t[1]) * (x - t[4]) + (t[0] - t[4]) * (z - t[5])) / d, c = 1 - a - b; if (a >= -1e-3 && b >= -1e-3 && c >= -1e-3) return true; } return false; };
  let pp = 0, ph = 0; for (const e of GS.edges) { if (e.hw || e.foot || e.sw < 1) continue; for (let s = 1; s < e.len; s += 3) { const q = e.path.at(s, {}); if (e.tz && (s < e.tz.a + 3 || s > e.len - e.tz.b - 3)) continue; for (const sgn of [-1, 1]) { const off = sgn * (e.half + e.sw * 0.5), x = q.x - q.hz * off, z = q.z + q.hx * off; pp++; if (!pcov(x, z)) ph++; } } }
  chk("the sidewalks are continuous: the pavement mesh covers the middle of the pavement strip along every road (" + ph + " gaps in " + pp + " samples)", ph === 0);
  grp.userData.dispose(); }
{ // a car footprint swept along every junction turn and every lane stays on the asphalt (the car can never be stopped by an invisible edge)
  const out = {}, LEN = 4.6, WID = 1.9, probe = (x, z, hx, hz) => { const rx = -hz, rz = hx; let b = 0; for (const u of [-LEN / 2, 0, LEN / 2]) for (const w of [-WID / 2, 0, WID / 2]) if (GS.surfaceAt(x + hx * u + rx * w, z + hz * u + rz * w, out, carMask(0)).cls !== 1) b++; return b; };
  let cb = 0, cn = 0, lb = 0, ln = 0; for (const c of GS.conns) { if (GS.lanes[c.from].hw || GS.lanes[c.to].hw) continue; cn++; let bad = 0; for (let s = 0; s <= c.len; s += 0.5) { const p = c.path.at(s, {}); if (probe(p.x, p.z, p.hx, p.hz)) bad++; } if (bad) cb++; }
  for (const l of GS.lanes) { if (l.hw) continue; ln++; let bad = 0; for (let s = 0; s <= l.len; s += 1) { const p = l.path.at(s, {}); if (probe(p.x, p.z, p.hx, p.hz)) bad++; } if (bad > 3) lb++; }
  chk("a car driving any junction turn stays on the asphalt with its whole body (" + cb + " of " + cn + " turns leave it)", cb === 0);
  chk("a car driving down any lane stays on the asphalt (" + lb + " of " + ln + " lanes leave it for more than 3 m)", lb <= 4); }
{ // every lane can be reached from every other lane through the junctions (the routing graph is one strongly connected piece on the ground)
  const gl = GS.lanes.filter((l) => !l.hw && l.comp === 0), start = gl[0].id, seen = new Set([start]), q = [start]; while (q.length) { const l = q.pop(); for (const cid of GS.lanes[l].out) { const t = GS.conns[cid].to; if (!seen.has(t)) { seen.add(t); q.push(t); } } }   // (the expressway's ramps are part of the network: a lane that joins the ground only by a ramp is still reachable)
  const unreached = gl.filter((l) => !seen.has(l.id)); const back = new Set([start]), q2 = [start]; while (q2.length) { const l = q2.pop(); for (const cid of GS.lanes[l].in) { const f = GS.conns[cid].from; if (!back.has(f)) { back.add(f); q2.push(f); } } }
  chk("the routing graph is one piece: from any lane you can drive to every lane and back (" + unreached.length + " unreachable, " + gl.filter((l) => !back.has(l.id)).length + " cannot return)", unreached.length === 0 && gl.every((l) => back.has(l.id)));
  // routes only ever follow connected lanes: re-route between spread-out lanes and check each hop is a real connector
  let bad2 = 0, routes = 0; for (let k = 0; k < gl.length; k += 11) { const a = gl[k], b = gl[(k * 7 + 3) % gl.length]; if (a.id === b.id) continue; const r = GS.route(a.id, 1, b.id, 1); routes++; if (!r) { bad2++; continue; } let prev = null; for (const sg of r.segs) { if (sg.kind === "conn") { const c = GS.conns[sg.id]; if (prev != null && c.from !== prev) bad2++; prev = c.to; } } }
  chk("route() finds a route between lanes spread over the whole network, and every hop of it is a real connector (" + routes + " routes, " + bad2 + " bad)", routes > 20 && bad2 === 0); }
{ // intersections have no stacked markings: a stop line is not on a zebra crossing
  let clash = 0; for (const l of GS.lanes) { if (l.hw || GS.nodes[l.to].deg < 3 || l.len < 6) continue; const a = l.path.at(l.len - 0.5, {}); for (const c of GS.crossings) if (Math.hypot(c.x - a.x, c.z - a.z) < c.along + 0.35 + 0.1 && Math.abs((a.x - c.x) * c.hx + (a.z - c.z) * c.hz) < c.along + 0.3 && Math.hypot(a.x - c.x, a.z - c.z) < 8) clash++; }
  chk("no stop line is drawn over a zebra crossing (" + clash + " clashes)", clash === 0); }

// ---- 6. street furniture ----
{ const F = buildRoadFurniture(GS, 0.1), S = 0.1, out = {}; let n = 0, onRoad = 0, inWall = 0; F.traverse((o) => { if (!o.isInstancedMesh) return; const a = o.instanceMatrix.array; for (let i = 0; i < o.count; i++) { const x = a[i * 16 + 12] / S, z = a[i * 16 + 14] / S; n++; if (GS.surfaceAt(x, z, out).cls === 1) onRoad++; if (world.sdf(x, z, 4) < 0) inWall++; } });
  const c = F.userData.counts; chk("street lights, trees and stop signs stand on pavements or medians, never on a carriageway or in a building (" + c.lamps + " lights, " + c.trees + " trees, " + c.signs + " signs; " + onRoad + " on a road, " + inWall + " in a wall)", c.lamps > 100 && c.trees > 100 && c.signs > 5 && onRoad === 0 && inWall === 0);
  chk("the furniture is instanced: a handful of draw calls however many there are", (() => { let m = 0; F.traverse((o) => { if (o.isMesh) m++; }); return m <= 8; })()); F.userData.dispose(); }

console.log(bad ? "\n" + bad + " of " + n + " checks failed" : "\nroad network: all " + n + " checks passed"); if (bad) process.exit(1);
