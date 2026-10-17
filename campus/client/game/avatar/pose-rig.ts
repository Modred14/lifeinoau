import * as THREE from "three";
import { findAvatarBone } from "./bones";

export interface RigJoint {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  restModel: THREE.Quaternion;
  point: THREE.Vector3;
}

export interface RigLimb {
  upper: RigJoint;
  lower: RigJoint;
  end: RigJoint;
  upperDir: THREE.Vector3;
  lowerDir: THREE.Vector3;
  upperLength: number;
  lowerLength: number;
}

const X_AXIS = new THREE.Vector3(1, 0, 0);

export class PoseRig {
  private joints = new Map<string, RigJoint>();
  private saved = new Map<THREE.Bone, THREE.Quaternion>();
  private modelQ = new THREE.Quaternion();
  private modelInverse = new THREE.Quaternion();
  private parentQ = new THREE.Quaternion();
  private q = new THREE.Quaternion();
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private d = new THREE.Vector3();

  constructor(readonly model: THREE.Object3D, private bones: ReadonlyMap<string, THREE.Bone>) {
    model.updateWorldMatrix(true, true);
  }

  joint(name: string): RigJoint | undefined {
    const known = this.joints.get(name);
    if (known) return known;
    const bone = findAvatarBone(this.bones, name);
    if (!bone) return undefined;
    const inverse = this.model.matrixWorld.clone().invert();
    const scale = this.model.scale.x;
    const modelInverse = this.model.getWorldQuaternion(new THREE.Quaternion()).invert();
    const joint: RigJoint = {
      bone,
      rest: bone.quaternion.clone(),
      restModel: modelInverse.multiply(bone.getWorldQuaternion(new THREE.Quaternion())),
      point: bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse).multiplyScalar(scale),
    };
    this.joints.set(name, joint);
    return joint;
  }

  limb(upper: string, lower: string, end: string): RigLimb | undefined {
    const u = this.joint(upper), l = this.joint(lower), e = this.joint(end);
    if (!u || !l || !e) return undefined;
    const upperDir = l.point.clone().sub(u.point), lowerDir = e.point.clone().sub(l.point);
    const upperLength = upperDir.length(), lowerLength = lowerDir.length();
    return { upper: u, lower: l, end: e, upperDir: upperDir.normalize(), lowerDir: lowerDir.normalize(), upperLength, lowerLength };
  }

  begin() {
    this.model.updateWorldMatrix(true, true);
    this.model.getWorldQuaternion(this.modelQ);
    this.modelInverse.copy(this.modelQ).invert();
  }

  release() {
    for (const [bone, quaternion] of this.saved) bone.quaternion.copy(quaternion);
    this.saved.clear();
  }

  private keep(bone: THREE.Bone) {
    if (!this.saved.has(bone)) this.saved.set(bone, bone.quaternion.clone());
  }

  pitch(joint: RigJoint, angle: number) {
    const bone = joint.bone;
    this.keep(bone);
    bone.parent!.getWorldQuaternion(this.parentQ);
    this.q.setFromAxisAngle(X_AXIS, angle).premultiply(this.modelQ).multiply(this.modelInverse);
    bone.quaternion.copy(this.parentQ).invert().multiply(this.q).multiply(this.parentQ).multiply(joint.rest).normalize();
    bone.updateWorldMatrix(false, true);
  }

  private aim(joint: RigJoint, restDir: THREE.Vector3, worldDir: THREE.Vector3): THREE.Quaternion {
    const bone = joint.bone;
    this.keep(bone);
    this.a.copy(worldDir).applyQuaternion(this.modelInverse).normalize();
    const turn = new THREE.Quaternion().setFromUnitVectors(restDir, this.a);
    bone.parent!.getWorldQuaternion(this.parentQ).invert();
    bone.quaternion.copy(this.parentQ).multiply(this.modelQ).multiply(turn).multiply(joint.restModel).normalize();
    bone.updateWorldMatrix(false, true);
    return turn;
  }

  reach(limb: RigLimb, target: THREE.Vector3, pole: THREE.Vector3) {
    const origin = limb.upper.bone.getWorldPosition(this.b);
    const span = this.c.copy(target).sub(origin);
    const reach = (limb.upperLength + limb.lowerLength) * 0.985;
    const distance = Math.min(Math.max(span.length(), 0.05), reach);
    span.normalize();
    const along = (limb.upperLength ** 2 - limb.lowerLength ** 2 + distance ** 2) / (2 * distance);
    const out = Math.sqrt(Math.max(0, limb.upperLength ** 2 - along ** 2));
    const side = this.d.copy(pole).addScaledVector(span, -pole.dot(span));
    if (side.lengthSq() < 1e-6) side.set(0, -1, 0).addScaledVector(span, span.y);
    side.normalize();
    const elbow = this.a.copy(origin).addScaledVector(span, along).addScaledVector(side, out);
    const upperDir = elbow.clone().sub(origin).normalize();
    const lowerDir = origin.addScaledVector(span, distance).sub(elbow).normalize();
    this.aim(limb.upper, limb.upperDir, upperDir);
    const turn = this.aim(limb.lower, limb.lowerDir, lowerDir);
    const hand = limb.end.bone;
    this.keep(hand);
    hand.parent!.getWorldQuaternion(this.parentQ).invert();
    hand.quaternion.copy(this.parentQ).multiply(this.modelQ).multiply(turn).multiply(limb.end.restModel).normalize();
    hand.updateWorldMatrix(false, true);
  }
}
