// lib3d/avatar/activityClips.js
// One distinct, procedurally baked clip for each kind of activity, built from the character's own skeleton (the same way npcClips.js and the idle emote are),
// so they fit every body and outfit and need no extra files. Seated clips (lecture, exam, coding, reading, eating at a table) share one seated base;
// standing clips (shopping, working, praying, greeting, ...) each have their own body language. Every clip loops cleanly: its last frame equals its first.
//   listen    seated, face the front, now and then glance down and jot a note (lectures)
//   write     seated, head down, pen hand writing across the page (exams, assignments)
//   type      seated, forearms on a keyboard, fingers tapping, eyes on the screen (coding, labs)
//   read      seated, a book held open, eyes moving down the page, a page turned now and then (study, library)
//   eatSit    seated at a table, hand to mouth                       drink    standing, cup to the lips, head back
//   eat       standing, hand to mouth                                 greet    standing, a friendly wave
//   shop      standing, head scanning shelves, reaching and examining   work     standing, both hands busy at waist height, body rocking
//   interact  standing, one hand reaching forward to press / pick up    pray     standing, hands together, head bowed
//   present   standing, one arm sweeping toward a board (a lecturer teaching)
//   sleepLie  lying on the back, slow breathing (the body is laid down by the scene)
import * as THREE from "three";
import { boneKey } from "./manifest.js";
import { bake, legs, arms, spine, NEED, TAU } from "./npcClips.js";

const wave = (ps, k = 1) => Math.sin(ps * k);

/** Seated lower body: thighs forward, shins down, feet back on the floor. `shift` lowers the hips by how far the thighs raise the knees. */
function seat(S, shift, { knees = 0.1, crossed = 0 } = {}) {
  for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
    S.aim(pre + "UpLeg", pre + "Leg", [side * knees, -0.03, 1]);
    S.aim(pre + "Leg", pre + "Foot", [side * (0.04 - (side < 0 ? crossed : 0)), -1, 0.12 - (side < 0 ? crossed * 2 : 0)]);
    S.aim(pre + "Foot", pre + "ToeBase", [0, -0.2, 1]);
  }
  S.hipsAt(0, shift, 0);
}
/** How far the hips must drop so a seated character's feet stay on the floor (measured once per body). */
function seatShift(root, bones) {
  root.updateMatrixWorld(true);
  const ground = bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y, saved = [];
  for (const k in bones) saved.push([bones[k], bones[k].position.clone(), bones[k].quaternion.clone()]);
  let shift = 0;
  const probe = bake(root, bones, "probe", 1 / 30, (t, S) => {
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
      S.aim(pre + "UpLeg", pre + "Leg", [side * 0.1, -0.03, 1]); S.aim(pre + "Leg", pre + "Foot", [side * 0.04, -1, 0.12]);
    }
    root.updateMatrixWorld(true); shift = ground - bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y;
  });
  void probe; for (const [b, p, q] of saved) { b.position.copy(p); b.quaternion.copy(q); } root.updateMatrixWorld(true);
  return shift;
}

