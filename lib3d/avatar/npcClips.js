// lib3d/avatar/npcClips.js
// Extra animations for NPCs, built in code from the character's own skeleton (the same way the idle emote is), so they fit every body and outfit and need no extra files:
//   run, cheer, sit, phone (texting), talk (chatting with hand gestures), lookAround (a standing idle that glances about).
// The authored "idle" and "walk" clips of the models are kept as they are. Poses are given as *directions* (x = the character's left, y = up, z = forward), so the
// same script works whatever the bones' local axes are. Clips are baked once per body (male/female) and shared by every NPC of that body.
import * as THREE from "three";
import { boneKey } from "./manifest.js";
import { aim } from "./idleEmote.js";

const FPS = 30, TAU = Math.PI * 2, RAD = Math.PI / 180;
const NEED = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
const TRACKED = ["Spine", "Spine1", "Spine2", "Neck", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot"];
const ease = (x) => x * x * (3 - 2 * x), clamp01 = (x) => Math.min(1, Math.max(0, x));
const dir = (side, a, spread = 0, lift = 0) => [side * spread, -Math.cos(a) + lift, Math.sin(a)]; // a limb hanging down, swung forward by `a` radians (side: +1 = left, -1 = right)

/** Runs `frame(t, S)` for every frame and records the resulting bone rotations as an AnimationClip. S = { bones, rot, aim, hipsAt, side }. Bones are restored afterwards. */
function bake(root, bones, name, duration, frame) {
  const saved = []; root.traverse((o) => { if (o.isBone) saved.push([o, o.position.clone(), o.quaternion.clone()]); });
  const rest = Object.fromEntries(Object.entries(bones).map(([k, b]) => [k, { p: b.position.clone(), q: b.quaternion.clone() }]));
  const times = [], data = Object.fromEntries(TRACKED.map((n) => [n, []])), hips = [], Qt = new THREE.Quaternion(), Et = new THREE.Euler();
  // the direction each spine segment and the neck point in at rest (root space): lean and head turns are applied on top of these, so an upright pose stays the model's own upright
  root.updateMatrixWorld(true);
  const restDir = {}, pa = new THREE.Vector3(), pb = new THREE.Vector3();
  for (const [a, b] of [["Spine", "Spine1"], ["Spine1", "Spine2"], ["Neck", "Head"]]) restDir[a] = bones[b].getWorldPosition(pb).sub(bones[a].getWorldPosition(pa)).normalize().clone();
  const S = {
    restDir,
    bones,
    rot: (n, x, y, z) => bones[n].quaternion.copy(rest[n].q).multiply(Qt.setFromEuler(Et.set(x, y, z))),
    aim: (n, child, d, roll = 0) => aim(root, bones[n], bones[child], d, roll),
    hipsAt: (dx, dy, dz) => bones.Hips.position.set(rest.Hips.p.x + dx, rest.Hips.p.y + dy, rest.Hips.p.z + dz),
    rest,
  };
  try {
    const n = Math.max(1, Math.round(duration * FPS));
    for (let s = 0; s <= n; s++) {
      for (const k in bones) { bones[k].position.copy(rest[k].p); bones[k].quaternion.copy(rest[k].q); }
      root.updateMatrixWorld(true);
      const t = Math.min(duration, s / FPS); times.push(t);
      frame(t, S);
      root.updateMatrixWorld(true);
      for (const k of TRACKED) data[k].push(...bones[k].quaternion.toArray());
      hips.push(bones.Hips.position.x, bones.Hips.position.y, bones.Hips.position.z);
    }
  } finally { for (const [o, p, q] of saved) { o.position.copy(p); o.quaternion.copy(q); } root.updateMatrixWorld(true); }
  const tracks = TRACKED.map((k) => new THREE.QuaternionKeyframeTrack(`${bones[k].name}.quaternion`, times, data[k]));
  tracks.push(new THREE.VectorKeyframeTrack(`${bones.Hips.name}.position`, times, hips));
  return new THREE.AnimationClip(name, duration, tracks);
}

/** Both legs for a gait phase. swing = thigh angle forward (radians), bend = knee flexion. */
function legs(S, swingL, bendL, swingR, bendR, splay = 0.06) {
  for (const [side, pre, sw, bd] of [[1, "Left", swingL, bendL], [-1, "Right", swingR, bendR]]) {
    S.aim(pre + "UpLeg", pre + "Leg", dir(side, sw, splay));
    S.aim(pre + "Leg", pre + "Foot", dir(side, sw - bd, splay * 0.5));
    S.aim(pre + "Foot", pre + "ToeBase", [0, -0.28 + Math.max(0, -(sw - bd)) * 0.3, 1]);
  }
}
/** Both arms: upper-arm swing and elbow flexion (forearm swung further forward by `elbow`). */
function arms(S, swingL, elbowL, swingR, elbowR, spread = 0.2) {
  for (const [side, pre, sw, el] of [[1, "Left", swingL, elbowL], [-1, "Right", swingR, elbowR]]) {
    S.aim(pre + "Arm", pre + "ForeArm", dir(side, sw, spread));
    S.aim(pre + "ForeArm", pre + "Hand", dir(side, sw + el, spread * 0.4));
  }
}
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), TMP = new THREE.Vector3();
const tilt = (S, name, pitch, turn = 0) => S.aim(name, { Spine: "Spine1", Spine1: "Spine2", Neck: "Head" }[name], TMP.copy(S.restDir[name]).applyAxisAngle(AX, pitch).applyAxisAngle(AY, turn).toArray());
/** lean = how far the trunk leans forward (radians, shared between the two spine segments); head = head tipped forward (+) or back (-); headTurn = looking left (+) or right (-). */
const spine = (S, lean, head = 0, headTurn = 0) => {
  tilt(S, "Spine", lean * 0.45); tilt(S, "Spine1", lean * 0.4);
  tilt(S, "Neck", head - lean * 0.6, headTurn);
};

