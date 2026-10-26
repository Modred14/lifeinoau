// tests/houses.test.mjs
// The 3- and 4-bedroom houses and the housing rules every home follows: the front door opens into the living room, every bedroom of the 2/3/4-bedroom
// homes has its own private bathroom plus one shared guest toilet, weatherproof furniture can be carried between the house and the compound, and
// what is placed is saved, shared with other players, and never floats, overlaps, blocks a doorway or leaves the property. Pure Node, no database server.
import { register } from "node:module";
import { makeDb } from "./fakedb.mjs";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const F = await import("../lib/furniture.js");
const R = await import("../lib/room.js");
const P = await import("../lib/plot.js");
const Rules = await import("../lib/rules.js");
const { LAYOUTS, layoutOf, zoneAt, canStep, doorCellsOf } = await import("../lib/layouts.js");
const { homesFor } = await import("../lib/housingService.js");
const service = await import("../lib/roomService.js");
const { GameError } = await import("./fixtures/room-gameService-stub.mjs");
const { ITEMS } = F;

let bad = 0;
const chk = (l, c, extra = "") => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && extra !== "" ? "  -> " + extra : "")); };
const refused = async (p, status) => { try { await p; return false; } catch (e) { return e instanceof GameError && e.status === status; } };

const HOUSES = ["2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"], BEDS = { "2-Bedroom Flat": 2, "3-Bedroom House": 3, "4-Bedroom House": 4 };
const WITH_LIVING = ["Off-campus", "1-Bedroom Flat", ...HOUSES];
const ALL = ["Ojaja", "Off-campus", "1-Bedroom Flat", ...HOUSES];
const doorsOf = (L, id) => L.doors.filter(([a, b, c, d]) => zoneAt(L, a, b).id === id || zoneAt(L, c, d).id === id);
const other = (L, [a, b, c, d], id) => (zoneAt(L, a, b).id === id ? zoneAt(L, c, d) : zoneAt(L, a, b));

