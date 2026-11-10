// lib3d/highwaytails.js
// How the expressway JOINS the ground road network at its two ends. Pure JS (no three.js, no DOM): runs in the browser, in tools/oau/refine-roads.mjs and in the tests.
//
// The deck used to stop 450 m beyond the map's rim at a concrete end barrier, with no road under it or beyond it. Now each end is a TAIL:
//   1. the straight deck runs on past the rim (as before), then a tangent ARC (one gentle, constant-radius curve, solved exactly below) turns it round on to a RETURN LINE
//      that points straight at an existing campus road, so the deck comes back towards the road network instead of leaving it,
//   2. the last DESCENT metres of the return line are a long, even ramp: the deck comes down to the ground (the same smoothed profile every ramp uses, roadgraph.climbFrac),
//   3. at the foot (the TOUCHDOWN) the carriageway carries straight on as an ordinary ground road, first with the deck's own cross-section (C1, so there is no step where the deck
//      meets the ground), then, after a taper, as a standard arterial (C2) that ends in a junction with the campus road.
// Everything is a pure function of the constants here and of the main alignment's two end points, so the tools, the meshes, the collision and the tests all see the same road.
import { resample } from "./roadrefine.js";
import { climbFrac } from "./roadgraph.js";

/** Length of each descent (m): 10 m of height over 330 m is 3 % on average, a gentler grade than the interchange ramps. */
export const DESCENT = 330;
/** Where the deck is high enough to need piers, and above which a person can walk under it (below this the descent is solid fill and has walls, lib3d/worldsvc.js). */
export const PIER_MIN_H = 3.6, WALK_UNDER_H = 2.4;
/** The ground part of a tail: C1 (the deck's own cross-section) is this long, then the taper, then C2. */
export const C1_LEN = 45;

const TAU = Math.PI * 2, hyp = Math.hypot;
const unit = (x, z) => { const l = hyp(x, z) || 1; return [x / l, z / l]; };

/**
 * The tails, one per end of the straight alignment. `side` is the way the arc turns (+1 right, -1 left: the right-hand side of a heading (hx, hz) is (-hz, hx)), `R` its radius,
 * `ret` the return line (a point on it and its heading), `touch` the touchdown, `ground` where C1 ends, `target` the existing node the connector ends at (`via`: corners of C2, rounded with an arc of radius `bend`).
 * The numbers were found by tools: R is the largest that leaves the return leg long enough for the 330 m descent; the target nodes are the open end of the arterial that leaves the map's east rim
 * (node 28) and the north-west corner of the campus grid (node 51), which has open land to its west.
 */
export const TAILS = {
  west: { side: 1, R: 130, ret: { q: [0, 0], h: [1, 0] }, touch: [-1620, 0], ground: [-1575, 0], target: [-1290.5, 104.5], via: [[-1400, 0]], bend: 120 },
  east: { side: -1, R: 250, ret: { q: [1427.5, -121.5], h: [-1, 0] }, touch: [1527.5, -121.5], ground: [1482.5, -121.5], target: [1427.5, -121.5], via: [], bend: 120 },
};

/** The arc that leaves P0 along d, turns `side` with radius R and ends going along the return line (q, h). */
export function solveArc(P0, d, q, h, side, R) {
  const nrm = (v) => [-v[1] * side, v[0] * side], dot = (a, b) => a[0] * b[0] + a[1] * b[1], nL = nrm(d), nR = nrm(h), rel = [P0[0] - q[0], P0[1] - q[1]];
  const a = (R - R * dot(nL, nR) - dot(rel, nR)) / dot(d, nR);                      // the straight run before the arc, so that the circle is tangent to both lines
  const ang = (v) => Math.atan2(v[1], v[0]); let th = side > 0 ? ang(h) - ang(d) : ang(d) - ang(h); th = ((th % TAU) + TAU) % TAU;
  const C = [P0[0] + a * d[0] + R * nL[0], P0[1] + a * d[1] + R * nL[1]];
  return { a, th, C, T0: [P0[0] + a * d[0], P0[1] + a * d[1]], T1: [C[0] - R * nR[0], C[1] - R * nR[1]], R, side };
}
/** Points along the arc, about `step` metres apart, from its start to its end (both included). */
function arcPoints(arc, d, step) {
  const n = Math.max(2, Math.ceil((arc.R * arc.th) / step)), out = [];
  for (let k = 0; k <= n; k++) { const phi = (arc.th * k) / n * arc.side, c = Math.cos(phi), s = Math.sin(phi), hx = d[0] * c - d[1] * s, hz = d[0] * s + d[1] * c, nx = -hz * arc.side, nz = hx * arc.side; out.push([arc.C[0] - arc.R * nx, arc.C[1] - arc.R * nz]); }
  return out;
}
/** A corner-rounded polyline (circular arcs of radius R at each interior vertex). */
function round(V, R) {
  if (V.length < 3) return V.slice(); const out = [V[0]];
  for (let i = 1; i < V.length - 1; i++) {
    const p = V[i], a = V[i - 1], b = V[i + 1], [ux, uz] = unit(p[0] - a[0], p[1] - a[1]), [vx, vz] = unit(b[0] - p[0], b[1] - p[1]), th = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (th < 0.02) { out.push(p); continue; }
    const T = Math.min(R * Math.tan(th / 2), hyp(p[0] - a[0], p[1] - a[1]) * 0.48, hyp(b[0] - p[0], b[1] - p[1]) * 0.48), r = T / Math.tan(th / 2), turn = Math.sign(ux * vz - uz * vx) || 1;
    const sx = p[0] - ux * T, sz = p[1] - uz * T, cx = sx - uz * turn * r, cz = sz + ux * turn * r, a0 = Math.atan2(sz - cz, sx - cx), n = Math.max(3, Math.ceil((r * th) / 3));
    for (let k = 0; k <= n; k++) { const an = a0 + turn * th * (k / n); out.push([cx + Math.cos(an) * r, cz + Math.sin(an) * r]); }
  }
  out.push(V[V.length - 1]); return out;
}