/* ------------------------------------------------------------------ the clips */

function runClip(root, bones) {
  const D = 0.68;
  return bake(root, bones, "run", D, (t, S) => {
    const ps = (t / D) * TAU, A = 0.78;
    const L = A * Math.sin(ps), R = -L;
    const knee = (a) => 0.35 + 1.15 * Math.pow(0.5 + 0.5 * Math.cos(a - 0.9), 1.6); // the knee folds as the leg swings through
    legs(S, L, knee(ps), R, knee(ps + Math.PI), 0.04);
    arms(S, -L * 0.85, 1.55, -R * 0.85, 1.55, 0.14);
    spine(S, 0.2, 0.05);
    S.hipsAt(0, -0.045 + 0.035 * Math.abs(Math.cos(ps)), 0);
    S.rot("Hips", 0, 0.05 * Math.sin(ps), 0.03 * Math.sin(ps)); // hips and shoulders twist against each other
    S.rot("Spine1", 0, -0.08 * Math.sin(ps), 0);
  });
}

function cheerClip(root, bones) {
  const D = 0.64;
  return bake(root, bones, "cheer", D, (t, S) => {
    const ps = (t / D) * TAU, up = 0.5 + 0.5 * Math.sin(ps), alt = Math.sin(ps);
    for (const [side, pre, k] of [[1, "Left", alt], [-1, "Right", -alt]]) { // both arms high, pumping alternately
      S.aim(pre + "Arm", pre + "ForeArm", [side * (0.88 - 0.08 * k), 0.3 + 0.2 * k, 0.1]);
      S.aim(pre + "ForeArm", pre + "Hand", [side * (0.25 + 0.15 * k), 1, 0.1]);
    }
    legs(S, 0.05 * alt, 0.1 + 0.25 * up, -0.05 * alt, 0.1 + 0.25 * (1 - up), 0.12);
    spine(S, -0.05, -0.18);
    S.hipsAt(0, -0.02 + 0.08 * Math.abs(Math.sin(ps / 2)), 0);
  });
}

function phoneClip(root, bones) {
  const D = 4;
  return bake(root, bones, "phone", D, (t, S) => {
    const ps = (t / D) * TAU, tap = Math.sin(t * 9) * 0.03;
    // both forearms raised in front of the chest holding the phone, head tipped down at it; weight shifts a little
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
      S.aim(pre + "Arm", pre + "ForeArm", [side * 0.22, -0.92, 0.18]);
      S.aim(pre + "ForeArm", pre + "Hand", [side * (0.34 - (side > 0 ? 0 : tap * 0.4)), 0.55 + (side > 0 ? 0 : tap), 0.72]);
    }
    legs(S, 0.03 * Math.sin(ps), 0.04, -0.02 * Math.sin(ps), 0.03, 0.07);
    spine(S, 0.07 + 0.015 * Math.sin(ps * 2), 0.42 + 0.04 * Math.sin(ps), 0.18 * Math.sin(ps * 0.5));
    S.rot("Hips", 0, 0.02 * Math.sin(ps), 0.025 * Math.sin(ps));
    S.hipsAt(0, -0.004 + 0.003 * Math.sin(ps * 3), 0);
  });
}

