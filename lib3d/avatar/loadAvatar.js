// lib3d/avatar/loadAvatar.js
// One entry point for every character in the game (the player, NPCs, the creator preview).
// It uses a rigged GLB body when one is installed and otherwise the built-in character, and both give the same API.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { SKIN_TONES, COLORS, cleanLook } from "../../lib/look.js";
import { checkWear, legacyFields, FINISHES } from "../../lib/wardrobe.js";
import { keepMask, applyFinish } from "./garments.js";
import { buildCharacter } from "../character.js";
import {
  BASES,
  ANIM_LIBRARY,
  REQUIRED_BONES,
  REQUIRED_SLOTS,
  BODY_MORPHS,
  ATTACH_BONES,
  partUrl,
  lodUrl,
  boneKey,
} from "./manifest.js";
import { createAnimator, createFace, resolveClip } from "./animation.js";
import { buildIdleEmoteClip } from "./idleEmote.js";
import { npcClips } from "./npcClips.js";
import { activityClips } from "./activityClips.js";

const loader = new GLTFLoader(),
  gltfCache = new Map(),
  exists = new Map();
const HEIGHT = { short: 0.95, average: 1, tall: 1.06 };

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Asks the server whether an asset exists. true / false only when the server gave a definite answer (200, or 404 / 410 / an HTML page standing in for a missing file);
 *  null when it could not be asked at all (offline, interrupted, a 5xx). A host that does not answer HEAD is asked for one byte instead. */
async function probe(url) {
  for (let i = 0; i < 2; i++) {
    try {
      let r = await fetch(url, { method: "HEAD" });
      if (r.status === 405 || r.status === 501) r = await fetch(url, { headers: { Range: "bytes=0-0" } });
      if (r.ok || r.status === 206) return !/text\/html/.test(r.headers.get("content-type") ?? "");
      if (r.status === 404 || r.status === 410) return false;
    } catch {
      /* offline or interrupted: ask once more */
    }
    if (i === 0) await wait(300);
  }
  return null;
}

/** The remembered answer of probe(). Only definite answers are remembered: a dropped connection must never make an installed model look "missing" for the rest of the session
 *  (that is what used to leave a player on a different-looking built-in body until they reloaded). */
function status(url) {
  if (!exists.has(url))
    exists.set(
      url,
      probe(url).then((s) => {
        if (s === null) exists.delete(url);
        return s;
      }),
    );
  return exists.get(url);
}
/** True only when the asset is known to be installed. */
const available = async (url) => (await status(url)) === true;

