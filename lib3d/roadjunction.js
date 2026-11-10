// lib3d/roadjunction.js
// How roads MEET. Every junction (and every bend, where one road ends and the next begins) is built from one polygon per layer (asphalt, kerb stone, pavement), computed from the roads that
// reach it, so the surfaces join with no gap and no overlap:
//   - each arm has two boundary lines (its left and right edge); the corner between two neighbouring arms is where the right edge of one meets the left edge of the next,
//   - on the inside of a turn that corner is rounded off with a kerb return (a circular fillet, radius by road class); on the outside of a bend it is a mitre,
//   - each arm's ribbon starts where the polygon ends (its `cut`), so the ribbon and the polygon share their mouth exactly.
// The same polygons are what roadgraph.js answers "is this carriageway or pavement?" with, so what is drawn is what is driven on. When a junction is too cramped for the construction (arms nearly
// on top of each other, a short stub between two junctions) it falls back to a disc, which is always valid.
// Pure JS. Metres, x east, z south. The right-hand side of a heading (hx, hz) is (-hz, hx), and the arms are walked in the direction of increasing angle, so an arm's right edge faces the next arm.
const hyp = Math.hypot;
const TAU = Math.PI * 2;

/** Kerb-return radius (m) by road class; the larger class of the two roads at a corner decides. */
export const RHO = { arterial: 8, collector: 6, local: 4.5 };
const RANK = { local: 0, collector: 1, arterial: 2 };
const rhoFor = (a, b) => RHO[(RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b] ?? RHO.local;
/** An arm is cut back at most this far (m), and never more than 45 percent of its road: a junction that would need more (roads meeting at a very sharp angle) is built as a round junction instead. */
export const MAX_CUT = 18;

const segCross = (p, p2, q, q2) => {
  const rx = p2[0] - p[0], rz = p2[1] - p[1], sx = q2[0] - q[0], sz = q2[1] - q[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-12) return false;
  const t = ((q[0] - p[0]) * sz - (q[1] - p[1]) * sx) / den, u = ((q[0] - p[0]) * rz - (q[1] - p[1]) * rx) / den; return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
};
/** Signed area (shoelace). */
export const area = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
/** True when no two edges of the polygon cross. */
export function isSimple(P) {
  const n = P.length; if (n < 3) return false;
  for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) { if (i === 0 && j === n - 1) continue; if (segCross(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) return false; }
  return true;
}
/** Point in polygon (even-odd). */
export function inside(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
/** Ear-clipping triangulation of a simple polygon. Returns [[i, j, k]...] indices into P (counter-clockwise by the shoelace sign of the polygon, whichever way it is wound). */
export function triangulate(P) {
  const n = P.length; if (n < 3) return []; const idx = [...Array(n).keys()], out = [], sgn = area(P) >= 0 ? 1 : -1;
  const cross = (a, b, c) => (P[b][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b][1] - P[a][1]) * (P[c][0] - P[a][0]);
  const inTri = (p, a, b, c) => { const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p); const neg = d1 < -1e-12 || d2 < -1e-12 || d3 < -1e-12, pos = d1 > 1e-12 || d2 > 1e-12 || d3 > 1e-12; return !(neg && pos); };
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cross(a, b, c) * sgn <= 1e-9) continue;                                        // a reflex or flat corner is not an ear
      let ear = true; for (const m of idx) { if (m === a || m === b || m === c) continue; if (inTri(m, a, b, c)) { ear = false; break; } }
      if (!ear) continue; out.push([a, b, c]); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) return null;                                                          // not simple after all
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]); return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * One polygon for one layer. `arms`: [{ cls, len, w, d, at(s) }] where at(s) = { x, z, hx, hz } is the point s metres from the node along the arm (heading AWAY from the node), w is the half-width of this
 * layer on that arm and d how much wider than the asphalt it is (the fillets shrink by that much, they are concentric). Returns { poly, cut: [per arm], rmax } or null when the construction fails.
 */
