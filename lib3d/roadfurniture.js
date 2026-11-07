// lib3d/roadfurniture.js
// The street furniture of the road network, placed from the same graph the roads are drawn and driven from, so nothing stands in a carriageway or a junction:
//   street lights   on every road: the median of each divided road (a double arm), otherwise alternating sides, every ~22 m (a short road gets one); they glow at night
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

/** A street light in metres: a 7.5 m pole with one arm 2.4 m long toward +x and a lamp head under the end. The pole and the head are separate meshes: the head glows at night. A median light is two of these back to back. */
function lampGeometry() {
  const pole = [paint(cyl(0.09, 0.13, 7.5, 0), "#4b5058"), paint(box(0.4, 0.3, 0.4, 0, 0, 0), "#3b4047"), paint(box(2.4, 0.09, 0.09, 1.2, 7.4, 0), "#4b5058")], head = [paint(box(0.85, 0.16, 0.32, 2.3, 7.22, 0), "#f4e9b8")];
  return { pole: merged(pole), head: merged(head) };
}
/** The light a lamp spills on the road: a flat round pool under the lamp head, at ground level (the mesh is lifted to the road by its own position). Drawn additively, only at night.
 *  It is wider than the gap between lights (LAMP_GAP in buildRoadFurniture), so neighbouring pools overlap and the road has no dark stretches. */
const POOL = 40;
function poolGeometry() { const g = new THREE.PlaneGeometry(POOL, POOL); g.rotateX(-Math.PI / 2); g.translate(2.3, 0, 0); return merged([g]); }

