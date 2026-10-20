// lib3d/roadmesh.js
// Draws the roads from the SAME geometry the vehicles drive on and the people collide with (lib3d/roadgraph.js), so the picture and the rules cannot
// disagree: where the asphalt is, cars may go; where the pavement is, people walk; the dashes mark the middle of the road.
// Layers, bottom to top (each its own mesh, nudged with polygon offset so none flickers against another):
//   pavement   a wide ribbon along every road          kerb stone  a thin lighter ribbon at the edge of the asphalt
//   asphalt    a ribbon the width of the carriageway, plus a patch through every junction turn, so corners are filled
//   markings   centre dashes, stop lines at junctions, zebra crossings
// Everything is built in scene units (metres * S) and flat; lib3d/campusReal.js owns the heights (layerY) so trips can lower them.
import * as THREE from "three";

export const ROAD_COLORS = { pavement: "#8f949c", kerb: "#c6c9ce", asphalt: "#2f353f", marking: "#ece9dd", apron: "#454c57" };
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
export function buildRoadMeshes(graph, S, y = 0.08) {
  const pav = new Soup(S), kerb = new Soup(S), asp = new Soup(S), mk = new Soup(S);
  for (const e of [...graph.edges, ...graph.foots]) {
    const P = sample(e.path, 3);
    if (e.foot) { pav.ribbon(P, Math.max(0.8, e.sw)); continue; }
    pav.ribbon(P, e.half + e.sw); kerb.ribbon(P, e.half + 0.22); asp.ribbon(P, e.half);
    // centre dashes: not through junctions, and only on roads wide enough to have two lanes
    if (e.half >= 3.0) {
      const ta = Math.max(...[0, 1].map((k) => (k ? graph.nodes[e.b] : graph.nodes[e.a]).radius)) + 3, w = 0.07;
      for (let s = ta; s + 3 < e.len - ta; s += 8) { const a = e.path.at(s, {}), b = e.path.at(s + 3, {}), nx = -(b.z - a.z), nz = b.x - a.x, l = Math.hypot(nx, nz) || 1; mk.quad(a.x + (nx / l) * w, a.z + (nz / l) * w, a.x - (nx / l) * w, a.z - (nz / l) * w, b.x - (nx / l) * w, b.z - (nz / l) * w, b.x + (nx / l) * w, b.z + (nz / l) * w); }
    }
  }
  for (const n of graph.nodes) if (n.deg > 0) { const r = n.radius; asp.disc(n.x, n.z, r, 20); pav.disc(n.x, n.z, r + 2, 20); kerb.disc(n.x, n.z, r + 0.22, 20); }
  for (const p of graph.patches) { const P = sample(p.path, 1.6); asp.ribbon(P, p.half); }
  // stop lines across the lane at the end of each approach to a junction
  for (const l of graph.lanes) {
    if (graph.nodes[l.to].deg < 3 || l.len < 6) continue; const a = l.path.at(l.len - 0.5, {}), nx = -a.hz, nz = a.hx, w = l.half / 2 - 0.1, d = 0.2;
    mk.quad(a.x - nx * w - a.hx * d, a.z - nz * w - a.hz * d, a.x + nx * w - a.hx * d, a.z + nz * w - a.hz * d, a.x + nx * w + a.hx * d, a.z + nz * w + a.hz * d, a.x - nx * w + a.hx * d, a.z - nz * w + a.hz * d);
  }
  // zebra crossings: bars along the road, one every metre across it
  for (const c of graph.crossings) {
    const nx = -c.hz, nz = c.hx, L = c.along;
    for (let o = -c.half + 0.5; o <= c.half - 0.4; o += 1.0) { const cx = c.x + nx * o, cz = c.z + nz * o, w = 0.24; mk.quad(cx - c.hx * L - nx * w, cz - c.hz * L - nz * w, cx - c.hx * L + nx * w, cz - c.hz * L + nz * w, cx + c.hx * L + nx * w, cz + c.hz * L + nz * w, cx + c.hx * L - nx * w, cz + c.hz * L - nz * w); }
  }
  const g = new THREE.Group(); g.name = "road-surface";
  const parts = [[pav, ROAD_COLORS.pavement, 5, y - 0.0016, "road-pavement"], [kerb, ROAD_COLORS.kerb, 6, y - 0.0008, "road-kerb"], [asp, ROAD_COLORS.asphalt, 7, y, "road-asphalt"], [mk, ROAD_COLORS.marking, 8, y + 0.0008, "road-marks"]];
  for (const [soup, color, layer, yy, name] of parts) { const m = soup.mesh(color, { layer, y: yy, rough: name === "road-marks" ? 0.7 : 0.95 }); if (m) { m.name = name; g.add(m); } }
  g.userData.dispose = () => g.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return g;
}