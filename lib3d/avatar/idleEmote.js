// lib3d/avatar/idleEmote.js
// The automatic idle emote: a short dance (arms up, hands on chest, low palm-down sweeps, belly rub, raised-hand waves, hands on head)
// recreated from the reference video, plus the small timer that decides when to play it.
//
// The clip is built in code from the character's own skeleton, so no extra model file is needed and it fits every body/outfit.
// Arms are posed by *direction* (where the upper arm and forearm point, in body space: x = the character's left, y = up, z = forward),
// which makes the same script work on any Mixamo-style rig, whatever the bones' local axes are.
import * as THREE from "three";
import { boneKey } from "./manifest.js";

/** Seconds of complete inactivity before the emote starts. */
export const IDLE_DELAY = 5;
/** Name of the clip inside the animator (the manifest maps "idleEmote" to it). */
export const EMOTE_CLIP = "idle_emote";

const RAD = Math.PI / 180, FPS = 30;

/* ------------------------------------------------------------------ the choreography */

// Arm poses for the LEFT arm: u = upper arm direction, f = forearm direction, r = twist of the hand (degrees, palm up/down).
// The right arm uses the same pose mirrored left-to-right.
const POSE = {
  down:    { u: [0.22, -1, 0.05],    f: [0.18, -1, 0.3],     r: 0 },
  cheer:   { u: [0.9, 0.18, 0.1],    f: [0.2, 1, 0.1],       r: 0 },   // elbows out, forearms straight up
  cheerW:  { u: [0.85, 0.4, 0],      f: [0.45, 1, 0.05],     r: 0 },
  chest:   { u: [0.45, -0.85, 0.12], f: [-0.62, 0.68, 0.5],  r: 0 },   // hand flat on the chest
  belly:   { u: [0.3, -0.95, 0.1],   f: [-0.92, 0.1, 0.55],  r: 0 },
  sweep:   { u: [0.36, -0.92, 0.1],  f: [0.82, -0.2, 0.5],   r: 0 },   // elbow bent, forearm sweeping out, palm down
  sweepLo: { u: [0.3, -0.95, 0.1],   f: [0.75, -0.42, 0.5],  r: 0 },
  sweepHi: { u: [0.5, -0.82, 0.1],   f: [0.92, 0.1, 0.35],   r: 0 },
  wave:    { u: [0.85, 0.0, 0.2],    f: [0.15, 1, 0.25],     r: 0 },   // hand up beside the head
  waveHi:  { u: [0.75, 0.25, 0.15],  f: [0.1, 1, 0.2],       r: 0 },
  mid:     { u: [0.5, -0.55, 0.35],  f: [0.12, 0.65, 0.85],  r: 0 },
  head:    { u: [0.85, 0.5, 0.0],    f: [-0.88, 0.4, 0.2],   r: 0 },   // hands on top of the head, elbows out
  ear:     { u: [0.7, 0.22, 0.28],   f: [-0.18, 1, 0.22],    r: 0 },
};

// [time in seconds, left arm pose, right arm pose]. Follows the video beat by beat; the end returns to the relaxed arms-down pose.
const SCRIPT = [
  [0.0, "down", "down"],
  [0.3, "cheer", "cheer"],      // both arms up, cheering
  [0.6, "cheerW", "cheerW"],
  [0.95, "chest", "chest"],     // hands on the chest
  [1.25, "chest", "chest"],
  [1.55, "sweep", "sweep"],     // arms sweep out low, palms down
  [1.85, "sweepLo", "sweepLo"],
  [2.2, "belly", "chest"],      // rub the belly
  [2.6, "chest", "belly"],
  [3.0, "belly", "wave"],       // right hand up by the head
  [3.35, "belly", "waveHi"],
  [3.7, "mid", "mid"],
  [4.0, "waveHi", "sweepLo"],   // then the left
  [4.3, "sweepHi", "sweepLo"],  // low sweeping, one side then the other
  [4.7, "sweepLo", "sweepHi"],
  [5.1, "sweepHi", "sweepLo"],
  [5.5, "sweepLo", "sweepHi"],
  [5.9, "sweep", "sweep"],
  [6.25, "wave", "sweepLo"],
  [6.6, "cheer", "cheer"],      // both hands up onto the head
  [6.95, "head", "head"],
  [7.3, "head", "head"],
  [7.6, "ear", "head"],
  [7.9, "sweep", "sweepLo"],    // last sweeps
  [8.3, "sweepLo", "sweep"],
  [8.7, "down", "down"],
];
export const EMOTE_DURATION = SCRIPT[SCRIPT.length - 1][0];