/** graph: from buildRoadGraph. S: scene units per metre. Returns a Group with dispose(), plus `counts`. */
export function buildRoadFurniture(graph, S, { seed = 11 } = {}) {
  const rnd = rng(seed), keep = corridorKeepOut(), sdf = graph.sdf ?? (() => Infinity), surf = {};
  const inCorridor = (x, z) => { for (const [kx, kz, kr] of keep) if (Math.abs(kx - x) < kr && Math.abs(kz - z) < kr && Math.hypot(kx - x, kz - z) < kr) return true; return false; };
  const crossings = graph.crossings, nearCrossing = (x, z, r) => { for (const c of crossings) if (Math.abs(c.x - x) < r && Math.abs(c.z - z) < r && Math.hypot(c.x - x, c.z - z) < r) return true; return false; };
  const lamps = [], trees = [], signs = [], taken = []; let posts = 0;   // `lamps` holds one entry per arm (a median pole carries two); `posts` counts the poles
  const free = (x, z, r) => { for (const t of taken) if (Math.abs(t[0] - x) < r && Math.abs(t[1] - z) < r && Math.hypot(t[0] - x, t[1] - z) < r) return false; return true; };
  const onPavement = (x, z) => graph.surfaceAt(x, z, surf).cls === 2;
  const at = (e, s, off) => { const p = e.path.at(s, {}); return { x: p.x - p.hz * off, z: p.z + p.hx * off, hx: p.hx, hz: p.hz }; };
  const cutOf = (e) => { const na = graph.nodes[e.a], nb = graph.nodes[e.b]; return [na.deg >= 3 ? na.J?.pave.cut.get(e.id * 2) ?? 0 : 0, nb.deg >= 3 ? nb.J?.pave.cut.get(e.id * 2 + 1) ?? 0 : 0]; };

  // ---- street lights: every road is lit ----
  // A light is tried on the preferred side of the road, then the other, then a few metres along, so a building or a crossing beside one spot never leaves a stretch dark. A road with no
  // pavement gets its lights on the bare verge. Short roads get one in the middle. Neighbouring lights are LAMP_GAP apart and each spills a pool wider than that, so the pools overlap and
  // the road is lit end to end. Lights are placed before trees and signs, so a tree never takes the place of a light.
  const LAMP_GAP = 22;
  const lampStations = (e, ca, cb, gap) => {
    const a = ca + 4, b = e.len - cb - 4, span = b - a;
    if (span < gap * 0.5) return e.len >= 12 ? [e.len / 2] : [];   // a short road still gets one, in the middle
    const n = Math.max(1, Math.round(span / gap)), step = span / n, out = []; for (let i = 0; i <= n; i++) out.push(a + i * step); return out;
  };
  const SHIFT = [0, 4, -4, 8, -8];
  const medianLamp = (e, s) => {   // a double-arm light on the median (an arm over each carriageway)
    for (const d of SHIFT) {
      const s2 = s + d; if (s2 < 2 || s2 > e.len - 2) continue; const p = at(e, s2, 0);
      if (inCorridor(p.x, p.z) || graph.surfaceAt(p.x, p.z, surf).cls === 1 || sdf(p.x, p.z) < 4 || nearCrossing(p.x, p.z, 7) || !free(p.x, p.z, 8)) continue;   // the median is not carriageway: if another road overlaps it, no light
      const yaw = Math.atan2(-p.hx, -p.hz);   // the two arms lie across the road: along the right-hand vector (-hz, hx), yaw = atan2(-dz, dx)
      lamps.push([p.x, p.z, yaw], [p.x, p.z, yaw + Math.PI]); posts++; taken.push([p.x, p.z]); return true;   // one arm each way: two single-arm lights back to back on one pole
    }
    return false;
  };
  const SHIFT_FAR = [0, 3, -3, 6, -6, 10, -10];
  const sideLamp = (e, s, sgn, relax = false) => {   // a single-arm light by the pavement (or the verge, where the road has none or another road lies over it). `relax`: the last try for a road that has none, allowing a light closer to a crossing or another light
    const lat0 = e.half + Math.min(1.1, Math.max(0.5, e.sw * 0.55)), crossR = relax ? 3 : 6, apart = relax ? 4 : 8;
    for (const more of relax ? [0, 1.5, 3.5, 6, 9] : [0, 1.5, 3.5]) for (const d of relax ? SHIFT_FAR : SHIFT) for (const sd of [sgn, -sgn]) {   // nearest to the kerb first, then further out
      const s2 = s + d; if (s2 < 2 || s2 > e.len - 2) continue; const p = at(e, s2, sd * (lat0 + more));
      if (inCorridor(p.x, p.z) || graph.surfaceAt(p.x, p.z, surf).cls === 1 || sdf(p.x, p.z) < 1.2 || nearCrossing(p.x, p.z, crossR) || !free(p.x, p.z, apart)) continue;   // never on a carriageway, nor in or against a building
      // the arm reaches over the road, toward the centreline: direction -sd * (-hz, hx) = (sd hz, -sd hx)
      lamps.push([p.x, p.z, Math.atan2(sd * p.hx, sd * p.hz)]); posts++; taken.push([p.x, p.z]); return true;
    }
    return false;
  };
  for (const e of graph.edges) {
    if (e.hw || e.foot || e.len < 12) continue;   // (the expressway has its own lamps, lib3d/highwaymesh.js; footpaths are not roads)
    const [ca, cb] = cutOf(e);
    const divided = e.cls === "arterial" && e.med > 0; let sgn = rnd() < 0.5 ? 1 : -1;
    let got = 0; for (const s of lampStations(e, ca, cb, divided ? LAMP_GAP + 2 : LAMP_GAP)) { if (divided && medianLamp(e, s) || sideLamp(e, s, sgn)) got++; sgn = -sgn; }   // where the median is blocked (a crossing, an overlapping road) the light goes by the pavement instead
    if (!got) for (const f of [0.5, 0.3, 0.7]) if (sideLamp(e, e.len * f, sgn, true)) break;   // a road must not be left dark: try again with the rules loosened
  }
  // ---- trees ----
  for (const e of graph.edges) {
    if (e.hw || e.foot || e.len < 30) continue;
    const [ca, cb] = cutOf(e), s0 = ca + 10, s1 = e.len - cb - 10; if (s1 - s0 < 12) continue;
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
  { const g = lampGeometry(), poles = instanced(g.pole, matV(), lamps, (o, it) => yawPlace(o, it)), heads = instanced(g.head, headMat(), lamps, (o, it) => yawPlace(o, it), false);
    if (heads) heads.userData.lampHead = true;
    if (poolMat.map) { const pools = instanced(poolGeometry(), poolMat, lamps, (o, it) => yawPlace(o, it), false); if (pools) { pools.userData.lampPool = true; pools.userData.layerY = ROAD_LAYER_Y + 0.004; pools.position.y = pools.userData.layerY; pools.renderOrder = 1; } }
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
  group.userData.counts = { lamps: posts, trees: trees.length, signs: signs.length };
  group.userData.dispose = () => { for (const d of disposables) d.dispose?.(); };
  return group;
}
void XS;