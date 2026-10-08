// lib3d/avatar/loadAvatar.js
// One entry point for every character in the game (the player, NPCs, the creator preview).
// It uses a rigged GLB body when one is installed and otherwise the built-in character, and both give the same API.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { SKIN_TONES, cleanLook } from "../../lib/look.js";
import { buildCharacter } from "../character.js";
import { BASES, ANIM_LIBRARY, REQUIRED_BONES, BODY_MORPHS, ATTACH_BONES, partUrl, boneKey } from "./manifest.js";
import { createAnimator, createFace } from "./animation.js";

const loader = new GLTFLoader(), gltfCache = new Map(), exists = new Map();
const HEIGHT = { short: 0.95, average: 1, tall: 1.06 };

/** True if the URL answers 200. Remembered, so a missing model is only asked for once per session. */
async function available(url) {
  if (!exists.has(url)) exists.set(url, fetch(url, { method: "HEAD" }).then((r) => r.ok && !/text\/html/.test(r.headers.get("content-type") ?? "")).catch(() => false));
  return exists.get(url);
}
const loadGltf = (url) => { if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url)); return gltfCache.get(url); };

/** Bones from REQUIRED_BONES that a model is missing (empty array = the skeleton is valid). */
export function missingBones(root) {
  const have = new Set(); root.traverse((o) => { if (o.isBone) have.add(boneKey(o.name)); });
  return REQUIRED_BONES.filter((b) => !have.has(b));
}

/** Colours the skin materials (any material whose name contains "skin") with the chosen tone. The base albedo should be a light neutral so the tint reads correctly. */
function tintSkin(root, hex) {
  root.traverse((o) => { if (!o.isMesh) return; const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => { if (!/skin/i.test(m.name)) return m; const c = m.clone(); c.color.set(hex); return c; }); o.material = Array.isArray(o.material) ? out : out[0]; });
}

/** Joins a skinned part (hair, jacket, trousers) to the base skeleton by bone name. Returns the meshes it added, or [] if the part does not fit. */
export function attachSkinnedPart(base, partScene) {
  const bones = new Map(); base.traverse((o) => { if (o.isBone) bones.set(boneKey(o.name), o); });
  const added = [];
  partScene.updateMatrixWorld(true);
  partScene.traverse((o) => { if (!o.isSkinnedMesh) return;
    const mapped = o.skeleton.bones.map((b) => bones.get(boneKey(b.name)));
    if (mapped.some((b) => !b)) { console.warn("avatar part does not match the skeleton:", o.name); return; }
    added.push([o, new THREE.Skeleton(mapped, o.skeleton.boneInverses)]); });
  for (const [mesh, skel] of added) { mesh.removeFromParent(); mesh.bind(skel, mesh.bindMatrix); mesh.frustumCulled = false; base.add(mesh); }
  return added.map(([m]) => m);
}

/** Parents a plain (non-skinned) accessory to a bone, e.g. a watch to the left hand. */
export function attachToBone(base, object, boneName) {
  let bone = null; base.traverse((o) => { if (o.isBone && boneKey(o.name) === boneName) bone = o; });
  if (!bone) return false; bone.add(object); return true;
}

async function loadModel(look, gender) {
  const url = BASES[gender]; if (!(await available(url))) return null;
  const gltf = await loadGltf(url), root = SkeletonUtils.clone(gltf.scene), problems = missingBones(root);
  if (problems.length) { console.warn("avatar base is missing bones:", problems.join(", ")); return null; }
  tintSkin(root, SKIN_TONES[look.skin]);
  const clips = [...gltf.animations]; if (await available(ANIM_LIBRARY)) clips.push(...(await loadGltf(ANIM_LIBRARY)).animations);
  // body and height: blend shapes when the model has them, otherwise a plain scale
  root.traverse((o) => { if (!o.isMesh || !o.morphTargetDictionary) return; for (const [k, m] of Object.entries(BODY_MORPHS)) { const i = o.morphTargetDictionary[m]; if (i !== undefined) o.morphTargetInfluences[i] = look.build === k || look.height === k ? 1 : 0; } });
  const raw = new THREE.Box3().setFromObject(root); root.scale.multiplyScalar((1.76 * HEIGHT[look.height]) / Math.max(0.01, raw.max.y - raw.min.y)); // any export unit becomes a 1.76 m adult, like the built-in character
  root.updateMatrixWorld(true);
  // modular parts: each is optional, a missing file is skipped
  const parts = [["hair", look.hair], ["outfit", look.outfit], ...look.acc.map((a) => [a, a])], extra = [];
  for (const [slot, id] of parts) { const u = partUrl(slot, id); if (!(await available(u))) continue;
    const part = SkeletonUtils.clone((await loadGltf(u)).scene), meshes = attachSkinnedPart(root, part);
    if (!meshes.length && ATTACH_BONES[slot]) { attachToBone(root, part, ATTACH_BONES[slot]); extra.push(part); } else extra.push(...meshes); }
  const box = new THREE.Box3().setFromObject(root), animator = createAnimator(root, clips), face = createFace(root);
  animator.play("idle");
  return { kind: "glb", root, height: box.max.y - box.min.y, animator, face, parts: extra.length };
}

/**
 * Creates a character. Always resolves: if no model is installed (or it is broken) it returns the built-in character.
 * The result: { root, kind: "glb"|"procedural", height, update(t, dt), play(name), has(name), animations(), setExpression(name), dispose() }.
 */
export async function createAvatar(lookIn, gender = "F", { preferModel = true } = {}) {
  const look = cleanLook(lookIn, gender);
  if (preferModel) { try { const m = await loadModel(look, gender); if (m) return {
    kind: "glb", root: m.root, height: m.height, update: (t, dt) => { m.animator.update(dt); m.face.update(t, dt); }, play: (n, o) => m.animator.play(n, o), has: (n) => m.animator.has(n),
    animations: () => m.animator.available(), setExpression: (n) => m.face.setExpression(n),
    dispose() { m.animator.dispose(); m.root.traverse((o) => { o.geometry?.dispose?.(); }); } }; } catch (e) { console.warn("avatar model unavailable, using the built-in character:", e); } }
  const c = buildCharacter(look, gender);
  return { kind: "procedural", root: c.root, height: c.height, update: (t) => c.update(t), play: () => false, has: () => false, animations: () => [], setExpression: () => {}, dispose: c.dispose };
}