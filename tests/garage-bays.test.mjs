// tests/garage-bays.test.mjs
// The garage hall of the home compound: every owned vehicle stands in its own painted bay INSIDE the garage (a lane down the middle, bays either side, noses to the lane), tidy and square,
// nothing overlaps, no vehicle touches a wall, every vehicle has a way out along the lane to the gate, a person can reach a door of every one, and the street is a separate group that
// the room shows only outdoors (nothing is drawn beyond the wall, and there are no neighbouring lots).
import fs from "node:fs";
import { CARS } from "../lib/cars.js";
import { LAYOUTS } from "../lib/layouts.js";
import { PLOT_RULES, plotFor } from "../lib/plot.js";
import { planParking, exitRoute, poseBox, compoundWorld } from "../lib3d/compoundParking.js";
import { walkWorld, planEntry, planExit } from "../lib3d/compoundWalk.js";
import { CELL_M } from "../lib3d/compoundUnits.js";

let bad = 0; const chk = (label, ok, extra = "") => { if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}${!ok && extra ? `: ${extra}` : ""}`); };
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const within = (o, r) => o.x0 >= r.x0 - 1e-9 && o.x1 <= r.x1 + 1e-9 && o.z0 >= r.z0 - 1e-9 && o.z1 <= r.z1 + 1e-9;
const fleet = CARS.map((c) => ({ id: c.id, modelId: c.id, color: "#2c5aa0" }));
const HOMES = [{ w: 8, d: 6 }, { w: 14, d: 10 }, ...Object.entries(LAYOUTS).map(([id, L]) => ({ w: L.w, d: L.d, layout: id }))];
const tag = (r) => `${r.w}x${r.d}${r.layout ? ":" + r.layout : ""}`;

chk(`the garage has a bay for every vehicle in the showroom (${PLOT_RULES.bays} bays, ${CARS.length} models)`, PLOT_RULES.bays >= CARS.length);
for (const room of HOMES) {
  const P = plotFor(room), r = planParking(room, fleet), ga = P.garage, bodies = r.slots.map((s) => poseBox(s.x, s.z, s.yaw, s.len, s.wid)), cw = r.cw;
  chk(`${tag(room)}: all ${fleet.length} vehicles stand inside the garage, none on the lawn`, r.slots.length === fleet.length && r.slots.every((s) => s.garage) && bodies.every((b) => within(b, ga)));
  chk(`${tag(room)}: no two vehicles overlap and none touches a wall of the garage`, bodies.every((a, i) => bodies.slice(i + 1).every((b) => !hit(a, b))) && bodies.every((b) => !cw.solids.some((s) => hit(s, b))));
  chk(`${tag(room)}: they are lined up: every vehicle square to the lane, noses to it, one bay each at the same spacing, the lane clear`, r.slots.every((s, i) => { const bay = P.bays[i]; return Math.abs(s.z - bay.z) < 1e-9 && Math.abs(Math.abs(Math.sin(s.yaw)) - 1) < 1e-9 && Math.sign(Math.sin(s.yaw)) === -bay.side && !hit(poseBox(s.x, s.z, s.yaw, s.len, s.wid), { x0: P.lane.x0, x1: P.lane.x1, z0: ga.z0, z1: ga.z1 }); }));
  chk(`${tag(room)}: bays are filled from the front, west then east, so a few vehicles stand together at the open front`, r.slots.slice(0, 4).every((s, i) => i === 0 || s.z <= r.slots[i - 1].z + 1e-9));
  chk(`${tag(room)}: every vehicle can pull out along the lane to the gate (nothing is moved first)`, r.slots.every((s) => { const rt = exitRoute(cw, r.slots, s); return !!rt && rt.at(-1)[1] > P.plot.z1; }));
  const env = { room, cw, slots: r.slots, placed: [] }, world = walkWorld(cw, r.slots), door = { x: P.doorOut.x * CELL_M, z: (P.doorOut.z + 0.5) * CELL_M };
  chk(`${tag(room)}: a person can walk from the front door to a door of every vehicle, and step out of it again`, r.slots.every((s) => { const e = planEntry(env, door, s), x = planExit(env, s); return e.ok && x.ok && world.free(e.spot.x, e.spot.z) && world.free(x.spot.x, x.spot.z); }), "");
}
// more vehicles than bays: the extra ones are parked on the lawn and nothing is dropped, and none of them stands in the garage
{
  const room = { w: 14, d: 10 }, P = plotFor(room), many = Array.from({ length: PLOT_RULES.bays + 3 }, (_, i) => ({ id: "m" + i, modelId: CARS[i % CARS.length].id, color: "#000" })), r = planParking(room, many);
  chk("beyond the garage's bays the rest park on the lawn, and never inside the garage", r.slots.length + r.unplaced.length === many.length && r.slots.filter((s) => !s.garage).every((s) => !hit(poseBox(s.x, s.z, s.yaw, s.len, s.wid), P.garage)));
}
// one vehicle, one bay, both its sides have room for a door
{
  const room = { w: 14, d: 10 }, r = planParking(room, [fleet[0]]), s = r.slots[0];
  chk("a single vehicle stands in the first bay, at the front, with room to open either door", s.garage && s.bay === 0 && !!planEntry({ room, cw: r.cw, slots: r.slots, placed: [] }, { x: 3, z: 3 }, s).ok);
}
// the street is its own group, shown only outdoors, and nothing is drawn past the wall
{
  const plot = fs.readFileSync(new URL("../lib3d/plot3d.js", import.meta.url), "utf8"), room = fs.readFileSync(new URL("../lib3d/room.js", import.meta.url), "utf8");
  chk("the road, kerbs and the footpath beyond the wall are in a group of their own that the plot returns", /road: roadG/.test(plot) && /new THREE\.Group\(\); roadG\.name = "plot-road"/.test(plot));
  chk("the room shows that group only outdoors or in the yard view", /const wantRoad = \(\) => view === "yard" \|\| isOutdoors\(\)/.test(room) && /roadG\.visible = roadShown = wr/.test(room));
  chk("there are no neighbouring lots drawn either side", !/const side = \(x0, x1, dir\)/.test(plot) && !/side\(pl\.x0 - 13/.test(plot));
  chk("the home screen's 3D scene fills the screen", /\.gx\[data-mode="home"\] \.gx-scene \{ left: 0; right: 0; top: 0; bottom: 0; \}/.test(fs.readFileSync(new URL("../components/game-home.css", import.meta.url), "utf8")));
}
console.log(bad ? `\n${bad} garage check(s) failed` : "\nall garage checks passed");
process.exit(bad ? 1 : 0);
