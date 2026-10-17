// tests/interiors.test.mjs
// Every place on the map is either given a walkable interior or kept outdoors ON PURPOSE. Pure Node: no 3D library, no network.
// Checks: explicit classification, the outdoor exceptions, and for every interior: it compiles, the doors are wide enough for the player,
// the spawn and the porch are free, every room can be reached from the entrance, solid items do not overlap and stay inside their rooms.
import fs from "node:fs";
import { LANDMARKS } from "../lib3d/landmarks.js";
import { withExtras } from "../lib3d/mapExtras.js";
import { classify, buildPlan } from "../lib3d/interiors/index.js";
import { compile, movePlayer, EXIT_DEPTH } from "../lib3d/interiors/compile.js";
import { dimsOf, footprint } from "../lib3d/interiors/items.js";
const walkTo = (c, P, pts) => { for (const [x, z] of pts) { let g = 0; while (Math.hypot(x - P.x, z - P.z) > 0.1 && g++ < 1500) { const d = Math.hypot(x - P.x, z - P.z), st = Math.min(0.08, d); movePlayer(c, P, ((x - P.x) / d) * st, ((z - P.z) / d) * st); } if (Math.hypot(x - P.x, z - P.z) > 0.25) return false; } return true; };
let bad = 0; const chk = (l, c, more) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l + (!c && more ? "\n     " + more : "")); };

const d = withExtras(JSON.parse(fs.readFileSync(new URL("../public/data/oau-campus.json", import.meta.url), "utf8")));
const all = new Map();
for (const l of LANDMARKS) all.set(l.id, { id: l.id, name: l.name, kind: l.kind });
for (const p of d.places) all.set(p.id, { id: p.id, name: p.name, kind: p.kind });
const places = [...all.values()];

const cls = places.map((p) => ({ p, c: classify(p.id, p.kind) }));
chk(`${places.length} places are all classified`, cls.every((x) => x.c.mode === "interior" || x.c.mode === "outdoor"));
const unclassified = cls.filter((x) => x.c.mode === "outdoor" && /unclassified/i.test(x.c.why ?? "")).map((x) => x.p.id);
chk("no place falls through to an unexplained outdoor default", unclassified.length === 0, unclassified.join(", "));
const MUST_OUT = ["amphitheatre", "moremi_statue", "motion_ground", "religious_ground", "main_bowl", "basketball", "humanities_car_park", "gate", "bio_gardens", "zoo", "damico", "ede_road", "road1", "mayfair", "asherifa", "sabo", "parakin", "lagere"];
for (const id of MUST_OUT) if (all.has(id)) chk(`${id} stays outdoors`, classify(id, all.get(id).kind).mode === "outdoor");
chk("every billboard stays outdoors", places.filter((p) => p.kind === "billboard" || p.id.startsWith("bb_")).every((p) => classify(p.id, p.kind).mode === "outdoor"));
const MUST_IN = ["oduduwa", "library", "senate", "sub", "lt_1000", "h_alumni", "h_ojaja", "h_pg", "science", "health_centre", "club_quantum", "club_0203", "club_divas", "church_catholic", "etf_mosque", "floor0", "squash_court", "new_market"];
for (const id of MUST_IN) if (all.has(id)) chk(`${id} has an interior`, classify(id, all.get(id).kind).mode === "interior");

