// tests/home-lot.test.mjs
// The home compound stands on the REAL map: for every accommodation a lot is found beside a real road, the plot lies on bare ground, the vehicle gate opens onto the carriageway, each owned vehicle is parked
// on the lawn or in the garage inside the plot, and people and cars can get from the house and the garage out onto the street, through the same collision world everyone else walks and drives in.
import fs from "node:fs";
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js");
const { withExtras } = await import("../lib3d/mapExtras.js");
const { buildServices } = await import("../lib3d/worldsvc.js");
const { homeLots, homeLot, lotFrame, lotShape, lotIsFree } = await import("../lib3d/homeLot.js");
const { homeSite, homePortal, addSiteCollision, removeSiteCollision, onSite } = await import("../lib3d/homeSite.js");
const { exitRoute, planParking } = await import("../lib3d/compoundParking.js");
const { CELL_M } = await import("../lib3d/compoundUnits.js");
const { HOME_PLACE } = await import("../lib/travel.js");

const read = (f) => JSON.parse(fs.readFileSync(new URL(`../public/data/${f}`, import.meta.url), "utf8"));
const data = withExtras(read("oau-campus.json")), svc = buildServices(data, read("oau-roadgraph.json"));
let bad = 0;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };

const HOMES = [["Awo", 9], ["Ojaja", 9], ["Angola", 9], ["Off-campus", 9], ["1-Bedroom Flat", 9], ["2-Bedroom Flat", 9], ["3-Bedroom House", 9], ["4-Bedroom House", 9]];
const placeOf = (h) => data.places.find((p) => p.id === (HOME_PLACE[h] ?? "senate"));
const cars = [{ id: "a", modelId: "corolla", color: "#c33" }, { id: "b", modelId: "corolla", color: "#36c" }, { id: "c", modelId: "corolla", color: "#3a3" }];
const scratch = {};

