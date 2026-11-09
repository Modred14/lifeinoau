// tests/traffic-persistence.test.mjs: NPC cars and people are permanent inhabitants: none is created or removed where the player can see it,
// none is left jammed for good, and a drive never simply ends. Run: node tests/traffic-persistence.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import { withExtras } from "../lib3d/mapExtras.js";
import { buildServices } from "../lib3d/worldsvc.js";
import { createTrafficSim, HOT_KINDS, DENSITY } from "../lib3d/trafficsim.js";

const ok = (m) => console.log("OK   " + m);
const data = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const raw = JSON.parse(fs.readFileSync(new URL("../public/data/oau-roadgraph.json", import.meta.url), "utf8"));
const svc = buildServices(data, raw), g = svc.graph, world = svc.world;
const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hot = (data.places ?? []).filter((p) => p.x != null && HOT_KINDS[p.kind] && !p.offmap).map((p) => ({ x: p.x, z: p.z, w: HOT_KINDS[p.kind] }));
const make = (f, seed = 7) => createTrafficSim({ graph: g, world, focus: () => f, rnd: rng(seed), density: { vehicles: 70, hwVehicles: 44, peds: 60, hotspots: hot, limits: { car: 80, keke: 10, bus: 8, minibus: 12 } } });
const hidden = (f, x, z, min, lvl = 0) => { if (lvl === 1 || Math.hypot(x - f.x, z - f.z) < min) return false; const dx = x - f.x, dz = z - f.z, l = Math.hypot(dx, dz), px = (-dz / l) * 2.5, pz = (dx / l) * 2.5; return [[0, 0], [px, pz], [-px, -pz]].every(([a, b]) => world.raycast(f.x, f.z, x + a, z + b) != null); };

// 1. over ten minutes at three places, with the player standing still: nothing is removed or created in the open, and no jam survives
for (const [name, f] of [["campus interchange", { x: 63, z: 730 }], ["city centre", { x: 0, z: 100 }], ["west interchange", { x: -493, z: 759 }]]) {
  const sim = make(f); let prev = new Map(), seenV = new Set(), seenP = new Set(), vanished = 0, appeared = 0, pAppeared = 0, longest = 0;
  for (let i = 0; i < 30 * 600; i++) {
    sim.update(1 / 30); const t = i / 30, cur = new Map(sim.vehicles.filter((v) => v.role === "npc").map((v) => [v.id, v]));
    if (t > 9) {   // the first fill of the world (see fillStep) is over
      for (const [id, v] of prev) if (!cur.has(id) && Math.hypot(v.x - f.x, v.z - f.z) < DENSITY.view - 10 && !hidden(f, v.x, v.z, DENSITY.hideBelow, v.lvl)) vanished++;
      for (const [id, v] of cur) if (!seenV.has(id) && Math.hypot(v.x - f.x, v.z - f.z) < DENSITY.view - 10 && !hidden(f, v.x, v.z, DENSITY.hideBelow, v.lvl)) appeared++;
      for (const p of sim.peds) if (!seenP.has(p.id) && Math.hypot(p.x - f.x, p.z - f.z) < DENSITY.pedView - 10 && !hidden(f, p.x, p.z, DENSITY.pedHideBelow)) pAppeared++;
    }
    for (const id of cur.keys()) seenV.add(id); for (const p of sim.peds) seenP.add(p.id);
    prev = new Map([...cur].map(([k, v]) => [k, { x: v.x, z: v.z, lvl: v.lvl }]));
    if (i % 30 === 0) for (const v of sim.vehicles) if (v.role === "npc") longest = Math.max(longest, v.stillFor);
  }
  assert.equal(vanished, 0, `${name}: ${vanished} vehicles were removed where they could be seen`);
  assert.equal(appeared, 0, `${name}: ${appeared} vehicles appeared where they could be seen`);
  assert.equal(pAppeared, 0, `${name}: ${pAppeared} people appeared where they could be seen`);
  assert.ok(longest < 240, `${name}: a vehicle stood still for ${longest.toFixed(0)} s: a queue that long is a lock, not traffic`);   // a busy junction queues for a minute or two at this density; a real deadlock never clears
  assert.ok(sim.vehicles.filter((v) => v.role === "npc").length > 50 && sim.peds.length >= 50, `${name}: the world stays populated`);
  ok(`${name}: 10 minutes, nothing seen to appear or vanish, longest stop ${longest.toFixed(0)} s, ${sim.stats.deadlocksBroken} locks let through`);
}

// 2. a drive never ends in front of anyone: it is extended where it stands, without a jump or a stop
{
  const f = { x: 63, z: 730 }, sim = make(f); for (let i = 0; i < 30 * 20; i++) sim.update(1 / 30);
  const a = sim.vehicles.find((v) => v.role === "npc" && v.route.segs[v.si].kind === "lane" && v.res == null && !v.hw && Math.hypot(v.x - f.x, v.z - f.z) < 200);
  assert.ok(a, "a vehicle in view to extend"); const sg = a.route.segs[a.si];
  // leave it only the lane it is on, and put it 30 m from the end of that
  a.route = g.makeRoute([{ kind: "lane", id: sg.id, s0: sg.s0, s1: sg.s1 }]); a.s = Math.max(0, a.route.len - 30); a.si = 0; a.nextConn = null; a.stopLine = null;
  sim.update(1 / 30);   // (the vehicle is now on its new, short route: measure from here, not from where the test put it)
  const before = a.route.len; let px = a.x, pz = a.z, jump = 0, extendedAt = -1;
  for (let i = 0; i < 30 * 4; i++) { sim.update(1 / 30); jump = Math.max(jump, Math.hypot(a.x - px, a.z - pz)); px = a.x; pz = a.z; if (extendedAt < 0 && a.route.len > before) extendedAt = i; if (a.done) break; }
  assert.ok(!a.done && extendedAt >= 0 && a.route.len > 1500, `the drive was extended instead of ending (route ${before.toFixed(0)} m -> ${a.route.len.toFixed(0)} m)`);
  assert.ok(jump < 1.5, `no jump when the drive is extended (largest step ${jump.toFixed(2)} m)`);
  ok(`a drive that was about to end carried on (route ${before.toFixed(0)} m -> ${a.route.len.toFixed(0)} m, largest step ${jump.toFixed(2)} m)`);
}