const ease = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, k) => a + (b - a) * k;

/** The two arm poses at time t (blended between the surrounding beats). */
function armsAt(t) {
  let i = 0;
  while (i < SCRIPT.length - 2 && t >= SCRIPT[i + 1][0]) i++;
  const [t0, l0, r0] = SCRIPT[i], [t1, l1, r1] = SCRIPT[i + 1], k = ease(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  const mix = (a, b) => ({ u: a.u.map((v, n) => lerp(v, b.u[n], k)), f: a.f.map((v, n) => lerp(v, b.f[n], k)), r: lerp(a.r, b.r, k) });
  return { L: mix(POSE[l0], POSE[l1]), R: mix(POSE[r0], POSE[r1]) };
}

/** Body motion: hip sway and bounce, a counter-twist up the spine and a head tilt. Fades in and out so it starts and ends at rest. */
function bodyAt(t) {
  const env = ease(Math.min(1, t / 0.45)) * ease(Math.min(1, (EMOTE_DURATION - t) / 0.6)), w = (t / 1.25) * Math.PI * 2;
  return {
    hipsY: 5 * RAD * Math.sin(w) * env, hipsZ: 3.5 * RAD * Math.sin(w + Math.PI / 2) * env, bounce: -0.012 * (0.5 + 0.5 * Math.cos(w * 2)) * env,
    spineY: -3 * RAD * Math.sin(w) * env, spine1Y: -3.5 * RAD * Math.sin(w) * env, spine2Z: -2.5 * RAD * Math.sin(w + Math.PI / 2) * env,
    headZ: 5 * RAD * Math.sin((t / 2.5) * Math.PI * 2) * env, headY: 7 * RAD * Math.sin((t / 3.3) * Math.PI * 2) * env,
  };
}

/* ------------------------------------------------------------------ baking the clip */

const V = new THREE.Vector3(), W = new THREE.Vector3(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), E = new THREE.Euler();

/** Turns `bone` so the segment from it to `child` points along `dir` (given in the root's space), twisted by `roll` degrees. */
export function aim(root, bone, child, dir, roll) {
  root.updateMatrixWorld(true);
  const rootQ = root.getWorldQuaternion(new THREE.Quaternion()), want = new THREE.Vector3(...dir).normalize().applyQuaternion(rootQ);
  bone.getWorldPosition(V); child.getWorldPosition(W);
  const cur = W.sub(V).normalize(), boneQ = bone.getWorldQuaternion(new THREE.Quaternion());
  const swing = Q.setFromUnitVectors(cur, want), next = swing.multiply(boneQ);
  if (roll) next.premultiply(Q2.setFromAxisAngle(want, roll * RAD));
  const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(parentQ.invert().multiply(next));
  bone.updateMatrixWorld(true);
}

/**
 * Builds the emote as an AnimationClip for this character's skeleton, or returns null if the skeleton lacks a needed bone.
 * The bones are restored to exactly how they were found, so this is safe to call at any time.
 */
export function buildIdleEmoteClip(root) {
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[boneKey(o.name)] = o; });
  const need = ["Hips", "Spine", "Spine1", "Spine2", "Head", "LeftArm", "LeftForeArm", "LeftHand", "RightArm", "RightForeArm", "RightHand"];
  if (need.some((n) => !bones[n])) return null;
  const saved = []; root.traverse((o) => { if (o.isBone) saved.push([o, o.position.clone(), o.quaternion.clone()]); });
  const restHips = bones.Hips.position.clone(), restQ = {};
  for (const n of ["Hips", "Spine", "Spine1", "Spine2", "Head"]) restQ[n] = bones[n].quaternion.clone();
  const order = ["Hips", "Spine", "Spine1", "Spine2", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm"];
  const times = [], data = Object.fromEntries(order.map((n) => [n, []])), hipsPos = [];
  const mirror = (a) => [-a[0], a[1], a[2]];
  try {
    const n = Math.round(EMOTE_DURATION * FPS);
    for (let s = 0; s <= n; s++) {
      const t = Math.min(EMOTE_DURATION, s / FPS), b = bodyAt(t), arms = armsAt(t);
      times.push(t);
      const rot = (name, x, y, z) => bones[name].quaternion.copy(restQ[name]).multiply(Q.setFromEuler(E.set(x, y, z)));
      rot("Hips", 0, b.hipsY, b.hipsZ); rot("Spine", 0, b.spineY, 0); rot("Spine1", 0, b.spine1Y, 0); rot("Spine2", 0, 0, b.spine2Z); rot("Head", 0, b.headY, b.headZ);
      bones.Hips.position.set(restHips.x, restHips.y + b.bounce, restHips.z);
      root.updateMatrixWorld(true);
      aim(root, bones.LeftArm, bones.LeftForeArm, arms.L.u, 0);
      aim(root, bones.LeftForeArm, bones.LeftHand, arms.L.f, arms.L.r);
      aim(root, bones.RightArm, bones.RightForeArm, mirror(arms.R.u), 0);
      aim(root, bones.RightForeArm, bones.RightHand, mirror(arms.R.f), -arms.R.r);
      for (const name of order) data[name].push(...bones[name].quaternion.toArray());
      hipsPos.push(bones.Hips.position.x, bones.Hips.position.y, bones.Hips.position.z);
    }
  } finally {
    for (const [o, p, q] of saved) { o.position.copy(p); o.quaternion.copy(q); }
    root.updateMatrixWorld(true);
  }
  const tracks = order.map((name) => new THREE.QuaternionKeyframeTrack(`${bones[name].name}.quaternion`, times, data[name]));
  tracks.push(new THREE.VectorKeyframeTrack(`${bones.Hips.name}.position`, times, hipsPos));
  return new THREE.AnimationClip(EMOTE_CLIP, EMOTE_DURATION, tracks);
}

