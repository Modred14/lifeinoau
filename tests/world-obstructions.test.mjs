// tests/world-obstructions.test.mjs
// Nothing solid stands on a road, nothing that drives or walks goes through anything solid, and the solids are the things that are drawn.
//   1. no solid thing (a street light, tree, sign, pier, billboard footing, woodland tree) stands on a carriageway, and none narrows a pavement below what a person needs to pass
//   2. a car can drive every lane of the road network (ground roads, ramps, descents, the expressway's ground connectors) without its body touching a static solid
//   3. people cannot walk through a post, a tree or the low (solid) part of a ramp or a descent; cars are NOT stopped by the foot-only walls round those, so the road on top is never blocked
//   4. nothing can be driven through at speed: the car probe is asked every MAX_STEP_M, which is much less than a car plus the thinnest solid
// Run: node tests/world-obstructions.test.mjs
import fs from "node:fs";
import { buildServices } from "../lib3d/worldsvc.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { LV_GROUND, heightOn } from "../lib3d/roadgraph.js";
import { woodlandTrees, treeOnRoad } from "../lib3d/woodland.js";
import { FLUSH_H } from "../lib3d/structuresolid.js";
import { WALK_UNDER_H } from "../lib3d/highwaytails.js";
import { MAX_STEP_M } from "../lib3d/carphysics.js";
import { WALK_R } from "../lib3d/walker.js";

let failed = 0; const chk = (name, ok, extra = "") => { console.log((ok ? "OK   " : "FAIL ") + name + (extra ? " (" + extra + ")" : "")); if (!ok) failed++; };
const data = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const raw = JSON.parse(fs.readFileSync(new URL("../public/data/oau-roadgraph.json", import.meta.url), "utf8"));
const svc = buildServices(data, raw), G = svc.graph, W = svc.world, X = G.expressway, out = {};
const solidOf = (e) => (e.poly >= 0 ? W.polys[e.poly].tag : e.tag);
const posts = W.polys.filter((p) => p.tag?.kind && p.tag.kind !== "building" && p.pts.length === 8).map((p) => ({ kind: p.tag.kind, soft: p.tag.soft, x: p.pts.reduce((a, q) => a + q[0], 0) / 8, z: p.pts.reduce((a, q) => a + q[1], 0) / 8, r: Math.hypot(p.pts[0][0] - p.pts.reduce((a, q) => a + q[0], 0) / 8, p.pts[0][1] - p.pts.reduce((a, q) => a + q[1], 0) / 8) }));
const kinds = {}; for (const p of posts) kinds[p.kind] = (kinds[p.kind] ?? 0) + 1;

// ---- 1. nothing solid on a road ----
{ const onRoad = posts.filter((p) => p.kind !== "floodlight" && [[0, 0], [p.r, 0], [-p.r, 0], [0, p.r], [0, -p.r]].some(([dx, dz]) => G.surfaceAt(p.x + dx, p.z + dz, out, LV_GROUND).cls === 1));
  chk("no solid post stands on a ground carriageway: street lights, trees, signs, piers, billboard footings, woodland trees (" + posts.length + " posts: " + Object.entries(kinds).map(([k, n]) => n + " " + k).join(", ") + ")", onRoad.length === 0, onRoad.length ? onRoad.slice(0, 4).map((p) => p.kind + "@" + p.x.toFixed(0) + "," + p.z.toFixed(0)).join(" ") : ""); }
{ const plan = G.furniturePlan, n = (k) => posts.filter((p) => p.kind === k).length;
  chk("every street light, tree and sign of the furniture plan is a solid post in the world (" + plan.solids.length + "), and the meshes are built from that same plan", plan && plan.solids.length === n("lamp") + n("tree") + n("sign") && plan.solids.length > 1500); }
{ const shown = woodlandTrees(data).filter(([x, z]) => !treeOnRoad(G, x, z)).length;
  chk("every woodland tree that is drawn is a solid trunk, and a tree hidden because a road runs there is not (" + shown + ")", shown === posts.filter((p) => p.kind === "wood-tree").length && shown > 100); }
{ // people can still walk along a pavement that has street lights and trees on it: the planner does not have to send them into the road to get round one
  let tried = 0, detour = 0, worst = 1; const edges = G.edges.filter((e) => !e.hw && e.sw >= 1.9 && e.len > 70 && !e.rural);
  for (let i = 0; i < edges.length; i += 2) { const e = edges[i]; for (const sgn of [1, -1]) { const at = (s) => { const q = e.path.at(s, {}), off = sgn * (e.half + e.sw * 0.5); return [q.x - q.hz * off, q.z + q.hx * off]; };
      const clearAt = (s0) => { for (let s = s0; s < e.len - 20; s += 1) { const q = at(s); if (!W.blockedAt(q[0], q[1], 1.3)) return s; } return null; };     // (a spot to start from that is not a street light's foot)
      const s0 = clearAt(Math.min(30, e.len * 0.3)); if (s0 == null) continue; const s1 = clearAt(Math.min(e.len - 30, s0 + 60)); if (s1 == null || s1 - s0 < 25) continue; const a = at(s0), b = at(s1), r = svc.nav.plan(a[0], a[1], b[0], b[1]), chord = Math.hypot(b[0] - a[0], b[1] - a[1]); tried++;
      if (!r.ok || r.len > chord * 1.15 + 2) detour++; worst = Math.max(worst, r.ok ? r.len / chord : 9); } }
  chk("a person can walk along every pavement past its street lights, trees and signs without being sent into the road (" + tried + " pavements walked, longest detour x" + worst.toFixed(2) + ")", tried > 60 && detour <= 2 && worst < 1.5, detour + " detoured; two pavements (edges 27 and 29, beside a building) already needed a detour before any street furniture was solid"); }

