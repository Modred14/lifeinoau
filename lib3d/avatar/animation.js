// lib3d/avatar/animation.js
// Plays named animations on a rigged character: maps the game's names to whatever clips the model has, cross-fades between them, and drives facial expressions.
import * as THREE from "three";
import { ANIMATIONS, EXPRESSIONS } from "./manifest.js";

const norm = (n) => String(n ?? "").replace(/^.*\|/, "").trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Finds the clip for a game animation name, or null. Accepts the canonical name itself or any alias. */
export function resolveClip(clips, name) {
  const byName = new Map(clips.map((c) => [norm(c.name), c]));
  for (const k of [norm(name), ...(ANIMATIONS[name] ?? [])]) if (byName.has(norm(k))) return byName.get(norm(k));
  return null;
}

/** Which game animation names this set of clips can play. */
export const availableAnimations = (clips) => Object.keys(ANIMATIONS).filter((n) => resolveClip(clips, n));

export function createAnimator(root, clips) {
  const mixer = new THREE.AnimationMixer(root), actions = new Map(); let current = null, currentName = null;
  const actionFor = (clip) => { if (!actions.has(clip)) actions.set(clip, mixer.clipAction(clip)); return actions.get(clip); };
  /** Plays a named animation with a cross-fade. Returns false (and keeps the current one) if the model has no such clip. */
  function play(name, { fade = 0.3, once = false } = {}) {
    const clip = resolveClip(clips, name); if (!clip) return false;
    const next = actionFor(clip); if (next === current) return true;
    next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); next.clampWhenFinished = once; next.enabled = true; next.fadeIn(fade).play();
    if (current) current.fadeOut(fade); current = next; currentName = name; return true;
  }
  return { play, has: (n) => !!resolveClip(clips, n), available: () => availableAnimations(clips), get current() { return currentName; }, update: (dt) => mixer.update(dt),
    dispose() { mixer.stopAllAction(); mixer.uncacheRoot(root); } };
}

/** Facial expressions and blinking through morph targets. Does nothing if the model has no morphs. */
export function createFace(root) {
  const meshes = []; root.traverse((o) => { if (o.isMesh && o.morphTargetDictionary) meshes.push(o); });
  const has = (m) => meshes.some((x) => m in x.morphTargetDictionary), target = {}, now = {}; let blinkAt = 2 + Math.random() * 3, blink = 0;
  const set = (m, v) => meshes.forEach((x) => { const i = x.morphTargetDictionary[m]; if (i !== undefined) x.morphTargetInfluences[i] = v; });
  return {
    usable: meshes.length > 0,
    /** Smoothly moves to a named expression ("happy", "sad", ...). Unknown names fall back to neutral. */
    setExpression(name) { for (const k of Object.keys(now)) target[k] = 0; Object.assign(target, EXPRESSIONS[name] ?? EXPRESSIONS.neutral); },
    update(t, dt) { if (!meshes.length) return;
      for (const k of new Set([...Object.keys(now), ...Object.keys(target)])) { const v = (now[k] ?? 0) + ((target[k] ?? 0) - (now[k] ?? 0)) * Math.min(1, dt * 8); now[k] = v; if (has(k)) set(k, v); }
      if (has("eyeBlink")) { if (t > blinkAt) { blink = 0.14; blinkAt = t + 2.5 + Math.random() * 3.5; } blink = Math.max(0, blink - dt); set("eyeBlink", blink > 0 ? 1 : now.eyeBlink ?? 0); } },
  };
}