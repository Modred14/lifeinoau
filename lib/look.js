// lib/look.js
// The choices a player makes for how their character looks. Shared by the browser (3D preview) and the server (validation).
export const SKIN_TONES = { amber: "#b98560", caramel: "#9c6a45", chestnut: "#7f5236", mahogany: "#63402b", espresso: "#4a2e20", ebony: "#33201a" };
export const HAIR = { F: ["braids", "afro", "bun", "ponytail", "long", "locs", "lowcut", "gele", "classic"], M: ["lowcut", "afro", "locs", "braids", "classic"] };
export const OUTFITS = ["casual", "office", "owambe", "sitework"];
export const FABRICS = ["plain", "ankara", "adire", "asooke"];
export const ACCENTS = { gold: "#d9a441", teal: "#1f8a7a", crimson: "#b3283c", indigo: "#2a3f8f", forest: "#2f6b3a", orange: "#d9692b" };
export const LABELS = { lowcut: "Low cut", asooke: "Aso-oke", sitework: "Site work", gele: "Gele" };
export const label = (k) => LABELS[k] ?? k[0].toUpperCase() + k.slice(1);

export const defaultLook = (gender) => ({ skin: "chestnut", hair: gender === "F" ? "braids" : "lowcut", outfit: gender === "F" ? "owambe" : "casual", fabric: "ankara", accent: "gold" });

/** Never trust a look from the browser: anything unknown falls back to a safe default. */
export function cleanLook(look, gender) {
  const g = gender === "F" ? "F" : "M", l = look && typeof look === "object" ? look : {}, d = defaultLook(g);
  const pick = (v, list, def) => (list.includes(v) ? v : def);
  return { skin: pick(l.skin, Object.keys(SKIN_TONES), d.skin), hair: pick(l.hair, HAIR[g], d.hair), outfit: pick(l.outfit, OUTFITS, d.outfit),
    fabric: pick(l.fabric, FABRICS, d.fabric), accent: pick(l.accent, Object.keys(ACCENTS), d.accent) };
}