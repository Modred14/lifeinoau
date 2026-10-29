// lib3d/highwaymesh.js
// Draws the elevated expressway (graph.expressway, built by lib3d/highway.js): deck, median barrier, lane markings, parapets, the girder under
// the deck, T-piers down to the ground, lamp posts, end barriers, and the entry/exit ramps. It draws what roadgraph.js drives on: the deck
// surface is at graph.expressway.H metres, the ramps climb with the same smootherstep (heightOn) the physics uses.
// Built in scene units (metres * S), with real heights. Not touched by the trip "layerY" lowering: the deck is a structure, not paint.
import * as THREE from "three";
import { heightOn } from "./roadgraph.js";

const COL = { deck: "#3a3f47", shoulder: "#4a4f56", concrete: "#a9aca8", mark: "#ece9dd", edge: "#e6c34a", under: "#7d8083", rail: "#b9bcc0", lamp: "#8a8e93" };

/** Triangle accumulator (3-D). */
class Tris {
  constructor(S) { this.S = S; this.p = []; }
  v(x, y, z) { this.p.push(x * this.S, y * this.S, z * this.S); }
  tri(a, b, c) { this.v(...a); this.v(...b); this.v(...c); }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  mesh(color, { rough = 0.9, metal = 0, offset = 0, shadow = true } = {}) {
    if (!this.p.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, side: THREE.DoubleSide, polygonOffset: offset > 0, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset * 2 }));
    m.receiveShadow = shadow; m.castShadow = shadow; m.frustumCulled = false; return m;
  }
}

/** A polyline with arc length: at(s) gives the point and heading; right normal is (-hz, hx), as everywhere in lib3d. */
class Line {
  constructor(pts) {
    this.P = pts.map((p) => ({ x: p[0], z: p[1] })); this.s = [0];
    for (let i = 1; i < this.P.length; i++) this.s.push(this.s[i - 1] + Math.hypot(this.P[i].x - this.P[i - 1].x, this.P[i].z - this.P[i - 1].z));
    this.len = this.s.at(-1); this.k = 0;
  }
  at(s) {
    s = Math.max(0, Math.min(this.len, s)); let k = this.k; if (this.s[k] > s) k = 0; while (k < this.P.length - 2 && this.s[k + 1] < s) k++; this.k = k;
    const a = this.P[k], b = this.P[k + 1], t = (s - this.s[k]) / (this.s[k + 1] - this.s[k] || 1), dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    return { x: a.x + dx * t, z: a.z + dz * t, hx: dx / l, hz: dz / l };
  }
}
const off = (q, l) => [q.x - q.hz * l, q.z + q.hx * l];     // a point l metres to the right of the centreline

/**
 * Sweeps a profile along a Line. `prof` is a list of [lateral offset, height] pairs; each consecutive pair becomes a band. `hAt(s)` is the
 * height of the reference line. Ends at s1; step in metres.
 */
function sweep(T, line, s0, s1, prof, hAt, step = 8, skip = null) {
  const n = Math.max(1, Math.ceil((s1 - s0) / step)); let prev = null;
  for (let i = 0; i <= n; i++) {
    const s = s0 + ((s1 - s0) * i) / n, q = line.at(s), h = hAt(s), row = prof.map(([l, dy]) => { const p = off(q, l); return [p[0], h + dy, p[1]]; });
    if (prev && !(skip && skip(s - (s1 - s0) / n / 2))) for (let j = 0; j < row.length - 1; j++) T.quad(prev[j], prev[j + 1], row[j + 1], row[j]);
    prev = row;
  }
}
const dashes = (T, line, s0, s1, l, w, hAt, dash = 4.5, gap = 7.5, dy = 0.03) => { for (let s = s0; s + dash < s1; s += dash + gap) sweep(T, line, s, s + dash, [[l - w / 2, dy], [l + w / 2, dy]], hAt, 2.5); };

/** A box standing at (x, z) with its long side along (hx, hz): width across, depth along, from y0 up to y1. */
function box(T, x, z, hx, hz, across, along, y0, y1) {
  const a = across / 2, d = along / 2, c = [[-a, -d], [a, -d], [a, d], [-a, d]].map(([u, w]) => [x + -hz * u + hx * w, z + hx * u + hz * w]);
  for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; T.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]]); }
  T.quad([c[0][0], y1, c[0][1]], [c[1][0], y1, c[1][1]], [c[2][0], y1, c[2][1]], [c[3][0], y1, c[3][1]]);
}

