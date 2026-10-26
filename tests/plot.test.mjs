// tests/plot.test.mjs
// The residential plot: a square compound with the house, a garage, a paved driveway to the road, a footpath, and a lawn where the owner's outdoor things move.
import { register } from "node:module";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const { ITEMS, isOutdoor, sizeOf } = await import("../lib/furniture.js");
const R = await import("../lib/room.js");
const P = await import("../lib/plot.js");
const service = await import("../lib/roomService.js");
const { GameError } = await import("./fixtures/room-gameService-stub.mjs");
let bad = 0;
const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const refused = async (promise, status) => { try { await promise; return false; } catch (e) { return e instanceof GameError && e.status === status; } };
const HOMES = ["Awo", "Angola", "Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"];
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0, inside = (r, x, z) => x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && z >= r.z0 - 1e-9 && z <= r.z1 + 1e-9;
const touches = (a, b) => a.x0 <= b.x1 + 1e-9 && a.x1 >= b.x0 - 1e-9 && a.z0 <= b.z1 + 1e-9 && a.z1 >= b.z0 - 1e-9; // overlap or share an edge

for (const h of HOMES) {
  const room = R.roomFor(h, "p"), p = P.plotFor(room);
  chk(`${h}: the plot is a square, with the whole house inside it`, p.plot.x1 - p.plot.x0 === p.plot.z1 - p.plot.z0 && p.plot.x0 < 0 && p.plot.z0 < 0 && p.plot.x1 > room.w && p.plot.z1 > room.d);
  chk(`${h}: the garage is beside the house, inside the plot, and does not touch the house`, p.garage.x0 > room.w && p.garage.x1 < p.plot.x1 && p.garage.z0 > p.plot.z0 && p.garage.z1 < p.plot.z1 && !hit(p.garage, p.house));
  chk(`${h}: the driveway is at least 5 cells wide, starts at the garage door, is centred on it and runs to the road's edge`, p.drive.x1 - p.drive.x0 >= 5 && Math.abs((p.drive.x0 + p.drive.x1) / 2 - (p.door.x0 + p.door.x1) / 2) < 1e-9 && p.drive.z0 === p.garage.z1 && p.drive.z1 === p.road.z0 && p.drive.x0 <= p.door.x0 && p.drive.x1 >= p.door.x1);
  chk(`${h}: the vehicle gate is in the front wall, covers the driveway, and the road is beyond the plot with a footpath between`, p.gate.z === p.plot.z1 && p.gate.x0 <= p.drive.x0 && p.gate.x1 >= p.drive.x1 && p.road.z0 > p.plot.z1 && p.road.z0 - p.plot.z1 >= 1.5 && p.road.x0 < p.plot.x0 && p.road.x1 > p.plot.x1 && !hit(p.road, { x0: p.plot.x0, x1: p.plot.x1, z0: p.plot.z0, z1: p.plot.z1 }));
  chk(`${h}: the footpath joins the front door to the pedestrian gate and the road, and the front walk joins it to the driveway`, p.path.every((r, i) => i === 0 || touches(r, p.path[i - 1])) && inside({ x0: p.path[0].x0, x1: p.path[0].x1, z0: p.path[0].z0 - 0.01, z1: p.path[0].z1 }, p.doorOut.x, p.doorOut.z) && p.path.at(-1).z1 === p.road.z0 && p.footGate.x0 <= p.path.at(-1).x0 + 1e-9 && p.footGate.x1 >= p.path.at(-1).x1 - 1e-9 && touches(p.link, p.path.at(-1)) && touches(p.link, p.drive));
  chk(`${h}: the footpath, the driveway and the gates never overlap the garage or the house`, [...p.path, p.drive, p.link].every((r) => !hit(r, p.house) && !hit(r, p.garage)) && !hit(p.drive, p.link));
  // a car (2.2 x 5.5 cells) from the middle of the garage to the road stays on garage floor, driveway, apron and road, and never touches the house or the walls
  const c = P.driveRoute(room), ok = []; const zone = P.driveable(room), band = [{ x0: p.plot.x0 - 1, x1: p.plot.x0 + 1, z0: p.plot.z0, z1: p.plot.z1 }, { x0: p.plot.x1 - 1, x1: p.plot.x1 + 1, z0: p.plot.z0, z1: p.plot.z1 }];
  for (let i = 0; i < c.length - 1; i++) for (let t = 0; t <= 1.0001; t += 0.05) { const x = c[i][0] + (c[i + 1][0] - c[i][0]) * t, z = c[i][1] + (c[i + 1][1] - c[i][1]) * t; for (const [dx, dz] of [[-1.1, -2.75], [1.1, -2.75], [-1.1, 2.75], [1.1, 2.75], [0, 0]]) { const px = x + dx, pz = z + dz; if (pz > p.road.z1) continue; ok.push(zone.some((r) => inside(r, px, pz)) && !hit({ x0: px, x1: px, z0: pz, z1: pz }, p.house) && !band.some((b) => inside(b, px, pz))); } }
  chk(`${h}: a car can drive from the garage along the driveway to the road without leaving the paving or touching the house, the wall or anything standing on the lawn`, ok.length > 50 && ok.every(Boolean));
}

