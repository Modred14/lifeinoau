// lib3d/campusOsm.js
// Draws the campus from REAL OpenStreetMap data (see lib3d/osm.js and tools/osm-import.mjs). Browser only.
// Roads and building outlines are real. Building heights come from OSM tags where present; otherwise a plausible default, and are exaggerated for readability.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { windowTextures } from "./campus.js";
import { matchLandmarks } from "./osm.js";
import { LANDMARKS } from "./landmarks.js";

const CLASS = { major: { c: "#1e242c", y: 0.07, min: 0.9 }, street: { c: "#252c35", y: 0.06, min: 0.6 }, service: { c: "#2d343d", y: 0.05, min: 0.4 }, path: { c: "#8f7f5e", y: 0.045, min: 0.3 } };
const WALLS = ["#d9ceb4", "#c6b08a", "#d8d8d0", "#aab7c4", "#d3c3a6", "#a5664e", "#e2dccb"];

function slice(g, start, count) { // part of a non-indexed geometry (an ExtrudeGeometry group)
  const r = new THREE.BufferGeometry();
  for (const k of ["position", "normal", "uv"]) { const a = g.attributes[k], n = a.itemSize, arr = new Float32Array(count * n); arr.set(a.array.subarray(start * n, (start + count) * n)); r.setAttribute(k, new THREE.BufferAttribute(arr, n)); }
  return r;
}
function paint(g, hex) { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; }

export function buildOsmCampus(data, opts = {}) {
  const S = opts.scale ?? 0.1, EX = opts.heightExaggeration ?? 1.6, root = new THREE.Group(), pad = 120, b = data.bounds;
  const x0 = (b.x0 - pad) * S, x1 = (b.x1 + pad) * S, z0 = (b.z0 - pad) * S, z1 = (b.z1 + pad) * S, W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // ground
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: "#3f7d4e", roughness: 1 })); grass.rotation.x = -Math.PI / 2; grass.position.set(cx, 0, cz); grass.receiveShadow = true; root.add(grass);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(W, 7, D), new THREE.MeshStandardMaterial({ color: "#3a2d24", roughness: 1 })); soil.position.set(cx, -3.6, cz); root.add(soil);
  // roads: one merged mesh per class
  for (const [cls, st] of Object.entries(CLASS)) {
    const pos = [], idx = []; let n = 0;
    for (const r of data.roads) { if (r.cls !== cls) continue; const w = Math.max(r.w * S, st.min), h = w / 2;
      for (let i = 0; i < r.pts.length - 1; i++) { const ax = r.pts[i][0] * S, az = r.pts[i][1] * S, bx = r.pts[i + 1][0] * S, bz = r.pts[i + 1][1] * S, dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1e-6) continue;
        const nx = (-dz / L) * h, nz = (dx / L) * h; pos.push(ax + nx, st.y, az + nz, ax - nx, st.y, az - nz, bx + nx, st.y, bz + nz, bx - nx, st.y, bz - nz); idx.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); n += 4; }
      for (const [px, pz] of r.pts) { const c = n; pos.push(px * S, st.y, pz * S); n++; for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; pos.push(px * S + Math.cos(a) * h, st.y, pz * S + Math.sin(a) * h); n++; } for (let k = 0; k < 8; k++) idx.push(c, c + 1 + k, c + 1 + ((k + 1) % 8)); } }
    if (!pos.length) continue; const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    for (let i = 0; i < g.attributes.normal.count; i++) g.attributes.normal.setXYZ(i, 0, 1, 0); // roads face up, whatever the winding
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: st.c, roughness: 0.95, side: THREE.DoubleSide })); m.receiveShadow = true; root.add(m);
  }
  // buildings: real footprints, extruded, merged into two meshes (walls with lit windows, roofs)
  const win = windowTextures(5), rep = 1 / (12 * S); for (const t of [win.map, win.emis]) t.repeat.set(rep, rep);
  const sides = [], caps = [];
  data.buildings.forEach((bd, i) => { try {
    const shape = new THREE.Shape(bd.pts.map(([x, z]) => new THREE.Vector2(x * S, -z * S))), depth = Math.max(0.35, bd.h * S * EX);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); const [capG, sideG] = g.groups.length >= 2 ? g.groups : [g.groups[0], { start: 0, count: 0 }];
    const col = WALLS[(bd.id ?? i) % WALLS.length]; caps.push(slice(g, capG.start, capG.count)); if (sideG.count) sides.push(paint(slice(g, sideG.start, sideG.count), col)); g.dispose();
  } catch { /* a malformed footprint is skipped, never fatal */ } });
  if (sides.length) { const m = new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ vertexColors: true, map: win.map, emissive: 0xffffff, emissiveMap: win.emis, emissiveIntensity: 0.85, roughness: 0.8 })); m.castShadow = m.receiveShadow = true; root.add(m); }
  if (caps.length) { const m = new THREE.Mesh(mergeGeometries(caps), new THREE.MeshStandardMaterial({ color: "#3a4452", roughness: 0.9 })); m.castShadow = m.receiveShadow = true; root.add(m); }
  // trees
  const trees = (data.trees ?? []).slice(0, 5000);
  if (trees.length) { const im = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.9, 0), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), trees.length), d = new THREE.Object3D(), c = new THREE.Color();
    trees.forEach(([x, z], i) => { const k = 0.8 + ((i * 7919) % 100) / 250; d.position.set(x * S, 1.1 * k, z * S); d.scale.setScalar(k); d.updateMatrix(); im.setMatrixAt(i, d.matrix); im.setColorAt(i, c.set("#2f6b3b").lerp(new THREE.Color("#4f8f3f"), ((i * 31) % 100) / 100)); }); root.add(im); }
  // places: only the ones really found in the data. Nothing is invented.
  const { found, missing } = matchLandmarks(data, LANDMARKS), byId = new Map(LANDMARKS.map((l) => [l.id, l])), anchors = new Map(), landmarks = [];
  for (const f of found) { const L = byId.get(f.id), x = f.x * S, z = f.z * S; landmarks.push({ ...L, x, z, conf: "osm", verified: true }); anchors.set(f.id, new THREE.Vector3(x, f.h * S * EX + 2.2, z)); }
  const sel = new THREE.Mesh(new THREE.RingGeometry(1, 1.2, 48), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.9, side: THREE.DoubleSide })); sel.rotation.x = -Math.PI / 2; sel.visible = false; root.add(sel);
  const setSelected = (id) => { const L = landmarks.find((l) => l.id === id); if (!L) { sel.visible = false; return; } sel.position.set(L.x, 0.3, L.z); sel.scale.setScalar(4); sel.visible = true; };
  const update = (t) => { if (sel.visible) { sel.material.opacity = 0.65 + Math.sin(t * 3) * 0.25; sel.rotation.z = t * 0.4; } };
  const extent = Math.max(W, D) / 2;
  const dispose = () => { root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.dispose(); }); }); win.map.dispose(); win.emis.dispose(); };
  return { root, anchors, groups: new Map(), landmarks, unmatched: missing, update, setSelected, dispose, osm: true, synthetic: !!data.synthetic, attribution: data.attribution, extent,
    bounds: { x0, x1, z0, z1 }, camera: { home: { x: cx, z: cz, dist: extent * 1.25, pol: 0.95 }, min: 10, max: extent * 3.5 } };
}