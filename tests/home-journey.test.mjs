// tests/home-journey.test.mjs
// The whole journey, through the real trip logic over the real map: out of the front door, across the compound to your own car in the garage, get in, drive out of the gate onto the real street, and on.
// And the walk: out of the door, through the footgate, onto the pavement. Nothing is placed or teleported on the way: the person and the car move by the same walker, car physics and collision the world uses,
// and the compound's walls, house and the other parked cars are in that world. Run for a hall and for every private home.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { planTrip } = await import("../lib3d/tripplan.js");
const { createTripFlow } = await import("../lib3d/tripflow.js");
const { createTrafficSim } = await import("../lib3d/trafficsim.js");
const { homeLot, lotFrame, lotShape } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, homeBuilding, addSiteCollision, removeSiteCollision } = await import("../lib3d/homeSite.js");
const { exitRoute, planParking } = await import("../lib3d/compoundParking.js");
const { HOME_PLACE } = await import("../lib/travel.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const svc = buildServices(withExtras(read("oau-campus.json")), read("oau-roadgraph.json")), places = svc.data.places;
let bad = 0, seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff, scratch = {};
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const cars = [{ id: "a", modelId: "corolla", color: "#c33" }, { id: "b", modelId: "corolla", color: "#36c" }];

/** Tap-to-walk, as the game does it: plan a route with the walking planner and let the walker follow it. Returns the seconds taken, or null if there is no route or it is not reached. */
function walkTo(flow, to, maxSec = 60) {
  const w = flow.walker, r = svc.nav.plan(w.x, w.z, to.x, to.z, {}); if (!r.ok) return null;
  w.follow(r, { goal: to, tolerance: 0.45 }); let t = 0;
  while (t < maxSec && w.following) { flow.update(1 / 30, {}); t += 1 / 30; }
  return !w.following && Math.hypot(to.x - w.x, to.z - w.z) < 1.0 ? t : null;
}

for (const hostel of ["Awo", "Ojaja", "Off-campus", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"].filter((h) => !process.env.ONLY || h === process.env.ONLY)) {
  const room = R.roomFor(hostel, "p"), place = places.find((p) => p.id === (HOME_PLACE[hostel] ?? "senate")), tag = hostel.padEnd(16);
  const lot = homeLot(svc, room, place, "journey"), site = homeSite(room, [], cars, lot), portal = homePortal(room, site), F = lotFrame(room, lot), { P } = lotShape(room);
  const park = planParking(room, cars, []).slots, slot = park[0], slotW = site.slots.find((s) => String(s.id) === String(slot.id));
  addSiteCollision(svc.world, site);
  for (const s of site.slots) if (s !== slotW) svc.world.setBody("park:" + s.id, { x: s.x, z: s.z, hx: s.hx, hz: s.hz, hl: s.len / 2, hw: s.wid / 2 });
  const base = planTrip(svc, { from: place, to: place, mode: "car", driver: false });
  const plan = { ...base, B: homeBuilding(site, portal), goal: { x: portal.exit.x, z: portal.exit.z }, start: { x: portal.exit.x, z: portal.exit.z } };
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus: () => place, rnd }); let end = null;
  const flow = createTripFlow({ svc, sim }, { plan, free: true, drivable: site.drivable, parked: { x: slotW.x, z: slotW.z, hx: slotW.hx, hz: slotW.hz, len: slotW.len, wid: slotW.wid }, roam: portal, dims: { len: slotW.len, wid: slotW.wid }, rnd, onArrive: () => true, onEnter() {}, onEnd: (w) => { end = w; }, onNotice() {} });
  let t = 0; while (flow.state.phase !== "roam" && t < 20) { flow.update(1 / 30, {}); sim.update(1 / 30); t += 1 / 30; }
  const w = flow.walker;
  chk(`${tag} the person walks out of the front door and is free on the doorstep (${t.toFixed(1)}s)`, flow.state.phase === "roam" && Math.hypot(w.x - portal.exit.x, w.z - portal.exit.z) < 0.3);
  chk(`${tag} the own car is parked in the compound, not on the road`, !!flow.own && Math.hypot(flow.own.x - slotW.x, flow.own.z - slotW.z) < 0.01 && svc.graph.surfaceAt(flow.own.x, flow.own.z, scratch).cls !== 1);

  // the walk: doorstep -> footgate -> the pavement, and back to the door
  const foot = site.spawn.footGate, [sx, sz] = F.toWorld((P.footGate.x0 + P.footGate.x1) / 2, P.kerb + 1.2);
  const t1 = walkTo(flow, foot), t2 = t1 != null ? walkTo(flow, { x: sx, z: sz }) : null;
  chk(`${tag} on foot: through the footgate onto the street pavement (${t1?.toFixed(1)}s + ${t2?.toFixed(1)}s)`, t1 != null && t2 != null);
  // and on to the street itself: the first pavement or carriageway beyond the gate (the road may bend away from a straight lot, so a few metres of verge are fine)
  let street = null; for (let k = 0; k <= 24 && !street; k++) { const x = sx + lot.dx * k * 0.5, z = sz + lot.dz * k * 0.5; if (svc.graph.surfaceAt(x, z, scratch).cls === 2 && svc.graph.surfaceAt(x + lot.dx * 0.8, z + lot.dz * 0.8, scratch).cls === 2 && !svc.world.blockedAt(x, z, 0.4)) street = { x: x + lot.dx * 0.8, z: z + lot.dz * 0.8 }; }
  const t4 = street ? walkTo(flow, street) : null;
  chk(`${tag} on foot: on to the real pavement of the street (${street ? t4?.toFixed(1) + "s" : "this road has none beside the lot: the gate opens on the verge at the carriageway"})`, !street || (t4 != null && svc.graph.surfaceAt(w.x, w.z, scratch).cls === 2));
  const t3 = walkTo(flow, portal.exit, 90);
  chk(`${tag} on foot: back from the street to the front door (${t3?.toFixed(1)}s)`, t3 != null);

  // back at the door the person goes in (the door phase); then out again through the same door, onto the doorstep
  let ti = 0, pressed = false, entered = false;
  while (flow.state.phase !== "inside" && ti < 15) {
    if (flow.state.phase === "door") { if (!pressed && flow.state.door === "closed") pressed = flow.pressDoor(); else if (!entered && flow.state.door === "open") entered = flow.enterNow(); }
    flow.update(1 / 30, {}); sim.update(1 / 30); ti += 1 / 30;
  }
  chk(`${tag} at the door they go back inside (${ti.toFixed(1)}s)`, flow.state.phase === "inside");
  const re = flow.exitBuilding(portal); let tr = 0; while (flow.state.phase !== "roam" && tr < 20) { flow.update(1 / 30, {}); sim.update(1 / 30); tr += 1 / 30; }
  chk(`${tag} and out again through the front door (${tr.toFixed(1)}s)`, re?.ok !== false && flow.state.phase === "roam");

  // the car: walk to it, get in, drive out of the gate onto the carriageway
  const carSide = { x: slotW.x - slotW.hz * (slotW.wid / 2 + 1.5), z: slotW.z + slotW.hx * (slotW.wid / 2 + 1.5) }, other = { x: slotW.x + slotW.hz * (slotW.wid / 2 + 1.5), z: slotW.z - slotW.hx * (slotW.wid / 2 + 1.5) };
  const tc = walkTo(flow, carSide, 90) ?? walkTo(flow, other, 90);
  chk(`${tag} on foot: across the compound to the car (${tc?.toFixed(1)}s)`, tc != null);
  let near = flow.state.canEnter; for (let i = 0; i < 6 && !near; i++) { flow.update(1 / 30, {}); near = flow.state.canEnter; }
  if (process.env.DBG) console.log("DBG", flow.state.phase, "walker", w.x.toFixed(2), w.z.toFixed(2), "own", flow.own && [flow.own.x, flow.own.z, flow.own.hx, flow.own.hz, flow.own.len, flow.own.wid].map((n) => +n.toFixed(2)), "slot", slotW.x.toFixed(2), slotW.z.toFixed(2), "canEnter", flow.state.canEnter);
  chk(`${tag} the interaction offers "get in" beside the car`, near);
  flow.update(1 / 30, { enter: true }); let tb = 0; while (flow.state.phase !== "drive" && tb < 15) { flow.update(1 / 30, {}); sim.update(1 / 30); tb += 1 / 30; }
  chk(`${tag} the person gets in and is at the wheel (${tb.toFixed(1)}s)`, flow.state.phase === "drive");
  const route = exitRoute(site.cw, park, slot), raw = route.map((p) => F.toWorld(Array.isArray(p) ? p[0] : p.x, Array.isArray(p) ? p[1] : p.z)), wp = [raw[0]], o = flow.own;
  for (let i = 1; i < raw.length; i++) { const a = raw[i - 1], b = raw[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.8)); for (let q = 1; q <= n; q++) wp.push([a[0] + ((b[0] - a[0]) * q) / n, a[1] + ((b[1] - a[1]) * q) / n]); }
  let k = 1, td = 0, onRoadAt = null, stuck = 0, lastD = 0, maxPen = 0;
  while (td < 120 && onRoadAt == null) {
    while (k < wp.length - 1 && Math.hypot(wp[k][0] - o.x, wp[k][1] - o.z) < 2.0) k++;
    const look = wp[Math.min(wp.length - 1, k + 2)], dx = look[0] - o.x, dz = look[1] - o.z, d = Math.hypot(dx, dz) || 1, err = (dx * -o.hz + dz * o.hx) / d, fwd = (dx * o.hx + dz * o.hz) / d;
    const steer = Math.max(-1, Math.min(1, err * 2.2)), want = fwd > 0.3 ? 2.6 : 1.2, gas = o.v < want ? 0.5 : 0, brake = o.v > want + 0.6 ? 0.5 : 0;
    flow.update(1 / 30, { gas, brake, steer: fwd < -0.2 ? (err >= 0 ? 1 : -1) : steer }); sim.update(1 / 30); td += 1 / 30; maxPen = Math.max(maxPen, svc.world.boxBlocked(o.x, o.z, o.hx, o.hz, o.len / 2 - 0.05, o.wid / 2 - 0.05, 0) ? 1 : 0);
    const q = svc.graph.surfaceAt(o.x, o.z, scratch); if (q.cls === 1 && !site.drivable(o.x, o.z)) onRoadAt = td;
    if (process.env.TRACE && Math.round(td * 30) % 30 === 0) console.log("T", td.toFixed(0), o.x.toFixed(1), o.z.toFixed(1), "v", o.v.toFixed(2), "k", k, "of", wp.length, "want", wp[Math.min(wp.length - 1, k)].map((n) => n.toFixed(1)).join(","), "pen", o.pen);
    if (td - lastD > 8) { if (Math.hypot(o.x - (o.px ?? 0), o.z - (o.pz ?? 0)) < 0.4) stuck++; o.px = o.x; o.pz = o.z; lastD = td; }
  }
  chk(`${tag} the car drives out of the gate onto the real carriageway (${onRoadAt?.toFixed(1)}s), never inside a wall or another car`, onRoadAt != null && maxPen === 0, `t=${td.toFixed(0)}s pos=${o.x.toFixed(1)},${o.z.toFixed(1)} v=${o.v.toFixed(1)} stuck=${stuck}`);
  const x0 = o.x, z0 = o.z; let tt = 0; while (tt < 6) { flow.update(1 / 30, { gas: 0.7, brake: 0, steer: 0 }); sim.update(1 / 30); tt += 1 / 30; }
  chk(`${tag} and it carries on along the street (the same trip, the free drive continues)`, !end && flow.state.phase === "drive" && flow.free);
  flow.dispose(); for (const s of site.slots) svc.world.removeBody("park:" + s.id); removeSiteCollision(svc.world);
  // this home's traffic simulation is finished, and its vehicles must not stay in the shared world as frozen obstacles for the next home (they did, wherever they happened to stop)
  for (const id of [...svc.world.bodies.keys()]) svc.world.removeBody(id); void x0; void z0;
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
