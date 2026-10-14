// tests/hostel.test.mjs
// Hostel rules: rent per session, who shares a room, what each room comes with, and how rough it gets. Pure Node, no database.
import { sessionRentOf, rentInstalmentKobo, occupantsFor, occupancyRange, SESSION_WEEKS, allowedHostels } from "../lib/rules.js";
import { starterFor, starterPlan, ITEMS, inShop } from "../lib/furniture.js";
import { roomFor, grimeFor, fits, autoPlace } from "../lib/room.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const SCHOOL = ["Awo", "Fajuyi", "ETF", "Moremi", "Akintola", "Alumni"], BIG = ["Angola", "Mozambique"];

chk("rent per session: school N50,000, Ojaja N310,000, off campus N450,000", sessionRentOf("Awo") === 50_000 && sessionRentOf("Angola") === 50_000 && sessionRentOf("Ojaja") === 310_000 && sessionRentOf("Off-campus") === 450_000);
for (const h of ["Awo", "Ojaja", "Off-campus"]) { let t = 0n; for (let i = 0; i < SESSION_WEEKS; i++) t += rentInstalmentKobo(h, i); chk(`${h}: the 12 weekly instalments add up to exactly the session price`, t === BigInt(sessionRentOf(h)) * 100n); }

const ids = Array.from({ length: 400 }, (_, i) => "player" + i), seen = (h) => new Set(ids.map((id) => occupantsFor(h, id)));
chk("school hostels: 6 to 8 in a room", SCHOOL.every((h) => [...seen(h)].every((n) => n >= 6 && n <= 8) && seen(h).size === 3));
chk("Angola and Mozambique: 8 to 10 in a room", BIG.every((h) => [...seen(h)].every((n) => n >= 8 && n <= 10) && seen(h).size === 3));
chk("Ojaja: exactly 2", [...seen("Ojaja")].join() === "2");
chk("off campus: 1 or 2", [...seen("Off-campus")].sort().join() === "1,2");
chk("a player always gets the same number", occupantsFor("Awo", "abc") === occupantsFor("Awo", "abc"));
chk("every hostel a player can pick has a range", ["M", "F"].every((g) => ["LAPO", "MAPO", "NEPO"].every((c) => allowedHostels(c, g, 200).every((h) => occupancyRange(h)))));

const keys = (h, n) => starterFor(h, n), has = (l, k) => l.includes(k), count = (l, k) => l.filter((x) => x === k).length;
for (const h of [...SCHOOL, ...BIG]) for (const n of [6, 7, 8, 9, 10]) { const l = keys(h, n); if (n > 8 && !BIG.includes(h)) continue;
  if (!(count(l, "iron_bunk") === Math.ceil(n / 2) && count(l, "wardrobe") === 1 && !["tv", "gas_cooker", "fridge", "counter", "ensuite", "single_bed", "sofa", "rug"].some((k) => has(l, k)))) { chk(`school ${h} x${n}: iron bunks and wardrobes only`, false); } }
chk("school hostels: iron double bunks (one per two people) and wardrobes only, no TV, no kitchen", keys("Awo", 7).every((k) => k === "iron_bunk" || k === "wardrobe") && count(keys("Awo", 7), "iron_bunk") === 4 && count(keys("Angola", 10), "iron_bunk") === 5);
const oj = keys("Ojaja", 2); chk("Ojaja: 2 single beds, wardrobe, kitchen, toilet, no TV, no bunks", count(oj, "single_bed") === 2 && has(oj, "wardrobe") && has(oj, "counter") && has(oj, "gas_cooker") && has(oj, "fridge") && has(oj, "ensuite") && !has(oj, "tv") && !has(oj, "iron_bunk"));
for (const n of [1, 2]) { const oc = keys("Off-campus", n); chk(`off campus x${n}: ${n} single bed(s), wardrobe, kitchen, toilet and a TV`, count(oc, "single_bed") === n && has(oc, "wardrobe") && has(oc, "counter") && has(oc, "gas_cooker") && has(oc, "ensuite") && has(oc, "tv") && !has(oc, "iron_bunk")); }
chk("every room has exactly one wardrobe, however many people share it", [["Awo", 6], ["Awo", 8], ["Angola", 10], ["Ojaja", 2], ["Off-campus", 1], ["Off-campus", 2]].every(([h, n]) => count(starterFor(h, n), "wardrobe") === 1));
chk("the toilet comes with the room and is not in the shop", ITEMS.ensuite.fixed && !inShop("ensuite") && inShop("single_bed") && inShop("iron_bunk"));

// everything a room comes with must actually fit and be placed
for (const [h, n] of [["Awo", 8], ["Fajuyi", 6], ["Angola", 10], ["Mozambique", 9], ["Ojaja", 2], ["Off-campus", 2], ["Off-campus", 1]]) {
  const room = roomFor(h, "x"), want = starterFor(h, n), placed = []; let all = true;
  for (const [k, zone] of starterPlan(h, n)) { const s = autoPlace(room, placed, k, zone); if (!s || !fits(room, placed, k, s.x, s.z, s.rot)) all = false; else placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  chk(`${h} (${n} people): the whole starter set fits in the ${room.w}x${room.d} room`, all);
}
chk("school rooms use the plain dorm look, Ojaja the suite, off campus the wood look", roomFor("Awo").theme === "dorm" && roomFor("Angola").theme === "dorm" && roomFor("Ojaja").theme === "suite" && roomFor("Off-campus").theme === "wood");
chk("school rooms get rough quickly; Ojaja and off campus stay clean", grimeFor("Awo", 0) < grimeFor("Awo", 4) && grimeFor("Awo", 8) >= 1 - 0.2 && grimeFor("Awo", 11) === 1 && grimeFor("Ojaja", 11) < 0.2 && grimeFor("Off-campus", 11) < 0.2);
console.log(bad ? `\n${bad} check(s) failed` : "\nAll hostel checks passed"); process.exit(bad ? 1 : 0);