// outdoor things: anywhere valid on the lawn, rotated, never on the paving, the house, the garage, outside the wall, or on each other
const room = R.roomFor("Awo", "p"), p = P.plotFor(room), lb = P.lawnBox(room), outdoor = Object.keys(ITEMS).filter(isOutdoor);
chk("there are outdoor things of every sort in the shop: furniture, plants and flower pots, benches, lights, bins, decorations", ["garden_bench", "balcony_set", "planter_trio", "flower_pots", "garden_lights", "post_light", "wheelie_bin", "garden_statue", "garden_fountain", "hammock", "generator"].every((k) => ITEMS[k]?.outdoor));
const spot = R.autoPlace(room, [], "garden_bench");
chk("a new outdoor thing is offered a free spot on the lawn", spot && R.fits(room, [], "garden_bench", spot.x, spot.z, spot.rot));
chk("an outdoor thing can be dropped on any free lawn cell, in every rotation, including cells west and north of the house (negative coordinates)", [[lb.x0, lb.z0], [lb.x0, 2], [3, lb.z0], [room.w + 1, 1]].every(([x, z]) => [0, 1, 2, 3].every((rot) => { const [w, d] = sizeOf("planter_trio", rot); return !R.fits(room, [], "planter_trio", x, z, rot) === !(x + w <= lb.x1 && z + d <= lb.z1 && !p.reserved.some((r) => hit(r, { x0: x, x1: x + w, z0: z, z1: z + d }))); })));
const bad2 = [["on the house floor", 2, 2], ["in the garage", p.garage.x0 + 1, p.garage.z0 + 1], ["on the driveway", Math.ceil(p.drive.x0) + 1, p.drive.z0 + 2], ["on the footpath", Math.ceil(p.path.at(-1).x0), p.path.at(-1).z0 + 2], ["on the front walk", p.link.x0 + 2, Math.ceil(p.link.z0)], ["through the boundary wall", p.plot.x0, 2], ["outside the plot", p.plot.x1 + 3, 2], ["on the road", 3, p.road.z0 + 1]];
for (const [why, x, z] of bad2) chk(`an outdoor thing cannot stand ${why}`, !R.fits(room, [], "garden_bench", x, z, 0));
chk("two outdoor things cannot share a cell, but side by side is fine", (() => { const a = { id: "a", key: "garden_bench", placed: true, x: lb.x0 + 1, z: lb.z0 + 1, rot: 0 }; return !R.fits(room, [a], "wheelie_bin", lb.x0 + 2, lb.z0 + 1, 0) && R.fits(room, [a], "wheelie_bin", lb.x0 + 3, lb.z0 + 1, 0) && R.fits(room, [a], "garden_bench", a.x, a.z, 0, "a"); })());
chk("indoor things still cannot go outside, and outdoor things cannot go inside", !R.fits(room, [], "wardrobe", room.w, 0, 0) && !R.fits(room, [], "bed", -1, 0, 0) && !R.fits(room, [], "generator", 1, 1, 0));
{ const placed = []; for (let i = 0; i < 40; i++) { const key = outdoor[i % outdoor.length], s = R.autoPlace(room, placed, key); if (s) placed.push({ id: "o" + i, key, placed: true, ...s }); }
  chk("many outdoor things all fit without overlap, and every one stands on a legal spot", placed.length === 40 && placed.every((o) => R.fits(room, placed, o.key, o.x, o.z, o.rot, o.id)) && (() => { const solid = placed.filter((o) => !ITEMS[o.key].flat); return new Set(solid.flatMap((o) => R.cellsOf(o.key, o.x, o.z, o.rot).map((c) => c.join()))).size === solid.reduce((n, o) => n + R.cellsOf(o.key, o.x, o.z, o.rot).length, 0); })()); // solid pieces never share a cell; a flat rug may lie under them
  chk("outdoor things do not block the walking floor inside, and a home with them is still consistent", R.blockedCells(placed).size === 0 && R.consistent(room, placed)); }

