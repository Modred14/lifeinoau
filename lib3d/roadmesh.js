// lib3d/roadmesh.js
// Draws the roads from the SAME geometry the vehicles drive on and the people collide with (lib3d/roadgraph.js), so the picture and the rules cannot
// disagree: where the asphalt is, cars may go; where the pavement is, people walk; the dashes mark the middle of the road.
// Layers, bottom to top (each its own mesh, nudged with polygon offset so none flickers against another):
//   pavement   a wide ribbon along every road          kerb stone  a thin lighter ribbon at the edge of the asphalt
//   asphalt    a ribbon the width of the carriageway, plus a patch through every junction turn, so corners are filled
//   shoulder   the paved strip outside the outer lane (lighter, worn asphalt)      median  the concrete strip down the middle of an express road
//   markings   solid edge lines, dashed lane lines (one fewer than the lanes, each way), a dashed centre line on a two-way road, stop lines at junctions, zebra crossings
// Roads on the expressway (graph edges with `hw`) are not drawn here: lib3d/highwaymesh.js builds them, up in the air.
// Everything is built in scene units (metres * S) and flat; lib3d/campusReal.js owns the heights (layerY) so trips can lower them.
import * as THREE from "three";
import { XS } from "./roadgraph.js";

export const ROAD_COLORS = { pavement: "#8f949c", kerb: "#c6c9ce", asphalt: "#2f353f", shoulder: "#444a52", median: "#a2a6a2", marking: "#ece9dd", apron: "#454c57" };
const DISC = 14;

/** Accumulates triangles as flat float arrays. */
class Soup {
  constructor(S) { this.S = S; this.p = []; }
  tri(ax, az, bx, bz, cx, cz) { const S = this.S; this.p.push(ax * S, 0, az * S, bx * S, 0, bz * S, cx * S, 0, cz * S); }
  quad(ax, az, bx, bz, cx, cz, dx, dz) { this.tri(ax, az, bx, bz, cx, cz); this.tri(ax, az, cx, cz, dx, dz); }
  disc(x, z, r, n = DISC) { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2; this.tri(x, z, x + Math.cos(a) * r, z + Math.sin(a) * r, x + Math.cos(b) * r, z + Math.sin(b) * r); } }
  /** A ribbon of half-width h along points (array of {x, z}); round joins where the line bends, so there are no gaps. */
  ribbon(P, h) {
    if (P.length < 2) return; const N = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)]; let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; return { x: -tz / l, z: tx / l, tx: tx / l, tz: tz / l }; });
    for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], na = N[i], nb = N[i + 1]; this.quad(a.x + na.x * h, a.z + na.z * h, a.x - na.x * h, a.z - na.z * h, b.x - nb.x * h, b.z - nb.z * h, b.x + nb.x * h, b.z + nb.z * h); }
    for (let i = 1; i < P.length - 1; i++) { const d = N[i - 1].tx * N[i + 1].tx + N[i - 1].tz * N[i + 1].tz; if (d < 0.985) this.disc(P[i].x, P[i].z, h, 10); }
    this.disc(P[0].x, P[0].z, h, 10); this.disc(P.at(-1).x, P.at(-1).z, h, 10);
  }
  mesh(color, { rough = 0.92, layer = 1, y = 0 } = {}) {
    if (!this.p.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(this.p), 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer }));
    m.position.y = y; m.userData.layerY = y; m.receiveShadow = true; return m;
  }
}
const sample = (path, step) => { const n = Math.max(1, Math.ceil(path.len / step)), out = [], a = {}; for (let i = 0; i <= n; i++) { path.at((path.len * i) / n, a); out.push({ x: a.x, z: a.z, hx: a.hx, hz: a.hz }); } return out; };

/**
 * graph: from buildRoadGraph. S: scene units per metre (0.1). `y` is the base height (scene units) of the asphalt layer; the others sit a hair below/above it.
 * Returns a Group (names: road-pavement, road-kerb, road-asphalt, road-marks) with a dispose().
 */
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

export function buildRoadMeshes(graph, S, y = 0.08) {
  const pav = new Soup(S), kerb = new Soup(S), asp = new Soup(S), sho = new Soup(S), med = new Soup(S), mk = new Soup(S);
  for (const e of [...graph.edges, ...graph.foots]) {
    if (e.hw) continue;
    const P = sample(e.path, 3);
    if (e.foot) { pav.ribbon(P, Math.max(0.8, e.sw)); continue; }
    pav.ribbon(P, e.half + e.sw); kerb.ribbon(P, e.half + 0.22); asp.ribbon(P, e.half);
    // markings stop short of the junctions at each end
    const ta = graph.nodes[e.a].radius + 3, tb = graph.nodes[e.b].radius + 3, s0 = ta, s1 = e.len - tb, W = 0.12;
    if (e.med > 0) strip(med, e.path, 0, e.len, 0, e.med * 2, 3);
    if (e.shoulder >= 0.8) for (const sgn of [-1, 1]) strip(sho, e.path, 0, e.len, sgn * (e.half - e.shoulder / 2), e.shoulder, 3);
    if (s1 - s0 > 8) {
      if (e.cls === "arterial") {
        for (const sgn of [-1, 1]) {
          strip(mk, e.path, s0, s1, sgn * (e.half - e.shoulder), 0.16, 3);                     // the edge line, where the shoulder starts
          for (let k = 1; k < e.lanesPerDir; k++) dashes(mk, e.path, s0, s1, sgn * (e.med + k * XS.lane), W);   // lane lines
        }
      } else {
        if (e.shoulder >= 0.8) for (const sgn of [-1, 1]) strip(mk, e.path, s0, s1, sgn * (e.half - e.shoulder), 0.14, 3);   // the edge line of a collector
        if (e.half >= 3.0) dashes(mk, e.path, s0, s1, 0, 0.14);                              // the centre line of a two-way road
      }
    }
  }
  for (const n of graph.nodes) if (n.deg > 0 && !n.fixedOnly && (n.mask & 1)) { const r = n.radius; asp.disc(n.x, n.z, r, 20); pav.disc(n.x, n.z, r + 2, 20); kerb.disc(n.x, n.z, r + 0.22, 20); }
  for (const p of graph.patches) { if (p.h0 > 0.4 || !(p.mask & 1)) continue; const P = sample(p.path, 1.6); asp.ribbon(P, p.half); }
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
  const parts = [[pav, ROAD_COLORS.pavement, 5, y - 0.0016, "road-pavement"], [kerb, ROAD_COLORS.kerb, 6, y - 0.0008, "road-kerb"], [asp, ROAD_COLORS.asphalt, 7, y, "road-asphalt"], [sho, ROAD_COLORS.shoulder, 8, y + 0.0004, "road-shoulder"], [med, ROAD_COLORS.median, 9, y + 0.0008, "road-median"], [mk, ROAD_COLORS.marking, 10, y + 0.0012, "road-marks"]];
  for (const [soup, color, layer, yy, name] of parts) { const m = soup.mesh(color, { layer, y: yy, rough: name === "road-marks" ? 0.7 : 0.95 }); if (m) { m.name = name; g.add(m); } }
  g.userData.dispose = () => g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return g;
}