for (const [h] of HOMES) {
  const room = R.roomFor(h, "p"), place = placeOf(h), tag = h.padEnd(16);
  const list = homeLots(svc, room, place, { limit: 12 }), again = homeLots(svc, room, place, { limit: 12 });
  chk(`${tag} finds lots beside real roads (${list.length})`, list.length >= 4);
  chk(`${tag} the same data always gives the same lots`, JSON.stringify(list) === JSON.stringify(again));
  const a = homeLot(svc, room, place, "player-1"), b = homeLot(svc, room, place, "player-1"), others = new Set(["p1", "p2", "p3", "p4", "p5", "p6"].map((s) => { const l = homeLot(svc, room, place, s); return `${l.x.toFixed(1)},${l.z.toFixed(1)}`; }));
  chk(`${tag} one player always gets the same lot; players are spread over several`, a === b && others.size >= 3, `distinct=${others.size}`);
  const lot = a, { P } = lotShape(room), F = lotFrame(room, lot), site = homeSite(room, [], cars, lot);
  chk(`${tag} the lot is bare ground (no road, building, water or tree)`, lotIsFree(svc, room, lot));
  // the frame: a rotation (not a mirror), 1 cell = 0.9 m, the gate's middle is on the road edge, and the three.js group transform agrees with it
  const [x0, z0] = F.toWorld(10, 10), [x1, z1] = F.toWorld(11, 10), [x2, z2] = F.toWorld(10, 11);
  const ux = [x1 - x0, z1 - z0], uz = [x2 - x0, z2 - z0], det = ux[0] * uz[1] - ux[1] * uz[0];
  chk(`${tag} the frame is a rotation at 0.9 m a cell`, Math.abs(Math.hypot(...ux) - CELL_M) < 1e-9 && Math.abs(Math.hypot(...uz) - CELL_M) < 1e-9 && Math.abs(det - CELL_M * CELL_M) < 1e-9);
  const g = F.group, c = Math.cos(g.rotY), s = Math.sin(g.rotY), lx = (13 - room.w / 2) * CELL_M, lz = (7 - room.d / 2) * CELL_M, [wx, wz] = F.toWorld(13, 7);
  chk(`${tag} the group transform puts a cell where the frame says`, Math.abs(g.x + lx * c + lz * s - wx) < 1e-6 && Math.abs(g.z - lx * s + lz * c - wz) < 1e-6);
  const [gx, gz] = F.toWorld(P.doorC, P.kerb), roadward = [gx + lot.dx * 1.2, gz + lot.dz * 1.2], farther = [gx - lot.dx * 1.2, gz - lot.dz * 1.2];
  chk(`${tag} the vehicle gate opens straight onto the carriageway (asphalt just beyond the kerb, none just inside)`, svc.graph.surfaceAt(roadward[0], roadward[1], scratch).cls === 1 && svc.graph.surfaceAt(farther[0], farther[1], scratch).cls !== 1);
  // every vehicle is parked inside the plot, clear of the house, garage and each other, and has a drive out
  const park = planParking(room, cars, []).slots, n = park.length;
  chk(`${tag} every owned vehicle has a place (${n} of ${cars.length})`, n === cars.length);
  chk(`${tag} every parked vehicle is inside the plot`, site.slots.every((p) => onSite(site, p.x, p.z)));
  const withHome = (fn) => { addSiteCollision(svc.world, site); try { return fn(); } finally { removeSiteCollision(svc.world); } };
  chk(`${tag} no parked vehicle is inside anything solid`, withHome(() => site.slots.every((p) => !svc.world.boxBlocked(p.x, p.z, p.hx, p.hz, p.len / 2 - 0.1, p.wid / 2 - 0.1, 0))));
  // people: from the doorstep to the footgate and out onto the pavement/road, planned through the real world with the compound's walls in it
  const out = withHome(() => {
    const walk = (from, to) => svc.nav.plan(from.x, from.z, to.x, to.z, {});
    const door = site.spawn.doorStep, foot = site.spawn.footGate, [sx, sz] = F.toWorld((P.footGate.x0 + P.footGate.x1) / 2, P.kerb + 1.5);
    const r1 = walk(door, foot), r2 = walk(foot, { x: sx, z: sz }), r3 = walk({ x: sx, z: sz }, door);
    return { ok: r1.ok && r2.ok && r3.ok, why: [r1.reason, r2.reason, r3.reason].filter(Boolean).join(",") };
  });
  chk(`${tag} a person can walk from the front door to the footgate and the pavement, and back`, out.ok, out.why);
  chk(`${tag} the fence is closed everywhere except the two gates (a person cannot walk through the wall)`, withHome(() => {
    const [bx, bz] = F.toWorld(P.plot.x0 + 3, P.plot.z0 + 8), [ex, ez] = F.toWorld(P.plot.x0 - 3, P.plot.z0 + 8); return !svc.world.segmentClear(bx, bz, ex, ez, 0.3, { bodies: false });
  }));
  chk(`${tag} the front door is on the house's outer face, faces out of it, and the spot outside it is clear to stand on`, withHome(() => {
    const po = homePortal(room, site), d = po.door, h = site.polys.find((q) => q.kind === "house").pts, xs = h.map((q) => q[0]), zs = h.map((q) => q[1]);
    const inside = (x, z) => { let c = false; for (let i = 0, j = h.length - 1; i < h.length; j = i++) if ((h[i][1] > z) !== (h[j][1] > z) && x < ((h[j][0] - h[i][0]) * (z - h[i][1])) / (h[j][1] - h[i][1]) + h[i][0]) c = !c; return c; };
    return xs.length === 4 && zs.length === 4 && !inside(d.x + d.nx * 0.3, d.z + d.nz * 0.3) && inside(d.x - d.nx * 0.3, d.z - d.nz * 0.3) && !svc.world.blockedAt(po.exit.x, po.exit.z, 0.4);
  }));
  // cars: each vehicle's route out of the gate, in cells, converts to world poses that are all clear of solids and on drivable ground (the lawn, driveway, gate) or the real road
  const cw = site.cw, res = withHome(() => park.map((slot) => {
    const route = exitRoute(cw, park, slot); if (!route) return { ok: false, why: "no route" };
    const pts = route.map((p) => F.toWorld(Array.isArray(p) ? p[0] : p.x, Array.isArray(p) ? p[1] : p.z)), badAt = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, z] = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], hl = slot.len / 2 * CELL_M, hw = slot.wid / 2 * CELL_M; let hx = q[0] - x, hz = q[1] - z; const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
      const probes = [-hl, 0, hl].flatMap((u) => [-hw, 0, hw].map((w) => [x + hx * u - hz * w, z + hz * u + hx * w]));
      if (!probes.every(([px, pz]) => svc.graph.surfaceAt(px, pz, scratch).cls === 1 || site.drivable(px, pz))) badAt.push(`off ground @${i}`);
      const others = site.slots.filter((o) => "park:" + o.id !== "park:" + slot.id);
      if (svc.world.boxBlocked(x, z, hx, hz, hl, hw, 0.02) && !others.some(() => false)) { badAt.push(`blocked @${i}`); }
    }
    return { ok: badAt.length === 0, why: badAt.slice(0, 2).join(";") };
  }));
  chk(`${tag} every vehicle can drive out of the gate onto the real carriageway (${res.filter((r) => r.ok).length}/${res.length})`, res.every((r) => r.ok), res.find((r) => !r.ok)?.why);
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll checks passed"); process.exit(bad ? 1 : 0);
