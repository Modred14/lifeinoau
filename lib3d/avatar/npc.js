// lib3d/avatar/npc.js
// NPCs are built by the SAME pipeline as the player (createAvatar: rigged GLB body + skinned hair and outfit parts + physical skin + the shared animation system).
// This file adds only what a crowd needs on top: a reproducible, varied look for each person, the lighter model copies, and a per-frame level-of-detail budget.
import { SKIN_TONES, COLORS, HAIR, OUTFITS } from "../../lib/look.js";
import { createAvatar } from "./loadAvatar.js";
import { dressPolice } from "./policeGear.js";

/** Small seeded random generator (mulberry32), so the same seed always gives the same person. */
export const rng = (seed) => { let a = hashSeed(seed); return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
export const hashSeed = (s) => { if (typeof s === "number") return s | 0; let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h | 0; };
const pickW = (r, table) => { let x = r() * table.reduce((a, [, w]) => a + w, 0); for (const [v, w] of table) if ((x -= w) < 0) return v; return table[0][0]; };
const pick = (r, list) => list[Math.floor(r() * list.length)];
const jitter = (hex, r, amt) => { const c = hex.replace("#", ""), n = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)), k = 1 + (r() - 0.5) * 2 * amt, w = (r() - 0.5) * 8; return "#" + n.map((v, i) => Math.max(0, Math.min(255, Math.round(v * k + (i === 0 ? w : i === 2 ? -w : 0)))).toString(16).padStart(2, "0")).join(""); };

// The styles the crowd has always used. The player-only additions to lib/look.js (long hair for women, braids for men) are left out so the same seed keeps giving the same person.
const CROWD_HAIR = { F: HAIR.F.filter((h) => h !== "long"), M: HAIR.M.filter((h) => h !== "braids") };

// What people at OAU wear. Tops are any colour; bottoms are the usual jeans, chinos and trousers.
const TOPS = ["white", "cream", "black", "charcoal", "grey", "navy", "blue", "sky", "teal", "green", "olive", "khaki", "yellow", "orange", "red", "maroon", "pink", "purple", "brown"];
const BOTTOMS = ["navy", "blue", "blue", "khaki", "black", "charcoal", "olive", "brown", "cream", "maroon", "grey"];
const SMART_TOPS = ["white", "sky", "cream", "blue", "grey", "navy", "pink", "teal"], SMART_BOTTOMS = ["black", "charcoal", "navy", "grey"];
const ROLES = {
  student: { outfit: [["campus", 40], ["casual", 50], ["office", 4], ["owambe", 6]], age: 0 },
  staff: { outfit: [["office", 100]], age: 1 }, // lecturers, administrators
  celebrant: { outfit: [["owambe", 100]], age: 0 },
  officer: { outfit: [["sitework", 100]], age: 1 }, // N-QRS officers: navy uniform and vest, cap and duty belt (policeGear.js)
};

/**
 * A person, described: { gender, look, colors, skinHex, bodyWidth, headScale, heightJitter, role }.
 * `look` is an ordinary look from lib/look.js (so it goes through exactly what the player's does); the rest are NPC-only touches that give each person their own build and head.
 * Options: gender "M"|"F" (random if omitted), role (see ROLES), anything in `force` overrides the generated value.
 */
