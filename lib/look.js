// lib/look.js
// The choices a player makes for how their character looks. Shared by the browser (3D preview) and the server (validation).
export const SKIN_TONES = { amber: "#b98560", caramel: "#9c6a45", chestnut: "#7f5236", mahogany: "#63402b", espresso: "#4a2e20", ebony: "#33201a" };
// Every style listed here has a model for that gender in public/models/avatars/parts/hair (tests/avatar-pipeline.test.mjs checks it), and the built-in character can draw it too.
export const HAIR = { F: ["braids", "afro", "bun", "ponytail", "long", "locs", "lowcut", "gele", "classic"], M: ["lowcut", "afro", "locs", "braids", "classic"] };
import { cleanWear, wearKey } from "./wardrobe.js";
export const OUTFITS = ["campus", "casual", "office", "owambe", "sitework"];
export const BUILDS = ["slim", "average", "athletic"];
export const HEIGHTS = ["short", "average", "tall"];
// Accessories a character can wear. Each gender has its own list (a backpack and watch for him; a shoulder bag, necklace and bracelet for her in the base designs).
export const ACCESSORIES = { M: ["backpack", "watch", "chain", "cap"], F: ["bag", "necklace", "bracelet", "earrings"] };
// Colours for the two clothing pickers: one recolours the shirt/top, the other the trousers/skirt, whatever outfit is worn.
export const COLORS = { white: "#f2f2ee", cream: "#e6d9b8", black: "#1d1f23", charcoal: "#3b4048", grey: "#80868f", navy: "#1f2f55", blue: "#2f62c4", sky: "#7fb2e5", teal: "#1f8a7a",
  green: "#2f7a45", olive: "#6b6f3a", khaki: "#a8946a", yellow: "#e3b83a", orange: "#dd6b27", red: "#c0312f", maroon: "#7a1f33", pink: "#e58aa8", purple: "#6b3fa0", brown: "#6a4429" };
export const LABELS = { campus: "Campus", lowcut: "Low cut", sitework: "Site work", gele: "Gele" };
export const label = (k) => LABELS[k] ?? k[0].toUpperCase() + k.slice(1);

export const defaultLook = (gender) => ({ skin: "chestnut", hair: gender === "F" ? "braids" : "lowcut", outfit: "campus", top: "navy", bottom: gender === "F" ? "blue" : "khaki", build: "slim", height: "average", acc: gender === "F" ? ["bag", "necklace", "bracelet"] : ["backpack", "watch"] });

/** Never trust a look from the browser: anything unknown falls back to a safe default. */
export function cleanLook(look, gender) {
  const g = gender === "F" ? "F" : "M", l = look && typeof look === "object" ? look : {}, d = defaultLook(g);
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  return { skin: pick(l.skin, Object.keys(SKIN_TONES), d.skin), hair: pick(l.hair, HAIR[g], d.hair), outfit: pick(l.outfit, OUTFITS, d.outfit),
    top: pick(l.top, Object.keys(COLORS), d.top), bottom: pick(l.bottom, Object.keys(COLORS), d.bottom),
    build: pick(l.build, BUILDS, d.build), height: pick(l.height, HEIGHTS, d.height),
    acc: Array.isArray(l.acc) ? [...new Set(l.acc.filter((a) => ACCESSORIES[g].includes(a)))] : d.acc,
    ...(cleanWear(l.wear, g) ? { wear: cleanWear(l.wear, g) } : {}) }; // store clothes: only a complete, valid outfit for this body is kept (lib/wardrobe.js); otherwise the starter outfit is drawn
}

/** The same look without any store clothes (the starter outfit). Anything that must not let the browser pick clothes (creating a character) uses this. */
export function withoutWear(look) { const { wear, ...rest } = look ?? {}; return rest; }
/** The clothing part of a stored look: the starter outfit, its colours and the equipped store outfit. Only the Offishall wardrobe may change these. */
export const CLOTHING_FIELDS = ["outfit", "top", "bottom", "wear"];
/** `incoming` (what the browser sent) with every clothing field taken from `stored` instead: Settings can change hair, skin and build but never clothes. */
export function keepClothing(incoming, stored) {
  const base = { ...(incoming && typeof incoming === "object" ? incoming : {}) }, old = stored && typeof stored === "object" ? stored : {};
  for (const k of CLOTHING_FIELDS) { if (k in old) base[k] = old[k]; else delete base[k]; }
  return base;
}

/** A short text that is the same for two looks exactly when they are drawn the same. Screens use it to rebuild a character only when it really changed
 *  (a new object with the same content must not make a person flicker or be built twice). */
export function lookKey(look, gender) {
  const g = gender === "F" ? "F" : "M", l = cleanLook(look, g);
  return JSON.stringify([g, l.skin, l.hair, l.outfit, l.top, l.bottom, l.build, l.height, [...l.acc].sort(), ...(l.wear ? [wearKey(l.wear)] : [])]);
}

// ---- Changing between the male and female presentation ----
// A choice that exists for both genders is kept as it is. One that only exists for the old gender is swapped for its closest match, never reset to a random default.
const HAIR_SWAP = { M: { bun: "classic", ponytail: "braids", long: "locs", gele: "classic" }, F: {} };
const ACC_SWAP = { M: { bag: "backpack", bracelet: "watch", necklace: "chain", earrings: "cap" }, F: { backpack: "bag", watch: "bracelet", chain: "necklace", cap: "earrings" } };

/** The same person for the other presentation: skin, outfit, colours, build and height stay; hair and accessories are kept when the new gender has them, otherwise replaced by the nearest equivalent.
 *  Always returns a look that cleanLook(…, gender) accepts unchanged. */
export function adaptLook(look, gender) {
  const g = gender === "F" ? "F" : "M", l = look && typeof look === "object" ? look : {};
  const hair = HAIR[g].includes(l.hair) ? l.hair : HAIR_SWAP[g][l.hair];
  const acc = Array.isArray(l.acc) ? l.acc.map((a) => (ACCESSORIES[g].includes(a) ? a : ACC_SWAP[g][a])) : undefined;
  return cleanLook({ ...l, hair, acc }, g); // `wear` is kept only when its pieces exist for the new body (cleanLook); owned clothes are never touched, only what is worn changes
}
