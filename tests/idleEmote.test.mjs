// tests/idleEmote.test.mjs
// The automatic idle emote: the 5-second inactivity timer, what resets or cancels it, the one-shot clip blending back to idle,
// and the clip builder on a stand-in skeleton. Pure Node (no browser needed).
import * as THREE from "three";
import { createIdleController, buildIdleEmoteClip, IDLE_DELAY, EMOTE_DURATION, EMOTE_CLIP } from "../lib3d/avatar/idleEmote.js";
import { createAnimator, resolveClip } from "../lib3d/avatar/animation.js";
import { ANIMATIONS } from "../lib3d/avatar/manifest.js";
let bad = 0; const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };

// ---- the timer
const mk = (over = {}) => { const log = []; const c = createIdleController({ canPlay: () => true, play: () => { log.push("play"); }, stop: () => log.push("stop"), ...over }); return { c, log }; };
const run = (c, secs, busy = false, dt = 1 / 60) => { for (let t = 0; t < secs - 1e-9; t += dt) c.update(dt, busy); };

chk("the delay is 5 seconds", IDLE_DELAY === 5);
{ const { c, log } = mk(); run(c, 4.9); chk("nothing plays before 5 s of inactivity", log.length === 0 && !c.playing); run(c, 0.2); chk("plays after 5 s of inactivity", log.join() === "play" && c.playing); }
{ const { c, log } = mk(); run(c, 4); c.poke(); run(c, 4); chk("a poke (tap/key/scroll) restarts the countdown", log.length === 0); run(c, 1.1); chk("...and it plays 5 s after the last poke", log.join() === "play"); }
{ const { c, log } = mk(); run(c, 4); run(c, 3, true); chk("being busy (moving, dragging, shopping) resets the countdown", log.length === 0 && c.idleFor === 0); run(c, 4.9); chk("...and the full 5 s must pass again afterwards", log.length === 0); }
{ const { c, log } = mk(); run(c, 5.1); run(c, 0.1, true); chk("starting to move cancels a running emote", log.join() === "play,stop" && !c.playing); run(c, 4.9); chk("no immediate replay after being cancelled", log.length === 2); }
{ const { c, log } = mk(); run(c, 5.1); c.poke(); chk("a poke cancels a running emote", log.join() === "play,stop" && !c.playing); }
{ const { c, log } = mk(); run(c, 5.1); c.finish(); chk("finish() ends it without a stop call and restarts the countdown", log.join() === "play" && !c.playing && c.idleFor === 0); run(c, 5.1); chk("...it can play again after another 5 s idle", log.length === 2); }
{ const { c, log } = mk(); run(c, 5.1); run(c, 30); chk("it never restarts while one is already playing", log.length === 1); }
{ const { c, log } = mk({ canPlay: () => false }); run(c, 20); chk("canPlay() = false (tab hidden, reduced motion, no clip) means it never plays", log.length === 0 && !c.playing); }
{ const { c, log } = mk({ play: () => false }); run(c, 6); chk("a play() that fails leaves the controller idle and not 'playing'", !c.playing); }
{ const { c, log } = mk(); run(c, 5.1); c.reset(); chk("reset() (avatar swapped) clears a running emote without a stop call", !c.playing && log.join() === "play" && c.idleFor === 0); }

