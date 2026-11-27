// tests/campus-decor.test.mjs
// The solid decoration of the Campuslife look (trees, stalls, banners, the Main Gate): it is really solid, and it changes nothing about where anyone can go. The world with it is compared with the
// world without it: the same building doors, the same trips, the same home lots; and a home compound clears its own yard.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { destinationOf } = await import("../lib3d/roadnet.js");
const { portalFor } = await import("../lib3d/buildingPortals.js");
const { planTrip } = await import("../lib3d/tripplan.js");
const { homeLots, homeLot, compoundRing, lotIsFree } = await import("../lib3d/homeLot.js");
const { homeSite, addSiteCollision, removeSiteCollision } = await import("../lib3d/homeSite.js");
const { planScatter } = await import("../lib3d/campuslife/scenery/plan.js");
const { plantingKeepOut, treeKey } = await import("../lib3d/campuslife/decor.js");
const { describeBuildings } = await import("../lib3d/campuslife/describe.js");
const { MAP_LOOK } = await import("../lib3d/mapLook.js");
const { HOME_PLACE } = await import("../lib/travel.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const data = withExtras(read("oau-campus.json")), look = read("oau-campuslife.json"), raw = read("oau-roadgraph.json");
let bad = 0;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
if (MAP_LOOK !== "campuslife" || !data.meta.oldToNew) { console.log("OK   the Campuslife look is not in use on this map: nothing to check"); process.exit(0); }

const plain = buildServices(data, raw), svc = buildServices(data, raw, look), D = svc.graph.campusDecor, W = svc.world;
chk("the decoration is chosen", !!D && !plain.graph.campusDecor && plain.world.decor.length === 0);
chk(`trees (${D.trees.size}), stalls (${D.stalls.length}), banners (${D.banners.length}) and the Main Gate stand`, D.trees.size > 5000 && D.stalls.length > 60 && D.banners.length > 100 && D.gate?.pillars.length >= 2);
const again = buildServices(data, raw, look).graph.campusDecor, text = (d) => JSON.stringify({ ...d, trees: [...d.trees] });
chk("the same map always gives the same decoration", text(D) === text(again));

// solid, and off the road
const solid = W.decor.map((i) => W.polys[i]), mid = (p) => [(p.bb[0] + p.bb[2]) / 2, (p.bb[1] + p.bb[3]) / 2], scratch = {};
chk("every piece is solid", solid.every((p) => W.blockedAt(...mid(p), 0.05)));
const onRoad = solid.filter((p) => p.pts.some(([x, z]) => svc.graph.surfaceAt(x, z, scratch).cls !== 0));
chk("nothing solid stands on a road or its pavement", onRoad.length === 0, `${onRoad.length}: ${onRoad.slice(0, 3).map((p) => p.tag.kind + " " + mid(p).map(Math.round)).join("; ")}`);
const inWall = solid.filter((p) => plain.world.inside(...mid(p)) >= 0);
chk("nothing stands inside a building or water", inWall.length === 0, `${inWall.length}`);

// trees: the same for every device, and exactly the drawn ones
const keys = (o) => new Set(planScatter(data, look, { keepOut: plantingKeepOut(), ...o }).chunks.flatMap((c) => ["tree", "palm"].flatMap((k) => { const a = c.items[k], out = []; for (let i = 0; i < a.length; i += 5) out.push(treeKey(a[i], a[i + 1])); return out; })));
const desk = keys(), phone = keys({ density: 0.6, chunkSize: 500 });
chk("a phone draws the very same trees as a computer", desk.size === phone.size && [...desk].every((k) => phone.has(k)));
chk("every solid tree is one of the drawn trees", [...D.trees].every((k) => desk.has(k)) && D.trees.size === solid.filter((p) => p.tag.kind.startsWith("planted-")).length);

// getting about is unchanged
const placeAt = new Map(); for (const p of data.places) if (p.bid != null && !placeAt.has(p.bid)) placeAt.set(p.bid, p);
const asks = data.buildings.map((b) => placeAt.get(b.id) ?? { id: "bld_" + b.id, bid: b.id });
const moved = asks.filter((a) => JSON.stringify(portalFor(plain, a)) !== JSON.stringify(portalFor(svc, a)));
chk(`every building door is where it was (${asks.length})`, moved.length === 0, moved.slice(0, 5).map((a) => a.id).join(", "));
const lost = []; let walked = 0;
for (let i = 0; i < asks.length; i += 14) {
  const d = destinationOf(plain.net, asks[i]), run = (s) => { const f = s.nav.stand(d.front.x, d.front.z), k = s.nav.stand(d.kerb.x, d.kerb.z); return s.nav.plan(k.x, k.z, f.x, f.z); };
  const p = run(plain); if (!p.ok) continue; walked++; const q = run(svc); if (!q.ok || q.len > p.len * 1.1 + 3) lost.push(asks[i].id);
}
chk(`the walk from the road to a door is as before (${walked} sampled)`, walked > 80 && lost.length === 0, lost.join(", "));
const from = data.places.find((p) => p.id === "sub") ?? data.places[0], changed = [];
for (const to of data.places.filter((p) => p.kind !== "billboard" && !p.offmap && p.id !== from.id)) for (const mode of ["trek", "car"]) {
  const p = planTrip(plain, { from, to, mode }), q = planTrip(svc, { from, to, mode });
  const len = (t) => (!t.ok ? -1 : mode === "trek" ? t.walk.len : t.route.len);
  if (p.ok !== q.ok || (p.ok && len(q) > len(p) * 1.08 + 4)) changed.push(`${to.id} ${mode}`);
}
chk("every trip from the Student Union is still possible, and no longer", changed.length === 0, changed.slice(0, 6).join(", "));

// homes
const cars = [{ id: "a", modelId: "corolla", color: "#c33" }, { id: "b", modelId: "corolla", color: "#36c" }];
let cleared = 0;
for (const h of ["Awo", "Ojaja", "Angola", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"]) {
  const room = R.roomFor(h, "p"), place = data.places.find((p) => p.id === (HOME_PLACE[h] ?? "senate")), tag = h.padEnd(16);
  const a = homeLots(plain, room, place, { limit: 12 }), b = homeLots(svc, room, place, { limit: 12 });
  chk(`${tag} the same home lots as without decoration`, JSON.stringify(a) === JSON.stringify(b));
  const lot = homeLot(svc, room, place, "player-1"), ring = compoundRing(room, lot), site = homeSite(room, [], cars, lot);
  const inYard = (p) => p.tag.pts.some(([x, z]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > z) !== (ring[j][1] > z) && x < ((ring[j][0] - ring[i][0]) * (z - ring[i][1])) / (ring[j][1] - ring[i][1]) + ring[i][0]) c = !c; return c; });
  const restore = W.suspendDecor(inYard); cleared += solid.filter((p) => p.dead).length;
  chk(`${tag} with the yard cleared the lot is bare ground`, lotIsFree(svc, room, lot));
  addSiteCollision(W, site);
  const [door, foot] = [site.spawn.doorStep, site.spawn.footGate];
  chk(`${tag} you can walk from the front door to the footgate`, svc.nav.plan(door.x, door.z, foot.x, foot.z, {}).ok && svc.nav.plan(foot.x, foot.z, door.x, door.z, {}).ok);
  removeSiteCollision(W); restore();
}
chk("leaving a home puts everything back", solid.every((p) => !p.dead) && W.decor.every((i) => { const p = W.polys[i]; return W.E.slice(p.first, p.first + p.count).every((e) => !e.dead); }));
console.log(`     (${cleared} pieces stood in the eight yards checked)`);

// looks
const list = describeBuildings(data, look), senate = data.places.find((p) => p.id === "senate"), tower = list.find((l) => l.id === senate?.bid);
chk("the Senate Building keeps its published height", tower?.tall > 20, `${tower?.tall}`);
const compounds = list.filter((l) => l.fence);
chk(`the hostel compounds are drawn as blocks inside a wall (${compounds.length})`, compounds.length === 3 && compounds.every((c) => list.filter((l) => l.id === c.id).length > 3) && D.doors.length === 3);
chk("every building is still described", new Set(list.map((l) => l.id)).size === data.buildings.length);

console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed");
process.exit(bad ? 1 : 0);