/** Loads a model once and shares it. A failed load is forgotten, so asking again really tries again. */
const loadGltf = (url) => {
  if (!gltfCache.has(url))
    gltfCache.set(
      url,
      loader.loadAsync(url).catch((e) => {
        gltfCache.delete(url);
        throw e;
      }),
    );
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
      p.userData.owned = true; // made for this one character, so it is disposed with it (the loaded model and its textures are shared)
      if (m.normalScale) p.normalScale.copy(m.normalScale);
      return p;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

/** Clothes are recoloured by material name, whatever outfit is worn: "Top_*" takes the shirt colour, "Bottom_*" the trouser/skirt colour, and "TopDark_*" / "BottomDark_*"
 *  a slightly darker shade of the same (cuffs, a shirt under a vest). Trim, shoes, stripes, ties and hair keep their own colour. Materials are cloned because the loaded model is cached. */
const SHADE = { "": 1, dark: 0.72, light: 1.18 };
function tintOutfit(meshes, topHex, bottomHex, darkTopHex = null, finish = null) {
  for (const o of meshes) {
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      const k = /^(top|bottom)(dark|light)?_/i.exec(m.name ?? "");
      if (!k) return m;
      const c = m.clone();
      c.userData.owned = true;
      c.color.set(k[1].toLowerCase() === "top" ? topHex : bottomHex);
      if (darkTopHex && k[1].toLowerCase() === "top" && /^dark$/i.test(k[2] ?? "")) c.color.set(darkTopHex); // NPC uniforms: a shirt of its own colour under the vest
      else c.color.multiplyScalar(SHADE[(k[2] ?? "").toLowerCase()] ?? 1);
      if (finish) applyFinish(c, finish[k[1].toLowerCase()], FINISHES); // store clothes: wool, denim, satin, silk or leather
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

/** Keeps only the garments of an outfit model that a look wants ({ top, bottom }: shoes follow the bottom). Dropped meshes are taken off the character again.
 *  The model itself is shared and cached, so nothing is disposed. Returns the meshes that stay. With no `want` every mesh stays (the whole starter outfit). */
export function keepGarments(meshes, want) {
  if (!want || !meshes.length) return meshes;
  const cy = (m) => { m.geometry.computeBoundingBox?.(); const b = m.geometry.boundingBox; return b ? (b.min.y + b.max.y) / 2 : 0; };
  const mat = (m) => (Array.isArray(m.material) ? m.material[0] : m.material)?.name;
  const mask = keepMask(meshes.map((m) => ({ material: mat(m), cy: cy(m) })), want);
  return meshes.filter((m, i) => { if (!mask[i]) m.removeFromParent(); return mask[i]; });
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

/** The URL to load: the lighter crowd copy when asked for and installed, otherwise the full-detail file. */
async function resolveUrl(url, lod) {
  if (lod) {
    const l = lodUrl(url);
    if (await available(l)) return l;
  }
  return url;
}

/**
 * Builds the rigged character for a look. Resolves with null only when the authored model is DEFINITELY not usable (a required file is not installed, or the
 * skeleton is wrong): the caller then shows the built-in character in the same look. A file that could not be fetched (offline, interrupted) is not "missing":
 * the load throws, and createAvatar tries again instead of quietly swapping the player's body.
 */
async function loadModel(look, gender, opt = {}) {
  // Everything the look needs is asked for at once (a phone on a slow connection used to wait for each file in turn).
  // Store clothes (look.wear): the top and bottom come from the garment meshes of the models they were authored in. No wear = the whole starter outfit model.
  const fit = checkWear(look.wear, gender), fitted = fit.ok ? fit.parts : null;
  const outfitSlots = !fitted ? [["outfit", look.outfit, null]]
    : fitted.top.src === fitted.bottom.src ? [["outfit", fitted.top.src, { top: true, bottom: true }]]
    : [["outfit", fitted.top.src, { top: true, bottom: false }], ["outfit", fitted.bottom.src, { top: false, bottom: true }]];
  const slots = [
    ["hair", look.hair],
    ...outfitSlots,
    ...(look.acc ?? []).map((a) => [a, a]),
  ];
  const [baseUrl, ...found] = await Promise.all([
    resolveUrl(BASES[gender], opt.lod),
    ...slots.map(([slot, id]) => resolveUrl(partUrl(slot, id, gender), opt.lod)),
  ]);
  const states = await Promise.all([baseUrl, ...found].map(status));
  if (states[0] === false) return null; // no body installed
  const wanted = []; // the parts to fit, in the order of the look
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i][0], st = states[i + 1];
    if (REQUIRED_SLOTS.includes(slot)) {
      if (st === false) return null; // a look without its hair or outfit part uses the built-in character
      wanted.push([slot, found[i], slots[i][2] ?? null]); // known to exist, or unknown (then the load below decides)
    } else if (st === true) wanted.push([slot, found[i], null]); // accessories are optional
  }
  const libraryUrl = (await available(ANIM_LIBRARY)) ? ANIM_LIBRARY : null;
  const [gltf, library, ...loadedParts] = await Promise.all([
    loadGltf(baseUrl),
    libraryUrl ? loadGltf(libraryUrl).catch((e) => { console.warn("shared animation library unavailable:", e); return null; }) : null,
    ...wanted.map(([, u]) => loadGltf(u)),
  ]);
  const root = SkeletonUtils.clone(gltf.scene),
    problems = missingBones(root);
  if (problems.length) {
    console.warn("avatar base is missing bones:", problems.join(", "));
    return null;
  }
  tintSkin(root, opt.skinHex ?? SKIN_TONES[look.skin]);
  const clips = [...gltf.animations];
  if (library) clips.push(...library.animations);
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
  // NPCs only: there are no body-shape blend shapes in the models, so a little width makes people differ in build (the player's own build is left as it was)
  if (opt.bodyWidth && opt.bodyWidth !== 1) { root.scale.x *= opt.bodyWidth; root.scale.z *= 1 + (opt.bodyWidth - 1) * 0.8; }
  const target = raw * k;
  root.updateMatrixWorld(true);
  // modular parts (already loaded above): skinned ones join the skeleton, plain accessories are parented to a bone
  const extra = [];
  for (let i = 0; i < wanted.length; i++) {
    const slot = wanted[i][0],
      part = SkeletonUtils.clone(loadedParts[i].scene),
      meshes = keepGarments(attachSkinnedPart(root, part), wanted[i][2]);
    if (!meshes.length && ATTACH_BONES[slot]) {
      attachToBone(root, part, ATTACH_BONES[slot]);
      extra.push(part);
    } else if (!meshes.length && REQUIRED_SLOTS.includes(slot)) {
      console.warn(`avatar ${slot} "${look[slot]}" does not fit the skeleton`);
      return null; // never show a bald or bare authored body: the built-in character in the same look is used instead
    } else extra.push(...meshes);
  }
  softenHair(extra);
  tintOutfit(
    extra,
    opt.colors?.top ?? COLORS[fitted ? fitted.top.color : look.top] ?? COLORS.navy,
    opt.colors?.bottom ?? COLORS[fitted ? fitted.bottom.color : look.bottom] ?? COLORS.khaki,
    opt.colors?.topDark ?? null,
    fitted ? { top: fitted.top.finish, bottom: fitted.bottom.finish } : null,
  );
  if (opt.npc || opt.actor) clips.push(...npcClips(root, gender, clips)); // crowd and player: sit, phone, talk, run ...
  clips.push(...activityClips(root, gender, clips)); // listen, write, type, read, eat, drink, greet, shop, work ... (one per kind of activity)
  if (!resolveClip(clips, "idleEmote")) { // no authored emote installed: build it from the skeleton
    try { const emote = buildIdleEmoteClip(root); if (emote) clips.push(emote); } catch (e) { console.warn("idle emote unavailable:", e); }
  }
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
    owned: true,
  };
}

/**
 * Creates a character. Always resolves: if no model is installed (or it is broken) it returns the built-in character in the SAME look.
 * A model that merely failed to download (offline, interrupted) is retried once before that happens, so a flaky connection does not change how a player looks.
 * The result: { root, kind: "glb"|"procedural", look, gender, height, update(t, dt), play(name), has(name), animations(), setExpression(name), dispose() }.
 * `look` is the cleaned look that was actually built, so every screen that shows a player can be checked against the saved one.
 */
export async function createAvatar(
  lookIn,
  gender = "F",
  { preferModel = true, lod = false, npc = false, actor = true, bodyWidth = 1, colors = null, skinHex = null } = {},
) {
  const g = gender === "F" ? "F" : "M",
    look = cleanLook(lookIn, g);
  if (preferModel) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const m = await loadModel(look, g, { lod, npc, actor, bodyWidth, colors, skinHex });
        if (m) return wrapModel(m, look, g);
        break; // the authored model is definitely not usable for this look: asking again cannot change that
      } catch (e) {
        if (attempt === 0) {
          await wait(500);
          continue;
        }
        console.warn("avatar model unavailable, using the built-in character:", e);
      }
    }
  }
  const c = buildCharacter({ ...look, ...(legacyFields(look.wear, g) ?? {}) }, g); // same outfit and colours as the model would have had
  return {
    kind: "procedural",
    root: c.root,
    look,
    gender: g,
    height: c.height,
    update: (t) => c.update(t),
    play: () => false,
    emote: () => false,
    stopEmote: () => {},
    has: () => false,
    animations: () => [],
    setExpression: () => {},
    dispose: c.dispose,
  };
}

