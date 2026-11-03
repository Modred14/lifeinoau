// lib3d/roadmesh.js
// Draws the roads from the SAME geometry the vehicles drive on and the people collide with (lib3d/roadgraph.js), so the picture and the rules cannot
// disagree: where the asphalt is, cars may go; where the pavement is, people walk; the dashes mark the middle of the road.
//
// HOW THE SURFACES JOIN. Every layer (pavement, kerb stone, asphalt) is made of two kinds of piece that share their edges exactly:
//   - one polygon per junction, computed from all the roads that reach it (lib3d/roadjunction.js: rounded kerb returns on the inside of each corner), triangulated,
//   - one ribbon per road, which starts where the junction polygon ends (the "cut") and has flat ends there; only a road end with no polygon (a bend, a dead end) is capped with a round join.
// So there is no gap, no sliver and no road poking through a corner.
//
// Layers, bottom to top (each its own mesh, nudged with polygon offset so none flickers against another):
//   pavement   paving slabs                         kerb stone  a thin lighter band at the edge of the asphalt
//   asphalt    dark, with a fine grain              shoulder    the paved strip outside the outer lane (lighter, worn asphalt)
//   median     the concrete strip down an express road, edged with a yellow-and-black kerb
//   markings   white edge lines, dashed lane lines, yellow centre lines, stop lines, zebra crossings and lane arrows
// Roads on the expressway (graph edges with `hw`) are not drawn here: lib3d/highwaymesh.js builds them, up in the air.
// Everything is built in scene units (metres * S) and flat; lib3d/campusReal.js owns the heights (layerY) so trips can lower them.
import * as THREE from "three";
import { XS } from "./roadgraph.js";
import { triangulate } from "./roadjunction.js";

export const ROAD_COLORS = { pavement: "#b9bcc2", kerb: "#d3d5d8", asphalt: "#3a3f48", shoulder: "#4b5059", median: "#a9aca8", marking: "#f1efe6", centre: "#e8c22e", medY: "#f0c419", medK: "#1d1f23", apron: "#454c57" };
const DISC = 14;

/** A small tileable texture made in code (no image to load, works in Node too). kind: "asphalt" (fine grain) or "paving" (slabs). One texel is 3 cm of grain or a slab is 1 m. */
function makeTexture(kind) {
  const N = 128, d = new Uint8Array(N * N * 4); let a = kind === "asphalt" ? 12345 : 6789; const r = () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v;
    if (kind === "asphalt") { v = 0.9 + r() * 0.1; if (r() < 0.02) v -= 0.12; }
    else { const gx = x % 32 === 0 || x % 32 === 1, gy = y % 32 === 0 || y % 32 === 1; v = 0.95 + r() * 0.05; if (gx || gy) v -= 0.16; const slab = (Math.floor(x / 32) * 7 + Math.floor(y / 32) * 13) % 5; v -= slab * 0.008; }
    const k = (y * N + x) * 4, c = Math.max(0, Math.min(255, Math.round(v * 255))); d[k] = d[k + 1] = d[k + 2] = c; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true; return t;
}

