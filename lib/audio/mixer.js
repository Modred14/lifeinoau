// lib/audio/mixer.js
// The volume knobs for the world's sound (engines, horns, traffic, town, radio) and the master over everything. Plain module state + subscribe, like lib/sound.js,
// so the audio code, the Settings app and the radio panel all read and write the same store. Pure apart from localStorage (guarded): it also runs in the tests.
//
// The SAVED copy of these lives in the player's settings on the server (lib/settings.js: audio.*), applied by lib/prefs.js through applyMixFromPrefs().
// Changes made from the car (the radio's volume slider) are kept on this device only, the same way the quick mute button is: the Settings screen stays the saved copy.
import { useSyncExternalStore } from "react";

export const MIX_DEFAULTS = Object.freeze({
  masterVolume: 100, engineVolume: 100, hornVolume: 100, trafficVolume: 100, townVolume: 100, radioVolume: 80,
  masterMute: false, engineMute: false, hornMute: false, trafficMute: false, townMute: false,
  hornStyle: "auto",
});
export const HORN_STYLES = ["auto", "standard", "deep", "bright", "air"];
const KEY = "lifeinoau:mix";
const pct = (v, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : d);
const clean = (j) => {
  const o = j && typeof j === "object" ? j : {}, out = {};
  for (const [k, d] of Object.entries(MIX_DEFAULTS)) out[k] = typeof d === "number" ? pct(o[k], d) : typeof d === "boolean" ? (typeof o[k] === "boolean" ? o[k] : d) : HORN_STYLES.includes(o[k]) ? o[k] : d;
  return Object.freeze(out);
};

let mix = MIX_DEFAULTS, loaded = false;
const subs = new Set();
const emit = () => { for (const f of subs) f(); };
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { mix = clean(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch { mix = MIX_DEFAULTS; }
}
export const getMix = () => { load(); return mix; };
export const subscribeMix = (f) => { subs.add(f); return () => subs.delete(f); };
export const useMix = () => useSyncExternalStore(subscribeMix, getMix, () => MIX_DEFAULTS);

/** setMix({ radioVolume: 40 }). Saved on this device. */
export function setMix(patch, { save = true } = {}) {
  load();
  const next = clean({ ...mix, ...patch });
  if (Object.keys(next).every((k) => next[k] === mix[k])) return;
  mix = next;
  if (save) { try { localStorage.setItem(KEY, JSON.stringify(mix)); } catch { /* private mode: it just won't be remembered */ } }
  emit();
}
/** The player's saved audio settings (server copy) become the live mix. */
export function applyMixFromPrefs(audio) { if (audio) setMix(audio, { save: true }); }

/** The level (0..1) of one channel: "master" | "engine" | "horn" | "traffic" | "town" | "radio". Muting the master, or the channel, gives 0. */
export function channel(name, m = getMix()) {
  const master = m.masterMute ? 0 : m.masterVolume / 100;
  if (name === "master") return master;
  if (name === "radio") return master * (m.radioVolume / 100);
  return m[name + "Mute"] ? 0 : master * (m[name + "Volume"] / 100);
}
