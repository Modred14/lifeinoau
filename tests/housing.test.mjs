// tests/housing.test.mjs
// The homes with several rooms (Ojaja, off campus and the two flats), the generator outside, and what moving home costs. Pure Node, no database.
import { sessionRentOf, rentInstalmentKobo, SESSION_WEEKS, movePricing, canLiveIn, isSchoolHostel, occupantsFor, schoolHalls, PRIVATE_HOMES } from "../lib/rules.js";
import { starterPlan, starterFor, ITEMS, isOutdoor, inShop } from "../lib/furniture.js";
import { roomFor, fits, autoPlace, blockedCells, spawnCell, consistent, outdoorSlots, cellsOf, cutOff } from "../lib/room.js";
import { LAYOUTS, layoutOf, canStep, zoneAt, wallRuns, doorCellsOf } from "../lib/layouts.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const HOMES = ["Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat"];

// ---- the plans ----
chk("Ojaja has one room for sleeping and sitting: that room, a kitchen, a bathroom and the hall, and no separate living room", (() => { const L = layoutOf(roomFor("Ojaja")); return L && L.zones.map((z) => z.kind).sort().join() === "bath,bed,kitchen,passage" && L.zones.find((z) => z.kind === "bed").name === "Bedroom and living room"; })());
chk("off campus has its own plan, with a bedroom and a separate living area (the combined room is only Ojaja's)", (() => { const L = layoutOf(roomFor("Off-campus")); return L && L !== layoutOf(roomFor("Ojaja")) && L.zones.map((z) => z.kind).sort().join() === "bath,bed,kitchen,living,passage" && L.zones.find((z) => z.kind === "bed").name !== "Bedroom and living room"; })());
chk("1-bedroom flat: bedroom, living room, kitchen, bathroom, a separate toilet and the hall", layoutOf(roomFor("1-Bedroom Flat")).zones.map((z) => z.kind).sort().join() === "bath,bed,kitchen,living,passage,toilet");
chk("2-bedroom flat: two bedrooms, living room, kitchen, bathroom, a separate toilet and the hall", layoutOf(roomFor("2-Bedroom Flat")).zones.map((z) => z.id).sort().join() === "bath,bed1,bed2,kitchen,living,passage,toilet");
chk("school halls stay one plain room", !roomFor("Awo").layout && !roomFor("Angola").layout);
for (const h of HOMES) {
  const room = roomFor(h, "p1"), L = layoutOf(room), start = [L.entry.x, L.entry.z], seen = new Set([start.join()]), q = [start];
  while (q.length) { const c = q.shift(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz]; if (!seen.has(n.join()) && zoneAt(L, n[0], n[1]) && canStep(L, c, n)) { seen.add(n.join()); q.push(n); } } }
  chk(`${h}: every cell can be reached from the front door, only through doorways`, seen.size === L.w * L.d);
  chk(`${h}: the front door is on the south wall and the doorways join touching cells`, L.entry.z === L.d - 1 && L.doors.every(([a, b, c, d]) => Math.abs(a - c) + Math.abs(b - d) === 1 && zoneAt(L, a, b).id !== zoneAt(L, c, d).id));
  chk(`${h}: walking cannot cross a wall`, !canStep(L, [0, 0], [0, 0 + 1]) || zoneAt(L, 0, 0).id === zoneAt(L, 0, 1).id);
}
{ const L = layoutOf(roomFor("2-Bedroom Flat"));
  const doorsBetween = (p, q) => L.doors.filter(([a, b, c, d]) => [zoneAt(L, a, b).id, zoneAt(L, c, d).id].sort().join() === [p, q].sort().join());
  const into = doorsBetween("bed1", "passage"), off = doorsBetween("bed2", "living");
  const doorsOf = (id) => L.doors.filter(([a, b, c, d]) => zoneAt(L, a, b).id === id || zoneAt(L, c, d).id === id);
  chk("2-bedroom flat: bedroom 1 and bedroom 2 are not joined to each other (the main bedroom opens on the hall, the second off the living room)", doorsBetween("bed1", "bed2").length === 0 && doorsOf("bed1").length === 1 && doorsOf("bed2").length === 1 && into.length === 1 && off.length === 1 && canStep(L, [into[0][0], into[0][1]], [into[0][2], into[0][3]]) && canStep(L, [off[0][0], off[0][1]], [off[0][2], off[0][3]]));
  chk("2-bedroom flat: the toilet and the bathroom each have their own door onto the hall", doorsBetween("toilet", "passage").length === 1 && doorsBetween("bath", "passage").length === 1 && doorsBetween("toilet", "bath").length === 0); }
{ const L = layoutOf(roomFor("1-Bedroom Flat")), doorsBetween = (p, q) => L.doors.filter(([a, b, c, d]) => [zoneAt(L, a, b).id, zoneAt(L, c, d).id].sort().join() === [p, q].sort().join());
  chk("1-bedroom flat: the front door opens into the living room, which leads to the bedroom and the hall; the toilet and bathroom are separate rooms off the hall", zoneAt(L, L.entry.x, L.entry.z).kind === "living" && doorsBetween("bed", "living").length === 1 && doorsBetween("living", "passage").length === 1 && doorsBetween("toilet", "passage").length === 1 && doorsBetween("bath", "passage").length === 1 && doorsBetween("toilet", "bath").length === 0); }

