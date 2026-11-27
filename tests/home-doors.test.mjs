// Every doorway keeps about a metre (one cell) clear on both sides, in every home type, with the full starter set placed AND after a stress of bought pieces:
// furniture can never trap or wall in a player. The front door's inside cell is kept clear too.
import { register } from "node:module";
register(new URL("./fixtures/room-loader.mjs", import.meta.url));
const R = await import("../lib/room.js"), F = await import("../lib/furniture.js"), { layoutOf, doorCellsOf, zoneAt } = await import("../lib/layouts.js");
let bad = 0; const chk = (n, ok, x = "") => { console.log(`${ok ? "OK  " : "FAIL"} ${n}${ok ? "" : " -> " + x}`); if (!ok) { bad++; process.exitCode = 1; } };
const BUYS = ["sofa", "dining_set", "wardrobe", "desk", "bookshelf", "piano", "tv_stand", "armchair", "double_bed", "center_table_wood", "rug", "plant", "nightstand", "office_chair", "display_cabinet", "large_smart_tv"].filter((k) => F.ITEMS[k]);
for (const h of ["Awo", "Ojaja", "Off-campus", "1-Bedroom Flat", "2-Bedroom Flat", "3-Bedroom House", "4-Bedroom House"]) {
  const room = R.roomFor(h, "p"), L = layoutOf(room), placed = [];
  for (const [key, zone] of F.starterPlan(h, room.occupants)) { const s = R.autoPlace(room, placed, key, zone); if (s) placed.push({ id: "s" + placed.length, key, placed: true, ...s }); }
  let refused = 0; // bought pieces are accepted only when the game's own placement rule (the one the server applies) allows them, as when a player drags them in
  for (let round = 0; round < 3; round++) for (const key of BUYS) { const s = R.autoPlace(room, placed, key); if (s && R.placementIssue(room, placed, key, s.x, s.z, s.rot) === null) placed.push({ id: "b" + placed.length, key, placed: true, ...s }); else refused++; }
  const occupied = new Set(placed.filter((i) => !F.ITEMS[i.key].flat && !R.isOutside(room, i)).flatMap((i) => R.cellsOf(i.key, i.x, i.z, i.rot ?? 0).map((c) => c.join()))), doors = L ? doorCellsOf(L) : R.doorCells(room);
  chk(`${h}: every doorway cell (both sides of each door) is clear after ${placed.length} pieces (${refused} more refused as blocking)`, doors.every((c) => !occupied.has(c.join())), doors.filter((c) => occupied.has(c.join())).join(" "));
  const [ex, ez] = R.spawnCell(room); chk(`${h}: the cell just inside the front door is clear`, !occupied.has(`${ex},${ez}`));
  chk(`${h}: nothing placed anywhere is walled off from the front door (every piece of floor is reachable)`, R.cutOff(room, placed) === 0, String(R.cutOff(room, placed)));
}
console.log(bad ? `\n${bad} check(s) failed` : "\nAll door-clearance checks passed");
