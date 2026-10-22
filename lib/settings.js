// lib/settings.js
// The player's saved preferences. ONE definition shared by the browser (the Settings screen, the places that obey a preference) and the server (validation).
// Stored in Character.settings (JSON). A missing or damaged value simply means "the defaults", so old player records need no migration of their data.
export const SETTING_DEFAULTS = Object.freeze({
  audio: { music: true, sfx: true, musicVolume: 100, sfxVolume: 100 }, // volumes are 0-100 (percent of the game's normal level)
  gameplay: { interiorView: "follow", nameTags: true }, // the camera you start with inside a building; whether other players' name tags are drawn
  notifications: { achievements: true, alertSound: true }, // pop-ups for awards; the chime that comes with a game alert
  privacy: { showRelationship: true, searchable: true }, // your relationship status on your public profile; appearing in player search
  accessibility: { reduceMotion: false, largeText: false, highContrast: false, autoSpin: true }, // autoSpin: the character preview turns by itself
});

const ENUMS = { "gameplay.interiorView": ["follow", "overhead"] };
const RANGES = { "audio.musicVolume": [0, 100], "audio.sfxVolume": [0, 100] };

/** Merge a (possibly partial, possibly hostile) settings object onto `base`. Unknown groups and keys are dropped, wrong types are ignored, numbers are clamped. */
export function cleanSettings(input, base = SETTING_DEFAULTS) {
  const out = {}, src = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  for (const [group, defs] of Object.entries(SETTING_DEFAULTS)) {
    out[group] = {};
    const have = src[group] && typeof src[group] === "object" && !Array.isArray(src[group]) ? src[group] : {};
    for (const [key, def] of Object.entries(defs)) {
      const path = group + "." + key, v = have[key], prev = base?.[group]?.[key] ?? def;
      if (typeof def === "boolean") out[group][key] = typeof v === "boolean" ? v : typeof prev === "boolean" ? prev : def;
      else if (typeof def === "number") { const [lo, hi] = RANGES[path]; out[group][key] = typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : typeof prev === "number" ? prev : def; }
      else out[group][key] = ENUMS[path]?.includes(v) ? v : ENUMS[path]?.includes(prev) ? prev : def;
    }
  }
  return out;
}

/** What is stored on a character row, read safely (null, old or damaged values give the defaults). */
export const settingsOf = (row) => cleanSettings(row?.settings ?? null, SETTING_DEFAULTS);
/** True if two settings objects mean the same thing. */
export const sameSettings = (a, b) => JSON.stringify(cleanSettings(a)) === JSON.stringify(cleanSettings(b));
