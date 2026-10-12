// lib3d/avatar/loadAvatar.js
// One entry point for every character in the game (the player, NPCs, the creator preview).
// It uses a rigged GLB body when one is installed and otherwise the built-in character, and both give the same API.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { SKIN_TONES, COLORS, cleanLook } from "../../lib/look.js";
import { buildCharacter } from "../character.js";
import {
  BASES,
  ANIM_LIBRARY,
  REQUIRED_BONES,
  REQUIRED_SLOTS,
  BODY_MORPHS,
  ATTACH_BONES,
  partUrl,
  boneKey,
} from "./manifest.js";
import { createAnimator, createFace } from "./animation.js";

const loader = new GLTFLoader(),
  gltfCache = new Map(),
  exists = new Map();
const HEIGHT = { short: 0.95, average: 1, tall: 1.06 };

/** True if the URL answers 200. Remembered, so a missing model is only asked for once per session. */
async function available(url) {
  if (!exists.has(url))
    exists.set(
      url,
      fetch(url, { method: "HEAD" })
        .then(
          (r) =>
            r.ok && !/text\/html/.test(r.headers.get("content-type") ?? ""),
        )
        .catch(() => false),
    );
  return exists.get(url);
}
const loadGltf = (url) => {
  if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url));
  return gltfCache.get(url);
};

/** Bones from REQUIRED_BONES that a model is missing (empty array = the skeleton is valid). */
export function missingBones(root) {
  const have = new Set();
  root.traverse((o) => {
    if (o.isBone) have.add(boneKey(o.name));
  });
  return REQUIRED_BONES.filter((b) => !have.has(b));
}

/** Standing height estimated from the skeleton (head joint above the lowest ankle). Bounding boxes of skinned meshes differ between three.js versions, so bones are used instead. */
function skeletonHeight(root) {
  root.updateWorldMatrix(true, true);
  const y = {};
  root.traverse((o) => {
    if (o.isBone) {
      const k = boneKey(o.name);
      if (["Head", "LeftFoot", "RightFoot"].includes(k))
        y[k] = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).y;
    }
  });
  return Math.max(0.01, (y.Head - Math.min(y.LeftFoot, y.RightFoot)) / 0.89);
}

/** Colours the skin materials (any material whose name contains "skin") with the chosen tone. The base albedo is a light neutral so the tint reads correctly.
 *  Skin is rendered as a physical material: the baked roughness map gives oily T-zone / matte cheeks / glossy lips, and a soft sheen gives the velvety rim light real skin has. */
function tintSkin(root, hex) {
  const tone = new THREE.Color(hex),
    sheen = tone.clone().lerp(new THREE.Color(0xffffff), 0.12);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      if (!/skin/i.test(m.name)) return m;
      const p = new THREE.MeshPhysicalMaterial({
        name: m.name,
        map: m.map,
        normalMap: m.normalMap,
        roughnessMap: m.roughnessMap,
        metalnessMap: m.metalnessMap,
        roughness: m.roughness,
        metalness: 0,
        color: tone,
        specularIntensity: 0.5,
        sheen: 0.28,
        sheenRoughness: 0.6,
        sheenColor: sheen,
      });
      if (m.normalScale) p.normalScale.copy(m.normalScale);
      return p;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

/** Clothes are recoloured by material name, whatever outfit is worn: "Top_*" takes the shirt colour, "Bottom_*" the trouser/skirt colour, and "TopDark_*" / "BottomDark_*"
 *  a slightly darker shade of the same (cuffs, a shirt under a vest). Trim, shoes, stripes, ties and hair keep their own colour. Materials are cloned because the loaded model is cached. */
const SHADE = { "": 1, dark: 0.72, light: 1.18 };
function tintOutfit(meshes, topHex, bottomHex) {
  for (const o of meshes) {
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      const k = /^(top|bottom)(dark|light)?_/i.exec(m.name ?? "");
      if (!k) return m;
      const c = m.clone();
      c.color.set(k[1].toLowerCase() === "top" ? topHex : bottomHex);
      c.color.multiplyScalar(SHADE[(k[2] ?? "").toLowerCase()] ?? 1);
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  }
}

/** Hair is authored with a dithered, strand-like hairline (alpha-tested). Alpha-to-coverage turns that into smooth anti-aliased edges. */
function softenHair(meshes) {
  for (const o of meshes) {
    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list)
      if (m.alphaTest > 0) {
        m.alphaToCoverage = true;
        m.needsUpdate = true;
      }
  }
}