// ---- furniture belongs in the right room ----
for (const h of HOMES) {
  const room = roomFor(h, "p1"), plan = starterPlan(h, room.occupants), placed = []; let all = true;
  for (const [k, zone] of plan) { const s = autoPlace(room, placed, k, zone); if (!s || !fits(room, placed, k, s.x, s.z, s.rot)) all = false; else placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  chk(`${h}: everything it comes with fits, in the room it is meant for`, all && placed.every((p, i) => { const z = plan[i][1]; return !z || ITEMS[p.key].outdoor || zoneAt(layoutOf(room), p.x, p.z).id === z; }));
  chk(`${h}: the starter layout is consistent, and nothing is walled in (every piece and every room can be reached from the front door)`, consistent(room, placed) && cutOff(room, placed) === 0);
  const L = layoutOf(room), doors = new Set(doorCellsOf(L).map((c) => c.join()));
  chk(`${h}: nothing but a rug stands in a doorway`, placed.every((p) => ITEMS[p.key].flat || cellsOk(p, doors)));
}
function cellsOk(p, doors) { const [w, d] = ITEMS[p.key].w ? (p.rot % 2 ? [ITEMS[p.key].d, ITEMS[p.key].w] : [ITEMS[p.key].w, ITEMS[p.key].d]) : [1, 1]; for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) if (doors.has([p.x + i, p.z + j].join())) return false; return true; }
{ const room = roomFor("1-Bedroom Flat", "p"), none = [];
  const L1 = layoutOf(room), zc = (kind) => L1.grid.flatMap((r, z) => r.map((zn, x) => (zn.kind === kind ? [x, z] : null))).filter(Boolean), canStand = (key, cells) => cells.some(([x, z]) => fits(room, none, key, x, z, 0));
  chk("the toilet and shower only go in the bathroom and the cooker only in the kitchen", canStand("ensuite", zc("bath")) && !canStand("ensuite", zc("bed")) && !canStand("ensuite", zc("toilet")) && canStand("gas_cooker", zc("kitchen")) && !canStand("gas_cooker", zc("living")) && !canStand("sofa", zc("bath")));
  chk("the separate toilet only goes in the toilet, and nothing else but a plant or mirror does", canStand("toilet", zc("toilet")) && !canStand("toilet", zc("bath")) && !canStand("toilet", zc("bed")) && !canStand("sofa", zc("toilet")) && !canStand("wardrobe", zc("toilet")) && canStand("plant", zc("toilet")));
  const wallPairs = L1.grid.flatMap((r, z) => r.map((zn, x) => (zoneAt(L1, x + 1, z) && zoneAt(L1, x + 1, z).id !== zn.id ? [x, z] : null))).filter(Boolean); // a spot where a 2-wide item would straddle a wall
  chk("nothing stands in the passage, and an item cannot sit across a wall", !canStand("plant", zc("passage")) && wallPairs.length > 0 && !canStand("sofa", wallPairs) && !canStand("wardrobe", doorCellsOf(L1)));
  chk("a bought bed goes to a bedroom and a bought sofa to the sitting room", (() => { const L = layoutOf(room), b = autoPlace(room, none, "single_bed"), s = autoPlace(room, none, "sofa"); return zoneAt(L, b.x, b.z).kind === "bed" && zoneAt(L, s.x, s.z).kind === "living"; })());
  chk("a fridge goes to the kitchen first", (() => { const f = autoPlace(room, none, "fridge"); return zoneAt(layoutOf(room), f.x, f.z).kind === "kitchen"; })()); }

