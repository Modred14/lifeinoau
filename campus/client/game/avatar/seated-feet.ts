import * as THREE from "three";
import { bindBoneRelative, findAvatarBone } from "./bones";

interface SeatedFoot {
  foot: THREE.Bone;
  calf: THREE.Bone;
  relative: THREE.Matrix4;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

export class SeatedFeet {
  private feet: SeatedFoot[] = [];
  private applied = false;
  private desired = new THREE.Matrix4();
  private local = new THREE.Matrix4();

  constructor(private model: THREE.Object3D, bones: ReadonlyMap<string, THREE.Bone>) {
    for (const side of ["L", "R"]) {
      const foot = findAvatarBone(bones, `Foot.${side}`);
      const calf = findAvatarBone(bones, `LowerLeg.${side}`);
      if (!foot || !calf) continue;
      const relative = bindBoneRelative(model, calf, foot);
      if (relative) this.feet.push({
        foot, calf, relative,
        position: foot.position.clone(), quaternion: foot.quaternion.clone(), scale: foot.scale.clone(),
      });
    }
  }

  apply() {
    this.model.updateWorldMatrix(true, true);
    for (const { foot, calf, relative } of this.feet) {
      this.desired.multiplyMatrices(calf.matrixWorld, relative);
      this.local.copy(foot.parent!.matrixWorld).invert().multiply(this.desired);
      this.local.decompose(foot.position, foot.quaternion, foot.scale);
      foot.updateWorldMatrix(false, true);
    }
    this.applied = true;
  }

  restore() {
    if (!this.applied) return;
    for (const { foot, position, quaternion, scale } of this.feet) {
      foot.position.copy(position);
      foot.quaternion.copy(quaternion);
      foot.scale.copy(scale);
    }
    this.applied = false;
  }
}
