// lib3d/roadfurniture.js
// The street furniture of the road network, placed from the same graph the roads are drawn and driven from, so nothing stands in a carriageway or a junction:
//   street lights   on the median of every express road (a double arm), and alternating sides of collectors and the longer local roads, every ~38 m
//   trees           along the outer edge of a pavement that is wide enough, every ~17 m, never near a junction, a crossing, a lamp or a wall
//   stop signs      on the right-hand verge of every side road where it meets a bigger road
// Everything is instanced (3 draw calls for lights, 2 for trees, 1 for signs, however many there are), so it costs a phone nothing.
// A candidate spot is rejected unless it is pavement (or median, for the lights on it), at least `clear` metres from a building or water, and outside the expressway's corridor.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { XS } from "./roadgraph.js";
import { corridorKeepOut } from "./highway.js";
import { glowMaterial } from "./glow.js";
import { ROAD_LAYER_Y } from "./roadsurface.js";

const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const cyl = (r0, r1, h, y, seg = 6) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(0, y + h / 2, 0); return g; };
const box = (w, h, d, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); return g; };
const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; };
const merged = (parts) => { const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))); parts.forEach((p) => p.dispose()); return g; };

/** A street light in metres: a 7.5 m pole with one arm 2.4 m long toward +x (or two, one each way) and a lamp head under the end. The pole and the head are separate meshes: the head glows at night. */
function lampGeometry(double) {
  const pole = [paint(cyl(0.09, 0.13, 7.5, 0), "#4b5058"), paint(box(0.4, 0.3, 0.4, 0, 0, 0), "#3b4047")], head = [];
  for (const sgn of double ? [1, -1] : [1]) { pole.push(paint(box(2.4, 0.09, 0.09, sgn * 1.2, 7.4, 0), "#4b5058")); head.push(paint(box(0.85, 0.16, 0.32, sgn * 2.3, 7.22, 0), "#f4e9b8")); }
  return { pole: merged(pole), head: merged(head) };
}
/** The light a lamp spills on the road: a flat round pool under each lamp head, at ground level (the mesh is lifted to the road by its own position). Drawn additively, only at night. */
function poolGeometry(double) {
  const parts = (double ? [1, -1] : [1]).map((sgn) => { const g = new THREE.PlaneGeometry(15, 15); g.rotateX(-Math.PI / 2); g.translate(sgn * 2.3, 0, 0); return g; });
  return merged(parts);
}