// ---- 2. a car can drive every lane ----
{ let bad = 0, lanes = 0; const ex = [];
  for (const l of G.lanes) {
    const e = G.byEdge.get(l.edge); lanes++; let hit = 0;
    for (let s = 0; s <= l.len; s += 1) { const p = l.path.at(s, {}), h = e.hw ? heightOn(e, l.dir ? Math.max(0, e.len - s) : Math.min(e.len, s)) : 0; if (h > 2.5) continue;      // (a car above 2.5 m is over everything on the ground: lib3d/tripflow.js does not ask the static world)
      if (W.boxBlocked(p.x, p.z, p.hx, p.hz, 2.4, 1.0, 0)) hit++; }
    if (hit) { bad++; if (ex.length < 3) ex.push(l.edge + "@" + l.path.at(0, {}).x.toFixed(0)); }
  }
  chk("a car can drive every lane of the road network, ground roads, ramps, descents and the expressway's ground connectors, without its body touching a static solid (" + lanes + " lanes, " + bad + " blocked)", bad === 0, ex.join(" ")); }

// ---- 3. people and the solids ----
{ let miss = 0, n = 0; for (let i = 0; i < posts.length; i += 7) { const p = posts[i]; if (p.kind === "floodlight") continue; n++; const r = W.pushOut(p.x + p.r * 0.5, p.z, WALK_R); if (!r.hit) miss++; }
  chk("a person pushed into a post is stopped by it (" + n + " posts tried)", miss === 0, miss + " walked through"); }
{ const walls = W.E.filter((e) => e.poly < 0 && e.tag?.kind === "embankment"); let miss = 0, carStopped = 0;
  for (const w of walls) { const mx = (w.ax + w.bx) / 2, mz = (w.az + w.bz) / 2; if (!W.pushOut(mx, mz, WALK_R).hit) miss++; if (W.boxBlocked(mx, mz, 1, 0, 2.4, 1.0, 0) && !W.blockedAt(mx, mz, 1.0 + 3, false) ) carStopped++; }
  chk("the solid lower part of every ramp and descent has walls that stop people (" + walls.length + " wall segments)", walls.length > 100 && miss === 0, miss + " walked through"); }
{ // from beside a descent, a person cannot walk in to the road where the deck is low enough to be solid fill; and a car driving the road there is not stopped by the walls
  let tried = 0, through = 0, carBlocked = 0;
  for (const d of X.deckEdges.filter((q) => q.descent)) { const e = G.byEdge.get(d.id);
    for (let s = 3; s < e.len; s += 4) { const h = heightOn(e, s); if (h < FLUSH_H + 0.4 || h > WALK_UNDER_H - 0.3) continue; const q = e.path.at(s, {}); tried++;
      const out1 = [q.x - q.hz * (e.half + 3), q.z + q.hx * (e.half + 3)], in1 = [q.x - q.hz * 3, q.z + q.hx * 3]; if (W.segmentClear(out1[0], out1[1], in1[0], in1[1], WALK_R, { bodies: false })) through++;
      for (const lat of [-9, -3, 3, 9]) if (W.boxBlocked(q.x - q.hz * lat, q.z + q.hx * lat, q.hx, q.hz, 2.4, 1.0, 0)) carBlocked++; } }
  chk("a person cannot walk into the solid foot of a descent from the side, and a car on it is never stopped by those walls (" + tried + " places tried)", tried > 20 && through === 0 && carBlocked === 0, through + " walked in, " + carBlocked + " car blocks"); }

// ---- 4. no driving through anything at speed ----
{ let skipped = 0, tried = 0; for (const thick of [0.1, 0.2, 0.5]) for (let phase = 0; phase < MAX_STEP_M; phase += 0.05) {
    const w = new W.constructor(); w.addRect(10 + phase, -3, 10 + phase + thick, 3, null); tried++; let hit = false;
    for (let x = 0; x < 20 && !hit; x += MAX_STEP_M) hit = w.boxBlocked(x, 0, 1, 0, 2.4, 1.0, 0);      // a car 4.8 m long, 2 m wide, probed every MAX_STEP_M metres, however fast it goes
    if (!hit) skipped++; }
  chk("a car probed every " + MAX_STEP_M + " m cannot pass through a wall 10 cm thick at any speed (" + tried + " cases)", skipped === 0, skipped + " passed through"); }

if (failed) { console.log(failed + " check(s) failed"); process.exit(1); } console.log("world-obstructions: all checks passed");
