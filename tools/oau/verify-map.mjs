// tools/oau/verify-map.mjs: checks the map in use (public/data/oau-campus.json + oau-roadgraph.json) by script. Prints one line per check and exits 1 if any fails.  node tools/oau/verify-map.mjs
//   1. the expressway is one connected piece that joins the campus network at both ends (no dead end), long, elevated, three lanes each way
//   2. every billboard stands by a road under the rules of lib3d/billboardSite.js (footing, gap, junction, dead end, bridge/ramp, deck, pier, sight lines)
//   3. no building stands inside a road, and none inside the expressway's corridor (deck half width + 24 m)
//   4. no place (a point the game sends you to) stands inside a road or the expressway's corridor
import fs from "node:fs";
import { withExtras } from "../../lib3d/mapExtras.js";
import { buildRoadGraph } from "../../lib3d/roadgraph.js";
import { alignment, HW } from "../../lib3d/highway.js";
import { spawnSync } from "node:child_process";
const read = (f) => JSON.parse(fs.readFileSync(new URL("../../public/data/" + f, import.meta.url), "utf8"));
const raw = read("oau-roadgraph.json"), data = withExtras(read("oau-campus.json")), G = buildRoadGraph(raw), ex = raw.expressway;
let bad = 0; const chk = (name, ok, detail = "") => { console.log((ok ? "OK   " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); if (!ok) bad++; };
const hyp = Math.hypot;

// 1. the expressway
{ const hw = G.edges.filter((e) => e.hw), ground = G.edges.filter((e) => !e.hw), deg = new Map();
  for (const e of G.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  const par = new Map(); const f = (x) => (par.get(x) === x ? x : (par.set(x, f(par.get(x))), par.get(x))); for (const e of G.edges) { par.set(e.a, par.get(e.a) ?? e.a); par.set(e.b, par.get(e.b) ?? e.b); } for (const e of G.edges) par.set(f(e.a), f(e.b));
  chk("the whole network (ground, ramps, deck, tails) is one connected piece", new Set(G.nodes.map((n) => f(n.id))).size === 1);
  const express = hw.filter((e) => e.kind === "express"), dec = hw.filter((e) => e.kind === "express-descent");
  chk("the deck has a descent at each end, and each descent ends on a ground edge that joins the campus roads", dec.length === 2 && dec.every((d) => [d.a, d.b].some((n) => ground.some((g) => g.a === n || g.b === n))));
  const ends = G.nodes.filter((n) => deg.get(n.id) === 1 && !n.rim && G.edges.some((e) => e.hw && (e.a === n.id || e.b === n.id)));
  chk("no expressway edge ends in a dead end", ends.length === 0, ends.length + " dead ends on the expressway");
  chk(`the expressway is long: ${ex.summary.length} m of deck inside the map ends (at least 4200 m), ${ex.summary.fullLength} m with its tails`, ex.summary.length >= 4200);
  chk(`it is elevated (${ex.summary.deckHeight} m) with ${ex.summary.lanesPerDirection} lanes each way and ${ex.summary.ramps} ramps at ${ex.summary.interchanges.length} interchanges`, ex.summary.deckHeight >= 10 && ex.summary.lanesPerDirection === 3 && ex.summary.ramps >= 4);
  chk("the ground Ile-Ife Expressway is an ordinary road: it is not part of the elevated expressway", !hw.some((e) => /Ile-Ife/i.test(e.name ?? "")) && express.every((e) => e.kind === "express"));
}
// 2. billboards: the rules are the code's own (lib3d/billboardSite.js); tests/billboard-sites.test.mjs holds every board to all of them (footing, gap, junction mouth, dead end, bridge or ramp, deck, pier, sight lines)
{ const sites = data.places.filter((p) => p.kind === "billboard"); chk("ten billboards on the map", sites.length === 10, sites.length + " found");
  const r = spawnSync(process.execPath, [new URL("../../tests/billboard-sites.test.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], { encoding: "utf8" }), out = (r.stdout || "") + (r.stderr || "");
  const rules = out.split("\n").filter((l) => /obeys every placement rule/.test(l)); chk("every billboard obeys every placement rule (" + rules.filter((l) => l.startsWith("OK")).length + " of " + rules.length + " boards)", r.status === 0 && rules.length === 10 && rules.every((l) => l.startsWith("OK")), r.status === 0 ? "" : out.split("\n").filter((l) => l.startsWith("FAIL")).join("; ")); }
// 3 and 4. buildings and places against roads and the expressway corridor
{   const pts = alignment(), R = HW.half + 24;   // the corridor: deck half width plus the 24 m clearance rule
  const dist2deck = (x, z) => { let best = 1e9; for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); best = Math.min(best, hyp(a[0] + t * dx - x, a[1] + t * dz - z)); } return best; };
  const inside = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if ((poly[i][1] > z) !== (poly[j][1] > z) && x < ((poly[j][0] - poly[i][0]) * (z - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) c = !c; return c; };
  const inRoad = (x, z) => data.roads.some((r) => inside(x, z, r.pts) && !(r.holes ?? []).some((h) => inside(x, z, h)));
  let inRoadB = 0, nearDeckB = 0; for (const b of data.buildings) { let cx = 0, cz = 0; for (const p of b.pts) { cx += p[0]; cz += p[1]; } cx /= b.pts.length; cz /= b.pts.length; if (inRoad(cx, cz)) inRoadB++; if (b.pts.some((p) => dist2deck(p[0], p[1]) < R) || dist2deck(cx, cz) < R) nearDeckB++; }
  chk("no building has its middle inside a road", inRoadB === 0, inRoadB + " buildings");
  chk(`no building comes within ${R} m of the deck's centre line (half width ${HW.half} + 24 m)`, nearDeckB === 0, nearDeckB + " buildings");
  const placed = data.places.filter((p) => p.x != null && p.kind !== "billboard"); const pr = placed.filter((p) => inRoad(p.x, p.z)), pd = placed.filter((p) => dist2deck(p.x, p.z) < R);
  chk("no place stands inside a road", pr.length === 0, pr.map((p) => p.id).join(","));
  chk("no place stands inside the expressway corridor", pd.length === 0, pd.map((p) => p.id).join(","));
}
console.log(bad ? "\n" + bad + " check(s) failed" : "\nall map checks passed"); process.exit(bad ? 1 : 0);