/**
 * Both tails for a main alignment `A` (a polyline of [x, z], first to last). Each result has:
 *   deck    the deck's centreline from the main alignment's end point OUT to the touchdown (the first point is that end point)
 *   touch   the touchdown [x, z]; ground the end of C1; c1 the polyline touch -> ground; c2 the polyline ground -> target (the existing campus node)
 *   arc     the solved arc (a, th, R, C, T0, T1) for the report and the tests
 */
export function tailGeometry(A) {
  const ends = { west: { P0: A[0], d: unit(A[0][0] - A[1][0], A[0][1] - A[1][1]) }, east: { P0: A.at(-1), d: unit(A.at(-1)[0] - A.at(-2)[0], A.at(-1)[1] - A.at(-2)[1]) } }, out = {};
  for (const [name, T] of Object.entries(TAILS)) {
    const { P0, d } = ends[name], arc = solveArc(P0, d, T.ret.q, T.ret.h, T.side, T.R);
    if (arc.a < 0) throw new Error(`expressway tail ${name}: the arc would have to start ${(-arc.a).toFixed(0)} m before the end of the deck`);
    const pts = [P0, ...resample([P0, arc.T0], 20).slice(1), ...arcPoints(arc, d, 6).slice(1)];     // run on, then round the bend
    const T1 = arc.T1, lead = hyp(T.touch[0] - T1[0], T.touch[1] - T1[1]); if ((T.touch[0] - T1[0]) * T.ret.h[0] + (T.touch[1] - T1[1]) * T.ret.h[1] < DESCENT) throw new Error(`expressway tail ${name}: the return leg is ${lead.toFixed(0)} m, shorter than the ${DESCENT} m descent`);
    pts.push(...resample([T1, T.touch], 20).slice(1));
    out[name] = { deck: pts, touch: T.touch.slice(), ground: T.ground.slice(), c1: [T.touch.slice(), T.ground.slice()], c2: round([T.ground.slice(), ...T.via, T.target.slice()], T.bend), target: T.target.slice(), arc };
  }
  return out;
}

/** The deck's whole centreline, west touchdown to east touchdown: the west tail turned round, the main alignment, the east tail. Returns { pts, sMain: [s0, s1] (the main alignment's range along it), tails }. */
export function fullAlignment(A) {
  const t = tailGeometry(A), w = [...t.west.deck].reverse();
  const pts = [...w, ...A.slice(1), ...t.east.deck.slice(1)], len = (P) => { let s = 0; for (let i = 1; i < P.length; i++) s += hyp(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return s; };
  const s0 = len(w), s1 = s0 + len(A); return { pts, sMain: [s0, s1], tails: t };
}

/**
 * The height (m) of the deck at distance s along the full alignment, for a descriptor `ex` ({ H, len, descents: [{ end, s0, s1 }] }). The same smoothed profile as every ramp (roadgraph.climbFrac),
 * so what is drawn, what is driven on and the graph's own edges (roadgraph.heightOn) agree.
 */
export function deckHeight(ex, s) {
  for (const d of ex.descents ?? []) if (s >= d.s0 && s <= d.s1) return ex.H * climbFrac(d.end === "west" ? s - d.s0 : d.s1 - s, 0, d.s1 - d.s0);
  return ex.H;
}
