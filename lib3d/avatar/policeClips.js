// lib3d/avatar/policeClips.js
// Police and custody animations, baked from the character's own skeleton exactly like activityClips.js (so they fit every body, need no files and keep the rig).
// Directions are (x = the character's left, y = up, z = forward). Every clip loops: its last frame equals its first.
//   Officers (N-QRS)
//     guard        standing at ease: feet apart, hands clasped behind the back, head slowly scanning the area (guarding a gate or a cell block)
//     patrolWalk   a brisk, upright patrol walk: one hand resting on the belt, the other swinging, head up and scanning
//     patrolRun    a pursuit run: elbows tight, hand near the belt
//     cuff         making an arrest: both hands working at the small of the suspect's back, body leaning in
//     escortWalk   walking a prisoner: one hand gripping their arm, the other on the belt
//     radio        a hand up to the shoulder radio, head tilted to it, now and then a nod
//   People in custody
//     cuffedStand  standing with hands cuffed behind the back, head bowed, weight shifting
//     cuffedWalk   walking with hands cuffed behind the back, short steps, head down (being escorted)
//     detainedHold standing at the bars: both hands gripping them, forehead near the bars, a slow sigh
//     detainedSit  sitting on the bunk: elbows on knees, head hanging, the odd slow shake of the head
//     detainedPace pacing the cell, hands hooked in the belt, head down
import * as THREE from "three";
import { bake, legs, arms, spine, TAU } from "./npcClips.js";

const wave = (ps, k = 1) => Math.sin(ps * k);
const behind = (S, drop = 0) => { // both hands clasped at the small of the back
  S.aim("LeftArm", "LeftForeArm", [0.12, -0.95, -0.28 - drop]); S.aim("LeftForeArm", "LeftHand", [-0.55, -0.4, -0.8]);
  S.aim("RightArm", "RightForeArm", [-0.12, -0.95, -0.28 - drop]); S.aim("RightForeArm", "RightHand", [0.55, -0.4, -0.8]);
};
const beltHand = (S, side) => { // a hand resting on the duty belt (side: 1 = left, -1 = right)
  const pre = side > 0 ? "Left" : "Right";
  S.aim(pre + "Arm", pre + "ForeArm", [side * 0.5, -0.8, 0.05]); S.aim(pre + "ForeArm", pre + "Hand", [-side * 0.55, -0.2, 0.75]);
};
function seat(S, shift, knees = 0.12) {
  for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
    S.aim(pre + "UpLeg", pre + "Leg", [side * knees, -0.03, 1]); S.aim(pre + "Leg", pre + "Foot", [side * 0.04, -1, 0.12]); S.aim(pre + "Foot", pre + "ToeBase", [0, -0.2, 1]);
  }
  S.hipsAt(0, shift, 0);
}
const knee = (a) => 0.18 + 0.9 * Math.pow(0.5 + 0.5 * Math.cos(a - 0.9), 1.6);

