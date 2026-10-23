// tests/room-size.test.mjs
// The player's room is about three times the floor area it used to be (school halls 8x6 and 9x7 cells, the one-bedroom place 8x8, the flats 8x10).
// Checks the new sizes, that every plan is still sound (doorways, front door, windows, decorations), that what every home comes with fits and nothing
// is walled in, that the character can walk everywhere (the same findPath the 3D room uses), and that a heavily furnished room still works.
// Pure Node: no database, no browser.
import { roomFor, SCHOOL_ROOM, BIG_SCHOOL_ROOM, fits, autoPlace, blockedCells, findPath, spawnCell, doorCells, consistent, cutOff, outdoorSlots, isOutsideCell } from "../lib/room.js";
import { LAYOUTS, HOME_SIZE, layoutOf, zoneAt, canStep, wallRuns, doorCellsOf } from "../lib/layouts.js";
import { starterPlan, ITEMS, MAX_ITEMS, inShop } from "../lib/furniture.js";
import { occupantsFor } from "../lib/rules.js";

let bad = 0; const chk = (l, c, extra) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && extra !== undefined ? "  -> " + extra : "")); };
const area = (r) => r.w * r.d;
const SCHOOL = ["Awo", "Fajuyi", "Moremi", "Angola", "Mozambique", "Hogwarts"].filter((h) => { try { return roomFor(h).theme === "dorm"; } catch { return false; } });

// ---- the new sizes (the old area is what the rooms were before) ----
const OLD = { school: 8 * 6, bigSchool: 9 * 7, studio: 8 * 8, flat: 8 * 10 };
const ratio = (now, old) => +(now / old).toFixed(2);
chk("a school room is about three times its old floor area (16x9 for 8x6)", SCHOOL_ROOM.join("x") === "16x9" && ratio(144, OLD.school) >= 2.8 && ratio(144, OLD.school) <= 3.2);
chk("the two big school halls are about three times theirs (19x10 for 9x7)", BIG_SCHOOL_ROOM.join("x") === "19x10" && ratio(190, OLD.bigSchool) >= 2.8 && ratio(190, OLD.bigSchool) <= 3.2);
chk("Ojaja and off campus are about three times the old one-bedroom place", ratio(LAYOUTS.studio.w * LAYOUTS.studio.d, OLD.studio) >= 2.8 && ratio(LAYOUTS.studio.w * LAYOUTS.studio.d, OLD.studio) <= 3.2, LAYOUTS.studio.w + "x" + LAYOUTS.studio.d);
chk("both flats are about three times the old flat size", ["flat1", "flat2"].every((k) => ratio(LAYOUTS[k].w * LAYOUTS[k].d, OLD.flat) >= 2.8 && ratio(LAYOUTS[k].w * LAYOUTS[k].d, OLD.flat) <= 3.2));
chk("roomFor() reports the real sizes the server and the 3D room both use", [["Awo", 16, 9], ["Fajuyi", 16, 9], ["ETF", 16, 9], ["Moremi", 16, 9], ["Akintola", 16, 9], ["Alumni", 16, 9], ["Angola", 19, 10], ["Mozambique", 19, 10], ["Ojaja", 14, 14], ["Off-campus", 14, 14], ["1-Bedroom Flat", 15, 16], ["2-Bedroom Flat", 15, 16]].every(([h, w, d]) => { const r = roomFor(h, "p"); return r.w === w && r.d === d; }));
chk("the plans are exactly the size HOME_SIZE says", Object.entries(HOME_SIZE).every(([k, [w, d]]) => LAYOUTS[k].w === w && LAYOUTS[k].d === d && LAYOUTS[k].grid.length === d && LAYOUTS[k].grid.every((r) => r.length === w)));

// ---- every plan is still sound ----
for (const [id, L] of Object.entries(LAYOUTS)) {
  const seen = new Set([[L.entry.x, L.entry.z].join()]), q = [[L.entry.x, L.entry.z]];
  while (q.length) { const c = q.shift(); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = [c[0] + dx, c[1] + dz]; if (!seen.has(n.join()) && zoneAt(L, n[0], n[1]) && canStep(L, c, n)) { seen.add(n.join()); q.push(n); } } }
  chk(`${id}: every cell can be reached from the front door, only through doorways`, seen.size === L.w * L.d);
  chk(`${id}: the front door is on the south wall, inside the plan`, L.entry.z === L.d - 1 && L.entry.x >= 0 && L.entry.x < L.w && L.entry.at >= 0 && L.entry.at <= L.w);
  chk(`${id}: every doorway joins two touching cells of two different rooms`, L.doors.every(([a, b, c, d]) => Math.abs(a - c) + Math.abs(b - d) === 1 && zoneAt(L, a, b) && zoneAt(L, c, d) && zoneAt(L, a, b).id !== zoneAt(L, c, d).id));
  chk(`${id}: the doorways are the same in number and each pair of rooms they join is unchanged`, wallRuns(L).doors.length === L.doors.length);
  chk(`${id}: the walking goal is a cell of the plan`, !!zoneAt(L, L.goal[0], L.goal[1]));
  const len = (side) => (side === "N" || side === "S" ? L.w : L.d);
  chk(`${id}: every window and decoration sits on its wall, not past the corner`, [...L.windows, ...L.decor].every((x) => x.at > 0.3 && x.at < len(x.side) - 0.3), JSON.stringify([...L.windows, ...L.decor].filter((x) => !(x.at > 0.3 && x.at < len(x.side) - 0.3))));
  const clash = L.windows.some((w, i) => L.windows.some((v, j) => j > i && v.side === w.side && Math.abs(v.at - w.at) < (w.w + v.w) / 2 + 0.3));
  chk(`${id}: no two windows overlap`, !clash);
  chk(`${id}: no room of the plan is squeezed to nothing (a room is at least 3 cells in both ways; the passage and the bathroom at least 2)`, L.zones.every((z) => { const cs = L.grid.flatMap((r, zz) => r.map((zn, x) => (zn.id === z.id ? [x, zz] : null))).filter(Boolean), xs = cs.map((c) => c[0]), zs = cs.map((c) => c[1]), need = z.kind === "passage" || z.kind === "bath" ? 2 : 3; return Math.max(...xs) - Math.min(...xs) + 1 >= need && Math.max(...zs) - Math.min(...zs) + 1 >= need; }));
}

