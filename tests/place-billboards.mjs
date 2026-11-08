// tools/oau/place-billboards.mjs
// Finds roadside sites for the ten billboards on the REAL road graph, so each one stands beside a road (never on it, never at a junction, a bridge end or against a building), turned toward the
// traffic, visible from the road, and the ten are spread over the campus. Every rule lives in lib3d/billboardSite.js; tests/billboard-sites.test.mjs holds the result to the same rules.
//
//   node tools/oau/place-billboards.mjs            print the chosen sites and how each one fares
//   node tools/oau/place-billboards.mjs --write    also rewrite the BILLBOARD_SITES block in lib3d/mapExtras.js
//
// Run it again after `npm run build:roads` (new roads can move the verge). The search is deterministic: the same roads give the same sites.
import fs from "node:fs";
import { buildServices } from "../../lib3d/worldsvc.js";
import { withExtras, BILLBOARD } from "../../lib3d/mapExtras.js";
import { buildRoadFurniture } from "../../lib3d/roadfurniture.js";
import { SCENE_S } from "../../lib3d/roadsurface.js";
import { makeContext, checkBillboard, yawFor, visibility, RULES } from "../../lib3d/billboardSite.js";

const url = (f) => new URL(f, import.meta.url), read = (f) => JSON.parse(fs.readFileSync(url("../../public/data/" + f), "utf8")), WRITE = process.argv.includes("--write");
const raw = read("oau-roadgraph.json"), data = withExtras(read("oau-campus.json")), svc = buildServices(data, raw), G = svc.graph;
const furniture = buildRoadFurniture(G, SCENE_S).userData.spots, ctx = makeContext(data, G, { furniture });
const old = data.places.filter((p) => p.kind === "billboard").sort((a, b) => a.board - b.board);   // where the boards stand now, for numbering the new sites

// ---- 1. every roadside position that obeys the rules ----
const CLS_BONUS = { arterial: 40, collector: 20, local: 0 }, TILTS = [34, 44], LEANS = [1, -1], found = [];
let tried = 0;
for (const e of G.edges) {
  if (e.hw || e.foot || e.len < 130 || e.kind === "ramp") continue;
  for (let s = 50; s <= e.len - 50; s += 6) {
    const p = e.path.at(s, {});
    for (const side of [1, -1]) for (let off = e.half + e.sw + 8; off <= e.half + e.sw + 20; off += 2) {
      const x = p.x + side * -p.hz * off, z = p.z + side * p.hx * off; let best = null;
      for (const tilt of TILTS) for (const lean of LEANS) {
        tried++; const site = { x, z, yaw: yawFor(p.hx, p.hz, side, tilt, lean) }, r = checkBillboard(site, ctx, { skipView: true }); if (!r.ok) continue;
        const v = visibility(ctx, site); if (!v || v.near.m < 56 || v.near.frac < 0.75 || v.far.m < 32 || v.far.frac < 0.6) continue;
        const score = v.near.m + 0.5 * v.far.m + (CLS_BONUS[e.cls] ?? 0) - 1.5 * Math.abs(r.m.gap - 9) + 0.1 * Math.min(150, r.m.junction);
        if (!best || score > best.score) best = { ...site, score, edge: e.id, cls: e.cls, gap: r.m.gap, junction: r.m.junction, near: v.near.m, far: v.far.m, tilt, lean, side };
      }
      if (best) found.push(best);
    }
  }
}
console.log(`${tried} variants tried, ${found.length} valid roadside positions`);
if (found.length < BILLBOARD.COUNT) { console.error("not enough valid sites"); process.exit(1); }

