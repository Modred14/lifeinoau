// lib3d/highway.js
// The expressway: a long, straight elevated dual carriageway across the south of the campus and out over the lake, inspired by the Third Mainland Bridge in Lagos (a 11.8 km viaduct
// of concrete box girders on pier pairs over the lagoon). It is DESIGNED, not found: this file lays out its centreline, its two interchanges and their ramps, its piers and lamps, and adds them
// to the road graph that tools/oau/refine-roads.mjs bakes into public/data/oau-roadgraph.json. Pure JS (no three.js, no DOM): runs in the tools and in the tests.
//
// SCALE. The real bridge is 11.8 km; the map is 3.2 km wide, so this one is about 4.2 km (the map, plus 480 m of causeway at each end). That is what a supercar needs: the fastest car here
// (Huracan, 325 km/h) reaches 95 % of its top speed in 2.7 km from a standstill. It is as straight as the map allows: three straight legs joined by two very gentle arcs (radius 2.5 km, so even
// at 325 km/h the sideways load is 3.3 m/s2, well inside what the tyres hold), found by searching every line across the map for the one that clears all buildings by 24 m or more.
//
// CROSS-SECTION (m, from the middle outwards): median barrier 1.5 | three lanes of 3.5 | hard shoulder 2.5 | parapet. 29 m of carriageway, 31 m with parapets. The deck is 10 m above the ground.
// The two ends are 80 m aprons with no median, so a vehicle can turn round before the end barrier.
//
// LEVELS. The deck, its ramps and its piers sit above the ground roads. roadgraph.js gives each edge a level mask: people, ambient traffic and taxis see the ground only; a driven car sees its own
// level plus the ramps (carMask). Ground roads that pass under the deck keep their own surface; a ramp that crosses one is told apart from it by height (see roadgraph.surfaceAt, hRef).
import { Path } from "./roadnet.js";
import { fillet, resample } from "./roadrefine.js";
import { heightOn } from "./roadgraph.js";

export const HW = {
  H: 10,                      // deck height above the ground (m)
  lanes: 3, lane: 3.5, med: 1.5, shoulder: 2.5,
  get half() { return this.med + this.lanes * this.lane + this.shoulder; },   // 14.5: the carriageway, from the middle to the parapet
  parapet: 0.55,              // concrete parapet: thickness (m)
  girder: 2.2,                // depth of the box girder under the deck
  apron: 80,                  // an end apron with no median (m)
  extend: 480,                // how far the road runs on past the edge of the map at each end (m)
  radius: 2500,               // arc radius at the two bends
  ramp: { half: 4.2, minLen: 235, maxGrade: 0.047 },   // a ramp: one lane, two shoulders; at most 4.7 % on average (it is steeper mid-way, ease5)
  pier: { land: 38, water: 50, col: [3.0, 2.2], head: [21.0, 1.7], clear: 3.5 },     // spacing (m), column (w x d), cross-head (w x d), clearance to a ground road
  lamp: 42,                   // lamp spacing in the median (m)
  clearance: 24,              // the corridor is this clear of buildings on each side of the centreline
};
/** The waypoints the straight legs join (metres, the map's own grid): found by the search described above. */
export const WAYPOINTS = [[-1760, 380], [-460, 690], [560, 870], [1440, 560]];

const hyp = Math.hypot;
const unit = (x, z) => { const l = hyp(x, z) || 1; return [x / l, z / l]; };

/** The centreline: the legs run on past both ends of the map by HW.extend, and each bend is rounded by an arc. Returns points about 20 m apart. */
export function alignment() {
  const W = WAYPOINTS.map((p) => p.slice()), [d0x, d0z] = unit(W[1][0] - W[0][0], W[1][1] - W[0][1]), n = W.length, [d1x, d1z] = unit(W[n - 1][0] - W[n - 2][0], W[n - 1][1] - W[n - 2][1]);
  W[0] = [W[0][0] - d0x * HW.extend, W[0][1] - d0z * HW.extend]; W[n - 1] = [W[n - 1][0] + d1x * HW.extend, W[n - 1][1] + d1z * HW.extend];
  return resample(fillet(W, HW.radius), 20);
}