export function npcSpec(seed, { gender, role = "student", force = {} } = {}) {
  const r = rng(seed), g = gender ?? (r() < 0.5 ? "M" : "F"), R = ROLES[role] ?? ROLES.student;
  const skin = pickW(r, [["amber", 13], ["caramel", 24], ["chestnut", 26], ["mahogany", 19], ["espresso", 12], ["ebony", 6]]);
  const outfit = pickW(r, R.outfit), smart = outfit === "office" || outfit === "owambe";
  // hair: women have the full set; men use their four. Staff keep it neat.
  const hairPool = g === "F" ? (role === "officer" ? ["lowcut", "classic", "braids"] : R.age ? ["classic", "lowcut", "bun", "gele", "braids"] : CROWD_HAIR.F) : (R.age ? ["lowcut", "classic"] : CROWD_HAIR.M);
  const hair = pickW(r, hairPool.map((h) => [h, g === "M" && h === "lowcut" ? 3 : g === "F" && (h === "braids" || h === "ponytail" || h === "afro") ? 2 : 1]));
  const height = pickW(r, [["short", 25], ["average", 50], ["tall", 25]]), build = pickW(r, [["slim", 40], ["average", 40], ["athletic", 20]]);
  const top = pick(r, smart ? SMART_TOPS : TOPS), bottom = pick(r, smart ? SMART_BOTTOMS : BOTTOMS);
  let colors = null;
  if (role === "officer") colors = { top: "#26385c", bottom: "#151c2e", topDark: "#1d2b47" }; // N-QRS patrol uniform: navy shirt, a slightly lighter tactical vest, dark trousers (policeGear.js adds the cap, belt and badge)
  const width = (build === "slim" ? 0.95 : build === "athletic" ? 1.06 : 1) * (0.96 + r() * 0.08) * (g === "F" ? 0.96 : 1) * (R.age ? 1.03 : 1);
  const spec = {
    gender: g, role, look: { skin, hair, outfit, top, bottom, build, height, acc: [] }, colors,
    skinHex: jitter(SKIN_TONES[skin], r, 0.06), bodyWidth: +width.toFixed(3),
    headScale: [0.96 + r() * 0.09, 0.96 + r() * 0.08, 0.95 + r() * 0.09], heightJitter: 0.985 + r() * 0.035,
  };
  return { ...spec, ...force, look: { ...spec.look, ...(force.look ?? {}) } };
}

/**
 * Creates an NPC from a spec (or a seed). Resolves with the same avatar object the player gets
 * ({ root, height, update, play, has, setSpeed, emote, setExpression, dispose ... }) plus `.spec` and `.tick()` (see below).
 * Uses the lighter model copies; falls back to the full ones if they are not installed.
 */
export async function createNpc(specOrSeed, opts = {}) {
  const spec = typeof specOrSeed === "object" ? specOrSeed : npcSpec(specOrSeed, opts);
  const av = await createAvatar(spec.look, spec.gender, { lod: opts.lod !== false, npc: true, bodyWidth: spec.bodyWidth, colors: spec.colors, skinHex: spec.skinHex });
  av.spec = spec;
  if (spec.role === "officer") dressPolice(av); // cap, badge, epaulettes, radio and duty belt
  if (av.kind === "glb") {
    const head = av.bone("Head"); if (head) head.scale.set(...spec.headScale); // a slightly different head shape for each person
    av.root.scale.multiplyScalar(spec.heightJitter ?? 1); av.height *= spec.heightJitter ?? 1;
  }
  av.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.npcMesh = true; } });
  let acc = 0, frame = (Math.random() * 4) | 0;
  /**
   * Level of detail by distance to the camera (metres). Near: animated every frame with shadows. Middle: animated at half rate, no shadows.
   * Far: a quarter of the rate; beyond `hideAt` not drawn and not animated at all. Returns true if the NPC is being drawn.
   */
  av.tick = (t, dt, dist = 0, { shadowAt = 28, halfAt = 45, hideAt = 130 } = {}) => {
    const on = dist < hideAt;
    if (av.root.visible !== on) av.root.visible = on;
    if (!on) { acc = 0; return false; }
    const sh = dist < shadowAt; if (av._sh !== sh) { av._sh = sh; av.root.traverse((o) => { if (o.userData.npcMesh) o.castShadow = sh; }); }
    acc += dt; frame++;
    const every = dist < halfAt ? 1 : dist < 90 ? 2 : 4;
    if (frame % every === 0) { av.update(t, acc); acc = 0; }
    return true;
  };
  return av;
}
export { OUTFITS, COLORS };
const LECTURER_SHIRTS = ["#4a6b8a", "#6b4a2e", "#3d6b55", "#7a5a8a", "#8a7a3c", "#5a6f93"];
/**
 * The person a named lecturer is: the SAME spec wherever they appear (the fight scene and the lecture room they teach in), derived from their name alone.
 * `difficulty` above 1.3 makes the big, red-shirted one.
 */
export function lecturerSpec(name, difficulty = 1) {
  const h = hashSeed(String(name)) >>> 0, skins = Object.keys(SKIN_TONES), skin = skins[h % skins.length], big = difficulty > 1.3;
  return npcSpec("lecturer:" + name, { gender: "M", role: "staff", force: { bodyWidth: big ? 1.14 : 1.05, colors: { top: big ? "#7a1f33" : LECTURER_SHIRTS[h % LECTURER_SHIRTS.length], bottom: "#23262d" }, look: { skin, hair: "lowcut" } } });
}