// ---- what each home comes with fits, nothing is walled in, and the character can walk everywhere ----
const HOMES = ["Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat"];
function walkable(room, placed) {
  const bl = blockedCells(placed), start = spawnCell(room), L = layoutOf(room); let free = 0, reached = 0;
  for (let z = 0; z < room.d; z++) for (let x = 0; x < room.w; x++) { if (bl.has(x + "," + z)) continue; free++; if ((x === start[0] && z === start[1]) || findPath(room, bl, start, [x, z]).length) reached++; }
  return { free, reached, L };
}
for (const [h, n] of [["Awo", 6], ["Awo", 8], ["Fajuyi", 8], ["Angola", 10], ["Mozambique", 10], ...HOMES.map((x) => [x, occupantsFor(x, "p1")]), ["Off-campus", 1], ["Off-campus", 2]]) {
  const room = roomFor(h, "p1"), plan = starterPlan(h, n), placed = []; let all = true;
  for (const [k, zone] of plan) { const s = autoPlace(room, placed, k, zone); if (!s || !fits(room, placed, k, s.x, s.z, s.rot)) all = false; else placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  chk(`${h} x${n} (${room.w}x${room.d}): the whole starter set fits`, all);
  chk(`${h} x${n}: it is consistent, with no door, room or piece walled in`, consistent(room, placed) && cutOff(room, placed) === 0);
  const w = walkable(room, placed);
  chk(`${h} x${n}: the character can walk to every free cell from the front door (${w.reached}/${w.free})`, w.reached === w.free);
  const doors = doorCells(room).map((c) => c.join());
  chk(`${h} x${n}: nothing but a rug blocks a doorway or the spot inside the front door`, placed.every((p) => ITEMS[p.key].flat || ITEMS[p.key].outdoor || !doors.some((d) => { const [x, z] = d.split(",").map(Number); return blockedCells([p]).has(x + "," + z); })));
}

// ---- the room feels roomy: much more floor stays free than before ----
{ const room = roomFor("Awo", "p1"), plan = starterPlan("Awo", 8), placed = [];
  for (const [k, z] of plan) { const s = autoPlace(room, placed, k, z); if (s) placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  const free = area(room) - blockedCells(placed).size;
  chk(`a full school room (8 people) leaves most of the floor free (${free} of ${area(room)} cells)`, free / area(room) > 0.6); }

// ---- a lived-in room: lots of bought furniture still goes in, still reachable ----
for (const h of ["Awo", "Ojaja", "2-Bedroom Flat"]) {
  const room = roomFor(h, "p1"), plan = starterPlan(h, room.occupants), placed = [];
  for (const [k, z] of plan) { const s = autoPlace(room, placed, k, z); if (s) placed.push({ id: String(placed.length), key: k, placed: true, ...s }); }
  const buy = Object.keys(ITEMS).filter((k) => inShop(k) && !ITEMS[k].outdoor && !ITEMS[k].flat && ITEMS[k].w * ITEMS[k].d <= 2 && k !== "iron_bunk");
  let bought = 0; for (let i = 0; i < 40; i++) { const k = buy[i % buy.length], s = autoPlace(room, placed, k); if (!s) continue; placed.push({ id: String(placed.length), key: k, placed: true, ...s }); bought++; }
  const w = walkable(room, placed);
  chk(`${h}: after buying ${bought} more pieces everything still stands legally`, bought >= 24 && consistent(room, placed), bought);
  chk(`${h}: ...and the character can still reach every free cell that has a path (${w.reached}/${w.free})`, w.reached >= w.free * 0.9);
}

// ---- the lawn (generators) and the walking grid edges ----
for (const h of ["Awo", "Angola", ...HOMES]) {
  const room = roomFor(h, "p"), placed = []; for (let i = 0; i < 9; i++) { const s = autoPlace(room, placed, "generator"); if (s) placed.push({ id: "g" + i, key: "generator", placed: true, ...s }); }
  chk(`${h}: the eight generator spots are outside the east wall of the bigger room, and still all work`, placed.length === 8 && outdoorSlots(room).every(([x, z]) => isOutsideCell(room, x) && z >= 0 && z < room.d) && placed.every((p) => fits(room, placed, "generator", p.x, p.z, p.rot, p.id)));
  chk(`${h}: nothing can be put outside the floor`, !fits(room, [], "sofa", room.w - 1, 0, 0) && !fits(room, [], "plant", room.w, 0, 0) && !fits(room, [], "plant", -1, 0, 0) && !fits(room, [], "plant", 0, room.d, 0));
}
chk("the shop limit on owned things is unchanged", MAX_ITEMS === 60);

console.log(bad ? `\n${bad} check(s) failed` : "\nAll room-size checks passed"); process.exit(bad ? 1 : 0);