/** [x, z, r] circles along the deck, for keeping trees (and anything else on the ground) out of the corridor. */
export function corridorKeepOut(step = 60, r = HW.half + 14) { const P = new Path(alignment()), out = []; for (let s = 0; s <= P.len; s += step) { const a = P.at(s, {}); out.push([a.x, a.z, r]); } return out; }

const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], zi = pts[i][1], xj = pts[j][0], zj = pts[j][1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const segD = (px, pz, ax, az, bx, bz) => { const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1; let t = ((px - ax) * dx + (pz - az) * dz) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; return hyp(px - ax - dx * t, pz - az - dz * t); };
const polyD = (px, pz, P) => { let d = Infinity; for (let i = 0; i < P.length - 1; i++) d = Math.min(d, segD(px, pz, P[i][0], P[i][1], P[i + 1][0], P[i + 1][1])); return d; };
const bez = (p0, p1, p2, p3, t) => { const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t; return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]; };
const nearestNode = (nodes, x, z, tol) => { let best = null; for (const n of nodes) { const d = hyp(n.x - x, n.z - z); if (d <= tol && (!best || d < best.d)) best = { d, n }; } return best?.n ?? null; };

/**
 * Where the two interchanges are, by the road they use. Each names the map position of the ground road it connects to:
 *   campus  a full diamond on the wide road into the campus from the south: it meets the road at the junction just north of the deck and at a new junction 110 m south of it
 *   west    a half diamond (east-bound ramps only) on the south side, at the end of the road that stops 60 m short of the deck on the west side
 * Both leave a car heading east on the south side and west on the north side, as traffic keeps right.
 */
export const INTERCHANGES = [
  { id: "west", name: "West interchange", sides: ["S"], south: { at: [-493, 759], tol: 8 } },
  { id: "campus", name: "Campus interchange", sides: ["N", "S"], north: { at: [63, 730], tol: 8 }, south: { road: [98, 782], dist: 110 } },
];

/**
 * Adds the expressway to the refined graph `raw` ({nodes, edges}). Returns a new graph with the expressway's nodes and edges (edges carry `fixed`: the geometry is exact) and an `expressway`
 * descriptor for the meshes, the piers' collision and the tests. `data` is the merged map (buildings, water); `sdf(x, z)` the distance to the nearest solid (for the clearance report).
 */
