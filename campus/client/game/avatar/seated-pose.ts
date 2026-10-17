import * as THREE from "three";
import { bindBoneRelative, findAvatarBone } from "./bones";
import { SeatedFeet } from "./seated-feet";

interface SeatedLeg {
  hip: THREE.Bone;
  knee: THREE.Bone;
  thigh: THREE.Vector3;
  calf: THREE.Vector3;
}

export class SeatedPose {
  private legs: SeatedLeg[] = [];
  private feet: SeatedFeet;
  private forward = new THREE.Vector3();
  private down = new THREE.Vector3();
  private current = new THREE.Vector3();
  private target = new THREE.Vector3();
  private modelRotation = new THREE.Quaternion();
  private parentRotation = new THREE.Quaternion();
  private turn = new THREE.Quaternion();

  constructor(private model: THREE.Object3D, bones: ReadonlyMap<string, THREE.Bone>) {
    this.feet = new SeatedFeet(model, bones);
    for (const side of ["L", "R"]) {
      const hip = findAvatarBone(bones, `UpperLeg.${side}`);
      const knee = findAvatarBone(bones, `LowerLeg.${side}`);
      const foot = findAvatarBone(bones, `Foot.${side}`);
      if (!hip || !knee || !foot) continue;
      const relative = bindBoneRelative(model, knee, foot);
      if (!relative) continue;
      this.legs.push({ hip, knee, thigh: knee.position.clone().normalize(), calf: new THREE.Vector3().setFromMatrixPosition(relative).normalize() });
    }
  }

  apply(thighPitch = 0) {
    this.model.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(this.modelRotation);
    this.forward.set(0, Math.sin(thighPitch), Math.cos(thighPitch)).applyQuaternion(this.modelRotation);
    this.down.set(0, -1, 0).applyQuaternion(this.modelRotation);
    for (const leg of this.legs) this.aim(leg.hip, leg.thigh, this.forward);
    for (const leg of this.legs) this.aim(leg.knee, leg.calf, this.down);
    this.feet.apply();
  }

  restore() {
    this.feet.restore();
  }

  private aim(bone: THREE.Bone, direction: THREE.Vector3, target: THREE.Vector3) {
    bone.parent!.getWorldQuaternion(this.parentRotation).invert();
    this.target.copy(target).applyQuaternion(this.parentRotation).normalize();
    this.current.copy(direction).applyQuaternion(bone.quaternion).normalize();
    this.turn.setFromUnitVectors(this.current, this.target);
    bone.quaternion.premultiply(this.turn).normalize();
    bone.updateWorldMatrix(false, true);
  }
}
