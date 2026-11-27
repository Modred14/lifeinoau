// tests/home-activities.test.mjs
// The home's activities (lib/homeActivities.js) on real, furnished homes standing on the real map: every home offers what its furniture offers and says why the rest is unavailable; for every
// available activity there is a spot where a person FITS, the walk there is possible from the front door, and the body lands on the piece (the bed under the sleeper, the seat under the sitter).
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const F = await import("../lib/furniture.js");
const H = await import("../lib/homeActivities.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { homeLot } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, addSiteCollision, removeSiteCollision, indoorSpawn } = await import("../lib3d/homeSite.js");
const { WALK_R } = await import("../lib3d/walker.js");
const { createIndoorRouter } = await import("../lib3d/homeRoute.js");
const { HOME_PLACE } = await import("../lib/travel.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places;
let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };

/** The home as the server furnishes it: the starter pieces, each put where autoPlace puts it. */
function furnish(hostel) {
  const room = R.roomFor(hostel, "p"), items = []; let id = 1;
  for (const [key, zone] of F.starterPlan(hostel)) { const s = R.autoPlace(room, items, key, zone); items.push({ id: id++, key, placed: !!s, x: s?.x ?? null, z: s?.z ?? null, rot: s?.rot ?? 0 }); }
  return { room, items };
}

// ---- the table itself
chk("every activity has a category, a clip, a spot kind and a time", H.ACTIVITY_IDS.every((id) => { const a = H.ACTIVITIES[id]; return H.CATEGORIES.some((c) => c.id === a.cat) && a.clip && a.spot && a.secs > 0 && a.hosts.length; }));
chk("every host piece exists in the furniture catalogue", H.ACTIVITY_IDS.every((id) => H.ACTIVITIES[id].hosts.every((k) => F.ITEMS[k])), H.ACTIVITY_IDS.filter((id) => H.ACTIVITIES[id].hosts.some((k) => !F.ITEMS[k])).join());
chk("every host offers a spot of the kind its activity needs", H.ACTIVITY_IDS.every((id) => H.ACTIVITIES[id].hosts.filter((k) => !H.spotsOf(k)[H.ACTIVITIES[id].spot]?.length).length === 0), H.ACTIVITY_IDS.map((id) => id + ":" + H.ACTIVITIES[id].hosts.filter((k) => !H.spotsOf(k)[H.ACTIVITIES[id].spot]?.length)).filter((s) => !s.endsWith(":")).join(" "));
chk("tapping the bed offers sleep, the cooker cooking, the television watching it, the desk reading", H.activitiesFor("single_bed").includes("sleep") && H.activitiesFor("gas_cooker").includes("cook") && H.activitiesFor("tv").includes("tv") && H.activitiesFor("desk").includes("read"));
{ // frames: a piece turned a quarter-turn has its front where the scene draws it
  const it = { key: "sofa", x: 3, z: 4, rot: 1 }, f = H.frameOf(it); const [fx, fz] = f.dir(0, 1);
  chk("a piece turned one quarter-turn faces -x (the scene turns its model by -rot quarter turns)", Math.abs(fx + 1) < 1e-9 && Math.abs(fz) < 1e-9, `${fx},${fz}`);
}

for (const hostel of ["Awo", "Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"]) {
  const { room, items } = furnish(hostel), tag = hostel.padEnd(16), place = places.find((p) => p.id === (HOME_PLACE[hostel] ?? "senate")) ?? places.find((p) => p.id === "senate");
  const lot = homeLot(svc, room, place, "interior"), site = homeSite(room, items, [], lot, { interior: true }), portal = homePortal(room, site), env = { toWorld: (x, z) => site.F.toWorld(x, z), dirOf: (x, z) => site.dirOf(x, z) };
  addSiteCollision(svc.world, site);
  const spawn = indoorSpawn(portal), router = createIndoorRouter(site, room, items, svc.world), fits = (x, z) => !svc.world.blockedAt(x, z, WALK_R + 0.04) && !!router.route(spawn, { x, z });
  const ctx = { energy: 40, meals: 1 }, list = H.listActivities({ items, room, ctx }), by = Object.fromEntries(list.map((a) => [a.id, a]));
  chk(`${tag} every listed activity is available, or says why not`, list.every((a) => a.available || (typeof a.why === "string" && a.why.length > 3)));
  const keys = new Set(items.map((i) => i.key)), wants = { sleep: [...keys].some((k) => H.ACTIVITIES.sleep.hosts.includes(k)), cook: keys.has("gas_cooker"), shower: keys.has("ensuite"), toilet: keys.has("ensuite") || keys.has("toilet"), tv: keys.has("tv") && [...keys].some((k) => H.ACTIVITIES.tv.hosts.includes(k)), meditate: keys.has("rug"), eat: keys.has("dining_set") };
  for (const [id, want] of Object.entries(wants)) chk(`${tag} ${id} is ${want ? "offered" : "unavailable"} because the home ${want ? "has" : "lacks"} the furniture`, by[id].available === want, `${by[id].available} ${by[id].why}`);
  chk(`${tag} nothing at all is offered while in custody or asleep`, H.listActivities({ items, room, ctx: { ...ctx, jailed: true } }).every((a) => !a.available) && H.listActivities({ items, room, ctx: { ...ctx, sleeping: true } }).every((a) => !a.available));
  chk(`${tag} a rested person is not offered sleep`, !H.listActivities({ items, room, ctx: { energy: 100 } }).find((a) => a.id === "sleep").available);

  for (const a of list.filter((x) => x.available)) {
    const taken = [], spot = H.chooseSpot(a.id, { items, room, from: spawn, env, free: fits, taken });
    chk(`${tag} ${a.id}: a spot is found`, !!spot && !spot.why, spot?.why);
    if (!spot || spot.why) continue;
    chk(`${tag} ${a.id}: where the walk ends a person fits, inside the house`, fits(spot.stand.x, spot.stand.z) && site.insideHouse(spot.stand.x, spot.stand.z), `${spot.stand.x.toFixed(1)},${spot.stand.z.toFixed(1)}`);
    const route = router.route(spawn, spot.stand);
    chk(`${tag} ${a.id}: it can be walked to from the front door`, !!route && route.length > 1);
    chk(`${tag} ${a.id}: the walk never passes through a wall or a piece of furniture`, !!route && route.every((p, i) => i === 0 || svc.world.segmentClear(route[i - 1][0], route[i - 1][1], p[0], p[1], WALK_R - 0.05, { bodies: false })));
    const reach = Math.hypot(spot.at.x - spot.stand.x, spot.at.z - spot.stand.z);
    chk(`${tag} ${a.id}: the body ends ${reach.toFixed(2)} m from where the walk ended (a step, not a jump)`, reach < 1.6);
    const host = spot.item, [w, d] = F.sizeOf(host.key, host.rot ?? 0), [cx, cz] = env.toWorld(host.x + w / 2, host.z + d / 2);
    chk(`${tag} ${a.id}: the body ends over the piece it uses (${host.key})`, spot.kind === "stand" || spot.kind === "cook" || spot.kind === "basin" || spot.kind === "shower" || Math.hypot(spot.at.x - cx, spot.at.z - cz) < Math.max(w, d) * 0.9 + 0.4);
    if (spot.kind === "lie") chk(`${tag} sleep: the sleeper lies at mattress height (${spot.y.toFixed(2)} m)`, spot.y > 0.35 && spot.y < 0.7);
    if (spot.kind === "seat" || spot.kind === "dine" || spot.kind === "toilet") chk(`${tag} ${a.id}: the seat is at a seat's height (${spot.y.toFixed(2)} m)`, spot.y > 0.2 && spot.y < 0.6);
  }
  // two people never take the same seat
  const t1 = H.chooseSpot("nap", { items, room, from: spawn, env, free: fits }); if (t1?.key) { const t2 = H.chooseSpot("nap", { items, room, from: spawn, env, free: fits, taken: [t1.key] }); chk(`${tag} a seat that is taken is not chosen again`, !t2?.key || t2.key !== t1.key); }
  removeSiteCollision(svc.world);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);

// ---- the panel only offers what the home actually has ----
{
  const { listActivities } = await import("../lib/homeActivities.js"), { roomFor } = await import("../lib/room.js");
  const room = roomFor("Awo", "p"), none = listActivities({ items: [], room, ctx: {} });
  console.log(none.every((a) => a.present === false) ? "OK   an empty hostel offers no activity at all (no shower, toilet, cooker or table is invented)" : "FAIL an empty hostel offers activities: " + none.filter((a) => a.present).map((a) => a.id));
  if (!none.every((a) => a.present === false)) process.exitCode = 1;
  const bed = [{ id: "b1", key: "single_bed", x: 2, z: 2, rot: 0, placed: true }], withBed = listActivities({ items: bed, room, ctx: { energy: 10 } }).filter((a) => a.present).map((a) => a.id);
  const ok = withBed.join() === "sleep"; console.log(ok ? "OK   placing a bed makes Sleep appear, and nothing else" : "FAIL a bed offers " + withBed); if (!ok) process.exitCode = 1;
}
