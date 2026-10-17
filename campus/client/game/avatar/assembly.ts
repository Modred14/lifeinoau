import * as THREE from "three";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { SLOTS, type BodyType, type Look, type Slot } from "@campuslife/shared/avatar";
import { fitBootTrousers } from "../fit-footwear";
import { fitLayeredClothes } from "../fit-layered-clothes";
import { StudentFace } from "../student-face";
import { applyAvatarMaterials } from "./materials";
import { findAvatarBone } from "./bones";
import type { LookAssets } from "./assets";

/** Target standing heights in metres. */
const HEIGHT: Record<BodyType, number> = { m: 1.78, f: 1.68 };

/** Scale that brings a body type's raw model to its target height, measured once. */
const scaleCache = new Map<BodyType, number>();

/** All SkinnedMeshes belonging to a slot ("top" also includes "top_backpack"). */
function slotMeshes(root: THREE.Object3D, slot: Slot): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((object) => {
    if (!(object as THREE.SkinnedMesh).isSkinnedMesh) return;
    // Name the mesh or any ancestor up to the root to find which part it belongs to.
    for (let ancestor: THREE.Object3D | null = object; ancestor && ancestor !== root; ancestor = ancestor.parent) {
      if (ancestor.name === slot || ancestor.name.startsWith(`${slot}_`)) {
        meshes.push(object as THREE.SkinnedMesh);
        return;
      }
    }
  });
  return meshes;
}

export interface AssembledAvatar {
  model: THREE.Object3D;
  face: StudentFace;
  bones: Map<string, THREE.Bone>;
  dispose: () => void;
}

export function assembleAvatar(sources: LookAssets, look: Look, castShadows: boolean): AssembledAvatar {
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  let fittedGeometry: THREE.BufferGeometry[] = [];
  let released = false;
  let base: THREE.Object3D | undefined;
  const registerSkeletons = (root: THREE.Object3D) => root.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
  });
  const dispose = () => {
    if (released) return;
    released = true;
    base?.removeFromParent();
    fittedGeometry.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    skeletons.forEach((skeleton) => skeleton.dispose());
    sources.release();
  };
  try {
    // Base = full clone of the head's outfit; its skeleton drives every part.
    base = cloneSkinned(sources.parts.head.scene);
    registerSkeletons(base);
    const model = base;
    const bones = new Map<string, THREE.Bone>();
    model.traverse((object) => {
      if ((object as THREE.Bone).isBone) bones.set(object.name, object as THREE.Bone);
    });
    for (const slot of SLOTS) {
      if (slot === "head") continue;
      const sameSource = look[slot] === look.head;
      // Drop the base's own part unless it's the one we want.
      if (!sameSource) for (const mesh of slotMeshes(model, slot)) mesh.removeFromParent();
      if (sameSource) continue;
      const donor = cloneSkinned(sources.parts[slot].scene);
      registerSkeletons(donor);
      for (const mesh of slotMeshes(donor, slot)) {
        // Same hierarchy in every outfit file, so the donor's parent has a twin in the base.
        const holder = (mesh.parent && model.getObjectByName(mesh.parent.name)) || model;
        const skeleton = new THREE.Skeleton(
          mesh.skeleton.bones.map((bone) => {
            const target = findAvatarBone(bones, bone.name);
            if (!target) throw new Error(`Missing avatar bone ${bone.name}`);
            return target;
          }),
          mesh.skeleton.boneInverses,
        );
        skeletons.add(skeleton);
        holder.add(mesh);
        mesh.bind(skeleton, mesh.bindMatrix);
      }
    }
    for (const slot of SLOTS) {
      if (!slotMeshes(model, slot).length) throw new Error(`Avatar has no ${slot} meshes`);
    }
    applyAvatarMaterials(model, look, castShadows, materials);
    fittedGeometry = fitLayeredClothes(model);
    fittedGeometry.push(...fitBootTrousers(model, look));
    const face = new StudentFace(look);
    face.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
    });
    const head = findAvatarBone(bones, "Head");
    if (!head) throw new Error("Avatar has no Head bone");
    head.add(face.root);
    // Normalise height once per body type.
    let scale = scaleCache.get(look.body);
    if (scale === undefined) {
      model.updateMatrixWorld(true);
      const headHeight = head.getWorldPosition(new THREE.Vector3()).y;
      const height = headHeight ? headHeight + 0.27 : new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3()).y;
      scale = height > 0 ? HEIGHT[look.body] / height : 1;
      scaleCache.set(look.body, scale);
    }
    model.scale.setScalar(scale);
    return { model, face, bones, dispose };
  } catch (error) {
    sources.invalidate();
    dispose();
    throw error;
  }
}