export const diag = { why: "" };
export function junctionPolygon(node, arms, { taper = false } = {}) {
  const n = arms.length; if (n < 2) return null; diag.why = "";
  const A = arms.map((a, k) => { const p0 = a.at(0), p1 = a.at(Math.min(8, a.len * 0.45)); let ux = p1.x - p0.x, uz = p1.z - p0.z; const l = hyp(ux, uz) || 1; ux /= l; uz /= l; return { ...a, k, ux, uz, rx: -uz, rz: ux, th: Math.atan2(uz, ux), cap: Math.min(MAX_CUT, a.len * 0.45), need: 0.5 }; });
  if (taper) for (const a of A) a.need = a.cap;       // a taper: the two mouths are as far apart as the roads allow, so the width changes over the longest, gentlest slope
  const order = [...A.keys()].sort((p, q) => A[p].th - A[q].th), corners = [];
  for (let m = 0; m < n; m++) {
    const i = A[order[m]], j = A[order[(m + 1) % n]]; if (n === 2 && m === 1 && i === j) break;
    const delta = (j.th - i.th + TAU) % TAU, c = { i, j, delta, kind: "none" };
    if (delta < 0.02 || delta > TAU - 0.02) { diag.why = "overlap"; return null; }                                // two arms on top of each other
    if (Math.abs(delta - Math.PI) > 0.09) {
      const bx = -i.w * i.rx - j.w * j.rx, bz = -i.w * i.rz - j.w * j.rz, det = -(i.ux * j.uz - i.uz * j.ux);
      if (Math.abs(det) > 1e-4) {
        const t = (-bx * j.uz + j.ux * bz) / det, s = (i.ux * bz - i.uz * bx) / det, px = node.x + i.ux * t + i.w * i.rx, pz = node.z + i.uz * t + i.w * i.rz; Object.assign(c, { t, s, px, pz });
        if (delta < Math.PI) {
          if (t > 0 && s > 0) { const rho = Math.max(0.4, rhoFor(i.cls, j.cls) - Math.max(i.d, j.d)), T = Math.min(rho / Math.tan(delta / 2), Math.max(0, Math.min(i.cap - t, j.cap - s))); c.kind = "fillet"; c.T = T; i.need = Math.max(i.need, t + T); j.need = Math.max(j.need, s + T); }
        } else if (hyp(px - node.x, pz - node.z) <= 3.2 * Math.max(i.w, j.w) + 2) c.kind = "miter";
      }
    }
    corners.push(c);
  }
  for (const a of A) a.c = clamp(a.need, 0.5, a.cap);
  for (const c of corners) if (c.kind === "fillet" && (c.t > c.i.cap || c.s > c.j.cap)) { diag.why = `far corner t${c.t.toFixed(0)} s${c.s.toFixed(0)} caps ${c.i.cap.toFixed(0)}/${c.j.cap.toFixed(0)} delta${(c.delta * 57.3).toFixed(0)}`; return null; }   // the corner is further out than the road is long
  for (const a of A) { const q = a.at(a.c), rx = -q.hz, rz = q.hx; a.L = [q.x - rx * a.w, q.z - rz * a.w]; a.R = [q.x + rx * a.w, q.z + rz * a.w]; }
  const poly = [];
  for (let m = 0; m < n; m++) {
    const i = A[order[m]]; poly.push(i.L, i.R); const c = corners[m]; if (!c) continue;
    if (c.kind === "fillet") {
      const { t, s, T, j, px, pz } = c, a0 = [node.x + i.ux * (t + T) + i.w * i.rx, node.z + i.uz * (t + T) + i.w * i.rz], b0 = [node.x + j.ux * (s + T) - j.w * j.rx, node.z + j.uz * (s + T) - j.w * j.rz];
      for (let q = 0; q <= 8; q++) { const u = q / 8, v = 1 - u; poly.push([v * v * a0[0] + 2 * u * v * px + u * u * b0[0], v * v * a0[1] + 2 * u * v * pz + u * u * b0[1]]); }
    } else if (c.kind === "miter") poly.push([c.px, c.pz]);
  }
  const P = poly.filter((p, k) => hyp(p[0] - poly[(k + poly.length - 1) % poly.length][0], p[1] - poly[(k + poly.length - 1) % poly.length][1]) > 1e-3);
  if (P.length < 3 || !isSimple(P) || Math.abs(area(P)) < 1) { diag.why = P.length < 3 ? "tiny" : !isSimple(P) ? "selfcross" : "area"; return null; }
  let rmax = 0; for (const p of P) rmax = Math.max(rmax, hyp(p[0] - node.x, p[1] - node.z));
  const cut = new Array(n); for (const a of A) cut[a.k] = a.c;
  return { poly: area(P) >= 0 ? P : [...P].reverse(), cut, rmax };
}