const ins = cls.filter((x) => x.c.mode === "interior").map((x) => x.p);
let n = 0, solidsBad = 0;
for (const pl of ins) {
  const probs = []; let c;
  try { const plan = buildPlan({ ...pl, actions: [] }); c = compile(plan); } catch (e) { chk(`${pl.id} compiles`, false, e.stack.split("\n").slice(0, 3).join(" | ")); continue; }
  for (const dr of c.plan.doors) { const nv = c.navPlayer[dr.floor]; const dx = dr.axis === "x" ? 0 : 1, dz = dr.axis === "x" ? 1 : 0; for (const s of [-0.8, 0.8]) { const x = (dr.axis === "x" ? dr.pos : dr.coord) + dx * s, z = (dr.axis === "x" ? dr.coord : dr.pos) + dz * s; if (!nv.isFree(x, z)) probs.push(`door ${dr.a}/${dr.b} blocked`); } }
  { const nv = c.navPlayer[0], sn = nv.snap(c.spawn.x, c.spawn.z); if (!sn || Math.hypot(sn[0] - c.spawn.x, sn[1] - c.spawn.z) > 0.45) probs.push("spawn not on free floor"); }
  for (const r of c.rooms) { if (r.kind === "stair") continue; const nv = c.navPlayer[r.floor], rp = c.reach[r.floor]; let any = false; for (let z = r.z0 + 0.4; z < r.z1 && !any; z += 0.4) for (let x = r.x0 + 0.4; x < r.x1; x += 0.4) { const [i, j] = nv.cell(x, z); if (nv.at(i, j) && rp[j * nv.nx + i]) { any = true; break; } } if (!any) probs.push(`room ${r.id} unreachable`); }
  const sol = c.items.filter((i) => dimsOf(i).solid).map((i) => ({ i, f: footprint(i) }));
  for (let a = 0; a < sol.length; a++) for (let b = a + 1; b < sol.length; b++) { if (sol[a].i.floor !== sol[b].i.floor) continue; const A = sol[a].f, B = sol[b].f; if (A.x0 < B.x1 - 0.05 && A.x1 > B.x0 + 0.05 && A.z0 < B.z1 - 0.05 && A.z1 > B.z0 + 0.05) probs.push(`overlap ${sol[a].i.type}/${sol[b].i.type}`); }
  for (const i of c.items) { if (i.lift) continue; const f = footprint(i), r = c.rooms.find((q) => q.floor === i.floor && i.x >= q.x0 && i.x <= q.x1 && i.z >= q.z0 && i.z <= q.z1); if (!r) { probs.push(`item ${i.type} outside rooms`); continue; } if (dimsOf(i).solid && (f.x0 < r.x0 - 0.01 || f.x1 > r.x1 + 0.01 || f.z0 < r.z0 - 0.01 || f.z1 > r.z1 + 0.01)) probs.push(`item ${i.type} sticks out of ${r.id}`); }
  // really walk it: out through the front door, and up the stairs to a room on the first floor and back down (same movement code as the 3D scene)
  { const P = { x: c.spawn.x, z: c.spawn.z, y: 0, fl: 0 }, e = c.porch;
    if (e) { const tx = e.axis === "x" ? e.pos : e.line + e.out[0] * (EXIT_DEPTH + 0.5), tz = e.axis === "x" ? e.line + e.out[1] * (EXIT_DEPTH + 0.5) : e.pos; if (!walkTo(c, P, [[e.axis === "x" ? e.pos : e.line - e.out[0] * 0.5, e.axis === "x" ? e.line - e.out[1] * 0.5 : e.pos], [tx, tz]]) || c.outsideDepth(P.x, P.z) <= EXIT_DEPTH) probs.push("cannot walk out of the front door"); }
    if (c.floors > 1 && c.stairs.length) { const P2 = { x: c.spawn.x, z: c.spawn.z, y: 0, fl: 0 }, s = c.stairs[0], mid = (a, b) => (a + b) / 2, lo = s.dx ? [s.dx > 0 ? s.x0 + 0.4 : s.x1 - 0.4, mid(s.z0, s.z1)] : [mid(s.x0, s.x1), s.dz > 0 ? s.z0 + 0.4 : s.z1 - 0.4], hi = s.dx ? [s.dx > 0 ? s.x1 - 0.4 : s.x0 + 0.4, mid(s.z0, s.z1)] : [mid(s.x0, s.x1), s.dz > 0 ? s.z1 - 0.4 : s.z0 + 0.4];
      const up = c.rooms.find((r) => r.floor === 1 && r.kind !== "stair" && c.navPlayer[1].snap((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2)), p0 = c.navPlayer[0].path(P2.x, P2.z, lo[0], lo[1]);
      if (!p0 || !up) probs.push("no route to the stairs"); else { const p1 = c.navPlayer[1].path(hi[0], hi[1], (up.x0 + up.x1) / 2, (up.z0 + up.z1) / 2); const ok = p1 && walkTo(c, P2, [...p0.slice(1), lo, hi]) && P2.fl === 1 && walkTo(c, P2, p1.slice(1)); if (!ok) probs.push("cannot walk up the stairs to " + up.name); else { const back = c.navPlayer[1].path(P2.x, P2.z, hi[0], hi[1]); if (!(back && walkTo(c, P2, [...back.slice(1), lo]) && P2.fl === 0 && P2.y < 0.5)) probs.push("cannot walk back down"); } } } }
  n++; if (probs.length) solidsBad++; chk(`interior ${pl.id}: ${c.rooms.length} rooms, ${c.items.length} items, ${c.npcs.length} people`, probs.length === 0, [...new Set(probs)].slice(0, 6).join("; "));
}
chk(`${n} interiors were validated`, n === ins.length && n > 60);
console.log(bad ? `\n${bad} check(s) failed` : "\nAll interior checks passed"); process.exit(bad ? 1 : 0);