/* ------------------------------------------------------------------ the idle timer */

/**
 * Decides when the emote plays. It knows nothing about the 3D scene: the scene tells it, every frame, whether the player is busy.
 *   canPlay()  -> can an emote be played right now (the model has the clip, the tab is visible, motion is allowed)?
 *   play()     -> starts it (returns false if it could not start). The scene calls finish() when it ends by itself.
 *   stop()     -> ends it early and returns to the normal idle.
 *   update(dt, busy) every frame.   poke() whenever the player does anything.
 */
export function createIdleController({ delay = IDLE_DELAY, canPlay = () => true, play, stop } = {}) {
  let idle = 0, playing = false;
  return {
    get playing() { return playing; },
    get idleFor() { return idle; },
    update(dt, busy) {
      if (busy) { idle = 0; if (playing) { playing = false; stop?.(); } return; }
      if (playing) return;
      idle += dt;
      if (idle < delay) return;
      idle = 0;
      if (canPlay() && play?.() !== false) playing = true;
    },
    /** The player did something: restart the countdown and end a running emote. */
    poke() { idle = 0; if (playing) { playing = false; stop?.(); } },
    /** The emote ended by itself (the animator already blended back to idle). */
    finish() { playing = false; idle = 0; },
    /** Forget everything (e.g. the character was swapped). */
    reset() { playing = false; idle = 0; },
  };
}