const circle = (x, z, r, n = 20) => Array.from({ length: n }, (_, k) => [x + Math.cos((k / n) * TAU) * r, z + Math.sin((k / n) * TAU) * r]);

/** The layers of every junction: asphalt, a 25 cm kerb stone round it, and the pavement round that. */
export const LAYERS = { asph: (e) => ({ w: e.half, d: 0 }), kerb: (e) => ({ w: e.half + 0.25, d: 0.25 }), pave: (e) => ({ w: e.half + e.sw, d: e.sw }) };

/**
 * Builds `node.J` for every node of the ground network: { asph, kerb, pave } each { poly, cut: Map(edgeId * 2 + end -> metres the ribbon starts from the node), rmax, disc }.
 * `edges` are the graph's ground edges (not the expressway), `byId` maps id -> edge. A node with one road gets a round cap; a cramped junction a disc.
 */
export function buildJunctions(nodes, byId, { skip = (e) => e.hw } = {}) {
  let discs = 0, polys = 0;
  for (const nd of nodes) {
    nd.J = null; const ends = [];
    for (const id of nd.edges) { const e = byId.get(id); if (!e || skip(e)) continue; if (e.a === nd.id) ends.push({ e, end: 0 }); if (e.b === nd.id) ends.push({ e, end: 1 }); }
    if (!ends.length) continue;
    if (ends.length === 1 && nd.edges.some((id) => byId.get(id)?.hw)) { nd.tdown = true; continue; }   // a touchdown (the deck comes down to a ground road): the two carry straight on, so no round cap or disc is drawn over the deck's last metres
    // A node flagged `taper` (where a wide road narrows to a narrower one: the expressway's ground road, lib3d/highway.js attachTails) gets a TAPER polygon that changes the width over the longest, gentlest
    // slope the roads allow, not a disc as wide as the wider road (which would bulge over the narrower one). If any layer's polygon cannot be built the node keeps the disc.
    let taper = ends.length === 2 && !!nd.taper, J = {};
    for (let attempt = 0; attempt < 2; attempt++) {
    J = {};
    for (const [name, spec] of Object.entries(LAYERS)) {
      const key = ends.map(({ e, end }) => e.id * 2 + end), arms = ends.map(({ e, end }) => { const { w, d } = spec(e); return { cls: e.cls, len: e.len, w, d, at: (s) => (end === 0 ? e.path.at(s, {}) : (() => { const q = e.path.at(e.len - s, {}); return { x: q.x, z: q.z, hx: -q.hx, hz: -q.hz }; })()) }; });
      let r = ends.length >= 3 ? junctionPolygon(nd, arms) : taper ? junctionPolygon(nd, arms, { taper: true }) : null, disc = false;   // a bend (two roads) or a dead end needs no polygon: round joins and a cap are exact
      if (!r && globalThis.process?.env?.DBGJ && name === "asph") console.error(`J node ${nd.id} deg${ends.length} (${Math.round(nd.x)},${Math.round(nd.z)}) ${diag.why} arms:` + ends.map(({ e, end }) => `${e.cls[0]}${Math.round(e.len)}m w${e.half}`).join(" "));
      // a cramped junction gets a disc about as wide as its typical road, not its widest
      if (!r) { const ws = arms.map((a) => a.w).sort((p, q) => p - q), R = ends.length >= 3 ? Math.min(ws.at(-1), ws[Math.floor(ws.length / 2)] * 1.1) + 0.2 : ws.at(-1) + 0.2; r = { poly: circle(nd.x, nd.z, R), cut: arms.map(() => 0), rmax: R }; disc = true; if (ends.length >= 3) discs++; } else polys++;
      J[name] = { poly: r.poly, cut: new Map(key.map((k, i) => [k, r.cut[i]])), rmax: r.rmax, disc };
    }
    if (!taper) break;
    if (Object.values(J).every((l) => !l.disc)) { nd.taper = true; break; }
    taper = false; nd.taper = false; discs++;     // a taper that could not be built: back to the disc
    }
    nd.J = J;
  }
  return { discs, polys };
}