// ---- 1. the houses exist and are real, spacious, enterable homes ----
chk("the 3- and 4-bedroom houses are private homes anyone can rent, with their own plans", ["3-Bedroom House", "4-Bedroom House"].every((h) => Rules.PRIVATE_HOMES.includes(h) && Rules.canLiveIn("M", h) && Rules.canLiveIn("F", h) && !Rules.isSchoolHostel(h) && layoutOf(R.roomFor(h, "p"))));
chk("they are the biggest homes: bigger than the 2-bedroom flat, the 4-bedroom the biggest, and dearer to match", (() => { const a = (h) => R.roomFor(h, "p").w * R.roomFor(h, "p").d; return a("3-Bedroom House") > a("2-Bedroom Flat") && a("4-Bedroom House") > a("3-Bedroom House") && Rules.sessionRentOf("4-Bedroom House") > Rules.sessionRentOf("3-Bedroom House") && Rules.sessionRentOf("3-Bedroom House") > Rules.sessionRentOf("2-Bedroom Flat"); })());
chk("the Housing app lists them with the right number of bedrooms, as houses", (() => { const hs = homesFor({ id: "c1", hostel: "Awo", gender: "M", sessionStartWeek: 1, rentPaidUntilWeek: 0 }, 5); const h3 = hs.find((h) => h.hostel === "3-Bedroom House"), h4 = hs.find((h) => h.hostel === "4-Bedroom House"); return h3?.bedrooms === 3 && h4?.bedrooms === 4 && h3.kind === "house" && h4.kind === "house" && h3.layout === "house3" && h4.layout === "house4" && BigInt(h4.chargeKobo) > BigInt(h3.chargeKobo); })());
chk("each house has a rent that adds up over the 12 weekly instalments", ["3-Bedroom House", "4-Bedroom House"].every((h) => { let t = 0n; for (let i = 0; i < Rules.SESSION_WEEKS; i++) t += Rules.rentInstalmentKobo(h, i); return t === BigInt(Rules.sessionRentOf(h)) * 100n; }));
for (const h of HOUSES) {
  const room = R.roomFor(h, "p"), L = layoutOf(room), area = (kind) => L.grid.flat().filter((z) => z.kind === kind).length, one = (id) => L.grid.flat().filter((z) => z.id === id).length;
  const beds = L.zones.filter((z) => z.kind === "bed");
  chk(`${h}: ${BEDS[h]} bedrooms, each a comfortable size (at least 50 cells, about 40 square metres or more of walking floor at 0.9 m a cell)`, beds.length === BEDS[h] && beds.every((z) => one(z.id) >= 50), beds.map((z) => one(z.id)).join());
  chk(`${h}: a spacious living room (at least 90 cells), a real kitchen (at least 30) and a hall`, area("living") >= 90 && area("kitchen") >= 30 && area("passage") >= 20, `${area("living")}/${area("kitchen")}/${area("passage")}`);
  const start = [L.entry.x, L.entry.z], seen = new Set([start.join()]), q = [start];
  while (q.length) { const c = q.shift(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz]; if (!seen.has(n.join()) && zoneAt(L, n[0], n[1]) && canStep(L, c, n)) { seen.add(n.join()); q.push(n); } } }
  chk(`${h}: you can walk from the front door to every cell of every room, only through doorways`, seen.size === L.w * L.d);
  chk(`${h}: every window and decoration sits on its wall, and none sits across the front door`, [...L.windows, ...L.decor].every((x) => x.at > 0.3 && x.at < (x.side === "N" || x.side === "S" ? L.w : L.d) - 0.3) && !L.windows.some((w) => w.side === "S" && Math.abs(w.at - L.entry.at) < 1.2));
  chk(`${h}: every room that has an outside wall has a window`, L.zones.filter((z) => z.kind !== "passage").every((z) => { const cs = L.grid.flatMap((r, zz) => r.map((zn, x) => (zn.id === z.id ? [x, zz] : null))).filter(Boolean); const onEdge = (side) => cs.some(([x, zz]) => (side === "N" ? zz === 0 : side === "S" ? zz === L.d - 1 : side === "W" ? x === 0 : x === L.w - 1)); const sides = ["N", "S", "W", "E"].filter(onEdge); return !sides.length || sides.some((s) => L.windows.some((w) => w.side === s)); }));
}

// ---- 2. every bedroom has its own private bathroom, and there is one shared guest toilet ----
for (const h of HOUSES) {
  const L = layoutOf(R.roomFor(h, "p")), beds = L.zones.filter((z) => z.kind === "bed"), baths = L.zones.filter((z) => z.kind === "bath"), toilets = L.zones.filter((z) => z.kind === "toilet");
  chk(`${h}: one bathroom per bedroom and exactly one guest toilet`, baths.length === BEDS[h] && toilets.length === 1);
  chk(`${h}: each bedroom has exactly one bathroom door, and it leads to a bathroom no other bedroom uses`, (() => { const used = []; for (const b of beds) { const to = doorsOf(L, b.id).map((d) => other(L, d, b.id)).filter((z) => z.kind === "bath"); if (to.length !== 1) return false; used.push(to[0].id); } return new Set(used).size === beds.length; })());
  chk(`${h}: every bathroom has exactly one door, and it opens only into its own bedroom (private: reached through the bedroom, never from the hall or the living room)`, baths.every((b) => { const d = doorsOf(L, b.id); return d.length === 1 && other(L, d[0], b.id).kind === "bed"; }));
  chk(`${h}: the guest toilet has one door onto the hall, so guests never go through a bedroom`, (() => { const d = doorsOf(L, toilets[0].id); return d.length === 1 && other(L, d[0], toilets[0].id).kind === "passage"; })());
  chk(`${h}: the guest toilet and the kitchen can be reached from the front door without crossing a bedroom, a bathroom, the kitchen or the toilet`, (() => {
    const ok = (z) => z.kind === "living" || z.kind === "passage", start = [L.entry.x, L.entry.z], seen = new Set([start.join()]), q = [start], hit = new Set();
    while (q.length) { const c = q.shift(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz], zn = zoneAt(L, n[0], n[1]); if (!zn || seen.has(n.join()) || !canStep(L, c, n)) continue; seen.add(n.join()); hit.add(zn.id); if (ok(zn)) q.push(n); } }
    return L.zones.filter((z) => z.kind !== "bath" && z.kind !== "passage" && z.kind !== "living").every((z) => hit.has(z.id)) || L.zones.filter((z) => z.kind === "bed" || z.kind === "kitchen" || z.kind === "toilet").every((z) => hit.has(z.id)); })());
  const room = R.roomFor(h, "p"), plan = F.starterPlan(h, room.occupants);
  chk(`${h}: it comes with a toilet and shower in every bedroom's bathroom, and the guest toilet in the guest toilet`, baths.every((b) => plan.filter(([k, z]) => k === "ensuite" && z === b.id).length === 1) && plan.filter(([k, z]) => k === "toilet" && z === toilets[0].id).length === 1);
  chk(`${h}: every bedroom is furnished with a bed and a wardrobe`, beds.every((b) => plan.some(([k, z]) => z === b.id && /bed$/.test(k)) && plan.some(([k, z]) => z === b.id && k === "wardrobe")));
}
chk("the 1-bedroom flat keeps its bathroom and its separate toilet; Ojaja and off campus keep one bathroom", (() => { const k = (h) => layoutOf(R.roomFor(h, "p")).zones.map((z) => z.kind); return k("1-Bedroom Flat").includes("toilet") && k("Ojaja").filter((x) => x === "bath").length === 1 && k("Off-campus").filter((x) => x === "bath").length === 1; })());