// ---- 2. ten of them, so that wherever a player drives there is a billboard to be seen ----
// Demand is the drivable road itself (a point every 40 m inside the map). A set of boards costs the average distance from those points to the nearest board, each capped at COVER_CAP so a far
// corner cannot pull every board toward it; the sight-line score is a mild tiebreaker. Greedy build-up, then swaps until nothing improves. Boards keep RULES.spacing apart.
const COVER_CAP = 700, SCORE_W = 0.4, N = BILLBOARD.COUNT, b = data.bounds, demand = [];
for (const e of G.edges) { if (e.hw || e.foot || e.kind === "ramp") continue; for (let s = 0; s <= e.len; s += 40) { const p = e.path.at(s, {}); if (p.x > b.x0 + 120 && p.x < b.x1 - 120 && p.z > b.z0 + 120 && p.z < b.z1 - 120) demand.push(p); } }
found.sort((a, b2) => b2.score - a.score || a.x - b2.x || a.z - b2.z);
const D = found.map((c) => Float32Array.from(demand, (p) => Math.min(COVER_CAP, Math.hypot(c.x - p.x, c.z - p.z)))), meanScore = (ix) => ix.reduce((t, i) => t + found[i].score, 0) / ix.length;
const cover = (ix) => { let t = 0; for (let k = 0; k < demand.length; k++) { let m = COVER_CAP; for (const i of ix) m = Math.min(m, D[i][k]); t += m; } return t / demand.length; };
const objective = (ix) => cover(ix) - SCORE_W * meanScore(ix), apart = (i, ix) => ix.every((j) => Math.hypot(found[i].x - found[j].x, found[i].z - found[j].z) >= RULES.spacing);
let pick = [];
while (pick.length < N) { let bi = -1, bv = Infinity; for (let i = 0; i < found.length; i++) { if (pick.includes(i) || !apart(i, pick)) continue; const v = objective([...pick, i]); if (v < bv) { bv = v; bi = i; } } if (bi < 0) { console.error("could only spread " + pick.length + " boards"); process.exit(1); } pick.push(bi); }
for (let pass = 0, again = true; again && pass < 6; pass++) { again = false;
  for (let k = 0; k < pick.length; k++) { const rest = pick.filter((_, q) => q !== k); let bi = pick[k], bv = objective(pick);
    for (let i = 0; i < found.length; i++) { if (pick.includes(i) || !apart(i, rest)) continue; const v = objective([...rest, i]); if (v < bv - 1e-9) { bv = v; bi = i; } }
    if (bi !== pick[k]) { pick[k] = bi; again = true; } } }
const chosen = pick.map((i) => found[i]);
console.log(`average distance from a road to its nearest board: ${cover(pick).toFixed(0)} m (capped at ${COVER_CAP}); before the move the old boards gave ${(() => { let t = 0; for (const p of demand) t += Math.min(COVER_CAP, ...old.map((o) => Math.hypot(o.x - p.x, o.z - p.z))); return (t / demand.length).toFixed(0); })()} m`);

// ---- 3. number them so each board moves as little as it can from where it stood ----
const cost = old.map((o) => chosen.map((c) => Math.hypot(o.x - c.x, o.z - c.z))), memo = new Map();
const best = (i, used) => { if (i === N) return [0, []]; const k = i * 4096 + used; if (memo.has(k)) return memo.get(k); let res = [Infinity, []]; for (let j = 0; j < N; j++) { if (used & (1 << j)) continue; const [c, rest] = best(i + 1, used | (1 << j)); if (c + cost[i][j] < res[0]) res = [c + cost[i][j], [j, ...rest]]; } memo.set(k, res); return res; };
const order = best(0, 0)[1], sites = order.map((j) => chosen[j]);

// ---- 4. name each one after the nearest place on the map with a name short enough for a map card ----
const named = data.places.filter((p) => p.kind !== "billboard" && p.kind !== "jail" && p.name && !p.offmap && p.x != null && p.tier <= 2);
const clean = (n) => n.replace(/^(Hezekiah Oluwasanmi|Murtala Muhammed|Faculty of|Department of|College of) /, "").replace(/\s+\(.*\)$/, "");
const rows = sites.map((c, i) => { const nb = named.map((p) => ({ d: Math.hypot(p.x - c.x, p.z - c.z), name: clean(p.name) })).filter((q) => q.name.length <= 24).sort((a, b) => a.d - b.d)[0]; return { ...c, n: i + 1, where: `${nb.name} Road`, x: +c.x.toFixed(1), z: +c.z.toFixed(1), yaw: +c.yaw.toFixed(3) }; });
const dist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z));
console.table(rows.map((r) => ({ n: r.n, where: r.where, x: r.x, z: r.z, yaw: r.yaw, road: r.cls, gap: +r.gap.toFixed(1), junction: Math.round(r.junction), seenNearM: r.near, seenFarM: r.far, movedM: dist(r, old[r.n - 1]) })));
let closest = Infinity; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) closest = Math.min(closest, dist(rows[i], rows[j]));
console.log(`closest two boards: ${closest} m apart (rule: ${RULES.spacing})`);

if (WRITE) {
  const file = url("../../lib3d/mapExtras.js"); let src = fs.readFileSync(file, "utf8");
  const block = `// BILLBOARD-SITES:BEGIN (written by tools/oau/place-billboards.mjs; tests/billboard-sites.test.mjs holds every site to the rules in lib3d/billboardSite.js)\nexport const BILLBOARD_SITES = [\n${rows.map((r) => `  [${JSON.stringify(r.where)}, ${r.x}, ${r.z}, ${r.yaw}],`).join("\n")}\n];\n// BILLBOARD-SITES:END`;
  const re = /\/\/ BILLBOARD-SITES:BEGIN[\s\S]*?\/\/ BILLBOARD-SITES:END/; if (!re.test(src)) { console.error("markers not found in lib3d/mapExtras.js"); process.exit(1); }
  fs.writeFileSync(file, src.replace(re, () => block)); console.log("lib3d/mapExtras.js updated");
}