/** Accumulates triangles as flat float arrays. */
class Soup {
  constructor(S) { this.S = S; this.p = []; }
  tri(ax, az, bx, bz, cx, cz) { const S = this.S; this.p.push(ax * S, 0, az * S, bx * S, 0, bz * S, cx * S, 0, cz * S); }
  quad(ax, az, bx, bz, cx, cz, dx, dz) { this.tri(ax, az, bx, bz, cx, cz); this.tri(ax, az, cx, cz, dx, dz); }
  disc(x, z, r, n = DISC) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2; this.tri(x, z, x + Math.cos(a) * r, z + Math.sin(a) * r, x + Math.cos(b) * r, z + Math.sin(b) * r); } }
  /** A convex-or-not simple polygon, by ear clipping; a polygon that cannot be cut (it should not happen: junctionPolygon checks) is drawn as a fan round its middle. */
  polygon(P) {
    const T = triangulate(P);
    if (T) { for (const [i, j, k] of T) this.tri(P[i][0], P[i][1], P[j][0], P[j][1], P[k][0], P[k][1]); return; }
    const cx = P.reduce((t, q) => t + q[0], 0) / P.length, cz = P.reduce((t, q) => t + q[1], 0) / P.length; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; this.tri(cx, cz, P[i][0], P[i][1], q[0], q[1]); }
  }
  /** A ribbon of half-width h along points (array of {x, z}); round joins where the line bends, so there are no gaps. `capA` / `capB` round the two ends (off where a junction polygon takes over). */
  ribbon(P, h, capA = true, capB = true) {
    // the edges of the ribbon at a sample are perpendicular to the PATH's own heading there (when the samples carry it), so two ribbons that meet at the same distance along a road, and the junction polygon, share their mouth exactly
    if (P.length < 2) return; const N = P.map((p, i) => { if (p.hx !== undefined) return { x: -p.hz, z: p.hx, tx: p.hx, tz: p.hz }; const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return { x: -tz / l, z: tx / l, tx: tx / l, tz: tz / l }; });
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], na = N[i], nb = N[i + 1]; this.quad(a.x + na.x * h, a.z + na.z * h, a.x - na.x * h, a.z - na.z * h, b.x - nb.x * h, b.z - nb.z * h, b.x + nb.x * h, b.z + nb.z * h); }
    for (let i = 1; i < P.length - 1; i++) { const d = N[i - 1].tx * N[i + 1].tx + N[i - 1].tz * N[i + 1].tz; if (d < 0.985) this.disc(P[i].x, P[i].z, h, 10); }
    if (capA) this.disc(P[0].x, P[0].z, h, 10); if (capB) this.disc(P.at(-1).x, P.at(-1).z, h, 10);
  }
  /** `tex`: a texture repeated every `uv` metres (the texture coordinates are the position on the ground, so pieces that meet continue each other's pattern exactly). */
  mesh(color, { rough = 0.92, layer = 1, y = 0, tex = null, uv = 4 } = {}) {
    if (!this.p.length) return null; const g = new THREE.BufferGeometry(), pos = new Float32Array(this.p); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
    if (tex) { const u = new Float32Array((pos.length / 3) * 2), k = 1 / (uv * this.S); for (let i = 0; i < pos.length / 3; i++) { u[i * 2] = pos[i * 3] * k; u[i * 2 + 1] = pos[i * 3 + 2] * k; } g.setAttribute("uv", new THREE.BufferAttribute(u, 2)); }
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, map: tex, roughness: rough, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer }));
    m.position.y = y; m.userData.layerY = y; m.receiveShadow = true; return m;
  }
}
const sampleRange = (path, s0, s1, step) => { const n = Math.max(1, Math.ceil((s1 - s0) / step)), out = [], a = {}; for (let i = 0; i <= n; i++) { path.at(s0 + ((s1 - s0) * i) / n, a); out.push({ x: a.x, z: a.z, hx: a.hx, hz: a.hz }); } return out; };

