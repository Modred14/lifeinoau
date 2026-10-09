// lib3d/avatar/manifest.js
// The single place that says where avatar assets live, what the skeleton must contain, and which animation names the game uses.
// Everything here is plain data so it can be read by the loader, by tools and by tests.

export const AVATAR_BASE = "/models/avatars";
/** Rigged base bodies (one skinned mesh set + one skeleton each). Missing files are fine: the game falls back to the built-in character. */
export const BASES = { M: `${AVATAR_BASE}/base_male.glb`, F: `${AVATAR_BASE}/base_female.glb` };
/** Optional shared animation library, authored on the same skeleton. Its clips are added to the base's own clips. */
export const ANIM_LIBRARY = `${AVATAR_BASE}/anim/library.glb`;
/** Modular clothing and hair: /models/avatars/parts/<slot>/<id>_m.glb or <id>_f.glb (they fit each base body), skinned to the same skeleton as the base or attached to a bone. */
export const partUrl = (slot, id, gender = "M") => `${AVATAR_BASE}/parts/${slot}/${id}_${gender === "F" ? "f" : "m"}.glb`;
/** Slots a look must have a part for before the authored model is used (otherwise the built-in character is shown, so nobody appears bare or bald). */
export const REQUIRED_SLOTS = ["hair", "outfit"];

/** Skeleton contract: bone names (without any "mixamorig" or "mixamorig:" prefix) every base and every skinned part must have. */
export const REQUIRED_BONES = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head",
  "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand", "RightShoulder", "RightArm", "RightForeArm", "RightHand",
  "LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase", "RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"];
export const boneKey = (name) => String(name ?? "").replace(/^mixamorig:?/i, "");

/** Bones that non-skinned accessories (watch, cap, bag) are parented to. */
export const ATTACH_BONES = { watch: "LeftHand", bracelet: "RightHand", cap: "Head", glasses: "Head", earrings: "Head", necklace: "Neck" };

/** Which look fields map to which part slot. A part is optional; the character looks right without it. */
export const SLOT_FOR = { hair: "hair", outfit: "outfit", shoes: "shoes" };

/** Morph targets (blend shapes) a base body may provide. Missing ones are ignored. Values are 0..1. */
export const BODY_MORPHS = { slim: "body_slim", athletic: "body_athletic", curvy: "body_curvy", short: "height_short", tall: "height_tall" };
export const FACE_MORPHS = ["browUp", "browDown", "eyeBlink", "eyeWide", "mouthSmile", "mouthOpen", "mouthFrown", "mouthPucker", "cheekPuff", "jawOpen", "noseWide", "lipFull"];

/** Facial expressions as morph weights. */
export const EXPRESSIONS = {
  neutral: {},
  happy: { mouthSmile: 0.8, browUp: 0.2 },
  sad: { mouthFrown: 0.7, browUp: 0.5 },
  angry: { browDown: 0.8, mouthFrown: 0.4 },
  surprised: { eyeWide: 0.8, browUp: 0.7, mouthOpen: 0.5 },
  talking: { mouthOpen: 0.35 },
};

/**
 * Animation names the game calls, and the clip names that can satisfy each one (case-insensitive, "mixamo.com|" prefix ignored).
 * An artist can name clips either way; the first alias present wins. "idle" is also the fallback for anything missing.
 */
export const ANIMATIONS = {
  idle: ["idle", "idle_loop", "standing_idle", "breathing_idle"],
  walk: ["walk", "walking", "walk_loop"],
  run: ["run", "running", "jog", "sprint"],
  sit: ["sit", "sitting", "sit_idle", "seated_idle"],
  stand: ["stand", "standing", "stand_up"],
  jump: ["jump", "jumping"],
  talk: ["talk", "talking", "talking_idle", "agree", "gesture"],
  phone: ["phone", "using_phone", "texting", "phone_idle"],
  eat: ["eat", "eating"],
  drink: ["drink", "drinking"],
  greet: ["greet", "wave", "waving", "hello"],
  gesture: ["gesture", "hand_gesture", "explain", "agree"],
  study: ["study", "reading", "read"],
  type: ["type", "typing"],
  sleep: ["sleep", "sleeping", "lying_down"],
  bike: ["bike", "riding_bike", "cycling"],
  enterVehicle: ["enter_vehicle", "get_in_car", "enter_car"],
  exitVehicle: ["exit_vehicle", "get_out_car", "exit_car"],
  interact: ["interact", "pick_up", "use_object", "press_button"],
  fight: ["fight", "punch", "defend", "self_defense"],
  sad: ["sad", "sad_pose", "sad_idle"],
  no: ["no", "headshake", "head_shake", "disagree"],
};