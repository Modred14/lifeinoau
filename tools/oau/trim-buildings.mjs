// tools/oau/trim-buildings.mjs
// Finds the buildings an interchange RAMP runs through below their roof, and trims each footprint just enough to clear the ramp's carriageway and its parapet (+ 1.5 m), so a car on the ramp is not
// stopped by a building and the ramp does not pass through a wall. Prints the trimmed footprints to paste into lib3d/mapExtras.js BUILDING_TRIMS (the trims are DATA: a fixed, reviewable list, not computed at run time).
//   node tools/oau/trim-buildings.mjs
import fs from "node:fs";
import { withExtras } from "../../lib3d/mapExtras.js";
import { buildServices } from "../../lib3d/worldsvc.js";
import { heightOn } from "../../lib3d/roadgraph.js";
const root = new URL("../../", import.meta.url), data = withExtras(JSON.parse(fs.readFileSync(new URL("public/data/oau-campus.json", root), "utf8"))), raw = JSON.parse(fs.readFileSync(new URL("public/data/oau-roadgraph.json", root), "utf8"));
const svc = buildServices(data, raw), G = svc.graph, MARGIN = 1.5;
const inPoly = (x, z, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const area = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] + P[i][0]) * (P[j][1] - P[i][1]); return Math.abs(a / 2); };
const clip = (P, p, n) => { const out = [], d = (q) => (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]; for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length], da = d(a), db = d(b); if (da >= 0) out.push(a); if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); } } return out; };
const ramps = G.edges.filter((e) => e.hw && e.kind === "ramp");
const deepest = (P, roof) => { let best = null; for (const e of ramps) for (let s = 0; s <= e.len; s += 1) { if (heightOn(e, s) > roof + 0.5) continue; const q = e.path.at(s, {}); let n = 0; for (let lat = -e.half - MARGIN; lat <= e.half + MARGIN; lat += 0.75) if (inPoly(q.x - q.hz * lat, q.z + q.hx * lat, P)) n++; if (n && (!best || n > best.n)) best = { n, q, e }; } return best; };
const result = {};
for (const b of data.buildings) {
  let P = b.pts.map((p) => p.slice()); if (!deepest(P, b.h)) continue; const a0 = area(P);
  for (let it = 0; it < 30; it++) {
    const d = deepest(P, b.h); if (!d) break; const { q, e } = d, nl = [-q.hz, q.hx]; let best = null;
    for (const sg of [1, -1]) { const n = [nl[0] * sg, nl[1] * sg], p = [q.x + n[0] * (e.half + MARGIN), q.z + n[1] * (e.half + MARGIN)], C = clip(P, p, n); if (C.length >= 3 && (!best || area(C) > area(best))) best = C; }
    if (!best) { P = []; break; } P = best;
  }
  P = P.filter((q, i) => Math.hypot(q[0] - P[(i + P.length - 1) % P.length][0], q[1] - P[(i + P.length - 1) % P.length][1]) > 0.4);     // (no slivers: merge vertices closer than 40 cm)
  result[b.id] = { before: a0, after: P.length >= 3 ? area(P) : 0, pts: P.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), left: deepest(P.length >= 3 ? P : [[0, 0]], b.h)?.n ?? 0 };
}
for (const [id, r] of Object.entries(result)) console.log(`${id}: area ${Math.round(r.before)} -> ${Math.round(r.after)} m2 (${Math.round((100 * r.after) / r.before)} % kept), ramp still in it: ${r.left}\n  ${JSON.stringify(r.pts)}`);