export function buildHighwayMeshes(ex, S) {
  const g = new THREE.Group(); g.name = "expressway";
  const H = ex.H, half = ex.half, med = ex.med, L = ex.len;
  const line = new Line(ex.deck), scale = line.len / L || 1;      // the polyline is a hair different from the arc the descriptor was measured on
  const hD = () => H, ds = (s) => Math.min(line.len, s * scale);
  const deckA = new Tris(S), deckS = new Tris(S), conc = new Tris(S), mk = new Tris(S), edgeM = new Tris(S), under = new Tris(S), rail = new Tris(S);
  const gaps = ex.ramps.filter((r) => r.gap).map((r) => ({ s0: r.gap[0], s1: r.gap[1], side: r.gap[2] }));
  const inGap = (s, side) => gaps.some((q) => q.side === side && s >= q.s0 && s <= q.s1);
  const gird = ex.girder, par = ex.parapet, shw = ex.shoulder, lane = ex.lane, step = 8;

  // ---- deck surface: each carriageway is its own ribbon (lanes + shoulder), the median is the strip between them
  for (const sg of [-1, 1]) {
    const inner = sg * med, outer = sg * half, lanesOuter = sg * (half - shw);
    sweep(deckA, line, 0, line.len, [[Math.min(inner, lanesOuter), 0], [Math.max(inner, lanesOuter), 0]], hD, step);
    sweep(deckS, line, 0, line.len, [[Math.min(lanesOuter, outer), 0], [Math.max(lanesOuter, outer), 0]], hD, step);
  }
  // the two aprons have no median: pave across it
  for (const [a, b] of [[0, ex.apron], [L - ex.apron, L]]) sweep(deckA, line, ds(a), ds(b), [[-med, 0], [med, 0]], hD, step);

  // ---- median: a concrete barrier (New Jersey section) along the middle, between the aprons
  const mA = ds(ex.apron), mB = ds(L - ex.apron);
  sweep(conc, line, mA, mB, [[-med, 0], [-med * 0.7, 0.35], [-med * 0.45, 0.85], [med * 0.45, 0.85], [med * 0.7, 0.35], [med, 0]], hD, step);
  // end of the median, a sloped nose
  for (const [s, dir] of [[mA, -1], [mB, 1]]) { const q = line.at(s), a = off(q, -med), b = off(q, med), c = off(q, med * 0.45), d = off(q, -med * 0.45), t = [q.x + q.hx * dir * 0, q.z]; void t; conc.quad([a[0], H, a[1]], [b[0], H, b[1]], [c[0], H + 0.85, c[1]], [d[0], H + 0.85, d[1]]); }

  // ---- markings
  for (const sg of [-1, 1]) {
    sweep(edgeM, line, mA, mB, [[sg * (med + 0.35) - 0.08, 0.03], [sg * (med + 0.35) + 0.08, 0.03]], hD, step);               // yellow line beside the median
    sweep(mk, line, 0, line.len, [[sg * (half - shw) - 0.1, 0.03], [sg * (half - shw) + 0.1, 0.03]], hD, step);              // white edge line at the shoulder
    for (let k = 1; k < ex.lanes; k++) dashes(mk, line, 0, line.len, sg * (med + k * lane), 0.14, hD);
  }

  // ---- parapets (concrete, both sides; open where a ramp leaves or joins), and the metal rail above them
  for (const sg of [-1, 1]) {
    const o = sg * half, i = sg * (half - par), top = 0.95;
    sweep(conc, line, 0, line.len, [[i, 0], [i, top], [o, top], [o, 0]], hD, step, (s) => inGap(s / scale, sg));
    // the rail posts and the rail itself on top of the parapet
    sweep(rail, line, 0, line.len, [[sg * (half - par / 2), top + 0.55], [sg * (half - par / 2), top + 0.65]], hD, step, (s) => inGap(s / scale, sg));
    for (let s = 4; s < line.len; s += 4) { const sv = s / scale; if (inGap(sv, sg)) continue; const q = line.at(s), p = off(q, sg * (half - par / 2)); box(rail, p[0], p[1], q.hx, q.hz, 0.12, 0.12, H + top, H + top + 0.7); }
  }

  // ---- girder under the deck: side faces and a flat soffit, with the parapet outer face continued down
  sweep(under, line, 0, line.len, [[-half, 0], [-half + 1.2, -gird], [half - 1.2, -gird], [half, 0]], hD, step);
  // end barriers across the two ends
  for (const [s, f] of [[0, 1], [line.len, -1]]) { const q = line.at(s), a = off(q, -half), b = off(q, half); const t = [q.hx * f * 0.8, q.hz * f * 0.8]; conc.quad([a[0], H, a[1]], [b[0], H, b[1]], [b[0], H + 1.1, b[1]], [a[0], H + 1.1, a[1]]); void t; }

  // ---- T-piers: a column and a cross-head under the girder; wider spans over the lake are the same shape with a taller column
  const colW = ex.pierSpec.col[0], colD = ex.pierSpec.col[1], headW = ex.pierSpec.head[0], headD = ex.pierSpec.head[1], headBottom = H - gird - 1.6;
  const piers = new Tris(S);
  for (const p of ex.piers) { box(piers, p.x, p.z, p.hx, p.hz, colW, colD, 0, headBottom); box(piers, p.x, p.z, p.hx, p.hz, headW, headD, headBottom, H - gird); }

  // ---- lamp posts in the median: pole and a double arm, every ~40 m
  const lamps = new Tris(S);
  for (const [x, z] of ex.lamps) {
    let best = 0, bd = 1e12; for (let i = 0; i < line.P.length; i++) { const d = (line.P[i].x - x) ** 2 + (line.P[i].z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    const q = line.at(line.s[best]); box(lamps, x, z, q.hx, q.hz, 0.35, 0.35, H, H + 11); box(lamps, x, z, q.hx, q.hz, 14, 0.25, H + 10.7, H + 10.95);
    for (const sg of [-1, 1]) { const p = off(q, sg * 6.2); box(lamps, p[0], p[1], q.hx, q.hz, 0.6, 1.1, H + 10.45, H + 10.7); }
  }

  // ---- ramps
  const ramp = new Tris(S), rampS = new Tris(S), rampC = new Tris(S), rampU = new Tris(S), rampM = new Tris(S), rampPi = new Tris(S);
  for (const r of ex.ramps) {
    const rl = new Line(r.pts), hOf = (s) => heightOn({ h0: r.h0, h1: r.h1, len: rl.len }, s), hw = r.half;
    // the visible range: the part that lies on the deck itself is covered by the deck, so it starts where the ramp leaves the deck
    const sv0 = rl.s[r.vis[0]], sv1 = rl.s[r.vis[1]];
    sweep(ramp, rl, sv0, sv1, [[-hw + 0.4, 0], [hw - 0.4, 0]], hOf, 5);
    sweep(rampS, rl, sv0, sv1, [[-hw, 0], [-hw + 0.4, 0]], hOf, 5); sweep(rampS, rl, sv0, sv1, [[hw - 0.4, 0], [hw, 0]], hOf, 5);
    sweep(rampM, rl, sv0, sv1, [[-hw + 0.4 - 0.08, 0.03], [-hw + 0.4 + 0.08, 0.03]], hOf, 5); sweep(rampM, rl, sv0, sv1, [[hw - 0.4 - 0.08, 0.03], [hw - 0.4 + 0.08, 0.03]], hOf, 5);
    for (const sg of [-1, 1]) sweep(rampC, rl, sv0, sv1, [[sg * hw, -0.2], [sg * hw, 0.95], [sg * (hw - 0.45), 0.95], [sg * (hw - 0.45), 0]], hOf, 5);
    sweep(rampU, rl, sv0, sv1, [[-hw, 0], [-hw + 0.8, -1.4], [hw - 0.8, -1.4], [hw, 0]], hOf, 5);
  }
  for (const p of ex.rampPiers) box(rampPi, p.x, p.z, p.hx, p.hz, 2.4, 1.8, 0, Math.max(0.5, p.h - 1.6));

  const add = (t, c, o) => { const m = t.mesh(c, o); if (m) g.add(m); };
  add(deckA, COL.deck, { rough: 0.95, offset: 1 }); add(deckS, COL.shoulder, { rough: 0.95, offset: 1 });
  add(ramp, COL.deck, { rough: 0.95, offset: 1 }); add(rampS, COL.shoulder, { rough: 0.95, offset: 1 });
  add(mk, COL.mark, { rough: 0.8, offset: 3, shadow: false }); add(edgeM, COL.edge, { rough: 0.8, offset: 3, shadow: false }); add(rampM, COL.mark, { rough: 0.8, offset: 3, shadow: false });
  add(conc, COL.concrete, { rough: 0.92 }); add(rampC, COL.concrete, { rough: 0.92 });
  add(under, COL.under, { rough: 0.95 }); add(rampU, COL.under, { rough: 0.95 });
  add(piers, COL.concrete, { rough: 0.95 }); add(rampPi, COL.concrete, { rough: 0.95 });
  add(rail, COL.rail, { rough: 0.4, metal: 0.6 }); add(lamps, COL.lamp, { rough: 0.5, metal: 0.5 });
  g.userData.dispose = () => g.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  return g;
}