export const POLICE_CLIPS = {
  guard: (root, bones) => bake(root, bones, "guard", 8, (t, S) => {
    const ps = (t / 8) * TAU, scan = 0.55 * wave(ps) * Math.max(0, wave(ps * 0.5 + 0.4));
    legs(S, 0.01, 0.02, -0.01, 0.02, 0.17); behind(S);
    spine(S, -0.03, 0.0, scan); S.rot("Hips", 0, 0.012 * wave(ps), 0);
  }),
  patrolWalk: (root, bones) => bake(root, bones, "patrolWalk", 0.95, (t, S) => {
    const ps = (t / 0.95) * TAU, L = 0.5 * wave(ps), R = -L;
    legs(S, L, 0.12 + 0.55 * Math.max(0, wave(ps + 1.9)), R, 0.12 + 0.55 * Math.max(0, wave(ps + 1.9 + Math.PI)), 0.05);
    beltHand(S, 1); // the left hand rests on the belt
    S.aim("RightArm", "RightForeArm", [-0.16, -Math.cos(R * 0.75 + 0.1), Math.sin(R * 0.75 + 0.1)]); S.aim("RightForeArm", "RightHand", [-0.1, -Math.cos(R * 0.75 + 0.5), Math.sin(R * 0.75 + 0.5)]);
    spine(S, 0.0, -0.02, 0.1 * wave(ps * 0.5)); S.hipsAt(0, -0.01 + 0.012 * Math.abs(Math.cos(ps)), 0); S.rot("Hips", 0, 0.05 * wave(ps), 0);
  }),
  patrolRun: (root, bones) => bake(root, bones, "patrolRun", 0.62, (t, S) => {
    const ps = (t / 0.62) * TAU, A = 0.8, L = A * wave(ps), R = -L;
    legs(S, L, knee(ps) + 0.2, R, knee(ps + Math.PI) + 0.2, 0.04);
    arms(S, -L * 0.7, 1.6, -R * 0.5, 1.7, 0.1); beltHand(S, 1); // the left hand stays on the radio and belt so nothing swings loose
    spine(S, 0.2, 0.0, 0); S.hipsAt(0, -0.045 + 0.035 * Math.abs(Math.cos(ps)), 0); S.rot("Hips", 0, 0.05 * wave(ps), 0.03 * wave(ps));
  }),
  cuff: (root, bones) => bake(root, bones, "cuff", 2.4, (t, S) => {
    const ps = (t / 2.4) * TAU, work = wave(ps * 3), pull = Math.max(0, wave(ps - 0.4));
    legs(S, 0.1, 0.22, -0.06, 0.14, 0.15);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.65 + 0.1 * pull, 0.75]); S.aim("LeftForeArm", "LeftHand", [-0.1 + 0.08 * work, -0.35, 0.9]);
    S.aim("RightArm", "RightForeArm", [-0.2, -0.65 + 0.1 * pull, 0.75]); S.aim("RightForeArm", "RightHand", [0.1 - 0.08 * work, -0.35, 0.9]);
    spine(S, 0.22 + 0.04 * pull, 0.12, 0.05 * work); S.hipsAt(0, -0.05, 0);
  }),
  escortWalk: (root, bones) => bake(root, bones, "escortWalk", 1.05, (t, S) => {
    const ps = (t / 1.05) * TAU, L = 0.42 * wave(ps), R = -L;
    legs(S, L, 0.12 + 0.5 * Math.max(0, wave(ps + 1.9)), R, 0.12 + 0.5 * Math.max(0, wave(ps + 1.9 + Math.PI)), 0.05);
    S.aim("LeftArm", "LeftForeArm", [0.35, -0.55, 0.75]); S.aim("LeftForeArm", "LeftHand", [-0.2, -0.3, 0.95]); // the left hand holds the prisoner's arm
    beltHand(S, -1);
    spine(S, 0.03, 0.0, 0.18); S.hipsAt(0, -0.01 + 0.01 * Math.abs(Math.cos(ps)), 0); S.rot("Hips", 0, 0.04 * wave(ps), 0);
  }),
  radio: (root, bones) => bake(root, bones, "radio", 5, (t, S) => {
    const ps = (t / 5) * TAU, nod = Math.max(0, wave(ps * 2 + 1)) ** 3;
    legs(S, 0.02, 0.04, -0.02, 0.04, 0.12);
    S.aim("RightArm", "RightForeArm", [-0.25, -0.35, 0.55]); S.aim("RightForeArm", "RightHand", [0.3, 0.9, 0.3]); // right hand up at the shoulder mic
    beltHand(S, 1);
    spine(S, 0.0, 0.0 + 0.08 * nod, -0.3); S.rot("Hips", 0, 0.01 * wave(ps), 0);
  }),
  cuffedStand: (root, bones) => bake(root, bones, "cuffedStand", 5, (t, S) => {
    const ps = (t / 5) * TAU;
    legs(S, 0.02 * wave(ps), 0.04, -0.02 * wave(ps), 0.04, 0.09); behind(S, 0.05);
    spine(S, 0.1 + 0.01 * wave(ps * 2), 0.38, 0.12 * wave(ps)); S.rot("Hips", 0, 0.025 * wave(ps), 0.02 * wave(ps));
  }),
  cuffedWalk: (root, bones) => bake(root, bones, "cuffedWalk", 1.15, (t, S) => {
    const ps = (t / 1.15) * TAU, L = 0.36 * wave(ps), R = -L;
    legs(S, L, 0.1 + 0.45 * Math.max(0, wave(ps + 1.9)), R, 0.1 + 0.45 * Math.max(0, wave(ps + 1.9 + Math.PI)), 0.06); behind(S, 0.05);
    spine(S, 0.1, 0.36, 0.06 * wave(ps)); S.hipsAt(0, -0.015 + 0.01 * Math.abs(Math.cos(ps)), 0); S.rot("Hips", 0, 0.05 * wave(ps), 0.02 * wave(ps));
  }),
  detainedHold: (root, bones) => bake(root, bones, "detainedHold", 6, (t, S) => {
    const ps = (t / 6) * TAU, sigh = Math.max(0, wave(ps)) ** 2;
    legs(S, 0.02, 0.04, -0.01, 0.04, 0.12);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.45, 0.85]); S.aim("LeftForeArm", "LeftHand", [0.08, 0.35, 0.95]);
    S.aim("RightArm", "RightForeArm", [-0.2, -0.45, 0.85]); S.aim("RightForeArm", "RightHand", [-0.08, 0.35, 0.95]);
    spine(S, 0.06 + 0.03 * sigh, 0.15 + 0.12 * sigh, 0.05 * wave(ps * 0.5));
  }),
  detainedSit: (root, bones, sh) => bake(root, bones, "detainedSit", 8, (t, S) => {
    const ps = (t / 8) * TAU, shake = Math.max(0, wave(ps * 2 - 1)) ** 4;
    seat(S, sh, 0.18);
    S.aim("LeftArm", "LeftForeArm", [0.18, -0.85, 0.35]); S.aim("LeftForeArm", "LeftHand", [-0.15, -0.35, 0.85]); // elbows on the knees, hands hanging between them
    S.aim("RightArm", "RightForeArm", [-0.18, -0.85, 0.35]); S.aim("RightForeArm", "RightHand", [0.15, -0.35, 0.85]);
    spine(S, 0.45 + 0.015 * wave(ps), 0.35, 0.25 * shake * wave(ps * 12));
  }),
  detainedPace: (root, bones) => bake(root, bones, "detainedPace", 1.3, (t, S) => {
    const ps = (t / 1.3) * TAU, L = 0.3 * wave(ps), R = -L;
    legs(S, L, 0.1 + 0.4 * Math.max(0, wave(ps + 1.9)), R, 0.1 + 0.4 * Math.max(0, wave(ps + 1.9 + Math.PI)), 0.06);
    beltHand(S, 1); beltHand(S, -1);
    spine(S, 0.08, 0.3, 0.05 * wave(ps)); S.hipsAt(0, -0.01 + 0.008 * Math.abs(Math.cos(ps)), 0);
  }),
};
export const POLICE_SEATED = new Set(["detainedSit"]);
void THREE;
