// tests/home-interior.test.mjs
// The home as a place you walk about in, on the map's own lot: with `interior` the house is four real walls with a doorway in the front one (not one solid block), what stands indoors is solid,
// and a person who starts just inside the front door can walk out through the doorway onto the lot, walk back in, and never through a wall. Run for a hall and every private home.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { planTrip } = await import("../lib3d/tripplan.js");
const { createTripFlow } = await import("../lib3d/tripflow.js");
const { createTrafficSim } = await import("../lib3d/trafficsim.js");
const { homeLot } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, homeBuilding, addSiteCollision, removeSiteCollision, indoorSpawn } = await import("../lib3d/homeSite.js");
const { HOME_PLACE } = await import("../lib/travel.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places;
let bad = 0, seed = 5; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };

for (const hostel of ["Awo", "Ojaja", "Off-campus", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].filter((h) => !process.env.ONLY || h === process.env.ONLY)) {
  const room = R.roomFor(hostel, "p"), place = places.find((p) => p.id === (HOME_PLACE[hostel] ?? "senate")), tag = hostel.padEnd(16);
  const lot = homeLot(svc, room, place, "interior"), solid = homeSite(room, [], [], lot), site = homeSite(room, [], [], lot, { interior: true }), portal = homePortal(room, site), spawn = indoorSpawn(portal);
  chk(`${tag} the solid house is one block; the walkable house has no house block, but walls`, solid.polys.some((p) => p.kind === "house") && !site.polys.some((p) => p.kind === "house") && site.walls.length >= solid.walls.length + 5, `${site.walls.length} vs ${solid.walls.length}`);
  chk(`${tag} the door is still the house's door (the trip logic still sees one building)`, homeBuilding(site, portal).building.pts.length === 4);
  chk(`${tag} a person starts inside the house, looking in (away from the street)`, site.insideHouse(spawn.x, spawn.z) && spawn.hx * portal.door.nx + spawn.hz * portal.door.nz < -0.99);
  const out = { x: portal.exit.x, z: portal.exit.z }; chk(`${tag} the doorstep outside is not inside the house`, !site.insideHouse(out.x, out.z));

  addSiteCollision(svc.world, site);
  const base = planTrip(svc, { from: place, to: place, mode: "trek", driver: false });
  const plan = { ...base, B: homeBuilding(site, portal), goal: out, start: out };
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => place, rnd });
  const mk = (pose) => createTripFlow({ svc, sim }, { plan, enterable: false, free: true, drivable: site.drivable, roam: portal, roamPose: pose, rnd, onArrive: () => true, onEnter() {}, onEnd() {}, onNotice() {} });
  const run = (flow, dx, dz, secs) => { for (let i = 0; i < secs * 30; i++) { flow.update(1 / 30, { dx, dz, mag: 1 }); sim.update(1 / 30); } };

  let flow = mk(spawn), wk = flow.walker;
  chk(`${tag} the trip starts on foot inside the house`, flow.state.phase === "roam" && site.insideHouse(wk.x, wk.z));
  run(flow, portal.door.nx, portal.door.nz, 6);   // push straight out of the door
  chk(`${tag} walking out of the doorway reaches the yard (${Math.hypot(wk.x - spawn.x, wk.z - spawn.z).toFixed(1)} m)`, !site.insideHouse(wk.x, wk.z) && flow.state.phase === "roam");
  run(flow, -portal.door.nx, -portal.door.nz, 6);  // and straight back in
  chk(`${tag} and back in through the same doorway`, site.insideHouse(wk.x, wk.z) && flow.state.phase === "roam");
  flow.dispose();

  // never through a wall: from the spawn push in each of the four directions for a long time; if the person ever leaves the house it must be by the doorway (the front wall's side)
  let leaks = 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = portal.door.nx * dx + portal.door.nz * dz; if (n > 0.5) continue; // towards the street: that is the doorway, tested above
    flow = mk(spawn); wk = flow.walker; run(flow, dx, dz, 12); if (!site.insideHouse(wk.x, wk.z)) leaks++; flow.dispose();
  }
  chk(`${tag} the other walls hold: nobody walks through them`, leaks === 0, `${leaks} leaks`);
  removeSiteCollision(svc.world);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
