import * as THREE from "three";

export function findAvatarBone(bones: ReadonlyMap<string, THREE.Bone>, name: string) {
  return bones.get(name) ?? bones.get(THREE.PropertyBinding.sanitizeNodeName(name));
}

export function bindBoneRelative(model: THREE.Object3D, parent: THREE.Bone, child: THREE.Bone) {
  let relative: THREE.Matrix4 | undefined;
  model.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || relative) return;
    const parentIndex = mesh.skeleton.bones.indexOf(parent);
    const childIndex = mesh.skeleton.bones.indexOf(child);
    if (parentIndex < 0 || childIndex < 0) return;
    relative = mesh.skeleton.boneInverses[parentIndex].clone()
      .multiply(mesh.skeleton.boneInverses[childIndex].clone().invert());
  });
  return relative;
}
