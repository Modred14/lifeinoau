// lib3d/avatar/homeClips.js
// The animations of life at home, baked from the character's own skeleton exactly like activityClips.js and policeClips.js (so they fit every body and outfit and need no files).
// Directions are (x = the character's left, y = up, z = forward). Every clip loops: its last frame equals its first. Clothed and non-graphic throughout.
//   cook        standing at the cooker: the left hand steadies the pot, the right stirs in slow circles, head down at the pan
//   shower      standing under the shower: both hands rub the hair, then wash the arms and chest, head tipped back into the water
//   washHands   leaning to the basin: both hands together under the tap, rubbing, now and then turned over
//   brushTeeth  leaning to the basin: the right hand at the mouth brushing in short strokes, the left holding the cup low
//   watchTV     seated back on a sofa: the right hand holds the remote on the knee, the head turned to the screen, a small shift now and then
//   sitRelax    seated back, arms resting, head back, slow breathing (a rest on the sofa)
//   sitPhone    seated, both hands holding a phone in front of the chest, thumb moving, head down at it
//   meditate    sitting cross-legged on the floor, back straight, hands on the knees, slow breathing
// Seated clips take the shared seated hip drop (the third argument, see activityClips.js seatShift); meditate drops the hips to the floor by its own measure.
import * as THREE from "three";
import { bake, legs, arms, spine, TAU } from "./npcClips.js";

const wave = (ps, k = 1) => Math.sin(ps * k), smooth = (x) => x * x * (3 - 2 * x), clamp01 = (x) => Math.min(1, Math.max(0, x));

function seat(S, shift, { knees = 0.1 } = {}) {
  for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
    S.aim(pre + "UpLeg", pre + "Leg", [side * knees, -0.03, 1]); S.aim(pre + "Leg", pre + "Foot", [side * 0.04, -1, 0.12]); S.aim(pre + "Foot", pre + "ToeBase", [0, -0.2, 1]);
  }
  S.hipsAt(0, shift, 0);
}