export function addExpressway(raw, data, { sdf = null } = {}) {
  const nodes = raw.nodes.map((n) => ({ ...n })), edges = raw.edges.map((e) => ({ ...e, pts: e.pts.map((p) => p.slice()) }));
  let nextEdge = Math.max(...edges.map((e) => e.id)) + 1; const newNode = (x, z) => { const n = { id: nodes.length, x, z, rim: false, comp: 0 }; nodes.push(n); return n; };
  const groundEdges = edges.map((e) => ({ id: e.id, pts: e.pts, half: Math.min(9.5, (e.w ?? 6) / 2) + 2.0 }));   // the ground roads, for keeping piers off them
  const D = new Path(alignment()), L = D.len, T = (s) => D.at(s, {}), right = (t) => [-t.hz, t.hx];     // right of the heading (x east, z south): south when heading east

  // ---- ramps ----
  const ramps = [], interchanges = [];
  const rampPath = (P0, P1, P2, P3) => { const pts = []; for (let i = 0; i <= 60; i++) pts.push(bez(P0, P1, P2, P3, i / 60)); return resample(pts, 6); };
  /**
   * A ramp, laid out in the deck's own coordinates: s along the deck and l across it (+ to the right, south when heading east). It leaves (or joins) the deck TANGENTIALLY at l = 0 and reaches the
   * terminal on the ground road at the s of the terminal's foot and the l of its distance from the deck, along a smootherstep. So a ramp can never cut across the deck or another ramp, and it
   * changes direction gently at both ends. Returns the polyline in map coordinates, from the first node to the last (off: deck to terminal; on: terminal to deck).
   */
  function makeRamp({ kind, s, term }) {
    const sT = D.nearest(term[0], term[1], L / 2, L), tT = T(sT), rT = right(tT), lT = (term[0] - tT.x) * rT[0] + (term[1] - tT.z) * rT[1];
    const [sa, la, sb, lb] = kind === "off" ? [s, 0, sT, lT] : [sT, lT, s, 0], n = 80, pts = [];
    for (let i = 0; i <= n; i++) { const t = i / n, e = t * t * t * (t * (t * 6 - 15) + 10), ss = sa + (sb - sa) * t, ll = la + (lb - la) * e, c = T(ss), r = right(c); pts.push([c.x + r[0] * ll, c.z + r[1] * ll]); }
    return resample(pts, 6);
  }
  const rampSpecs = [], sideOf = (x, z) => { const sN = D.nearest(x, z, L / 2, L), t = T(sN), r = right(t); return (x - t.x) * r[0] + (z - t.z) * r[1]; };   // > 0: on the right (south) of the deck
  for (const ic of INTERCHANGES) {
    const rec = { id: ic.id, name: ic.name, ramps: [] }, terms = {};
    for (const side of ic.sides) {
      const want = side === "N" ? ic.north : ic.south; let node = null, axis = null;
      if (want.at) {          // an existing junction (or a dead end): the ramps join the road there
        node = nearestNode(nodes, want.at[0], want.at[1], want.tol); if (!node) throw new Error(`expressway: no junction near ${want.at} for the ${ic.id} interchange`);
        const e = edges.find((q) => q.a === node.id || q.b === node.id), P = e.pts, i = e.a === node.id ? 0 : P.length - 1, j = i ? i - 1 : 1; axis = [P[j][0] - P[i][0], P[j][1] - P[i][1]];
      } else {                // a new junction on the nearest road, `dist` metres from where the deck crosses it, on the ramps' side of the deck
        let best = null; for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) { const d = segD(want.road[0], want.road[1], e.pts[i][0], e.pts[i][1], e.pts[i + 1][0], e.pts[i + 1][1]); if (!best || d < best.d) best = { d, e }; }
        const e = best.e, path = new Path(e.pts), s0 = path.nearest(want.road[0], want.road[1], path.len / 2, path.len), want1 = side === "S" ? 1 : -1;
        const cand = [s0 + want.dist, s0 - want.dist].filter((q) => q > 10 && q < path.len - 10).find((q) => { const c = path.at(q, {}); return sideOf(c.x, c.z) * want1 > 0; });
        if (cand === undefined) throw new Error(`expressway: the road at ${want.road} has no room for the ${ic.id} ${side} ramps`);
        const pt = path.at(cand, {}); node = newNode(pt.x, pt.z); axis = [pt.hx, pt.hz];
        let k = 0; while (k < e.pts.length - 2 && path.cum[k + 1] < cand) k++;                   // split the road at the new junction
        edges.push({ ...e, id: nextEdge++, a: node.id, pts: [[node.x, node.z], ...e.pts.slice(k + 1)] }); e.pts = [...e.pts.slice(0, k + 1), [node.x, node.z]]; e.b = node.id;
      }
      terms[side] = { node, axis };
    }
    for (const side of ic.sides) {
      const { node, axis } = terms[side], Tn = [node.x, node.z], sN = D.nearest(Tn[0], Tn[1], L / 2, L), back = Math.max(HW.ramp.minLen, Math.min(HW.H / HW.ramp.maxGrade, 330)) + 40, dirS = side === "S" ? 1 : -1;   // east-bound traffic moves to higher s; west-bound to lower s
      rampSpecs.push({ ic: ic.id, kind: "off", side, s: sN - dirS * back, node, term: Tn, termAxis: axis });
      rampSpecs.push({ ic: ic.id, kind: "on", side, s: sN + dirS * back, node, term: Tn, termAxis: axis });
    }
    interchanges.push(rec);
  }

  // two ramps whose ends on the deck are within 45 m of each other share one deck junction (no sliver of deck between them)
  { const byS = [...rampSpecs].sort((p, q) => p.s - q.s); let head = null; for (const r of byS) { if (head && r.s - head.s < 45) r.s = head.s; else head = r; } }
  // ---- deck nodes: where the ramps leave and join, and the two aprons ----
  const cuts = [0, HW.apron, L - HW.apron, L, ...rampSpecs.map((r) => r.s)].sort((a, b) => a - b).filter((s, i, a) => i === 0 || s - a[i - 1] > 1);
  const deckNode = new Map(); for (const s of cuts) { const t = T(s); deckNode.set(Math.round(s * 10), newNode(t.x, t.z)); }
  const nodeAt = (s) => deckNode.get(Math.round(s * 10)) ?? [...deckNode.values()].reduce((b, n) => (hyp(n.x - T(s).x, n.z - T(s).z) < hyp(b.x - T(s).x, b.z - T(s).z) ? n : b));
  const deckEdges = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1], pts = []; pts.push([T(s0).x, T(s0).z]); for (let s = Math.ceil((s0 + 0.01) / 20) * 20; s < s1 - 0.01; s += 20) { const t = T(s); pts.push([t.x, t.z]); } pts.push([T(s1).x, T(s1).z]);
    const apron = s1 <= HW.apron + 1 || s0 >= L - HW.apron - 1, a = nodeAt(s0), b = nodeAt(s1);
    const e = { id: nextEdge++, a: a.id, b: b.id, pts, w: HW.half * 2, clr: 99, comp: 0, cls: "express", kind: apron ? "express-end" : "express", hw: true, lv: 1, h0: HW.H, h1: HW.H, s0, s1, fixed: { half: HW.half, sw: 0, med: apron ? 0 : HW.med, lanes: HW.lanes, shoulder: HW.shoulder } };
    edges.push(e); deckEdges.push({ id: e.id, s0, s1, apron });
  }
  // ---- ramp edges ----
  for (const sp of rampSpecs) {
    const pts = makeRamp(sp), deckN = nodeAt(sp.s), tn = sp.node, off = sp.kind === "off";
    if (off) { pts[0] = [deckN.x, deckN.z]; pts[pts.length - 1] = [tn.x, tn.z]; } else { pts[0] = [tn.x, tn.z]; pts[pts.length - 1] = [deckN.x, deckN.z]; }
    const e = { id: nextEdge++, a: off ? deckN.id : tn.id, b: off ? tn.id : deckN.id, pts, w: HW.ramp.half * 2, clr: 99, comp: 0, cls: "ramp", kind: "ramp", hw: true, lv: 2, oneWay: true, h0: off ? HW.H : 0, h1: off ? 0 : HW.H, fixed: { half: HW.ramp.half, sw: 0, med: 0, lanes: 1, shoulder: 1.2 } };
    const len = new Path(pts).len; e.len = len; edges.push(e);
    // where the ramp is drawn from (it starts on the deck centreline, so the first part lies on the deck itself) and where the deck's parapet must have a gap for it
    const lat = pts.map((q) => { const sd = D.nearest(q[0], q[1], sp.s, 700), t = T(sd), r = right(t); return { sd, l: (q[0] - t.x) * r[0] + (q[1] - t.z) * r[1] }; });
    const fromDeck = off ? 0 : pts.length - 1, step = off ? 1 : -1; let vis = fromDeck; while (vis >= 0 && vis < pts.length && Math.abs(lat[vis].l) < HW.half - 3) vis += step;
    const near = lat.filter((q) => Math.abs(Math.abs(q.l) - HW.half) <= HW.ramp.half + 0.6), gap = near.length ? [Math.min(...near.map((q) => q.sd)) - 3, Math.max(...near.map((q) => q.sd)) + 3, Math.sign(near[Math.floor(near.length / 2)].l) || 1] : null;
    ramps.push({ id: e.id, ic: sp.ic, kind: sp.kind, side: sp.side, s: sp.s, pts: pts.map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), h0: e.h0, h1: e.h1, len, half: HW.ramp.half, grade: HW.H / len, vis: off ? [vis, pts.length - 1] : [0, vis], gap });
  }

  // ---- piers ----
  const water = data.areas?.water ?? [], inWater = (x, z) => water.some((a) => inPoly(x, z, a.pts)), roads = groundEdges;
  const nearRoad = (x, z, r) => { for (const g of roads) { if (polyD(x, z, g.pts) < g.half + r) return true; } return false; };
  const piers = [];
  for (let s = 36; s < L - 20;) {
    let ss = s, tries = 0; const t0 = T(ss); const sp = inWater(t0.x, t0.z) ? HW.pier.water : HW.pier.land;
    // a pier never stands on a road that passes under the deck: slide the station along the deck to the nearest clear place
    const clearAt = (q) => { const t = T(q); return !nearRoad(t.x, t.z, HW.pier.col[0] / 2 + HW.pier.clear); };
    if (!clearAt(ss)) { let found = false; for (let d = 2; d <= 16 && !found; d += 2) for (const sg of [1, -1]) if (clearAt(ss + sg * d)) { ss += sg * d; found = true; break; } }
    const t = T(ss); piers.push({ s: Math.round(ss * 10) / 10, x: Math.round(t.x * 100) / 100, z: Math.round(t.z * 100) / 100, hx: Math.round(t.hx * 10000) / 10000, hz: Math.round(t.hz * 10000) / 10000, water: inWater(t.x, t.z) }); s = ss + sp;
  }
  const rampPiers = [];
  for (const r of ramps) {
    const P = new Path(r.pts); for (let u = 24; u < P.len - 12; u += 26) { const h = heightOn({ h0: r.h0, h1: r.h1, len: P.len }, u); if (h < 2.5) continue; const q = P.at(u, {}); if (nearRoad(q.x, q.z, 2.5)) { continue; } rampPiers.push({ ramp: r.id, u: Math.round(u * 10) / 10, x: Math.round(q.x * 100) / 100, z: Math.round(q.z * 100) / 100, hx: Math.round(q.hx * 10000) / 10000, hz: Math.round(q.hz * 10000) / 10000, h: Math.round(h * 100) / 100, water: false }); }
  }
  const lamps = []; for (let s = HW.apron + 20; s < L - HW.apron - 10; s += HW.lamp) { const t = T(s); lamps.push([Math.round(t.x * 100) / 100, Math.round(t.z * 100) / 100]); }

  // ---- summary (for the report) ----
  let minClear = Infinity; if (sdf) for (let s = 0; s <= L; s += 10) { const t = T(s); for (const o of [-HW.half, 0, HW.half]) { if (inWater(t.x - t.hz * o, t.z + t.hx * o)) continue; minClear = Math.min(minClear, sdf(t.x - t.hz * o, t.z + t.hx * o)); } }
  let turn = 0; { const a = alignment(); for (let i = 1; i < a.length - 1; i++) { const u = Math.atan2(a[i][1] - a[i - 1][1], a[i][0] - a[i - 1][0]), v = Math.atan2(a[i + 1][1] - a[i][1], a[i + 1][0] - a[i][0]); turn += Math.abs(((v - u + Math.PI * 3) % (Math.PI * 2)) - Math.PI); } }
  const summary = { length: Math.round(L), width: HW.half * 2, deckHeight: HW.H, lanesPerDirection: HW.lanes, totalTurnDeg: Math.round((turn * 180) / Math.PI * 10) / 10, minClearanceToSolids: Number.isFinite(minClear) ? Math.round(minClear * 10) / 10 : null, ramps: ramps.length, piers: piers.length, rampPiers: rampPiers.length, interchanges: INTERCHANGES.map((i) => i.id) };
  const expressway = {
    H: HW.H, half: HW.half, med: HW.med, lanes: HW.lanes, lane: HW.lane, shoulder: HW.shoulder, apron: HW.apron, len: L, girder: HW.girder, parapet: HW.parapet, pierSpec: HW.pier,
    deck: alignment().map((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), deckEdges, ramps, piers, rampPiers, lamps, summary,
  };
  return { ...raw, nodes, edges, expressway };
}