// ---- 3. the living room is the entrance ----
for (const h of WITH_LIVING) {
  const L = layoutOf(R.roomFor(h, "p")), at = zoneAt(L, L.entry.x, L.entry.z);
  chk(`${h}: the front door opens straight into the living room (not a bedroom, bathroom, kitchen, toilet or hall)`, at.kind === "living", at.kind);
  chk(`${h}: the living room opens naturally onto a bedroom, the kitchen or the hall`, doorsOf(L, at.id).map((d) => other(L, d, at.id).kind).some((k) => k === "bed" || k === "kitchen" || k === "passage"), doorsOf(L, at.id).map((d) => other(L, d, at.id).kind).join());
  chk(`${h}: no bathroom or toilet opens onto the living room, and every bedroom is within one doorway of the living room or the hall`, doorsOf(L, at.id).every((d) => { const k = other(L, d, at.id).kind; return k !== "bath" && k !== "toilet"; }) && L.zones.filter((z) => z.kind === "bed").every((b) => doorsOf(L, b.id).some((d) => { const k = other(L, d, b.id).kind; return k === "living" || k === "passage"; })));
}
chk("Ojaja has no living room: its front door opens into the one room for sleeping and sitting, never into the bathroom or kitchen", (() => { const L = layoutOf(R.roomFor("Ojaja", "p")); return zoneAt(L, L.entry.x, L.entry.z).id === "bed"; })());
chk("the character spawns just inside the front door in the living room, and the front step is outside it", WITH_LIVING.every((h) => { const room = R.roomFor(h, "p"), L = layoutOf(room), [sx, sz] = R.spawnCell(room); return zoneAt(L, sx, sz).kind === "living" && sz === room.d - 1 && P.plotFor(room).doorOut.z === room.d; }));