export const HOME_CLIPS = {
  cook: (root, bones) => bake(root, bones, "cook", 3.2, (t, S) => {
    const ps = (t / 3.2) * TAU, sx = Math.cos(ps), sz = Math.sin(ps), sway = wave(ps);
    legs(S, 0.03, 0.06, -0.02, 0.05, 0.12);
    S.aim("LeftArm", "LeftForeArm", [0.24, -0.72, 0.5]); S.aim("LeftForeArm", "LeftHand", [0.1, -0.3, 1]);                       // steadies the pot
    S.aim("RightArm", "RightForeArm", [-0.26, -0.74, 0.52]); S.aim("RightForeArm", "RightHand", [-0.1 + 0.24 * sx, -0.42, 0.9 + 0.2 * sz]); // stirs round and round
    spine(S, 0.3 + 0.015 * sway, 0.3, 0.06 * wave(ps * 0.5));
    S.hipsAt(0, -0.02, 0);
  }),
  shower: (root, bones) => bake(root, bones, "shower", 4.8, (t, S) => {
    const ps = (t / 4.8) * TAU, hair = smooth(clamp01(0.5 + 0.9 * Math.sin(ps))), body = 1 - hair, rub = wave(ps * 5);
    legs(S, 0.01, 0.03, -0.01, 0.03, 0.13);
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) { // hands up to the hair, then across the chest and arms
      const r = side * rub * 0.2;
      S.aim(pre + "Arm", pre + "ForeArm", [side * (0.8 * hair + 0.3 * body), 0.3 * hair - 0.7 * body, 0.1 + 0.4 * body]);
      S.aim(pre + "ForeArm", pre + "Hand", [side * (-0.5 * hair - 0.85 * body) + r * hair, 0.8 * hair + 0.1 * body, 0.25 + 0.5 * body + r * body]);
    }
    spine(S, -0.02 * hair + 0.06 * body, -0.3 * hair + 0.18 * body, 0.1 * wave(ps * 0.5));
  }),
  washHands: (root, bones) => bake(root, bones, "washHands", 3, (t, S) => {
    const ps = (t / 3) * TAU, rub = wave(ps * 4), turn = 0.5 + 0.5 * wave(ps);
    legs(S, 0.02, 0.05, -0.02, 0.04, 0.1);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.78, 0.52]); S.aim("LeftForeArm", "LeftHand", [-0.14 + 0.1 * rub, -0.45, 0.9]);
    S.aim("RightArm", "RightForeArm", [-0.2, -0.78, 0.52]); S.aim("RightForeArm", "RightHand", [0.14 - 0.1 * rub, -0.45 + 0.12 * turn, 0.9]);
    spine(S, 0.3, 0.3, 0.04 * wave(ps * 0.5));
    S.hipsAt(0, -0.02, 0);
  }),
  brushTeeth: (root, bones) => bake(root, bones, "brushTeeth", 2, (t, S) => {
    const ps = (t / 2) * TAU, stroke = wave(ps * 6), look = 0.06 * wave(ps);
    legs(S, 0.02, 0.05, -0.02, 0.04, 0.1);
    S.aim("RightArm", "RightForeArm", [-0.3, -0.7, 0.45]); S.aim("RightForeArm", "RightHand", [-0.08 + 0.2 * stroke, 0.95, 0.5 + 0.08 * stroke]);   // hand at the mouth, brushing
    S.aim("LeftArm", "LeftForeArm", [0.24, -0.82, 0.4]); S.aim("LeftForeArm", "LeftHand", [0.1, -0.35, 1]);                                          // the cup held low
    spine(S, 0.2, 0.12 + 0.02 * stroke, look);
    S.hipsAt(0, -0.01, 0);
  }),
  watchTV: (root, bones, sh) => bake(root, bones, "watchTV", 8, (t, S) => {
    const ps = (t / 8) * TAU, shift = clamp01(Math.sin(ps * 2 - 1) * 2) * 0.5;
    seat(S, sh, { knees: 0.14 });
    S.aim("LeftArm", "LeftForeArm", [0.3, -0.95, 0.2]); S.aim("LeftForeArm", "LeftHand", [0.2, -0.35, 1]);                         // the left hand rests on the knee
    S.aim("RightArm", "RightForeArm", [-0.28, -0.9, 0.3]); S.aim("RightForeArm", "RightHand", [-0.1, 0.12 + 0.1 * shift, 1]);          // the right holds the remote
    spine(S, -0.14, -0.05 + 0.02 * wave(ps * 3), 0.05 * wave(ps * 0.5) + 0.04 * shift);
    S.rot("Hips", 0, 0.01 * wave(ps), 0);
  }),
  sitRelax: (root, bones, sh) => bake(root, bones, "sitRelax", 5, (t, S) => {
    const ps = (t / 5) * TAU, breathe = 0.5 + 0.5 * wave(ps);
    seat(S, sh + 0.002 * breathe, { knees: 0.16 });
    S.aim("LeftArm", "LeftForeArm", [0.32, -0.95, 0.12]); S.aim("LeftForeArm", "LeftHand", [0.22, -0.3, 1]);
    S.aim("RightArm", "RightForeArm", [-0.32, -0.95, 0.12]); S.aim("RightForeArm", "RightHand", [-0.22, -0.3, 1]);
    spine(S, -0.18 + 0.012 * breathe, -0.12 + 0.01 * breathe, 0.04 * wave(ps * 0.5));
  }),
  sitPhone: (root, bones, sh) => bake(root, bones, "sitPhone", 4, (t, S) => {
    const ps = (t / 4) * TAU, tap = Math.sin(t * 9) * 0.03;
    seat(S, sh, { knees: 0.14 });
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
      S.aim(pre + "Arm", pre + "ForeArm", [side * 0.22, -0.92, 0.2]);
      S.aim(pre + "ForeArm", pre + "Hand", [side * (0.34 - (side > 0 ? 0 : tap * 0.4)), 0.55 + (side > 0 ? 0 : tap), 0.72]);
    }
    spine(S, 0.04 + 0.01 * wave(ps * 2), 0.42 + 0.04 * wave(ps), 0.14 * wave(ps * 0.5));
    S.rot("Hips", 0, 0.015 * wave(ps), 0);
  }),
  // sitting on the floor: the hips come down to rest on it (`drop` metres below standing, taken from the body: see floorDrop)
  meditate: (root, bones) => bake(root, bones, "meditate", 6, (t, S) => {
    const ps = (t / 6) * TAU, breathe = 0.5 + 0.5 * wave(ps), drop = floorDrop(bones);
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) { // thighs out and forward, the shins crossed in front
      S.aim(pre + "UpLeg", pre + "Leg", [side * 0.92, -0.06, 0.42]);
      S.aim(pre + "Leg", pre + "Foot", [-side * 0.88, -0.04, 0.3]);
      S.aim(pre + "Foot", pre + "ToeBase", [-side * 0.4, -0.2, 0.9]);
    }
    S.hipsAt(0, -drop, 0);
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) { S.aim(pre + "Arm", pre + "ForeArm", [side * 0.42, -0.86, 0.18]); S.aim(pre + "ForeArm", pre + "Hand", [side * 0.05, -0.62, 0.78]); } // hands on the knees
    spine(S, 0.0 + 0.008 * breathe, 0.06, 0);
  }),
};
export const HOME_SEATED = ["watchTV", "sitRelax", "sitPhone"];

/** How far (in the skeleton's own units) the hips come down to sit on the floor: from the standing hip height to just above the floor. */
function floorDrop(bones) {
  const parent = bones.Hips.parent, k = parent ? new THREE.Vector3().setFromMatrixScale(parent.matrixWorld).y || 1 : 1; // the hips' local unit in world metres
  const hipM = bones.Hips.getWorldPosition(new THREE.Vector3()).y; // standing hip height in world metres (the bake runs with the body upright, at rest)
  return Math.max(0, (hipM - 0.13) / (k || 1)) * (parent ? 1 : 1);
}
