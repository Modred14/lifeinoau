// lib3d/campuslife/scenery/index.js
// Draws the planting of lib3d/campuslife/scenery/plan.js: instanced, one mesh per kind per ~250 m block, positions in METRES (the caller scales the group into the scene).
// Cheap enough for a phone: trees and palms have a far shape of a few triangles that the whole campus is drawn with, and the detailed one only near the camera; small things are only drawn near the camera.
import * as THREE from "three";
import { mergeParts } from "./kit.js";
import { scatterGeometry } from "./meshes.js";
import { SCATTER_CHUNK_M, SCATTER_KINDS, SCATTER_STRIDE } from "./plan.js";

/** A block this close to the camera (m, to its nearest side roughly) draws its detailed trees; further ones the far shape. */
const NEAR_TREES = 260;
/** How far (m) each small thing is drawn from. */
const RANGE = { bush: 420, scrub: 420, rock: 360, tuft: 130, flower: 420, bed: 420 };
const CASTS = { tree: true, palm: true, rock: true };
const GRASS = [0x6f9f47, 0x86ad52, 0x5e8f3e, 0x9aa85a];
const FOLIAGE_SWING = 0.26;
const REACH = SCATTER_CHUNK_M * Math.SQRT1_2;
const UPDATE_EVERY = 12;
const farGeometry = (kind) => mergeParts(kind === "palm"
  ? [{ geo: new THREE.CylinderGeometry(0.14, 0.2, 6.3, 3, 1, true), color: 0x7d6549, at: [0, 3.15, 0] }, { geo: new THREE.OctahedronGeometry(2.4, 0), color: 0x4d8b3a, at: [0, 6.2, 0], scale: [1, 0.35, 1], shade: 0.25 }]
  : [{ geo: new THREE.CylinderGeometry(0.18, 0.26, 3, 3, 1, true), color: 0x6a4a30, at: [0, 1.5, 0] }, { geo: new THREE.IcosahedronGeometry(2.4, 0), color: 0x3f8236, at: [0, 4.4, 0], scale: [1.15, 0.8, 1.1], shade: 0.38 }]);

export function buildScenery(plan, { shadows = true } = {}) {
  const group = new THREE.Group(); group.name = "scenery";
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  const geometries = [], geo = new Map(), meshes = [];
  const geometryOf = (kind, far) => { const k = kind + (far ? ":far" : ""); if (!geo.has(k)) { const g = far ? farGeometry(kind) : scatterGeometry(kind); geo.set(k, g); geometries.push(g); } return geo.get(k); };
  const m4 = new THREE.Matrix4(), at = new THREE.Vector3(), quat = new THREE.Quaternion(), size = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), color = new THREE.Color();
  const compose = (kind, items, i, hidden) => {
    const o = i * SCATTER_STRIDE, scale = hidden ? 0 : items[o + 2], squat = kind === "bush" || kind === "scrub" || kind === "rock" ? 0.8 + (items[o + 4] % 1) * 0.5 : 1;
    return m4.compose(at.set(items[o], 0, items[o + 1]), quat.setFromAxisAngle(up, items[o + 3]), size.set(scale, scale * squat, scale));
  };
  for (const chunk of plan.chunks) for (const kind of SCATTER_KINDS) {
    const items = chunk.items[kind], n = items.length / SCATTER_STRIDE; if (!n) continue;
    const tree = kind === "tree" || kind === "palm";
    for (const far of tree ? [false, true] : [false]) {
      const mesh = new THREE.InstancedMesh(geometryOf(kind, far), material, n);
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, compose(kind, items, i, false));
        const tint = items[i * SCATTER_STRIDE + 4] % 1;
        if (kind === "tuft") color.setHex(GRASS[Math.floor(tint * GRASS.length) % GRASS.length]);
        else { const k = 1 - FOLIAGE_SWING / 2 + tint * FOLIAGE_SWING, neutral = kind === "rock" || kind === "flower" || kind === "bed"; color.setRGB(k * (neutral ? 1 : 0.96 + tint * 0.1), k, k * (neutral ? 1 : 0.92)); }
        mesh.setColorAt(i, color);
      }
      mesh.computeBoundingSphere();
      mesh.castShadow = shadows && !far && !!CASTS[kind]; mesh.receiveShadow = shadows && !far && kind !== "tuft";
      mesh.visible = tree && far;   // before the first update the whole campus shows its far trees
      group.add(mesh); meshes.push({ mesh, kind, far, tree, items, x: chunk.cx, z: chunk.cz });
    }
  }

  let frame = 0;
  return {
    group,
    /** eye: the camera's position in METRES. */
    update(eye, now = false) {
      if (!now && frame++ % UPDATE_EVERY !== 0) return;
      for (const m of meshes) {
        const d = Math.hypot(m.x - eye.x, eye.y, m.z - eye.z) - REACH;
        m.mesh.visible = m.tree ? m.far !== d < NEAR_TREES : d < RANGE[m.kind];
      }
    },
    /** Hides (hidden(x, z, kind) true, metres) or shows each plant again. */
    setHidden(hidden) {
      for (const m of meshes) {
        const n = m.items.length / SCATTER_STRIDE;
        for (let i = 0; i < n; i++) m.mesh.setMatrixAt(i, compose(m.kind, m.items, i, !!hidden?.(m.items[i * SCATTER_STRIDE], m.items[i * SCATTER_STRIDE + 1], m.kind)));
        m.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    dispose() { for (const m of meshes) m.mesh.dispose(); for (const g of geometries) g.dispose(); material.dispose(); },
  };
}