// 3. a keke is never put where it could be stranded or sent on the expressway; others do use the ramps
{
  const sim = make({ x: -493, z: 759 }); let kekes = 0, ramp = 0;
  for (let i = 0; i < 30 * 400; i++) { sim.update(1 / 30); if (i % 15) continue; for (const v of sim.vehicles) { if (v.role !== "npc") continue; if (v.kind === "keke") { kekes++; assert.ok(!g.lanes[v.laneId].hw, "a keke on the expressway or a ramp"); } else if (g.byEdge.get(g.lanes[v.laneId].edge).kind === "ramp") ramp++; } }
  assert.ok(kekes > 0 && ramp > 0, "kekes were seen, and other vehicles took the ramps");
  ok(`kekes stay off the deck (${kekes} samples); ${ramp} samples of other vehicles on ramps`);
}

// 4. the first fill happens at once, around the player, and a jump of the camera refills the world
{
  const f = { x: 63, z: 730 }, sim = make(f); for (let i = 0; i < 30 * 8; i++) sim.update(1 / 30);
  const n0 = sim.vehicles.filter((v) => v.role === "npc").length; assert.ok(n0 >= 90 && sim.peds.length >= 55, `world filled within 8 s (${n0} vehicles, ${sim.peds.length} people)`);
  f.x = -780; f.z = 120; for (let i = 0; i < 30 * 8; i++) sim.update(1 / 30);
  const near = sim.vehicles.filter((v) => v.role === "npc" && Math.hypot(v.x - f.x, v.z - f.z) < 250).length; assert.ok(near >= 20, `traffic around the new place within 8 s (${near})`);
  ok(`filled at once (${n0} vehicles), and refilled after a jump (${near} within view of the new place)`);
}

// 6. the same holds while the player walks or drives along real roads (the camera moves, the ring of creation and removal moves with it)
for (const [label, speed] of [["walking", 1.4], ["driving", 14]]) {
  const f = { x: 63, z: 730 }, sim = make(f), start = g.nearestOnRoad(63, 730, 200), lane = g.lanes.find((l) => l.edge === start.edge && !l.hw), route = sim.wander(lane.id, 0, 6000, true);
  let ps = 0, prev = new Map(), seenV = new Set(), seenP = new Set(), vanished = 0, appeared = 0, pAppeared = 0;
  for (let i = 0; i < 30 * 150; i++) {
    ps = Math.min(route.len - 1, ps + speed / 30); const p = route.path.at(ps, {}); f.x = p.x; f.z = p.z; sim.update(1 / 30);
    const cur = new Map(sim.vehicles.filter((v) => v.role === "npc").map((v) => [v.id, v]));
    if (i / 30 > 9) {
      for (const [id, v] of prev) if (!cur.has(id) && Math.hypot(v.x - f.x, v.z - f.z) < DENSITY.view - 10 && !hidden(f, v.x, v.z, DENSITY.hideBelow, v.lvl)) vanished++;
      for (const [id, v] of cur) if (!seenV.has(id) && Math.hypot(v.x - f.x, v.z - f.z) < DENSITY.view - 10 && !hidden(f, v.x, v.z, DENSITY.hideBelow, v.lvl)) appeared++;
      for (const q of sim.peds) if (!seenP.has(q.id) && Math.hypot(q.x - f.x, q.z - f.z) < DENSITY.pedView - 10 && !hidden(f, q.x, q.z, DENSITY.pedHideBelow)) pAppeared++;
    }
    for (const id of cur.keys()) seenV.add(id); for (const q of sim.peds) seenP.add(q.id);
    prev = new Map([...cur].map(([k, v]) => [k, { x: v.x, z: v.z, lvl: v.lvl }]));
  }
  const near = sim.vehicles.filter((v) => v.role === "npc" && Math.hypot(v.x - f.x, v.z - f.z) < DENSITY.view).length;
  assert.equal(vanished + appeared + pAppeared, 0, `${label}: ${vanished} vanished, ${appeared} vehicles and ${pAppeared} people appeared in view`);
  assert.ok(near >= 20, `${label}: the world stays populated around the player (${near} vehicles)`);
  ok(`${label} (${Math.round(ps)} m): nothing seen to appear or vanish, ${near} vehicles around the player`);
}

// 5. the report cadence of a healthy client always fits inside the window in which the server keeps a player on the road
{
  const srv = Number(/const ROAD_SECONDS = (\d+)/.exec(fs.readFileSync(new URL("../lib/travelService.js", import.meta.url), "utf8"))[1]) * 1000;
  const d = /const DEFAULTS = \{([^}]*)\}/.exec(fs.readFileSync(new URL("../lib/tripSync.js", import.meta.url), "utf8"))[1], n = (k) => Number(new RegExp(k + ":\\s*(\\d+)").exec(d)[1]);
  const worst = n("idleMs") + n("posMs") + n("maxBackoff");   // heartbeat due just after a tick, then one tick, then a failed request's back-off
  assert.ok(srv > worst, `server window ${srv} ms must exceed the longest quiet gap ${worst} ms`);
  ok(`a player is never quiet (${worst} ms worst case) for longer than the server waits (${srv} ms)`);
}
console.log("traffic persistence passed");
