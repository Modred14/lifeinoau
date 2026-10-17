import * as THREE from "three";
import type { BodyType } from "@campuslife/shared/avatar";
import type { PoseDetail } from "./pose-detail";
import { PoseRig, type RigJoint, type RigLimb } from "./pose-rig";

export interface SeatFit {
  y: number;
  z: number;
  thighPitch: number;
}

const EAT_PERIOD = 2.6;
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class ActivityPose {
  readonly rightHand = new THREE.Vector3();
  readonly leftHand = new THREE.Vector3();
  readonly plate = new THREE.Vector3();
  lift = 0;
  private rig: PoseRig;
  private arms: { L?: RigLimb; R?: RigLimb };
  private abdomen?: RigJoint;
  private neck?: RigJoint;
  private head?: RigJoint;
  private hipY = 0.9;
  private hipZ = 0;
  private thigh = 0.42;
  private calf = 0.48;
  private footY = 0.02;
  private shoulderY = 1.35;
  private thighRadius: number;
  private time = Math.random() * 10;
  private target = new THREE.Vector3();
  private mouth = new THREE.Vector3();
  private pole = new THREE.Vector3();
  private elbow = new THREE.Vector3();

  constructor(private model: THREE.Object3D, bones: ReadonlyMap<string, THREE.Bone>, body: BodyType) {
    this.rig = new PoseRig(model, bones);
    this.thighRadius = body === "f" ? 0.08 : 0.085;
    this.arms = { L: this.rig.limb("UpperArm.L", "LowerArm.L", "Wrist.L"), R: this.rig.limb("UpperArm.R", "LowerArm.R", "Wrist.R") };
    this.abdomen = this.rig.joint("Abdomen");
    this.neck = this.rig.joint("Neck");
    this.head = this.rig.joint("Head");
    const legs = [this.rig.limb("UpperLeg.L", "LowerLeg.L", "Foot.L"), this.rig.limb("UpperLeg.R", "LowerLeg.R", "Foot.R")].filter((leg): leg is RigLimb => !!leg);
    if (legs.length) {
      const mean = (pick: (leg: RigLimb) => number) => legs.reduce((sum, leg) => sum + pick(leg), 0) / legs.length;
      this.hipY = mean((leg) => leg.upper.point.y);
      this.hipZ = mean((leg) => leg.upper.point.z);
      this.thigh = mean((leg) => leg.upperLength);
      this.calf = mean((leg) => leg.lowerLength);
      this.footY = mean((leg) => leg.end.point.y);
    }
    if (this.arms.L) this.shoulderY = this.arms.L.upper.point.y;
  }

  seatFit(seat: { h: number; hip: number }): SeatFit {
    const hip = seat.h + this.thighRadius;
    const knee = this.calf + this.footY;
    const thighPitch = Math.asin(Math.min(0.5, Math.max(-0.5, (knee - hip) / this.thigh)));
    return { y: hip - this.hipY, z: seat.hip - this.hipZ, thighPitch };
  }

  release() {
    this.rig.release();
  }

  apply(dt: number, seated: boolean, detail: PoseDetail) {
    const root = this.model.parent;
    if (!root) return;
    this.time += dt;
    this.rig.begin();
    const { variant, surface } = detail;
    const cycle = (this.time % EAT_PERIOD) / EAT_PERIOD;
    this.lift = variant === "eat" ? smooth(0.22, 0.42, cycle) * (1 - smooth(0.6, 0.8, cycle)) : 0;
    const reading = variant === "write" && !detail.focused && this.time % 11 > 7.5;
    const lean = !seated ? 0 : variant === "write" ? 0.24 : variant === "eat" ? 0.17 : surface ? 0.1 : 0.03;
    const nod = variant === "write" ? (reading ? -0.12 : 0.26) : variant === "eat" ? 0.2 + this.lift * 0.14 : 0;
    if (this.abdomen && lean) this.rig.pitch(this.abdomen, lean);
    if (this.neck && nod) this.rig.pitch(this.neck, nod);
    const sideways = this.shoulderY * 0.1;
    const world = (x: number, y: number, z: number) => root.localToWorld(this.target.set(x, y, z));
    const table = surface?.h ?? this.shoulderY - 0.36;
    const near = surface?.near ?? 0.06;
    if (this.head) {
      this.head.bone.getWorldPosition(this.mouth);
      root.worldToLocal(this.mouth);
      this.mouth.y += 0.03;
      this.mouth.z += 0.105;
    }
    this.plate.set(0, table, near + 0.17);
    if (!seated && variant === "eat") this.plate.set(0.05, this.shoulderY - 0.3, 0.33);
    let rx = -sideways, ry = table + 0.045, rz = near - 0.01;
    let lx = sideways + 0.03, ly = table + 0.04, lz = near;
    if (variant === "write") {
      const line = (this.time * 0.045) % 0.09;
      rx = -0.13 + (reading ? 0.03 : line + Math.sin(this.time * 11) * 0.006);
      rz = near + 0.01 + (reading ? 0 : Math.sin(this.time * 17) * 0.005);
      lx = 0.15;
      lz = near + 0.03;
    } else if (variant === "eat") {
      const scoop = Math.sin(this.time * 7) * 0.012 * (1 - this.lift);
      const k = this.lift;
      rx = THREE.MathUtils.lerp(this.plate.x - 0.07 + scoop, this.mouth.x - 0.04, k);
      ry = THREE.MathUtils.lerp(this.plate.y + 0.1, this.mouth.y - 0.17, k) + Math.sin(Math.PI * k) * 0.03;
      rz = THREE.MathUtils.lerp(this.plate.z - 0.11, this.mouth.z + 0.04, k);
      if (!seated) {
        lx = this.plate.x + 0.1;
        ly = this.plate.y - 0.035;
        lz = this.plate.z - 0.1;
      } else {
        lx = 0.19;
        lz = near + 0.02;
      }
    } else if (!surface) {
      const lap = detail.seat ? detail.seat.h + this.thighRadius * 2 + 0.03 : this.shoulderY - 0.5;
      rx = -0.12; ry = lap; rz = (detail.seat?.hip ?? 0) + 0.27;
      lx = 0.12; ly = lap; lz = rz;
    }
    if (this.arms.R) {
      this.rig.reach(this.arms.R, world(rx, ry, rz), root.getWorldDirection(this.pole).multiplyScalar(-0.5).add(this.elbow.set(-0.7, -1, 0).transformDirection(root.matrixWorld)));
      this.handPoint(this.arms.R, this.rightHand, root);
    }
    if (this.arms.L) {
      this.rig.reach(this.arms.L, world(lx, ly, lz), root.getWorldDirection(this.pole).multiplyScalar(-0.5).add(this.elbow.set(0.7, -1, 0).transformDirection(root.matrixWorld)));
      this.handPoint(this.arms.L, this.leftHand, root);
    }
  }

  private handPoint(limb: RigLimb, out: THREE.Vector3, root: THREE.Object3D) {
    limb.end.bone.getWorldPosition(out);
    limb.lower.bone.getWorldPosition(this.elbow);
    out.addScaledVector(this.elbow.sub(out).normalize(), -0.085);
    root.worldToLocal(out);
  }
}
