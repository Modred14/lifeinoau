// lib3d/avatar/figureRig.js
// Drives a realistic rigged avatar (the same GLB characters as the player) with the joint-angle poses that the cutscenes were written for in lib3d/toonFigure.js,
// so the lecturer brawl and the DSA scene can use real characters without rewriting their choreography.
//   makeAvatarFigure(avatar)  ->  { root, hips, torso, head, apply(pose, k), expr(name), height, dispose(), model }   (the same shape makeFigure returns)
// The toon figure faces +x with its right side on +z; the avatar faces +z with its left on +x. The wrapper turns the model so both agree.
// Every limb is posed by *direction* (see idleEmote.aim), so it works on any Mixamo-style skeleton whatever its bones' local axes are.
import * as THREE from "three";
import { boneKey } from "./manifest.js";
import { aim } from "./idleEmote.js";
import { CHANNELS } from "../toonFigure.js";

const B = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), Binv = B.clone().invert(); // toon space -> avatar space
const E = new THREE.Euler(), UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), W = [0.4, 0.35, 0.25]; // how the trunk's lean is shared between the three spine bones
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), qh = new THREE.Quaternion(), qt = new THREE.Quaternion(), qa = new THREE.Quaternion(), id = new THREE.Quaternion(), v = new THREE.Vector3();
const eul = (q, x, y, z) => q.setFromEuler(E.set(x, y, z, "XYZ"));
const toAvatar = (vec) => vec.applyQuaternion(B).toArray();

export function makeAvatarFigure(avatar) {
  const root = new THREE.Group(), model = avatar.root; model.rotation.y = Math.PI / 2; root.add(model);
  const bones = {}; model.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });
  const rest = {}; for (const k in bones) rest[k] = { p: bones[k].position.clone(), q: bones[k].quaternion.clone() };
  model.updateMatrixWorld(true);
  // directions the spine segments and neck point in at rest (avatar space), turned into toon space so poses can be applied on top of them
  const rd = {}, pa = new THREE.Vector3(), pb = new THREE.Vector3(), M0 = model.matrixWorld.clone().invert();
  for (const [a, b] of [["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"], ["Neck", "Head"]]) rd[a] = bones[b].getWorldPosition(pb).sub(bones[a].getWorldPosition(pa)).transformDirection(M0).applyQuaternion(Binv).normalize().clone();
  const cur = Object.fromEntries(CHANNELS.map((c) => [c, 0]));
  const lift = (name, child, dirToon, roll = 0) => aim(model, bones[name], bones[child], toAvatar(dirToon), roll);
  const wrapper = root;
  function apply(target = {}, k = 1) {
    for (const c of CHANNELS) cur[c] += ((target[c] ?? 0) - cur[c]) * k;
    const c = cur;
    for (const n in bones) { bones[n].quaternion.copy(rest[n].q); bones[n].position.copy(rest[n].p); }
    bones.Hips.position.y += c.hipsY / (model.scale.y || 1);
    eul(qh, c.sway, 0, -c.lean); eul(qt, 0, c.twist, -c.chest); const qHT = qh.clone().multiply(qt);
    // trunk: the lean and twist are shared between Spine, Spine1 and Spine2 (the twist is rolled about each bone's own axis)
    [["Spine", "Spine1"], ["Spine1", "Spine2"], ["Spine2", "Neck"]].forEach(([a, b], i) => {
      q1.copy(id).slerp(qHT, W[i]); lift(a, b, v.copy(rd[a]).applyQuaternion(q1), (c.twist * W[i] * 180) / Math.PI);
    });
    // head: tipped forward by headX, to the side by headZ and turned by headY, on top of the trunk
    eul(qa, c.headZ, 0, -c.headX); q1.copy(qHT).multiply(qa);
    lift("Neck", "Head", v.copy(rd.Neck).applyQuaternion(q1), (c.headY * 180) / Math.PI);
    // arms: swing forward (s), out to the side (a) and elbow bend (e), on top of the trunk's own tilt
    for (const [pre, s, a, e, side] of [["Right", c.aRs, c.aRa, c.aRe, -1], ["Left", c.aLs, c.aLa, c.aLe, 1]]) {
      const phi = side < 0 ? -a : a;
      q1.copy(qHT).multiply(eul(q2, phi, 0, s)); lift(pre + "Arm", pre + "ForeArm", v.copy(DOWN).applyQuaternion(q1));
      q1.copy(qHT).multiply(eul(q2, phi, 0, s + e)); lift(pre + "ForeArm", pre + "Hand", v.copy(DOWN).applyQuaternion(q1));
    }
    // legs: hip swing (h) and knee bend (k), carried by the hips' own lean but not by the trunk's twist
    for (const [pre, h, kn] of [["Right", c.lRh, c.lRk], ["Left", c.lLh, c.lLk]]) {
      q1.copy(qh).multiply(eul(q2, 0, 0, h)); lift(pre + "UpLeg", pre + "Leg", v.copy(DOWN).applyQuaternion(q1));
      q1.copy(qh).multiply(eul(q2, 0, 0, h - kn)); lift(pre + "Leg", pre + "Foot", v.copy(DOWN).applyQuaternion(q1));
      lift(pre + "Foot", pre + "ToeBase", v.set(1, -0.22 - 0.2 * Math.max(0, Math.sin(h - kn)), 0).applyQuaternion(qh));
    }
    // sitting: lower the hips until the feet are on the floor (the seat is wherever the figure is placed)
    if (c.lRh > 1.2 && c.lLh > 1.2) {
      wrapper.updateWorldMatrix(true, true); let low = 1e9;
      for (const n of ["LeftFoot", "RightFoot"]) { bones[n].getWorldPosition(pa); wrapper.worldToLocal(pa); low = Math.min(low, pa.y); }
      bones.Hips.position.y -= (low - 0.045) / (model.scale.y || 1);
    }
  }
  const head = bones.Head, torso = bones.Spine1, hips = bones.Hips;
  return {
    root, hips, torso, head, model, apply,
    /** The realistic faces have no expression morphs; the pose carries the mood (hurt, guard, cheer). */
    expr() {},
    get height() { return avatar.height; },
    dispose() { avatar.dispose(); },
  };
}