/** Joins a skinned part (hair, jacket, trousers) to the base skeleton by bone name. Returns the meshes it added, or [] if the part does not fit. */
export function attachSkinnedPart(base, partScene) {
  const bones = new Map();
  base.traverse((o) => {
    if (o.isBone) bones.set(boneKey(o.name), o);
  });
  const added = [];
  partScene.updateMatrixWorld(true);
  partScene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const mapped = o.skeleton.bones.map((b) => bones.get(boneKey(b.name)));
    if (mapped.some((b) => !b)) {
      console.warn("avatar part does not match the skeleton:", o.name);
      return;
    }
    added.push([o, new THREE.Skeleton(mapped, o.skeleton.boneInverses)]);
  });
  for (const [mesh, skel] of added) {
    mesh.removeFromParent();
    mesh.bind(skel, mesh.bindMatrix);
    mesh.frustumCulled = false;
    base.add(mesh);
  }
  return added.map(([m]) => m);
}

/** Parents a plain (non-skinned) accessory to a bone, e.g. a watch to the left hand. */
export function attachToBone(base, object, boneName) {
  let bone = null;
  base.traverse((o) => {
    if (o.isBone && boneKey(o.name) === boneName) bone = o;
  });
  if (!bone) return false;
  bone.add(object);
  return true;
}

async function loadModel(look, gender) {
  const url = BASES[gender];
  if (!(await available(url))) return null;
  const gltf = await loadGltf(url),
    root = SkeletonUtils.clone(gltf.scene),
    problems = missingBones(root);
  if (problems.length) {
    console.warn("avatar base is missing bones:", problems.join(", "));
    return null;
  }
  tintSkin(root, SKIN_TONES[look.skin]);
  const clips = [...gltf.animations];
  if (await available(ANIM_LIBRARY))
    clips.push(...(await loadGltf(ANIM_LIBRARY)).animations);
  // body and height: blend shapes when the model has them, otherwise a plain scale
  root.traverse((o) => {
    if (!o.isMesh || !o.morphTargetDictionary) return;
    for (const [k, m] of Object.entries(BODY_MORPHS)) {
      const i = o.morphTargetDictionary[m];
      if (i !== undefined)
        o.morphTargetInfluences[i] =
          look.build === k || look.height === k ? 1 : 0;
    }
  });
  // keep the model's own size when it is already in metres (so men and women differ naturally); otherwise rescale any export unit to a 1.76 m adult
  const raw = skeletonHeight(root),
    k =
      raw > 1.4 && raw < 2.1
        ? (HEIGHT[look.height] ?? 1)
        : (1.76 * (HEIGHT[look.height] ?? 1)) / raw;
  root.scale.multiplyScalar(k);
  const target = raw * k;
  root.updateMatrixWorld(true);
  // modular parts: each is optional, a missing file is skipped
  const parts = [
      ["hair", look.hair],
      ["outfit", look.outfit],
      ...(look.acc ?? []).map((a) => [a, a]),
    ],
    extra = [];
  for (const [slot, id] of parts) {
    const u = partUrl(slot, id, gender);
    if (!(await available(u))) {
      if (REQUIRED_SLOTS.includes(slot)) return null;
      continue;
    } // a look without its hair or outfit part uses the built-in character
    const part = SkeletonUtils.clone((await loadGltf(u)).scene),
      meshes = attachSkinnedPart(root, part);
    if (!meshes.length && ATTACH_BONES[slot]) {
      attachToBone(root, part, ATTACH_BONES[slot]);
      extra.push(part);
    } else extra.push(...meshes);
  }
  softenHair(extra);
  tintOutfit(
    extra,
    COLORS[look.top] ?? COLORS.navy,
    COLORS[look.bottom] ?? COLORS.khaki,
  );
  const animator = createAnimator(root, clips),
    face = createFace(root);
  animator.play("idle");
  return {
    kind: "glb",
    root,
    height: target,
    animator,
    face,
    parts: extra.length,
  };
}

/**
 * Creates a character. Always resolves: if no model is installed (or it is broken) it returns the built-in character.
 * The result: { root, kind: "glb"|"procedural", height, update(t, dt), play(name), has(name), animations(), setExpression(name), dispose() }.
 */
export async function createAvatar(
  lookIn,
  gender = "F",
  { preferModel = true } = {},
) {
  const look = cleanLook(lookIn, gender);
  if (preferModel) {
    try {
      const m = await loadModel(look, gender);
      if (m)
        return {
          kind: "glb",
          root: m.root,
          height: m.height,
          update: (t, dt) => {
            m.animator.update(dt);
            m.face.update(t, dt);
          },
          play: (n, o) => m.animator.play(n, o),
          has: (n) => m.animator.has(n),
          animations: () => m.animator.available(),
          setExpression: (n) => m.face.setExpression(n),
          dispose() {
            m.animator.dispose();
            m.root.traverse((o) => {
              o.geometry?.dispose?.();
            });
          },
        };
    } catch (e) {
      console.warn(
        "avatar model unavailable, using the built-in character:",
        e,
      );
    }
  }
  const c = buildCharacter(look, gender);
  return {
    kind: "procedural",
    root: c.root,
    height: c.height,
    update: (t) => c.update(t),
    play: () => false,
    has: () => false,
    animations: () => [],
    setExpression: () => {},
    dispose: c.dispose,
  };
}