// ---- 4. furniture: what each home comes with fits, in the right room, nothing walled in, doors clear ----
for (const h of ALL) for (const n of h === "Off-campus" ? [1, 2] : [R.roomFor(h, "p").occupants]) {
  const room = R.roomFor(h, "p"), L = layoutOf(room), plan = F.starterPlan(h, n), placed = []; let all = true;
  for (const [k, zone] of plan) { const s = R.autoPlace(room, placed, k, zone); if (!s || R.placementIssue(room, placed, k, s.x, s.z, s.rot) !== null) all = false; else placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  chk(`${h} x${n}: everything it comes with is placed legally, in its own room`, all && placed.every((p, i) => !plan[i][1] || zoneAt(L, p.x, p.z).id === plan[i][1]));
  chk(`${h} x${n}: nothing is walled in, and every free cell can be walked to from the front door`, R.cutOff(room, placed) === 0 && R.consistent(room, placed) && (() => { const bl = R.blockedCells(placed, room), st = R.spawnCell(room); for (let z = 0; z < room.d; z++) for (let x = 0; x < room.w; x++) if (!bl.has(x + "," + z) && !(x === st[0] && z === st[1]) && !R.findPath(room, bl, st, [x, z]).length) return false; return true; })());
  const doors = new Set(doorCellsOf(L).map((c) => c.join()));
  chk(`${h} x${n}: nothing but a rug stands in a doorway or inside the front door`, placed.every((p) => ITEMS[p.key].flat || !R.cellsOf(p.key, p.x, p.z, p.rot).some((c) => doors.has(c.join()))));
}

// ---- 5. the new outdoor range, and what may be carried out ----
const NEW_OUTDOOR = ["patio_chair", "patio_side_table", "patio_dining_set", "outdoor_sofa", "swing_bench", "picnic_table", "sun_lounger", "fire_pit", "outdoor_rug", "bird_bath", "topiary_pair", "bbq_grill", "garden_gazebo"];
chk("the shop sells chairs, tables, sofas, benches and decorations for the compound", NEW_OUTDOOR.every((k) => ITEMS[k]?.outdoor && F.inShop(k) && ITEMS[k].shop === "outdoor") && ["garden_bench", "hammock", "planter_trio", "garden_fountain", "post_light"].every((k) => ITEMS[k].outdoor));
chk("weatherproof household things can go outside; electronics, beds, wardrobes, plumbing and fixtures cannot", ["sofa", "armchair", "plastic_chair", "floor_lamp", "plant", "rug", "center_table_wood", "desk"].every(F.canGoOutside) && ["tv", "smart_tv", "double_bed", "wardrobe", "fridge", "bathtub", "washing_machine", "gas_cooker", "ensuite", "toilet", "dining_set", "ac"].every((k) => !F.canGoOutside(k)));
chk("the home's own fixtures (toilet, shower, guest toilet, dining table) cannot be moved", ["ensuite", "toilet", "dining_set"].every((k) => F.isFixture(k) && !F.isMovable(k)) && F.isMovable("sofa"));
{ const room = R.roomFor("3-Bedroom House", "p"), L = layoutOf(room), pl = P.plotFor(room), lb = P.lawnBox(room);
  const living = L.grid.flat().find((z) => z.kind === "living"), spot = (key, x, z, rot = 0, placed = []) => R.placementIssue(room, placed, key, x, z, rot);
  chk("a sofa out on the lawn is valid, and the same sofa in the living room is valid: where it stands decides", spot("sofa", lb.x0 + 1, lb.z0 + 1) === null && (() => { const s = R.autoPlace(room, [], "sofa", living.id); return s && spot("sofa", s.x, s.z, s.rot) === null && !R.isOutside(room, { key: "sofa", x: s.x, z: s.z, rot: s.rot }); })() && R.isOutside(room, { key: "sofa", x: lb.x0 + 1, z: lb.z0 + 1, rot: 0 }));
  chk("a wardrobe cannot be put on the lawn, and a sofa cannot straddle the house wall", spot("wardrobe", lb.x0 + 1, lb.z0 + 1) !== null && spot("sofa", room.w - 1, 5) !== null && spot("sofa", -1, 5) !== null);
  chk("outdoor furniture cannot be placed inside the house", ["garden_bench", "patio_dining_set", "outdoor_sofa"].every((k) => spot(k, 2, 2) !== null && !R.fits(room, [], k, 2, 2, 0)));
  chk("nothing can stand outside the property: past the boundary wall, in the road, or on the next plot", [[lb.x0 - 1, 3], [lb.x1, 3], [3, lb.z0 - 1], [3, lb.z1], [pl.plot.x0 - 8, 3], [3, pl.road.z0 + 1]].every(([x, z]) => spot("garden_bench", x, z) !== null && spot("sofa", x, z) !== null));
  chk("nothing can stand on the house, the garage, the driveway, the footpath or the front walk", [["garage", pl.garage.x0 + 1, pl.garage.z0 + 1], ["driveway", Math.ceil(pl.drive.x0) + 1, pl.drive.z0 + 2], ["footpath", Math.ceil(pl.path.at(-1).x0), pl.path.at(-1).z0 + 3], ["walk", Math.ceil(pl.link.x0) + 1, Math.ceil(pl.link.z0)]].every(([, x, z]) => spot("garden_bench", x, z) !== null && spot("sofa", x, z) !== null));
  // a free patch of lawn: the first spot where a 12 x 8 block of cells is open ground (no house, garage, driveway or path)
  let base = null; for (let z = lb.z0; z + 8 <= lb.z1 && !base; z++) for (let x = lb.x0; x + 12 <= lb.x1 && !base; x++) if (Array.from({ length: 12 * 8 }, (_, i) => [x + (i % 12), z + Math.floor(i / 12)]).every(([cx, cz]) => P.plotAllows(room, "bird_bath", cx, cz, 0))) base = { x, z };
  chk("the lawn has a free patch to dress, away from the house, the garage and the paving", !!base);
  const a = { id: "a", key: "outdoor_sofa", placed: true, x: base.x, z: base.z, rot: 0 };
  chk("two solid pieces cannot overlap, side by side is fine, and a rug can lie under a table", spot("picnic_table", base.x + 1, base.z, 0, [a]) !== null && spot("picnic_table", base.x + 4, base.z, 0, [a]) === null && spot("outdoor_rug", base.x, base.z, 0, [a]) === null);
  chk("every piece can be turned to every quarter-turn on the lawn, and its footprint swaps when turned", [0, 1, 2, 3].every((rot) => spot("patio_dining_set", base.x + 4, base.z + 3, rot) === null) && F.sizeOf("patio_dining_set", 1).join() === "2,3" && F.sizeOf("patio_dining_set", 0).join() === "3,2");
  // a piece indoors may not wall in a doorway or a room
  const door = doorCellsOf(L).find(([x, z]) => zoneAt(L, x, z).kind === "living"), entry = [L.entry.x, L.entry.z];
  chk("nothing can be put in a doorway or on the spot inside the front door", spot("plastic_chair", door[0], door[1]) !== null && spot("plastic_chair", entry[0], entry[1]) !== null && spot("rug", door[0], door[1]) === null);
  // wall in the front door with a row of chairs across the living room's width -> refused for blocking the way
  const blockers = []; for (let x = 0; x < room.w; x++) if (zoneAt(L, x, L.entry.z - 3)?.kind === "living") blockers.push({ id: "b" + x, key: "plastic_chair", placed: true, x, z: L.entry.z - 3, rot: 0 });
  const last = blockers.pop(), why = spot("plastic_chair", last.x, last.z, 0, blockers);
  chk("a row of furniture that would wall the living room off from the rest of the home is refused", blockers.length > 3 && typeof why === "string" && /block|way/i.test(why), String(why)); }

// ---- 6. saving, carrying out and back in, other players, and sync ----
const models = ["character", "account", "ledgerEntry", "roomItem", "gameClock"];
const db = makeDb(models, { unique: { ledgerEntry: ["idempotencyKey"] }, join: { character: (c, T) => c && ({ ...c, account: T.account.find((a) => a.characterId === c.id), user: { status: "ACTIVE" } }) } });
const epoch = new Date(Date.now() - 2 * 86400_000);
db.T().gameClock.push({ id: 1, startedAt: epoch, campusEpoch: epoch });
db.T().account.push({ id: "a1", characterId: "me", kind: "PLAYER", balance: 90_000_000_000n }, { id: "a2", characterId: "other", kind: "PLAYER", balance: 90_000_000_000n }, { id: "venues", systemName: "VENUES", kind: "SYSTEM", balance: 0n });
db.T().character.push({ id: "me", name: "Ada", userId: "u-me", accountId: "a1", hostel: "3-Bedroom House", sessionStartWeek: 1, class: "NEPO", gender: "F", level: 1 }, { id: "other", name: "Tunde", userId: "u-other", accountId: "a2", hostel: "Awo", sessionStartWeek: 1, class: "MAPO", gender: "M", level: 1 });
let v = await service.getRoom(db, "u-me"); await service.getRoom(db, "u-other");
chk("moving into the 3-bedroom house gives the full starter set, with a private bathroom per bedroom, all placed", v.room.layout === "house3" && v.items.every((i) => i.placed) && v.items.filter((i) => i.key === "ensuite").length === 3 && v.items.filter((i) => i.key === "toilet").length === 1 && R.consistent(v.room, v.items));
const rev0 = v.rev;
chk("the room carries a revision, and asking with it answers 'same' while nothing has moved", !!rev0 && (await service.getRoomIfChanged(db, "u-me", rev0)).same === true);
const sofa = v.items.find((i) => i.key === "sofa");
let out = await service.placeItem(db, "u-me", { id: sofa.id, where: "outside" });
let s2 = out.items.find((i) => i.id === sofa.id);
chk("a household sofa is carried out to the compound: it ends up on the lawn, legally, and the revision changes", R.isOutside(out.room, s2) && R.placementIssue(out.room, out.items, "sofa", s2.x, s2.z, s2.rot, s2.id) === null && out.rev !== rev0);
chk("another device asking with the old revision gets the new compound", (await service.getRoomIfChanged(db, "u-me", rev0)).items?.find((i) => i.id === sofa.id)?.x === s2.x);
const reloaded = (await service.getRoom(db, "u-me")).items.find((i) => i.id === sofa.id);
chk("it is saved: a fresh load finds it in exactly the same place", reloaded.x === s2.x && reloaded.z === s2.z && reloaded.rot === s2.rot && reloaded.placed);
const lb = P.lawnBox(v.room), turned = await service.placeItem(db, "u-me", { id: sofa.id, x: lb.x0 + 3, z: lb.z0 + 3, rot: 2 });
chk("the owner can move and turn it freely on the lawn, and the server saves the turn", turned.items.find((i) => i.id === sofa.id).rot === 2 && turned.items.find((i) => i.id === sofa.id).x === lb.x0 + 3);
const view = await service.getCompound(db, "ada");
chk("another player looking at the home from outside sees the compound's pieces and not the furniture inside", view.owner === "Ada" && view.items.some((i) => i.key === "sofa" && i.x === lb.x0 + 3) && view.items.every((i) => R.isOutside(v.room, i)) && !view.items.some((i) => ["double_bed", "ensuite", "toilet"].includes(i.key)));
chk("the compound view of an unknown home is refused", await refused(service.getCompound(db, "nobody"), 404));
const back = await service.placeItem(db, "u-me", { id: sofa.id, where: "inside" });
chk("carried back in, it stands on the house floor again, in the living room, and the home is still consistent", (() => { const i = back.items.find((x) => x.id === sofa.id), L = layoutOf(back.room); return !R.isOutside(back.room, i) && zoneAt(L, i.x, i.z).kind === "living" && R.consistent(back.room, back.items) && R.cutOff(back.room, back.items) === 0; })());
chk("an outdoor-only piece is never carried inside, and an indoor-only piece never carried out", await (async () => { const g = (await service.buyItem(db, "u-me", { key: "garden_bench", requestId: "bench-0000001" })).items.find((i) => i.key === "garden_bench"), t = (await service.buyItem(db, "u-me", { key: "smart_tv", requestId: "tv-00000001" })).items.find((i) => i.key === "smart_tv"); return (await refused(service.placeItem(db, "u-me", { id: g.id, where: "inside" }), 409)) && (await refused(service.placeItem(db, "u-me", { id: t.id, where: "outside" }), 409)) && (await refused(service.placeItem(db, "u-me", { id: t.id, x: lb.x0 + 1, z: lb.z0 + 1, rot: 0 }), 409)); })());
const fix = (await service.getRoom(db, "u-me")).items.find((i) => i.key === "ensuite");
chk("the shower and toilet, the guest toilet and the dining table cannot be moved or stored", (await refused(service.placeItem(db, "u-me", { id: fix.id, x: 1, z: 1, rot: 0 }), 409)) && (await refused(service.storeItem(db, "u-me", { id: fix.id }), 409)) && (await refused(service.placeItem(db, "u-me", { id: fix.id, where: "outside" }), 409)));
const bath = (await service.buyItem(db, "u-me", { key: "bathtub", requestId: "bath-0000001" })).items.find((i) => i.key === "bathtub");
chk("a bought bathtub (plumbing) goes in a bathroom and cannot be put on the lawn or in the living room", bath.placed && zoneAt(layoutOf(v.room), bath.x, bath.z).kind === "bath" && (await refused(service.placeItem(db, "u-me", { id: bath.id, x: lb.x0 + 1, z: lb.z0 + 1, rot: 0 }), 409)) && (await refused(service.placeItem(db, "u-me", { id: bath.id, x: 1, z: 11, rot: 0 }), 409)));
chk("placing something on top of another piece, in a doorway, or beyond the property is refused with the item left where it was", await (async () => { const cur = (await service.getRoom(db, "u-me")).items, chair = cur.find((i) => i.key === "plastic_chair") ?? (await service.buyItem(db, "u-me", { key: "plastic_chair", requestId: "chair-000001" })).items.find((i) => i.key === "plastic_chair"), L = layoutOf(v.room), door = doorCellsOf(L)[0], before = (await service.getRoom(db, "u-me")).items.find((i) => i.id === chair.id); const r = [await refused(service.placeItem(db, "u-me", { id: chair.id, x: door[0], z: door[1], rot: 0 }), 409), await refused(service.placeItem(db, "u-me", { id: chair.id, x: lb.x1 + 40, z: 2, rot: 0 }), 409), await refused(service.placeItem(db, "u-me", { id: chair.id, x: 1.5, z: 2, rot: 0 }), 409)]; const after = (await service.getRoom(db, "u-me")).items.find((i) => i.id === chair.id); return r.every(Boolean) && after.x === before.x && after.z === before.z; })());
chk("another player cannot move, carry or store my things", (await refused(service.placeItem(db, "u-other", { id: sofa.id, where: "outside" }), 404)) && (await refused(service.storeItem(db, "u-other", { id: sofa.id }), 404)));
{ const rows = (await service.getRoom(db, "u-me")).items, many = []; // fill the compound with pieces and check nothing overlaps or leaves the property
  for (let i = 0; i < 30; i++) { const key = NEW_OUTDOOR[i % NEW_OUTDOOR.length], s = R.autoPlace(v.room, [...rows, ...many], key); if (s) many.push({ id: "m" + i, key, placed: true, ...s }); }
  chk("a compound dressed with thirty garden pieces has every piece on the lawn, none overlapping a solid piece, none on the paving", many.length === 30 && many.every((o) => R.placementIssue(v.room, [...rows, ...many], o.key, o.x, o.z, o.rot, o.id) === null) && R.cutOff(v.room, [...rows, ...many]) === 0); }
chk("a player who moves out of a house keeps what they bought: it stays placed if it fits, otherwise it goes to storage or the best spot", await (async () => { const mv = await service.roomAfterMove(db, { ...db.T().character.find((c) => c.id === "me"), hostel: "Awo", account: db.T().account.find((a) => a.id === "a1") }); return mv.items.some((i) => i.key === "garden_bench") && R.consistent(mv.room, mv.items); })());

console.log(bad ? `\n${bad} check(s) failed` : "\nAll house checks passed"); process.exit(bad ? 1 : 0);
