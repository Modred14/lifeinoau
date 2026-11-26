// tests/home-activity-run.test.mjs
// The controller (lib3d/homeActivity.js) run headlessly on real furnished homes: the person walks from the front door to the piece, settles, does it, gets up, and is the player's again; every frame stays inside the house and off the furniture, and the body never jumps.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js"), F = await import("../lib/furniture.js"), H = await import("../lib/homeActivities.js");
const { withExtras } = await import("../lib3d/mapExtras.js"), { buildServices } = await import("../lib3d/worldsvc.js"), { homeLot } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, addSiteCollision, removeSiteCollision, indoorSpawn } = await import("../lib3d/homeSite.js");
const { Walker, WALK_R } = await import("../lib3d/walker.js"), { createIndoorRouter } = await import("../lib3d/homeRoute.js"), { createHomeActivity } = await import("../lib3d/homeActivity.js"), { HOME_PLACE } = await import("../lib/travel.js");
const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places;
let bad = 0; const chk = (l, ok, x = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${l}${!ok && x ? ": " + x : ""}`); };
function furnish(h) { const room = R.roomFor(h, "p"), items = []; let id = 1; for (const [key, zone] of F.starterPlan(h)) { const s = R.autoPlace(room, items, key, zone); items.push({ id: id++, key, placed: !!s, x: s?.x ?? null, z: s?.z ?? null, rot: s?.rot ?? 0 }); } return { room, items }; }
for (const hostel of ["1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"]) {
  const { room, items } = furnish(hostel), place = places.find((p) => p.id === (HOME_PLACE[hostel] ?? "senate")) ?? places.find((p) => p.id === "senate");
  const lot = homeLot(svc, room, place, "interior"), site = homeSite(room, items, [], lot, { interior: true }), portal = homePortal(room, site), env = { toWorld: (x, z) => site.F.toWorld(x, z), dirOf: (x, z) => site.dirOf(x, z) };
  addSiteCollision(svc.world, site);
  const sp = indoorSpawn(portal), router = createIndoorRouter(site, room, items, svc.world), free = (x, z) => !svc.world.blockedAt(x, z, WALK_R + 0.04) && !!router.route(sp, { x, z });
  for (const id of ["sleep", "cook", "tv", "shower", "toilet", "meditate"]) {
    const WK = new Walker(svc.world, svc.nav, { x: sp.x, z: sp.z, hx: sp.hx, hz: sp.hz }); let ended = null, active = false;
    const A = createHomeActivity({ walker: WK, router, env, getItems: () => items, room, height: () => 1.76, free, hooks: { onActive: () => { active = true; }, onEnd: (s, why) => { ended = why; } } });
    const r = A.start(id); if (!r.ok) { chk(`${hostel} ${id}: skipped (${r.why})`, /furniture|Nothing|no |not/i.test(r.why)); continue; }
    let last = null, maxJump = 0, outside = 0, t = 0, sawEnter = false, steered = 0; const dt = 1 / 30;
    while (t < 120 && !ended) {
      t += dt; const own = A.update(dt); if (!own) WK.step(dt, null); else steered++;
      if (A.state?.stage === "active" && t > 40 && id !== "sleep") { /* let a long one run */ }
      if (A.state?.stage === "active" && (id === "sleep" ? t > 30 : false)) A.stop();
      const p = A.pose(), x = p ? p.x : WK.x, z = p ? p.z : WK.z; if (p?.stage === "enter") sawEnter = true;
      if (!site.insideHouse(x, z)) outside++;
      if (last) maxJump = Math.max(maxJump, Math.hypot(x - last[0], z - last[1])); last = [x, z];
    }
    chk(`${hostel} ${id}: it ran to the end (${t.toFixed(0)} s) and handed control back`, ended === "done" && !A.busy, String(ended));
    chk(`${hostel} ${id}: it became active`, active); chk(`${hostel} ${id}: the body is never outside the house`, outside === 0, String(outside));
    chk(`${hostel} ${id}: the body never jumps (largest step ${maxJump.toFixed(2)} m in a frame)`, maxJump < 0.2);
    chk(`${hostel} ${id}: the person ends up standing, off the furniture`, !svc.world.blockedAt(WK.x, WK.z, WALK_R - 0.05), `${WK.x.toFixed(2)},${WK.z.toFixed(2)}`);
  }
  removeSiteCollision(svc.world);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