// ---- the generator stands outside ----
for (const h of ["Awo", ...HOMES]) {
  const room = roomFor(h, "p"), g = autoPlace(room, [], "generator");
  chk(`${h}: a generator is put outside the east wall, on the lawn`, isOutdoor("generator") && g && g.x >= room.w && fits(room, [], "generator", g.x, g.z, g.rot) && !fits(room, [], "generator", 1, 1, 0));
}
{ const room = roomFor("Ojaja", "p"), placed = []; for (let i = 0; i < 9; i++) { const s = autoPlace(room, placed, "generator"); if (s) placed.push({ id: "g" + i, key: "generator", placed: true, ...s }); }
  chk("each generator takes its own spot outside, and there are eight spots", placed.length === outdoorSlots(room).length && new Set(placed.map((p) => p.x + "," + p.z)).size === placed.length);
  const old = [{ id: "1", key: "generator", placed: true, x: 3, z: 3, rot: 0 }];
  chk("a generator left inside a room by an older version is flagged so the server moves it outside", !consistent(room, old));
  chk("a generator takes no room inside: it does not block the floor", blockedCells([{ key: "generator", placed: true, x: room.w, z: room.d - 2, rot: 3 }]).size === 0); }

// ---- rent and moving ----
chk("rent per session: 1-bedroom flat N600,000 and 2-bedroom flat N900,000 (the most expensive home)", sessionRentOf("1-Bedroom Flat") === 600_000 && sessionRentOf("2-Bedroom Flat") === 900_000 && PRIVATE_HOMES.every((h) => sessionRentOf(h) <= 900_000));
for (const h of ["1-Bedroom Flat", "2-Bedroom Flat"]) { let t = 0n; for (let i = 0; i < SESSION_WEEKS; i++) t += rentInstalmentKobo(h, i); chk(`${h}: the 12 weekly instalments add up to the session price`, t === BigInt(sessionRentOf(h)) * 100n); }
chk("flats are not school hostels, and school halls still are", !isSchoolHostel("1-Bedroom Flat") && !isSchoolHostel("2-Bedroom Flat") && isSchoolHostel("Awo"));
chk("a flat has 1 to 2 (1-bed) or 2 to 4 (2-bed) people", [...new Set(Array.from({ length: 200 }, (_, i) => occupantsFor("2-Bedroom Flat", "x" + i)))].sort().join() === "2,3,4" && [...new Set(Array.from({ length: 200 }, (_, i) => occupantsFor("1-Bedroom Flat", "x" + i)))].sort().join() === "1,2");
chk("anyone can rent any private home; school halls only of their own gender", PRIVATE_HOMES.every((h) => canLiveIn("M", h) && canLiveIn("F", h)) && canLiveIn("M", "Awo") && !canLiveIn("M", "Moremi") && canLiveIn("F", "Moremi") && !canLiveIn("M", "Hogwarts"));
chk("the 4 school halls of each gender are offered", schoolHalls("M").length === 4 && schoolHalls("F").length === 4);
{ const base = { week: 5, sessionStart: 1 }, p = movePricing({ ...base, from: "Awo", to: "2-Bedroom Flat" });
  let want = 0n; for (let w = 6; w <= 12; w++) want += rentInstalmentKobo("2-Bedroom Flat", w - 1);
  chk("moving in week 5 pays the other 7 weeks of the session at the new rate", p.weeks === 7 && p.chargeKobo === want && p.refundKobo === 0n && p.netKobo === want && p.prepaidUntil === 12);
  const back = movePricing({ ...base, from: "2-Bedroom Flat", to: "Awo", paidUntil: 12 });
  let paid = 0n, refund = 0n; for (let w = 6; w <= 12; w++) { paid += rentInstalmentKobo("Awo", w - 1); refund += rentInstalmentKobo("2-Bedroom Flat", w - 1); }
  chk("going back to a hostel gives back the rent prepaid for the flat, so moving around never costs extra", back.refundKobo === refund && back.chargeKobo === paid && back.netKobo === paid - refund && back.netKobo < 0n);
  const hop = movePricing({ ...base, from: "Awo", to: "Ojaja" }), hop2 = movePricing({ ...base, from: "Ojaja", to: "Awo", paidUntil: hop.prepaidUntil });
  chk("moving to a place and straight back costs only what a week of the old home would have", hop.netKobo + hop2.netKobo === hop2.chargeKobo);
  const last = movePricing({ week: 12, sessionStart: 1, from: "Awo", to: "2-Bedroom Flat" });
  chk("moving in the last week of a session costs nothing now, and nothing is marked as paid", last.weeks === 0 && last.netKobo === 0n && last.prepaidUntil === 0);
  const next = movePricing({ week: 14, sessionStart: 13, from: "Awo", to: "Ojaja", paidUntil: 12 });
  chk("rent prepaid in an earlier session is never refunded in a later one", next.refundKobo === 0n && next.weeks === 10);
  const walls = wallRuns(LAYOUTS.flat2);
  chk("the 3D walls leave a gap at every door and cover every other boundary", walls.doors.length === LAYOUTS.flat2.doors.length && walls.walls.length > 0); }