/** The point at distance s along `path`, `off` metres to the right of its heading (x east, z south: right of east is south). */
const side = (path, s, off, o) => { path.at(s, o); return { x: o.x - o.hz * off, z: o.z + o.hx * off, hx: o.hx, hz: o.hz }; };
/** A strip of width w, centred `off` metres right of the road's centreline, from s0 to s1 along it (a solid line, or a band when w is large). */
function strip(soup, path, s0, s1, off, w, step = 2.5) {
  if (s1 - s0 < 0.3) return; const n = Math.max(1, Math.ceil((s1 - s0) / step)), a = {}, h = w / 2; let prev = null;
  for (let i = 0; i <= n; i++) {
    const q = side(path, s0 + ((s1 - s0) * i) / n, off, a), L = { x: q.x - q.hz * h, z: q.z + q.hx * h }, R = { x: q.x + q.hz * h, z: q.z - q.hx * h };
    if (prev) soup.quad(prev.L.x, prev.L.z, prev.R.x, prev.R.z, R.x, R.z, L.x, L.z); prev = { L, R };
  }
}
/** Dashes of length `dash` every `dash + gap` metres between s0 and s1. */
function dashes(soup, path, s0, s1, off, w, dash = 3, gap = 9) { for (let s = s0; s + dash <= s1; s += dash + gap) strip(soup, path, s, s + dash, off, w, dash); }
/** The same dash pattern for a strip made of two colours (the median kerb: yellow and black bars, 1.5 m each). */
function bars(a, b, path, s0, s1, off, w, len = 1.5) { let k = 0; for (let s = s0; s < s1 - 0.05; s += len, k++) strip(k % 2 ? b : a, path, s, Math.min(s1, s + len), off, w, len); }

/**
 * A road arrow lying on the road: a shaft and a head, at (x, z) facing (hx, hz); `turn` (radians, + to the right) bends the head off to one side for a turn lane.
 */
function arrow(soup, x, z, hx, hz, turn = 0) {
  const rx = -hz, rz = hx, W = 0.16, SL = 2.2, HL = 1.5, HW = 0.62, P = (u, v) => [x + hx * u + rx * v, z + hz * u + rz * v];
  const tipU = turn ? 0.2 : SL - 1.1; const a = P(-1.1, -W), b = P(-1.1, W), c = P(tipU, W), d = P(tipU, -W); soup.quad(a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]);
  const ch = Math.cos(turn), sh = Math.sin(turn), fx = hx * ch + rx * sh, fz = hz * ch + rz * sh, gx = -fz, gz = fx, base = P(tipU, 0);   // the head faces the road's heading turned `turn` to the right
  const t0 = [base[0] + fx * HL, base[1] + fz * HL], l0 = [base[0] + gx * HW, base[1] + gz * HW], r0 = [base[0] - gx * HW, base[1] - gz * HW]; soup.tri(t0[0], t0[1], l0[0], l0[1], r0[0], r0[1]);
}

/**
 * graph: from buildRoadGraph. S: scene units per metre (0.1). `y` is the base height (scene units) of the asphalt layer; the others sit a hair below/above it.
 * Returns a Group (names: road-pavement, road-kerb, road-asphalt, road-shoulder, road-median, road-medstripe-*, road-marks, road-centre) with a dispose().
 */