// saving and loading, and whose things they are
const models = ["character", "account", "ledgerEntry", "roomItem", "gameClock"];
const db = makeDb(models, { unique: { ledgerEntry: ["idempotencyKey"] }, join: { character: (c, T) => c && ({ ...c, account: T.account.find((a) => a.characterId === c.id) }) } });
const epoch = new Date(Date.now() - 2 * 86400_000);
db.T().gameClock.push({ id: 1, startedAt: epoch, campusEpoch: epoch });
db.T().account.push({ id: "a1", characterId: "me", kind: "PLAYER", balance: 900_000_000n }, { id: "a2", characterId: "other", kind: "PLAYER", balance: 900_000_000n }, { id: "venues", systemName: "VENUES", kind: "SYSTEM", balance: 0n });
db.T().character.push({ id: "me", userId: "u-me", accountId: "a1", hostel: "Awo", sessionStartWeek: 1, class: "MAPO", gender: "M", level: 1 }, { id: "other", userId: "u-other", accountId: "a2", hostel: "Awo", sessionStartWeek: 1, class: "MAPO", gender: "M", level: 1 });
await service.getRoom(db, "u-me"); await service.getRoom(db, "u-other");
const bought = await service.buyItem(db, "u-me", { key: "garden_bench", requestId: "bench-buy-0001" }), bench = bought.items.find((i) => i.key === "garden_bench");
chk("a bought outdoor thing is placed on the lawn", bench.placed && isOutdoor(bench.key) && R.fits(bought.room, bought.items, bench.key, bench.x, bench.z, bench.rot, bench.id));
const dest = { x: lb.x0 + 2, z: lb.z0 + 2, rot: 1 };
const moved = await service.placeItem(db, "u-me", { id: bench.id, ...dest });
chk("the owner can move and turn it to a valid lawn spot, and the server saves it", moved.items.find((i) => i.id === bench.id).x === dest.x && moved.items.find((i) => i.id === bench.id).rot === 1);
const loaded = await service.getRoom(db, "u-me"), after = loaded.items.find((i) => i.id === bench.id);
chk("loading the room again (another session) finds it exactly where it was left", after.placed && after.x === dest.x && after.z === dest.z && after.rot === dest.rot);
chk("placing it on the driveway, in the garage or outside the wall is refused and it stays where it was", (await refused(service.placeItem(db, "u-me", { id: bench.id, x: Math.ceil(p.drive.x0) + 1, z: p.drive.z0 + 2, rot: 0 }), 409)) && (await refused(service.placeItem(db, "u-me", { id: bench.id, x: p.garage.x0 + 1, z: p.garage.z0 + 1, rot: 0 }), 409)) && (await refused(service.placeItem(db, "u-me", { id: bench.id, x: p.plot.x1 + 4, z: 0, rot: 0 }), 409)) && (await service.getRoom(db, "u-me")).items.find((i) => i.id === bench.id).x === dest.x);
chk("another player cannot move or store someone else's outdoor thing", (await refused(service.placeItem(db, "u-other", { id: bench.id, ...dest }), 404)) && (await refused(service.storeItem(db, "u-other", { id: bench.id }), 404)) && (await service.getRoom(db, "u-me")).items.find((i) => i.id === bench.id).x === dest.x);
const stored = await service.storeItem(db, "u-me", { id: bench.id }), again = await service.placeItem(db, "u-me", { id: bench.id });
chk("stored and placed again, it goes back to a free lawn spot", !stored.items.find((i) => i.id === bench.id).placed && again.items.find((i) => i.id === bench.id).placed && R.fits(again.room, again.items, bench.key, again.items.find((i) => i.id === bench.id).x, again.items.find((i) => i.id === bench.id).z, again.items.find((i) => i.id === bench.id).rot, bench.id));
const structural = (await service.getRoom(db, "u-me")).items.filter((i) => ITEMS[i.key]?.fixed);
chk("the house, garage, driveway, fence and gates are not items at all, so there is nothing to drag: only owned things have rows", !structural.some((i) => isOutdoor(i.key)) && (await refused(service.placeItem(db, "u-me", { id: "999999", x: 0, z: 0, rot: 0 }), 404)));
// the 3D plot builds for every home, with real geometry, inside and around the plot, and its road and neighbours stay clear of the plot
{ const THREE = await import("three"), { buildPlot, GROUND } = await import("../lib3d/plot3d.js");
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, ...o }), tree = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 1, 0.2), mat("#444"))); return g; };
  let all = true, finite = true, meshes = 0;
  for (const h of HOMES) { const rm = R.roomFor(h, "p"), pp = P.plotFor(rm), built = buildPlot(rm, { mat, tree }); built.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(built.group), sz = bb.getSize(new THREE.Vector3()); finite &&= [sz.x, sz.y, sz.z].every(Number.isFinite);
    let n = 0; built.group.traverse((o) => { if (o.isMesh) n++; }); meshes += n;
    const lawn = { x0: pp.plot.x0 - rm.w / 2, x1: pp.plot.x1 - rm.w / 2 };
    all &&= n > 100 && n < 900 && bb.min.y < GROUND && bb.max.y > 2 && bb.min.x <= lawn.x0 - 12 && bb.max.x >= lawn.x1 + 12 && built.trees.every((t) => Number.isFinite(t.a)); }
  chk("the 3D plot builds for every home with real geometry, neighbours either side, and a reasonable number of meshes for good performance", all && finite && meshes > 0); }
process.exit(bad ? 1 : 0);
