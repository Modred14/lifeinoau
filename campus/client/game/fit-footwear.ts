import * as THREE from "three";
import type { Look } from "@campuslife/shared/avatar";
import { BOOT_SHAFTS } from "./footwear-shapes";
import { cropTrouserHem } from "./crop-trouser-hem";

export function fitBootTrousers(root: THREE.Object3D, look: Look): THREE.BufferGeometry[] {
  if (!Object.hasOwn(BOOT_SHAFTS, look.shoes)) return [];
  const rings = BOOT_SHAFTS[look.shoes];
  if (!rings) return [];
  root.updateMatrixWorld(true);
  const feet = new Map<number, THREE.Box3>([[-1, new THREE.Box3()], [1, new THREE.Box3()]]);
  const bottoms: THREE.SkinnedMesh[] = [];
  const point = new THREE.Vector3();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material.name.startsWith("bottom:"))) bottoms.push(mesh);
    if (!materials.some((material) => material.name === "shoes:skin")) return;
    const rest = new THREE.Matrix4().fromArray(materials[0].userData.restTransform);
    const positions = mesh.geometry.getAttribute("position");
    let top = -Infinity;
    for (let i = 0; i < positions.count; i++) top = Math.max(top, point.fromBufferAttribute(positions, i).applyMatrix4(rest).y);
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(rest);
      if (point.y >= top - 0.002) feet.get(Math.sign(point.x))?.expandByPoint(point);
    }
  });
  if ([...feet.values()].some((box) => box.isEmpty())) throw new Error(`Missing ankle fit for ${look.body} ${look.shoes}`);
  const centers = new Map([...feet].map(([side, box]) => [side, box.getCenter(new THREE.Vector3())]));
  const widthScale = look.body === "f" ? 0.84 : 1, lengthScale = look.body === "f" ? 0.92 : 1;
  const height = rings.at(-1)![0], owned: THREE.BufferGeometry[] = [];
  for (const mesh of bottoms) {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const rest = new THREE.Matrix4().fromArray(material.userData.restTransform);
    const geometry = cropTrouserHem(mesh.geometry, rest, height - 0.008);
    geometry.userData.avatarFit = "boot";
    const original = geometry.getAttribute("position");
    const inverse = rest.clone().invert(), positions = new Float32Array(original.count * 3);
    for (let i = 0; i < original.count; i++) {
      point.fromBufferAttribute(original, i).applyMatrix4(rest);
      if (point.y < height + 0.15) {
        const center = centers.get(Math.sign(point.x))!;
        const upper = rings.findIndex((ring) => ring[0] >= point.y);
        const a = upper < 0 ? rings.at(-1)! : rings[Math.max(0, upper - 1)], b = upper < 0 ? a : rings[upper];
        const blend = THREE.MathUtils.clamp((point.y - a[0]) / Math.max(0.0001, b[0] - a[0]), 0, 1);
        const width = (THREE.MathUtils.lerp(a[1], b[1], blend) - 0.007) * widthScale;
        const depth = (THREE.MathUtils.lerp(a[2], b[2], blend) - 0.007) * lengthScale;
        const dx = point.x - center.x, dz = point.z - (center.z - 0.004 * lengthScale);
        const radius = Math.hypot(dx / width, dz / depth);
        const amount = (1 - THREE.MathUtils.smoothstep(point.y, height + 0.035, height + 0.15)) * (1 - 1 / Math.max(1, radius));
        if (amount > 0) {
          point.x -= dx * amount; point.z -= dz * amount;
        }
      }
      point.applyMatrix4(inverse).toArray(positions, i * 3);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    mesh.geometry = geometry; owned.push(geometry);
  }
  return owned;
}