// ---- the clip on a stand-in Mixamo-style skeleton (same bone names, offsets copied from base_male.glb)
function skeleton() {
  const B = (n, x = 0, y = 0, z = 0, parent) => { const b = new THREE.Bone(); b.name = "mixamorig" + n; b.position.set(x, y, z); parent?.add(b); return b; };
  const root = new THREE.Group(), hips = B("Hips", 0, 0.996, 0.013); root.add(hips);
  const sp = B("Spine", 0, 0.092, 0.015, hips), sp1 = B("Spine1", 0, 0.096, -0.019, sp), sp2 = B("Spine2", 0, 0.128, -0.055, sp1), neck = B("Neck", 0, 0.1, 0, sp2); B("Head", 0, 0.1, 0, neck);
  for (const [side, s] of [["Left", 1], ["Right", -1]]) { const sh = B(side + "Shoulder", s * 0.04, 0.12, 0, sp2), arm = B(side + "Arm", s * 0.144, -0.071, 0.009, sh), fore = B(side + "ForeArm", s * 0.169, -0.194, -0.002, arm); B(side + "Hand", s * 0.142, -0.138, 0.207, fore); }
  return { root, hips };
}
const { root, hips } = skeleton();
const before = []; root.traverse((o) => before.push(o.position.clone(), o.quaternion.clone()));
const clip = buildIdleEmoteClip(root);
chk("the clip builds on a Mixamo-style skeleton and is named idle_emote", !!clip && clip.name === EMOTE_CLIP);
chk("its length matches the script (about 9 s)", clip && Math.abs(clip.duration - EMOTE_DURATION) < 1e-6 && clip.duration > 7 && clip.duration < 10);
const after = []; root.traverse((o) => after.push(o.position.clone(), o.quaternion.clone()));
chk("building it leaves the skeleton exactly as it was", before.every((v, i) => v.distanceTo ? v.distanceTo(after[i]) < 1e-9 : v.angleTo(after[i]) < 1e-9));
chk("it animates the spine, head, hips and both arms", ["Hips", "Spine", "Spine1", "Spine2", "Head", "LeftArm", "LeftForeArm", "RightArm", "RightForeArm"].every((n) => clip.tracks.some((t) => t.name === `mixamorig${n}.quaternion`)));
chk("it never touches the legs (they stay under the idle clip's control)", !clip.tracks.some((t) => /Leg|Foot|Toe/.test(t.name)));
const q = clip.tracks.find((t) => t.name === "mixamorigLeftArm.quaternion").values;
chk("every quaternion is finite and unit length", Array.from({ length: q.length / 4 }, (_, i) => Math.hypot(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3])).every((l) => Math.abs(l - 1) < 1e-5));
const last = clip.tracks.find((t) => t.name === "mixamorigHips.position").values, n = last.length;
chk("hips come back to their rest height at the end (no pop into idle)", Math.abs(last[n - 2] - 0.996) < 1e-4 && Math.abs(last[1] - 0.996) < 1e-4);
chk("a skeleton missing a needed bone gets no clip instead of an error", buildIdleEmoteClip(new THREE.Group()) === null);
chk("the manifest maps the game name to the clip", resolveClip([clip], "idleEmote") === clip && ANIMATIONS.idleEmote.includes(EMOTE_CLIP));

// ---- the animator: play once, blend back into idle by itself
const idle = new THREE.AnimationClip("idle", 2, [new THREE.NumberKeyframeTrack("mixamorigHips.position[y]", [0, 2], [0.996, 0.996])]), walk = new THREE.AnimationClip("walk", 1, [new THREE.NumberKeyframeTrack("mixamorigHips.position[y]", [0, 1], [0.99, 0.99])]);
const sk = skeleton(), an = createAnimator(sk.root, [idle, walk, buildIdleEmoteClip(sk.root)]);
an.play("idle"); an.update(0.1);
let done = null; const started = an.playOnce("idleEmote", { onDone: (f) => (done = f) });
chk("playOnce starts the emote", started && an.current === "idleEmote" && an.playingOnce);
for (let t = 0; t < EMOTE_DURATION - 0.6; t += 1 / 60) an.update(1 / 60);
chk("it is still playing before the end", done === null && an.current === "idleEmote");
for (let t = 0; t < 0.7; t += 1 / 60) an.update(1 / 60);
chk("it blends back to idle by itself and reports it finished", done === true && an.current === "idle" && !an.playingOnce);
for (let t = 0; t < 1; t += 1 / 60) an.update(1 / 60);
chk("it can be played again after finishing", an.playOnce("idleEmote") && an.current === "idleEmote");
an.update(1);
let cut = null; an.stopOnce("idle");
chk("stopOnce returns to idle", an.current === "idle" && !an.playingOnce);
an.playOnce("idleEmote", { onDone: (f) => (cut = f) }); an.update(1); an.play("walk");
chk("walking while emoting cuts it short (onDone(false)) and plays walk", cut === false && an.current === "walk" && !an.playingOnce);
chk("playOnce on a model without the clip returns false", createAnimator(new THREE.Group(), [idle]).playOnce("idleEmote") === false);
{ const a2 = createAnimator(new THREE.Group(), [idle]); a2.play("idle"); a2.stopOnce(); chk("stopOnce with nothing running is harmless", a2.current === "idle"); }

console.log(bad ? `\n${bad} check(s) failed` : "\nall checks passed"); process.exit(bad ? 1 : 0);
