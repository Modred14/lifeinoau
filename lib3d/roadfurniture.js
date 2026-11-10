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
import { planFurniture } from "./furnitureplan.js";
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
  const { lamps, trees, signs, taken, posts } = graph.furniturePlan?.seed === seed ? graph.furniturePlan : planFurniture(graph, { seed });   // (the plan the collision world was built from, when it has been)

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
  group.userData.spots = [...taken];   // where every light pole, tree and sign stands, [x, z] in metres: lib3d/billboardSite.js keeps billboards clear of them
  group.userData.dispose = () => { for (const d of disposables) d.dispose?.(); };
  return group;
}
void XS;