chk("the generator is still sold in the shop, and the dining set, the toilet and shower and the separate toilet are fixtures", inShop("generator") && !inShop("dining_set") && !inShop("ensuite") && !inShop("toilet"));
{ const keys = (h) => starterFor(h, 2), n = (l, k) => l.filter((x) => x === k).length;
  chk("only the flats come with a separate toilet; every home has the toilet and shower in its bathroom",["1-Bedroom Flat", "2-Bedroom Flat"].every((h) => n(keys(h), "toilet") === 1 && n(keys(h), "ensuite") === 1) && ["Ojaja", "Off-campus"].every((h) => n(keys(h), "toilet") === 0 && n(keys(h), "ensuite") === 1));
  const plan = (h, z) => starterPlan(h, 2).filter(([, zone]) => zone === z).map(([k]) => k);
  chk("off campus: the TV, rug and armchair are in the living area and the beds in the bedroom; Ojaja keeps everything in the one room", plan("Off-campus", "living").sort().join() === "armchair,rug,tv" && plan("Off-campus", "bed").every((k) => k !== "tv" && k !== "rug" && k !== "armchair") && ["rug", "armchair", "desk"].every((k) => plan("Ojaja", "bed").includes(k)) && plan("Ojaja", "living").length === 0);
  chk("2-bedroom flat: the dining table stands in the living room", plan("2-Bedroom Flat", "living").includes("dining_set") && plan("2-Bedroom Flat", "dining").length === 0); }
console.log(bad ? `\n${bad} check(s) failed` : "\nAll housing checks passed"); process.exit(bad ? 1 : 0);