const clips = {
  listen: (root, bones, sh) => bake(root, bones, "listen", 6, (t, S) => {
    const ps = (t / 6) * TAU, note = Math.max(0, Math.sin(ps * 2 - 0.5)), look = 0.12 * wave(ps);
    seat(S, sh + 0.002 * wave(ps * 3));
    arms(S, 0.25, 1.3, 0.3, 1.25 + 0.05 * wave(ps * 14) * note, 0.12);
    spine(S, 0.05 + 0.05 * note, 0.1 + 0.45 * note, look * (1 - note)); // eyes front, then down to the page and back
    S.rot("Hips", 0, 0.01 * wave(ps), 0);
  }),
  write: (root, bones, sh) => bake(root, bones, "write", 2.4, (t, S) => {
    const ps = (t / 2.4) * TAU, glance = Math.max(0, Math.sin(ps - 1.2)) ** 6;
    seat(S, sh);
    S.aim("LeftArm", "LeftForeArm", [0.15, -0.9, 0.35]); S.aim("LeftForeArm", "LeftHand", [0.1, -0.35, 1]); // the left hand holds the paper
    S.aim("RightArm", "RightForeArm", [-0.2, -0.85, 0.45]);
    S.aim("RightForeArm", "RightHand", [-0.15 + 0.12 * wave(ps * 5), -0.35, 1]); // the pen hand moves along the line
    spine(S, 0.14, 0.5 - 0.35 * glance, 0.15 * glance);
  }),
  type: (root, bones, sh) => bake(root, bones, "type", 2, (t, S) => {
    const ps = (t / 2) * TAU;
    seat(S, sh);
    const l = wave(ps * 6), r = wave(ps * 6 + 2.1);
    S.aim("LeftArm", "LeftForeArm", [0.18, -0.9, 0.3]); S.aim("LeftForeArm", "LeftHand", [0.1, -0.28 + 0.12 * l, 1]);
    S.aim("RightArm", "RightForeArm", [-0.18, -0.9, 0.3]); S.aim("RightForeArm", "RightHand", [-0.1, -0.28 + 0.12 * r, 1]);
    spine(S, 0.1 + 0.01 * wave(ps), 0.22 + 0.03 * wave(ps * 2), 0.05 * wave(ps)); // looking at the screen, not the keys
  }),
  read: (root, bones, sh) => bake(root, bones, "read", 8, (t, S) => {
    const ps = (t / 8) * TAU, turn = Math.max(0, Math.sin(ps * 2 - 1)) ** 4; // a page turned twice per loop
    seat(S, sh);
    S.aim("LeftArm", "LeftForeArm", [0.3, -0.85, 0.3]); S.aim("LeftForeArm", "LeftHand", [-0.15, 0.55, 0.8]);
    S.aim("RightArm", "RightForeArm", [-0.3, -0.85 + 0.1 * turn, 0.3 + 0.2 * turn]);
    S.aim("RightForeArm", "RightHand", [0.15 + 0.5 * turn, 0.55 + 0.2 * turn, 0.8]); // the right hand crosses to lift the page
    spine(S, 0.1, 0.5 + 0.03 * wave(ps * 4), 0.1 * wave(ps * 4) * 0.5); // eyes travel down the page
  }),
  eatSit: (root, bones, sh) => bake(root, bones, "eatSit", 4, (t, S) => {
    const ps = (t / 4) * TAU, up = (0.5 - 0.5 * Math.cos(ps * 2)) ** 1.5;
    seat(S, sh);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.9, 0.3]); S.aim("LeftForeArm", "LeftHand", [0.1, -0.3, 1]);
    S.aim("RightArm", "RightForeArm", [-0.22 + 0.1 * up, -0.85 + 0.2 * up, 0.3 + 0.2 * up]);
    S.aim("RightForeArm", "RightHand", [-0.1 + 0.1 * up, -0.2 + 1.1 * up, 0.9 - 0.4 * up]);
    spine(S, 0.08, 0.2 - 0.1 * up + 0.05 * (1 - up), 0);
  }),
  eat: (root, bones) => bake(root, bones, "eat", 3.6, (t, S) => {
    const ps = (t / 3.6) * TAU, up = (0.5 - 0.5 * Math.cos(ps * 2)) ** 1.5;
    legs(S, 0.02 * wave(ps), 0.04, -0.02 * wave(ps), 0.03, 0.07);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.9, 0.3]); S.aim("LeftForeArm", "LeftHand", [0.15, -0.2, 1]); // a plate held at the belly
    S.aim("RightArm", "RightForeArm", [-0.25 + 0.1 * up, -0.85 + 0.2 * up, 0.25 + 0.2 * up]);
    S.aim("RightForeArm", "RightHand", [-0.1, -0.1 + 1.1 * up, 0.9 - 0.45 * up]);
    spine(S, 0.05, 0.25 - 0.12 * up, 0.08 * wave(ps));
  }),
  drink: (root, bones) => bake(root, bones, "drink", 4, (t, S) => {
    const ps = (t / 4) * TAU, up = Math.min(1, Math.max(0, 0.5 - 0.7 * Math.cos(ps))); // raise, hold, lower
    legs(S, 0.015 * wave(ps), 0.03, -0.015 * wave(ps), 0.03, 0.07);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.95, 0.12]); S.aim("LeftForeArm", "LeftHand", [0.15, -0.5, 0.9]);
    S.aim("RightArm", "RightForeArm", [-0.2 + 0.05 * up, -0.9 + 0.3 * up, 0.15 + 0.3 * up]);
    S.aim("RightForeArm", "RightHand", [-0.15, -0.1 + 1.1 * up, 0.9 - 0.5 * up]);
    spine(S, 0.0, -0.35 * up, 0.05 * wave(ps));
  }),
  greet: (root, bones) => bake(root, bones, "greet", 1.8, (t, S) => {
    const ps = (t / 1.8) * TAU, up = Math.min(1, Math.max(0, 0.5 - 0.6 * Math.cos(ps))) , w = wave(ps * 4);
    legs(S, 0.02 * wave(ps), 0.04, -0.02 * wave(ps), 0.03, 0.08);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.95, 0.08]); S.aim("LeftForeArm", "LeftHand", [0.18, -0.5, 0.8]);
    S.aim("RightArm", "RightForeArm", [-(0.5 + 0.2 * up), -0.9 + 1.5 * up, 0.1]);
    S.aim("RightForeArm", "RightHand", [-(0.2 + 0.45 * w * up), 1, 0.1]); // the forearm rocks side to side
    spine(S, -0.02, -0.08 * up, 0.12 * up);
  }),
  shop: (root, bones) => bake(root, bones, "shop", 7, (t, S) => {
    const ps = (t / 7) * TAU, reach = Math.max(0, Math.sin(ps * 2)) ** 2, scan = 0.45 * wave(ps);
    legs(S, 0.03 * wave(ps * 2), 0.05, -0.03 * wave(ps * 2), 0.04, 0.08);
    S.aim("LeftArm", "LeftForeArm", [0.25, -0.9, 0.2]); S.aim("LeftForeArm", "LeftHand", [0.2, -0.45, 0.9]); // a basket on the left arm
    S.aim("RightArm", "RightForeArm", [-(0.2 + 0.15 * reach), -0.9 + 0.55 * reach, 0.25 + 0.4 * reach]);
    S.aim("RightForeArm", "RightHand", [-0.15, -0.35 + 0.1 * reach, 1]);
    spine(S, 0.06 + 0.05 * reach, 0.08 + 0.1 * reach, scan * (1 - reach));
    S.rot("Hips", 0, 0.04 * wave(ps), 0);
  }),
  work: (root, bones) => bake(root, bones, "work", 2.4, (t, S) => {
    const ps = (t / 2.4) * TAU, a = wave(ps), b = wave(ps + 1.6);
    legs(S, 0.04 + 0.03 * a, 0.12, -0.02 - 0.03 * a, 0.08, 0.14);
    S.aim("LeftArm", "LeftForeArm", [0.28, -0.8, 0.45 + 0.1 * a]); S.aim("LeftForeArm", "LeftHand", [0.2 - 0.1 * a, -0.5, 1]);
    S.aim("RightArm", "RightForeArm", [-0.28, -0.8, 0.45 - 0.1 * a]); S.aim("RightForeArm", "RightHand", [-0.2 + 0.1 * b, -0.5, 1]);
    spine(S, 0.2 + 0.05 * a, 0.2, 0.1 * b);
    S.hipsAt(0, -0.03 - 0.01 * Math.abs(a), 0);
  }),
  interact: (root, bones) => bake(root, bones, "interact", 3, (t, S) => {
    const ps = (t / 3) * TAU, press = (0.5 - 0.5 * Math.cos(ps * 2)) ** 2;
    legs(S, 0.02 * wave(ps), 0.04, -0.02 * wave(ps), 0.03, 0.08);
    S.aim("LeftArm", "LeftForeArm", [0.2, -0.95, 0.1]); S.aim("LeftForeArm", "LeftHand", [0.15, -0.5, 0.85]);
    S.aim("RightArm", "RightForeArm", [-0.15, -0.55 + 0.1 * press, 0.8]);
    S.aim("RightForeArm", "RightHand", [-0.1, -0.1 + 0.05 * press, 1]);
    spine(S, 0.07 + 0.04 * press, 0.2, 0.05 * wave(ps));
  }),
  pray: (root, bones) => bake(root, bones, "pray", 6, (t, S) => {
    const ps = (t / 6) * TAU;
    legs(S, 0.015 * wave(ps), 0.03, -0.015 * wave(ps), 0.03, 0.05);
    S.aim("LeftArm", "LeftForeArm", [0.15, -0.9, 0.25]); S.aim("LeftForeArm", "LeftHand", [-0.45, 0.35, 0.9]);
    S.aim("RightArm", "RightForeArm", [-0.15, -0.9, 0.25]); S.aim("RightForeArm", "RightHand", [0.45, 0.35, 0.9]);
    spine(S, 0.05, 0.55 + 0.03 * wave(ps), 0);
  }),
  present: (root, bones) => bake(root, bones, "present", 5, (t, S) => {
    const ps = (t / 5) * TAU, sweep = wave(ps), beat = Math.max(0, wave(ps * 3));
    legs(S, 0.03 * wave(ps), 0.05, -0.03 * wave(ps), 0.04, 0.09);
    S.aim("RightArm", "RightForeArm", [-(0.5 + 0.25 * sweep), -0.4 + 0.3 * beat, 0.55]); // pointing out at the board
    S.aim("RightForeArm", "RightHand", [-(0.55 + 0.3 * sweep), 0.15 + 0.2 * beat, 0.8]);
    S.aim("LeftArm", "LeftForeArm", [0.3, -0.85, 0.3]); S.aim("LeftForeArm", "LeftHand", [0.2, -0.3, 1]);
    spine(S, 0.02, 0.02, -0.35 * Math.max(0, sweep) + 0.1 * wave(ps * 2)); // turns between the board and the class
  }),
  play: (root, bones) => bake(root, bones, "play", 1.6, (t, S) => { // a racket sport: a lunge and a swing, over and over, on the spot
    const ps = (t / 1.6) * TAU, sw = wave(ps), hit = Math.max(0, wave(ps - 0.5)) ** 2;
    legs(S, 0.18 * Math.abs(sw), 0.3 + 0.2 * Math.abs(sw), -0.12 * Math.abs(sw), 0.2, 0.2);
    S.aim("LeftArm", "LeftForeArm", [0.4, -0.5, 0.35]); S.aim("LeftForeArm", "LeftHand", [0.35, -0.2, 0.9]);
    S.aim("RightArm", "RightForeArm", [-(0.9 - 0.5 * hit), 0.1 - 0.5 * hit, 0.3 + 0.5 * hit]); S.aim("RightForeArm", "RightHand", [-(0.9 - 0.3 * hit), 0.15, 0.4 + 0.6 * hit]);
    spine(S, 0.18, 0.05, -0.3 * sw); S.hipsAt(0, -0.06 - 0.03 * Math.abs(sw), 0);
  }),
  sleepLie: (root, bones) => bake(root, bones, "sleepLie", 4, (t, S) => {
    const ps = (t / 4) * TAU, br = 0.5 + 0.5 * wave(ps);
    legs(S, 0.02, 0.05, 0.03, 0.06, 0.1);
    S.aim("LeftArm", "LeftForeArm", [0.25, -1, 0.05]); S.aim("LeftForeArm", "LeftHand", [0.3, -1, 0.1]);
    S.aim("RightArm", "RightForeArm", [-0.2, -1, 0.1]); S.aim("RightForeArm", "RightHand", [-0.1, -0.6, 0.8]);
    spine(S, -0.01 + 0.012 * br, 0.04, 0);
  }),
};
const SEATED = new Set(["listen", "write", "type", "read", "eatSit"]);

const cache = new Map();
/** The activity clips for this body (built once per gender and shared). Names the model already has are skipped. Returns [] if the skeleton is incomplete. */
export function activityClips(root, gender = "F", existing = []) {
  const have = new Set(existing.map((c) => c.name.replace(/^.*\|/, "").toLowerCase()));
  if (!cache.has(gender)) {
    const bones = {}; root.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });
    if (NEED.some((n) => !bones[n])) cache.set(gender, []);
    else {
      const keep = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone() };
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      try {
        const sh = seatShift(root, bones), out = [];
        for (const [name, f] of Object.entries(clips)) { try { out.push(f(root, bones, SEATED.has(name) ? sh : 0)); } catch (e) { console.warn("activity clip failed:", name, e); } }
        cache.set(gender, out);
      } finally { root.position.copy(keep.p); root.quaternion.copy(keep.q); root.scale.copy(keep.s); root.updateMatrixWorld(true); }
    }
  }
  return cache.get(gender).filter((c) => !have.has(c.name.toLowerCase())).map((c) => c.clone());
}
export const ACTIVITY_CLIP_NAMES = Object.keys(clips);