/** graph: from buildRoadGraph. S: scene units per metre. Returns a Group with dispose(), plus `counts`. */
export function buildRoadFurniture(graph, S, { seed = 11 } = {}) {
  const rnd = rng(seed), keep = corridorKeepOut(), sdf = graph.sdf ?? (() => Infinity), surf = {};
  const inCorridor = (x, z) => { for (const [kx, kz, kr] of keep) if (Math.abs(kx - x) < kr && Math.abs(kz - z) < kr && Math.hypot(kx - x, kz - z) < kr) return true; return false; };
  const crossings = graph.crossings, nearCrossing = (x, z, r) => { for (const c of crossings) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && Math.hypot(c.x - x, c.z - z) < r) return true; return false; };
  const lamps = [], lamps2 = [], trees = [], signs = [], taken = [];
  const free = (x, z, r) => { for (const t of taken) if (Math.abs(t[0] - x) < r && Math.abs(t[1] - z) < r && Math.hypot(t[0] - x, t[1] - z) < r) return false; return true; };
  const onPavement = (x, z) => graph.surfaceAt(x, z, surf).cls === 2;
  const at = (e, s, off) => { const p = e.path.at(s, {}); return { x: p.x - p.hz * off, z: p.z + p.hx * off, hx: p.hx, hz: p.hz }; };
  const cutOf = (e) => { const na = graph.nodes[e.a], nb = graph.nodes[e.b]; return [na.deg >= 3 ? na.J?.pave.cut.get(e.id * 2) ?? 0 : 0, nb.deg >= 3 ? nb.J?.pave.cut.get(e.id * 2 + 1) ?? 0 : 0]; };

  for (const e of graph.edges) {
    if (e.hw || e.foot || e.len < 30) continue;
    const [ca, cb] = cutOf(e), s0 = ca + 10, s1 = e.len - cb - 10; if (s1 - s0 < 12) continue;
    // ---- lights ----
    if (e.cls === "arterial" && e.med > 0) {
      const n = Math.max(1, Math.floor((s1 - s0) / 36)), step = (s1 - s0) / n;
      for (let i = 0; i <= n; i++) { const s = s0 + i * step, p = at(e, s, 0); if (inCorridor(p.x, p.z) || graph.surfaceAt(p.x, p.z, surf).cls === 1 || sdf(p.x, p.z) < 4 || nearCrossing(p.x, p.z, 7) || !free(p.x, p.z, 8)) continue;   // the median is not carriageway: if another road overlaps it, no light lamps2.push([p.x, p.z, Math.atan2(-p.hx, -p.hz)]);   // the two arms lie across the road: along the right-hand vector (-hz, hx), yaw = atan2(-dz, dx)
        taken.push([p.x, p.z]); }
    } else if (e.cls !== "local" || e.len > 90) {
      const gap = e.cls === "local" ? 44 : 38, n = Math.max(1, Math.floor((s1 - s0) / gap)), step = (s1 - s0) / n; let sgn = rnd() < 0.5 ? 1 : -1;
      for (let i = 0; i <= n; i++, sgn = -sgn) {
        const s = s0 + i * step, lat = e.half + Math.min(1.1, e.sw * 0.55); if (e.sw < 1.0) continue; const p = at(e, s, sgn * lat);
        if (inCorridor(p.x, p.z) || !onPavement(p.x, p.z) || sdf(p.x, p.z) < 1.2 || nearCrossing(p.x, p.z, 6) || !free(p.x, p.z, 8)) continue;
        // the arm reaches over the road, toward the centreline: direction -sgn * (-hz, hx) = (sgn hz, -sgn hx)
        lamps.push([p.x, p.z, Math.atan2(sgn * p.hx, sgn * p.hz)]); taken.push([p.x, p.z]);
      }
    }
    // ---- trees ----
    if (e.sw >= 1.9) {
      for (const sgn of [-1, 1]) for (let s = s0 + 4 + rnd() * 6; s < s1 - 4; s += 15 + rnd() * 6) {
        const p = at(e, s, sgn * (e.half + e.sw * 0.62));
        if (inCorridor(p.x, p.z) || !onPavement(p.x, p.z) || sdf(p.x, p.z) < 2.4 || nearCrossing(p.x, p.z, 7) || !free(p.x, p.z, 6)) continue;
        trees.push([p.x, p.z, 0.8 + rnd() * 0.5, rnd()]); taken.push([p.x, p.z]);
      }
    }
  }
  // ---- stop signs: at the end of every lane that runs into a bigger road ----
  const RANK = { local: 0, collector: 1, arterial: 2 };
  for (const l of graph.lanes) {
    if (l.hw) continue; const e = graph.byEdge.get(l.edge), node = graph.nodes[l.to]; if (node.deg < 3 || e.sw < 0.6 || l.len < 14) continue;
    const bigger = node.edges.some((id) => { const o = graph.byEdge.get(id); return o && o !== e && !o.hw && (RANK[o.cls] ?? 0) > (RANK[e.cls] ?? 0); }); if (!bigger) continue;
    // at the stop line itself the swept corner of a turn can cover the pavement: take the first spot back along the lane that is pavement
    for (let s = l.len - 0.5; s > Math.max(4, l.len - 16); s -= 1.5) {
      const p = l.path.at(s, {}), rx = -p.hz, rz = p.hx, off = e.half + Math.min(0.7, Math.max(0.3, e.sw * 0.5)) - l.off, x = p.x + rx * off, z = p.z + rz * off;
      if (!onPavement(x, z) || sdf(x, z) < 0.5 || inCorridor(x, z) || nearCrossing(x, z, 3.2) || !free(x, z, 3)) continue;
      signs.push([x, z, Math.atan2(-p.hx, -p.hz)]); taken.push([x, z]); break;   // the plate faces the traffic that comes up to it
    }
  }

  const group = new THREE.Group(); group.name = "road-furniture"; const dummy = new THREE.Object3D(), disposables = [];
  const instanced = (geom, mat, list, place, cast = true) => { if (!list.length) return null; const m = new THREE.InstancedMesh(geom, mat, list.length); list.forEach((it, i) => { place(dummy, it); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); }); m.instanceMatrix.needsUpdate = true; m.castShadow = cast; m.frustumCulled = false; group.add(m); disposables.push(geom, mat); return m; };
  const matV = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
  const yawPlace = (o, [x, z, yaw], k = 1) => { o.position.set(x * S, 0, z * S); o.rotation.set(0, yaw, 0); o.scale.setScalar(S * k); };
  // the lamps: pole (always the same), head (glows at night, see userData.lampHead) and the pool of light on the road (userData.lampPool). campusReal.js sets the glow from the night level.
  const headMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, emissive: "#ffcf70", emissiveIntensity: 0 }), poolMat = glowMaterial(0xffc46b);
  for (const [list, dbl] of [[lamps, false], [lamps2, true]]) {
    const g = lampGeometry(dbl), poles = instanced(g.pole, matV(), list, (o, it) => yawPlace(o, it)), heads = instanced(g.head, headMat(), list, (o, it) => yawPlace(o, it), false);
    if (heads) heads.userData.lampHead = true;
    if (poolMat.map) { const pools = instanced(poolGeometry(dbl), poolMat, list, (o, it) => yawPlace(o, it), false); if (pools) { pools.userData.lampPool = true; pools.userData.layerY = ROAD_LAYER_Y + 0.004; pools.position.y = pools.userData.layerY; pools.renderOrder = 1; } }
    void poles;
  }
  // trees: a trunk and a low-poly crown, tinted per tree
  const trunkG = cyl(0.12, 0.17, 2.0, 0, 6), crownG = new THREE.IcosahedronGeometry(1.25, 0); crownG.translate(0, 3.0, 0);
  const trunk = instanced(trunkG, new THREE.MeshStandardMaterial({ color: "#5a4030", roughness: 1 }), trees, (o, it) => { o.position.set(it[0] * S, 0, it[1] * S); o.rotation.set(0, 0, 0); o.scale.setScalar(S * it[2]); });
  const crown = instanced(crownG, new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), trees, (o, it) => { o.position.set(it[0] * S, 0, it[1] * S); o.rotation.set(0, it[3] * 6, 0); o.scale.setScalar(S * it[2]); });
  if (crown) { const c = new THREE.Color(); trees.forEach((it, i) => crown.setColorAt(i, c.set("#2f7a3a").lerp(new THREE.Color("#5c9a3c"), it[3]))); crown.instanceColor.needsUpdate = true; }
  void trunk;
  // stop signs: a pole with a red octagon, facing the traffic that comes up to it
  const signG = merged([paint(cyl(0.04, 0.04, 2.4, 0, 5), "#8a8f96"), (() => { const g = new THREE.CylinderGeometry(0.42, 0.42, 0.05, 8); g.rotateX(Math.PI / 2); g.rotateY(Math.PI / 8); g.translate(0, 2.2, 0.05); return paint(g, "#c7312b"); })()]);
  instanced(signG, matV(), signs, (o, it) => yawPlace(o, it));
  group.userData.counts = { lamps: lamps.length + lamps2.length, trees: trees.length, signs: signs.length };
  group.userData.dispose = () => { for (const d of disposables) d.dispose?.(); };
  return group;
}
void XS;