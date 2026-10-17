import * as THREE from "three";
import { cropTrouserHem } from "./crop-trouser-hem";

export function fitLayeredClothes(root: THREE.Object3D): THREE.BufferGeometry[] {
  const bottoms: THREE.SkinnedMesh[] = [];
  const point = new THREE.Vector3();
  let hem = Infinity;
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material.name.startsWith("bottom:"))) bottoms.push(mesh);
    const cover = materials.find((material) => material.name.startsWith("top:") && material.userData.garmentCoverage === "closed");
    if (!cover) return;
    const rest = new THREE.Matrix4().fromArray(cover.userData.restTransform);
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) hem = Math.min(hem, point.fromBufferAttribute(positions, i).applyMatrix4(rest).y);
  });
  if (!Number.isFinite(hem)) return [];
  const owned: THREE.BufferGeometry[] = [];
  try {
    for (const mesh of bottoms) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const rest = new THREE.Matrix4().fromArray(material.userData.restTransform);
      const positions = mesh.geometry.getAttribute("position");
      let highest = -Infinity;
      for (let i = 0; i < positions.count; i++) highest = Math.max(highest, point.fromBufferAttribute(positions, i).applyMatrix4(rest).y);
      if (highest <= hem + 0.004) continue;
      const fitted = cropTrouserHem(mesh.geometry, rest, hem + 0.004, "below");
      fitted.userData.avatarFit = "closed-layer";
      fitted.computeVertexNormals(); fitted.computeBoundingBox(); fitted.computeBoundingSphere();
      mesh.geometry = fitted;
      owned.push(fitted);
    }
    return owned;
  } catch (error) {
    owned.forEach((geometry) => geometry.dispose());
    throw error;
  }
}
