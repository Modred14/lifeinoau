// lib3d/avatar/danceClips.js
// Club dance clips, baked from the character's own skeleton exactly like activityClips.js / policeClips.js (so they fit every body and outfit and need no files).
// Directions are (x = the character's left, y = up, z = forward). Every clip loops: its last frame equals its first (all motion is whole-number harmonics of the cycle).
//   danceBounce   a steady two-step: weight bounces from foot to foot, fists pumping
//   danceSway     smooth side-to-side hip movement, trunk leaning with the hips, hands low and flowing
//   danceLegwork  fast alternating footwork, knees snapping, elbows tight, the body rocking
//   danceOblee    low stance, quick feet, one arm driving high while the other drops, switching with the beat, head bobbing
// All of these are CHOREOGRAPHED IN CODE as approximations (the skeleton helpers set limb directions and hip position; they cannot set hip or torso roll).
// If an artist adds a real clip with the same name (or an alias in manifest.js), activityClips() skips ours and the authored one is used.
import { bake, legs, arms, spine, TAU } from "./npcClips.js";

const sin = Math.sin, cos = Math.cos, pos = (x) => Math.max(0, x);
/** Leans the trunk sideways (+ = toward the character's left) by lateral component `side`, on top of the forward lean. */
const lean = (S, side, fwd = 0) => {
  S.aim("Spine", "Spine1", [S.restDir.Spine.x + side * 0.5, S.restDir.Spine.y, S.restDir.Spine.z + fwd * 0.45]);
  S.aim("Spine1", "Spine2", [S.restDir.Spine1.x + side * 0.4, S.restDir.Spine1.y, S.restDir.Spine1.z + fwd * 0.4]);
};

export const DANCE_CLIPS = {
  danceBounce: (root, bones) => bake(root, bones, "danceBounce", 1, (t, S) => {
    const ps = (t / 1) * TAU, shift = sin(ps), up = Math.abs(sin(ps));
    legs(S, 0.1 + 0.18 * pos(shift), 0.25 + 0.3 * pos(shift), 0.1 + 0.18 * pos(-shift), 0.25 + 0.3 * pos(-shift), 0.14);
    arms(S, 0.55 + 0.45 * shift, 1.5, 0.55 - 0.45 * shift, 1.5, 0.28);
    lean(S, 0.05 * shift, 0.08); spine(S, 0.06, 0.05 * up, 0.12 * shift);
    S.hipsAt(0.03 * shift, -0.07 + 0.045 * up, 0);
  }),
  danceSway: (root, bones) => bake(root, bones, "danceSway", 2.4, (t, S) => {
    const ps = (t / 2.4) * TAU, s = sin(ps);
    legs(S, 0.08, 0.22 + 0.1 * s, 0.08, 0.22 - 0.1 * s, 0.2);
    arms(S, 0.35 + 0.25 * s, 0.7, 0.35 - 0.25 * s, 0.7, 0.5);
    lean(S, -0.22 * s, 0.02); spine(S, 0.02, 0.03 * cos(ps * 2), -0.2 * s);
    S.hipsAt(0.07 * s, -0.05 + 0.012 * cos(ps * 2), 0);
  }),
  danceLegwork: (root, bones) => bake(root, bones, "danceLegwork", 1.2, (t, S) => {
    const ps = (t / 1.2) * TAU, k = sin(ps * 2), L = pos(k), R = pos(-k);
    legs(S, 0.1 + 0.5 * L, 0.3 + 0.9 * L, 0.1 + 0.5 * R, 0.3 + 0.9 * R, 0.18);
    arms(S, 0.45 - 0.25 * k, 1.7, 0.45 + 0.25 * k, 1.7, 0.3);
    lean(S, 0.1 * k, 0.12); spine(S, 0.1, 0.06 * cos(ps * 4), 0.18 * k);
    S.hipsAt(0.04 * k, -0.1 + 0.03 * Math.abs(sin(ps * 2)), 0);
  }),
  danceOblee: (root, bones) => bake(root, bones, "danceOblee", 1.6, (t, S) => {
    const ps = (t / 1.6) * TAU, beat = sin(ps * 2), sw = sin(ps), tap = sin(ps * 4);
    // quick feet: low stance, small alternating taps at four times the arm rate
    legs(S, 0.18 + 0.2 * pos(tap), 0.55 + 0.25 * pos(tap), 0.18 + 0.2 * pos(-tap), 0.55 + 0.25 * pos(-tap), 0.22);
    // one arm drives high (overhead, elbow bent) while the other drops low across the body; they swap every half cycle
    const hi = pos(sw), lo = pos(-sw);
    S.aim("LeftArm", "LeftForeArm", [0.55 + 0.1 * hi, 0.2 + 0.95 * hi - 0.9 * lo, 0.1 + 0.1 * lo]);
    S.aim("LeftForeArm", "LeftHand", [0.2 + 0.1 * hi, 0.5 + 0.5 * hi - 0.3 * lo, 0.55 + 0.3 * lo]);
    S.aim("RightArm", "RightForeArm", [-(0.55 + 0.1 * lo), 0.2 + 0.95 * lo - 0.9 * hi, 0.1 + 0.1 * hi]);
    S.aim("RightForeArm", "RightHand", [-(0.2 + 0.1 * lo), 0.5 + 0.5 * lo - 0.3 * hi, 0.55 + 0.3 * hi]);
    lean(S, -0.12 * sw, 0.16); spine(S, 0.16, 0.1 * beat, 0.25 * sw);
    S.hipsAt(0.05 * sw, -0.15 + 0.035 * Math.abs(beat), 0);
  }),
};
export const DANCE_CLIP_NAMES = Object.keys(DANCE_CLIPS);