export function buildRoadMeshes(graph, S, y = 0.08) {
  const pav = new Soup(S), kerb = new Soup(S), asp = new Soup(S), sho = new Soup(S), med = new Soup(S), mk = new Soup(S), yel = new Soup(S), mY = new Soup(S), mK = new Soup(S);
  const cutOf = (n, e, end, layer) => n.J?.[layer].cut.get(e.id * 2 + end) ?? 0;
  for (const e of [...graph.edges, ...graph.foots]) {
    if (e.hw) continue;
    const na = graph.nodes[e.a], nb = graph.nodes[e.b], ca = { asph: cutOf(na, e, 0, "asph"), kerb: cutOf(na, e, 0, "kerb"), pave: cutOf(na, e, 0, "pave") }, cb = { asph: cutOf(nb, e, 1, "asph"), kerb: cutOf(nb, e, 1, "kerb"), pave: cutOf(nb, e, 1, "pave") };
    const range = (layer, h, soup) => { const s0 = ca[layer], s1 = e.len - cb[layer]; if (s1 - s0 < 0.05) return; soup.ribbon(sampleRange(e.path, s0, s1, 3), h, s0 < 0.05, e.len - s1 < 0.05); };
    if (e.foot) { pav.ribbon(sampleRange(e.path, 0, e.len, 3), Math.max(0.8, e.sw)); continue; }
    range("pave", e.half + e.sw, pav); range("kerb", e.half + 0.25, kerb); range("asph", e.half, asp);
    // the stretch of each arm between the node and the mouth: the road runs right up to the node (it is carriageway there for the surface query too), and the polygon adds the corners
    for (const [layer, h, soup] of [["pave", e.half + e.sw, pav], ["kerb", e.half + 0.25, kerb], ["asph", e.half, asp]]) { if (ca[layer] > 0.05) soup.ribbon(sampleRange(e.path, 0, ca[layer], 3), h, false, false); if (cb[layer] > 0.05) soup.ribbon(sampleRange(e.path, e.len - cb[layer], e.len, 3), h, false, false); }
    // markings stop short of the junctions at each end: the zebra crossing and the stop line come first
    const open = (n, c) => (n.deg >= 3 && !n.J?.asph.disc ? c.asph + XS.stopGap + 1.2 : n.deg >= 3 ? n.radius + 4 : 0.3), s0 = open(na, ca), s1 = e.len - open(nb, cb), W = 0.12;
    const m0 = ca.asph, m1 = e.len - cb.asph;                                                // the median, the shoulders and the kerb run right up to the junction's mouth
    if (e.med > 0) { strip(med, e.path, m0, m1, 0, e.med * 2, 3); if (m1 - m0 > 3) for (const sgn of [-1, 1]) bars(mY, mK, e.path, m0, m1, sgn * e.med, 0.34); }
    if (e.shoulder >= 0.8) for (const sgn of [-1, 1]) strip(sho, e.path, m0, m1, sgn * (e.half - e.shoulder / 2), e.shoulder, 3);
    if (s1 - s0 > 8) {
      if (e.cls === "arterial") {
        for (const sgn of [-1, 1]) {
          strip(mk, e.path, s0, s1, sgn * (e.half - e.shoulder), 0.16, 3);                     // the edge line, where the shoulder starts
          for (let k = 1; k < e.lanesPerDir; k++) dashes(mk, e.path, s0, s1, sgn * (e.med + k * XS.lane), W);   // lane lines
        }
      } else {
        if (e.shoulder >= 0.8) for (const sgn of [-1, 1]) strip(mk, e.path, s0, s1, sgn * (e.half - e.shoulder), 0.14, 3);   // the edge line of a collector
        if (e.half >= 3.0) dashes(yel, e.path, s0, s1, 0, 0.14, 4, 8);                            // the yellow centre line of a two-way road
      }
    }
    // lane arrows, one on the outer lane of each direction just before the stop line (a turn arrow where every way on is a turn)
    if (e.cls !== "local" && e.len > 45) for (const dir of [0, 1]) {
      const lane = e.lanes[dir], node = dir ? na : nb, c = dir ? ca : cb; if (!lane || node.deg < 3 || node.J?.asph.disc) continue;
      const kinds = lane.out.map((id) => graph.conns[id].kind).filter((k) => k !== "uturn"), allL = kinds.length && kinds.every((k) => k === "left"), allR = kinds.length && kinds.every((k) => k === "right");
      const sArrow = dir ? c.asph + XS.stopGap + 9 : e.len - (c.asph + XS.stopGap + 9); if (sArrow < s0 + 4 || sArrow > s1 - 4) continue;
      const lanes = e.cls === "arterial" ? e.lanesPerDir : 1;
      for (let k = 0; k < lanes; k++) {
        const off = (e.med > 0 ? e.med + XS.lane * (k + 0.5) : e.half / 2) * (dir ? -1 : 1), q = side(e.path, sArrow, off, {}), hx = dir ? -q.hx : q.hx, hz = dir ? -q.hz : q.hz, outer = k === lanes - 1 && lanes > 1 ? true : lanes === 1;
        arrow(mk, q.x, q.z, hx, hz, outer && allR ? 0.75 : outer && allL ? -0.75 : 0);
      }
    }
  }
  // the junctions: one polygon per layer, and a round cap where a bend or a dead end has none
  for (const n of graph.nodes) {
    if (!n.J || !(n.mask & 1) || n.fixedOnly) continue;
    for (const [soup, layer] of [[pav, "pave"], [kerb, "kerb"], [asp, "asph"]]) soup.polygon(n.J[layer].poly);
    if (n.J.asph.disc && n.deg >= 3) { /* the disc is the polygon: nothing more to add */ }
  }
  for (const p of graph.patches) { if (p.h0 > 0.4 || !(p.mask & 1)) continue; const e0 = graph.lanes[graph.conns[p.conn].from], n = graph.nodes[graph.conns[p.conn].node]; if (n.J && !n.J.asph.disc) continue; const P = sampleRange(p.path, 0, p.path.len, 1.6); asp.ribbon(P, p.half); }   // only a disc junction needs the swept corner; a polygon already has its kerb returns
  // stop lines across the lane at the end of each approach to a junction
  for (const l of graph.lanes) {
    if (l.hw || graph.nodes[l.to].deg < 3 || l.len < 6) continue; const e = graph.byEdge.get(l.edge), a = l.path.at(l.len - 0.5, {}), nx = -a.hz, nz = a.hx, dirW = e.half - (e.med ?? 0), w = dirW / 2 - 0.15, d = 0.2;
    const cx = a.x + nx * ((e.med ?? 0) + dirW / 2 - l.off), cz = a.z + nz * ((e.med ?? 0) + dirW / 2 - l.off);       // the line spans the whole carriageway on this side of the road
    mk.quad(cx - nx * w - a.hx * d, cz - nz * w - a.hz * d, cx + nx * w - a.hx * d, cz + nz * w - a.hz * d, cx + nx * w + a.hx * d, cz + nz * w + a.hz * d, cx - nx * w + a.hx * d, cz - nz * w + a.hz * d);
  }
  // zebra crossings: bars along the road, one every metre across it
  for (const c of graph.crossings) {
    const nx = -c.hz, nz = c.hx, L = c.along;
    for (let o = -c.half + 0.5; o <= c.half - 0.4; o += 1.0) { const cx = c.x + nx * o, cz = c.z + nz * o, w = 0.24; mk.quad(cx - c.hx * L - nx * w, cz - c.hz * L - nz * w, cx - c.hx * L + nx * w, cz - c.hz * L + nz * w, cx + c.hx * L + nx * w, cz + c.hz * L + nz * w, cx + c.hx * L - nx * w, cz + c.hz * L - nz * w); }
  }
  const g = new THREE.Group(); g.name = "road-surface";
  const tAsp = makeTexture("asphalt"), tPav = makeTexture("paving");
  const parts = [[pav, ROAD_COLORS.pavement, 5, y - 0.0016, "road-pavement", tPav, 4], [kerb, ROAD_COLORS.kerb, 6, y - 0.0008, "road-kerb"], [asp, ROAD_COLORS.asphalt, 7, y, "road-asphalt", tAsp, 3], [sho, ROAD_COLORS.shoulder, 8, y + 0.0004, "road-shoulder", tAsp, 3], [med, ROAD_COLORS.median, 9, y + 0.0008, "road-median", tPav, 4],
    [mY, ROAD_COLORS.medY, 10, y + 0.0012, "road-medstripe-y"], [mK, ROAD_COLORS.medK, 10, y + 0.0012, "road-medstripe-k"], [mk, ROAD_COLORS.marking, 10, y + 0.0014, "road-marks"], [yel, ROAD_COLORS.centre, 10, y + 0.0014, "road-centre"]];
  for (const [soup, color, layer, yy, name, tex, uv] of parts) { const m = soup.mesh(color, { layer, y: yy, rough: name.includes("marks") || name.includes("centre") || name.includes("stripe") ? 0.7 : 0.95, tex: tex ?? null, uv }); if (m) { m.name = name; g.add(m); } }
  g.userData.dispose = () => { g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); tAsp.dispose(); tPav.dispose(); };
  return g;
}
