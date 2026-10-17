import * as THREE from "three";
import { scatterGeometry } from "./meshes";
import { SCATTER_CHUNK_M, SCATTER_KINDS, SCATTER_STRIDE, planScatter, type ScatterKind } from "./plan";

export interface Scenery {
  group: THREE.Group;
  update(focus: THREE.Vector3, viewFar: number): void;
  dispose(): void;
}

const LOW_DENSITY = 0.55;
const CHUNK_REACH = SCATTER_CHUNK_M * Math.SQRT1_2;
const RANGE: Record<ScatterKind, { min: number; max: number }> = {
  tree: { min: 280, max: 900 },
  palm: { min: 280, max: 900 },
  bush: { min: 240, max: 420 },
  scrub: { min: 240, max: 420 },
  rock: { min: 200, max: 360 },
  tuft: { min: 70, max: 110 },
  flower: { min: 240, max: 420 },
  bed: { min: 240, max: 420 },
};
const CASTS: Record<ScatterKind, boolean> = { tree: true, palm: true, bush: false, scrub: false, rock: true, tuft: false, flower: false, bed: false };
const GRASS = [0x6f9f47, 0x86ad52, 0x5e8f3e, 0x9aa85a];
const FOLIAGE_SWING = 0.26;
const UPDATE_EVERY = 12;

export function buildScenery(opts: { shadows: boolean; patch: (mat: THREE.Material) => void }): Scenery {
  const group = new THREE.Group();
  const plan = planScatter(opts.shadows ? 1 : LOW_DENSITY);
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  opts.patch(material);
  const geometries = new Map<ScatterKind, THREE.BufferGeometry>();
  for (const kind of SCATTER_KINDS) geometries.set(kind, scatterGeometry(kind));
  const meshes: { mesh: THREE.InstancedMesh; kind: ScatterKind; x: number; z: number }[] = [];
  const m4 = new THREE.Matrix4();
  const at = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const color = new THREE.Color();

  for (const chunk of plan.chunks)
    for (const kind of SCATTER_KINDS) {
      const items = chunk.items[kind];
      const n = items.length / SCATTER_STRIDE;
      const geo = geometries.get(kind);
      if (!n || !geo) continue;
      const mesh = new THREE.InstancedMesh(geo, material, n);
      for (let i = 0; i < n; i++) {
        const o = i * SCATTER_STRIDE;
        const scale = items[o + 2];
        const tint = items[o + 4];
        const squat = kind === "bush" || kind === "scrub" || kind === "rock" ? 0.8 + (tint % 1) * 0.5 : 1;
        at.set(items[o], 0, items[o + 1]);
        mesh.setMatrixAt(i, m4.compose(at, quat.setFromAxisAngle(up, items[o + 3]), size.set(scale, scale * squat, scale)));
        if (kind === "tuft") {
          color.setHex(GRASS[Math.floor((tint % 1) * GRASS.length) % GRASS.length]);
        } else {
          const k = 1 - FOLIAGE_SWING / 2 + (tint % 1) * FOLIAGE_SWING;
          const neutral = kind === "rock" || kind === "flower" || kind === "bed";
          color.setRGB(k * (neutral ? 1 : 0.96 + (tint % 1) * 0.1), k, k * (neutral ? 1 : 0.92));
        }
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = opts.shadows && CASTS[kind];
      mesh.receiveShadow = opts.shadows && kind !== "tuft";
      mesh.visible = false;
      group.add(mesh);
      meshes.push({ mesh, kind, x: chunk.cx, z: chunk.cz });
    }

  let frame = 0;
  return {
    group,
    update(focus, viewFar) {
      if (frame++ % UPDATE_EVERY !== 0) return;
      for (const m of meshes) {
        const r = RANGE[m.kind];
        const reach = Math.min(r.max, Math.max(r.min, viewFar));
        m.mesh.visible = Math.hypot(m.x - focus.x, m.z - focus.z) - CHUNK_REACH < reach;
      }
    },
    dispose() {
      for (const m of meshes) m.mesh.dispose();
      for (const g of geometries.values()) g.dispose();
      material.dispose();
    },
  };
}