function talkClip(root, bones) {
  const D = 3.2;
  return bake(root, bones, "talk", D, (t, S) => {
    const ps = (t / D) * TAU, g = Math.sin(ps * 2), g2 = Math.sin(ps * 3 + 1);
    // the right hand explains (up and out in beats), the left stays lower and joins in now and then
    S.aim("RightArm", "RightForeArm", [-(0.42 + 0.1 * g), -0.75, 0.25 + 0.1 * g]);
    S.aim("RightForeArm", "RightHand", [-(0.35 + 0.2 * g), 0.3 + 0.5 * Math.max(0, g), 0.8]);
    const lj = Math.max(0, Math.sin(ps + 2)) ;
    S.aim("LeftArm", "LeftForeArm", [0.3 + 0.1 * lj, -0.9 + 0.2 * lj, 0.12 + 0.12 * lj]);
    S.aim("LeftForeArm", "LeftHand", [0.28 + 0.2 * lj, -0.6 + 0.8 * lj, 0.7 + 0.2 * lj]);
    legs(S, 0.035 * Math.sin(ps), 0.05, -0.03 * Math.sin(ps), 0.04, 0.07);
    spine(S, 0.02, 0.04 * g2 - 0.03, 0.22 * Math.sin(ps) + 0.1 * Math.sin(ps * 3));
    S.rot("Hips", 0, 0.03 * Math.sin(ps), 0.02 * Math.sin(ps + 1));
  });
}

function lookAroundClip(root, bones) {
  const D = 6;
  return bake(root, bones, "lookAround", D, (t, S) => {
    const ps = (t / D) * TAU, turn = 0.5 * Math.sin(ps) * Math.max(0, Math.sin(ps * 0.5 + 0.4)) + 0.2 * Math.sin(ps * 2);
    arms(S, 0.02, 0.28 + 0.03 * Math.sin(ps), 0.015, 0.24, 0.17);
    legs(S, 0.025 * Math.sin(ps), 0.035, -0.02 * Math.sin(ps), 0.03, 0.07);
    spine(S, 0.01, 0.05 * Math.sin(ps * 2), turn);
    S.rot("Hips", 0, 0.02 * Math.sin(ps), 0.02 * Math.sin(ps));
  });
}

function sitClip(root, bones) {
  root.updateMatrixWorld(true);
  const groundY = bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y; // where the ankle stands when upright
  let shift = 0, measured = false;
  const clip = bake(root, bones, "sit", 2 / FPS, (t, S) => {
    const breathe = 0.003 * Math.sin(t * 2);
    legs(S, 1.5, 1.5, 1.5, 1.5, 0.1); // thighs forward, shins hang down (overridden just below: a seated knee is bent a right angle)
    for (const [side, pre] of [[1, "Left"], [-1, "Right"]]) {
      S.aim(pre + "UpLeg", pre + "Leg", [side * 0.1, -0.03, 1]);
      S.aim(pre + "Leg", pre + "Foot", [side * 0.04, -1, 0.12]);
      S.aim(pre + "Foot", pre + "ToeBase", [0, -0.2, 1]);
    }
    arms(S, 0.1, 0.55, 0.1, 0.55, 0.14);
    spine(S, -0.02 + breathe, 0.03);
    if (!measured) { // lower the hips until the feet are back on the floor
      root.updateMatrixWorld(true); const foot = bones.LeftFoot.getWorldPosition(new THREE.Vector3()).y; shift = groundY - foot; measured = true;
    }
    S.hipsAt(0, shift + breathe, 0);
  });
  return clip;
}

/* ------------------------------------------------------------------ public */

const cache = new Map();
/**
 * The extra clips for this body (built once per gender, then shared). Pass `existing` (the clips the model already has) so nothing an artist authored is overridden:
 * a name the model already provides is skipped. Returns [] if the skeleton is incomplete.
 */
export function npcClips(root, gender = "F", existing = []) {
  const have = new Set(existing.map((c) => c.name.replace(/^.*\|/, "").toLowerCase()));
  if (!cache.has(gender)) {
    const bones = {};
    root.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });
    if (NEED.some((n) => !bones[n])) { cache.set(gender, []); }
    else {
      // bake on the bare skeleton (no scale, no position, no parent) so directions mean what they say, then put everything back
      const keep = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone(), parent: root.parent };
      root.position.set(0, 0, 0); root.quaternion.identity(); root.scale.set(1, 1, 1);
      try {
        cache.set(gender, [runClip, cheerClip, phoneClip, talkClip, lookAroundClip, sitClip].map((f) => { try { return f(root, bones); } catch (e) { console.warn("npc clip failed:", f.name, e); return null; } }).filter(Boolean));
      } finally { root.position.copy(keep.p); root.quaternion.copy(keep.q); root.scale.copy(keep.s); root.updateMatrixWorld(true); }
    }
  }
  return cache.get(gender).filter((c) => !have.has(c.name.toLowerCase())).map((c) => c.clone());
}
// shared with activityClips.js (the same baking helpers, so both sets of clips fit the body the same way)
export { bake, legs, arms, spine, dir, NEED, FPS, TAU };