/** The common interface of a rigged character (see createAvatar). */
function wrapModel(m, look, gender) {
  return {
    kind: "glb",
    root: m.root,
    look,
    gender,
    height: m.height,
    update: (t, dt) => {
      m.animator.update(dt);
      m.face.update(t, dt);
    },
    play: (n, o) => m.animator.play(n, o),
    /** Plays the idle emote once and blends back to idle. onDone(finishedByItself). Returns false if this model cannot. */
    emote: (o) => m.animator.playOnce("idleEmote", o),
    stopEmote: () => m.animator.stopOnce("idle"),
    has: (n) => m.animator.has(n),
    setSpeed: (k) => m.animator.setSpeed(k),
    duration: (n) => m.animator.durationOf(n),
    /** A bone of this character's skeleton by name without the rig prefix ("Head", "LeftHand"...), or null. */
    bone: (n) => {
      let b = null;
      m.root.traverse((o) => {
        if (o.isBone && boneKey(o.name) === n) b = o;
      });
      return b;
    },
    animations: () => m.animator.available(),
    setExpression: (n) => m.face.setExpression(n),
    dispose() {
      m.animator.dispose();
      // The geometry and textures are shared with every other copy of the same cached model, so they stay. Only what was made for this one character is freed.
      m.root.traverse((o) => (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x?.userData?.owned && x.dispose()));
    },
  };
}
