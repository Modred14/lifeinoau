// tools/oau/place-billboards.mjs
// Finds roadside sites for the ten billboards on the REAL road graph, so each one stands beside a road (never on it, never at a junction, a bridge end or against a building), turned toward the
// traffic, visible from the road, and the ten are spread over the campus. Every rule lives in lib3d/billboardSite.js; tests/billboard-sites.test.mjs holds the result to the same rules.
//
//   node tools/oau/place-billboards.mjs            print the chosen sites and how each one fares
//   --data=path --graph=path   use another map / road graph (default: public/data/oau-campus.json and oau-roadgraph.json)      --json=path   also write the chosen sites as JSON
//   node tools/oau/place-billboards.mjs --write    also rewrite the OSM billboard sites in lib3d/mapLayout.js
//
// Run it again after `npm run build:roads` (new roads can move the verge). The search is deterministic: the same roads give the same sites.
import fs from "node:fs";
import { buildServices } from "../../lib3d/worldsvc.js";
import { withExtras, BILLBOARD } from "../../lib3d/mapExtras.js";
import { buildRoadFurniture } from "../../lib3d/roadfurniture.js";
import { SCENE_S } from "../../lib3d/roadsurface.js";
import { makeContext, checkBillboard, yawFor, visibility, RULES } from "../../lib3d/billboardSite.js";

const url = (f) => new URL(f, import.meta.url), read = (f) => JSON.parse(fs.readFileSync(url("../../public/data/" + f), "utf8")), WRITE = process.argv.includes("--write");
const arg = (k) => process.argv.find((a) => a.startsWith("--" + k + "="))?.slice(k.length + 3), readAbs = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const raw = arg("graph") ? readAbs(arg("graph")) : read("oau-roadgraph.json"), data = withExtras(arg("data") ? readAbs(arg("data")) : read("oau-campus.json")), svc = buildServices(data, raw), G = svc.graph;
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

// ---- 2. one board for each of the ten places the boards are named after ----
// Each board has an ANCHOR (a place, or the middle of a group of places). The board goes to the best-scoring valid site near its anchor: the search starts 200 m out and widens by 100 m until a site exists that keeps
// RULES.spacing from the boards already chosen. Order matters (bb_1 first), so the boards named after the busiest places are never crowded out by the later ones. Score = the site's sight-line score, minus 0.15 per metre from the anchor.
const GROUP = { halls: ["h_awo", "h_angola", "h_mozambique"], banks: ["ecobank", "wema_bank", "first_bank", "zenith_bank", "access_bank"], clubs: ["club_quantum", "club_0203", "club_divas"] };
const INTENTS = [
  { label: "Senate Plaza", at: ["senate"] }, { label: "Library Road", at: ["library"] }, { label: "Law Corner", at: ["f_law"] }, { label: "Student Union Strip", at: ["sub"] },
  { label: "Moremi Junction", at: ["h_moremi"] }, { label: "Alumni Road", at: ["h_alumni"] }, { label: "Halls Row", at: GROUP.halls }, { label: "Fajuyi Crossing", at: ["h_fajuyi"] },
  { label: "Ede Road Banks", at: GROUP.banks }, { label: "Nightlife Strip", at: GROUP.clubs },
];
const N = BILLBOARD.COUNT, byId = new Map(data.places.map((p) => [p.id, p]));
for (const it of INTENTS) { const ps = it.at.map((id) => byId.get(id)).filter((p) => p && p.x != null); if (!ps.length) { console.error("no place for " + it.label + ": " + it.at.join(", ")); process.exit(1); } it.x = ps.reduce((t, p) => t + p.x, 0) / ps.length; it.z = ps.reduce((t, p) => t + p.z, 0) / ps.length; }
found.sort((a, b2) => b2.score - a.score || a.x - b2.x || a.z - b2.z);
const sites = [];
for (const it of INTENTS) {
  let pickOne = null;
  for (let R = 200; R <= 1600 && !pickOne; R += 100) for (const c of found) { const d = Math.hypot(c.x - it.x, c.z - it.z); if (d > R || !sites.every((q) => Math.hypot(q.x - c.x, q.z - c.z) >= RULES.spacing)) continue; const v = c.score - 0.15 * d; if (!pickOne || v > pickOne.v) pickOne = { c, v, d }; }
  if (!pickOne) { console.error("no valid site for " + it.label); process.exit(1); }
  sites.push({ ...pickOne.c, anchorM: Math.round(pickOne.d) });
}

// ---- 4. name each one after the nearest place on the map with a name short enough for a map card ----
const named = data.places.filter((p) => p.kind !== "billboard" && p.kind !== "jail" && p.name && !p.offmap && p.x != null && p.tier <= 2);
const clean = (n) => n.replace(/^(Hezekiah Oluwasanmi|Murtala Muhammed|Faculty of|Department of|College of) /, "").replace(/\s+\(.*\)$/, "");
const rows = sites.map((c, i) => { const nb = named.map((p) => ({ d: Math.hypot(p.x - c.x, p.z - c.z), name: clean(p.name) })).filter((q) => q.name.length <= 24).sort((a, b) => a.d - b.d)[0]; return { ...c, n: i + 1, where: INTENTS[i].label, x: +c.x.toFixed(1), z: +c.z.toFixed(1), yaw: +c.yaw.toFixed(3) }; });
const dist = (a, b) => Math.round(Math.hypot(a.x - b.x, a.z - b.z));
console.table(rows.map((r) => ({ n: r.n, where: r.where, x: r.x, z: r.z, yaw: r.yaw, road: r.cls, gap: +r.gap.toFixed(1), junction: Math.round(r.junction), seenNearM: r.near, seenFarM: r.far, anchorM: r.anchorM })));
let closest = Infinity; for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) closest = Math.min(closest, dist(rows[i], rows[j]));
console.log(`closest two boards: ${closest} m apart (rule: ${RULES.spacing})`);

if (arg("json")) { fs.writeFileSync(arg("json"), JSON.stringify(rows.map((r) => ({ n: r.n, id: "bb_" + r.n, where: r.where, x: r.x, z: r.z, yaw: r.yaw, road: r.cls, edge: r.edge, anchorM: r.anchorM })), null, 1) + "\n"); console.log("wrote " + arg("json")); }
if (WRITE) {   // writes the sites of the map in use (lib3d/mapLayout.js LAYOUT) into its entry of mapLayout.js
  const file = url("../../lib3d/mapLayout.js"); let src = fs.readFileSync(file, "utf8");
  const which = src.match(/export const LAYOUT = "(\w+)";/)[1], list = `[\n${rows.map((r) => `      [${JSON.stringify(r.where)}, ${r.x}, ${r.z}, ${r.yaw}],`).join("\n")}\n    ]`;
  if (which !== "osm") { console.error("--write only rewrites the OSM entry; the active map is " + which + " (node tools/oau/use-map.mjs osm)"); process.exit(1); }
  const re = /(osm: \{[\s\S]*?)billboardSites: \[[\s\S]*?\],   \/\/ BILLBOARD-SITES-OSM/; if (!re.test(src)) { console.error("marker not found in lib3d/mapLayout.js"); process.exit(1); }
  fs.writeFileSync(file, src.replace(re, (_, pre) => `${pre}billboardSites: ${list},   // BILLBOARD-SITES-OSM`)); console.log("lib3d/mapLayout.js updated (osm billboard sites)");
}
