import * as THREE from "three";
import { CLOTH_COLORS, HAIR_COLORS, SKIN_TONES, type Look } from "@campuslife/shared/avatar";

function colorFor(role: string, slot: string, look: Look, original: THREE.Color): THREE.Color {
  switch (role) {
    case "skin":
      return new THREE.Color(SKIN_TONES[look.skin]);
    case "skin_shade":
      return new THREE.Color(SKIN_TONES[look.skin]).multiplyScalar(0.82);
    case "hair":
      return new THREE.Color(HAIR_COLORS[look.hair]);
    case "hair_shade":
      return new THREE.Color(HAIR_COLORS[look.hair]).multiplyScalar(0.75);
    case "hair_fade":
      return new THREE.Color(SKIN_TONES[look.skin]).lerp(new THREE.Color(HAIR_COLORS[look.hair]), 0.48);
    case "primary":
      if (slot === "top") return new THREE.Color(CLOTH_COLORS[look.topColor]);
      if (slot === "bottom") return new THREE.Color(CLOTH_COLORS[look.bottomColor]);
      if (slot === "shoes") return new THREE.Color(CLOTH_COLORS[look.shoesColor]);
      return original.clone(); // hats keep their colour
    case "primary_shade":
      if (slot === "top") return new THREE.Color(CLOTH_COLORS[look.topColor]).multiplyScalar(0.82);
      if (slot === "bottom") return new THREE.Color(CLOTH_COLORS[look.bottomColor]).multiplyScalar(0.82);
      if (slot === "shoes") return new THREE.Color(CLOTH_COLORS[look.shoesColor]).multiplyScalar(0.65);
      return original.clone();
    default:
      return original.clone();
  }
}

export function applyAvatarMaterials(root: THREE.Object3D, look: Look, castShadows: boolean, owned: Set<THREE.Material>) {
  // Per-character materials (so one player's shirt colour doesn't change everyone's).
  root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.frustumCulled = false; // we cull whole characters by distance instead
    mesh.castShadow = castShadows;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((material) => {
      const source = material as THREE.MeshStandardMaterial;
      const [slot, role] = source.name.split(":");
      const authoredFinish = slot === "shoes" || role === "buckle" || role === "zip" || role === "button" || role === "accessory";
      const instance = source.clone();
      owned.add(instance);
      instance.color = colorFor(role ?? "fixed", slot ?? "", look, source.color);
      instance.flatShading = false;
      instance.metalness = authoredFinish ? source.metalness : 0;
      instance.roughness = role === "skin" || role === "skin_shade" ? 0.72 : authoredFinish ? source.roughness : 0.9;
      return instance;
    });
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
    const [slot, role] = materials[0].name.split(":");
    if (slot === "head") mesh.visible = role === "hair" || role === "hair_shade" || role === "hair_fade" || role === "accessory";
  });
}
