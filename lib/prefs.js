// lib/prefs.js
// The player's preferences on this device: one small store, read by every screen that obeys a preference (usePrefs / getPrefs),
// and the one place that turns a preference into something real: accessibility switches on <html>, the sound engine, the camera a building opens with.
// The saved copy lives on the server (Character.settings, see lib/settings.js), so it follows the player to any device. The last copy is also kept in this
// browser, only so the page can look right (large text, no motion) before the server has answered.
import { useSyncExternalStore } from "react";
import { SETTING_DEFAULTS, cleanSettings, settingsOf } from "./settings.js";
import { setSoundSettings } from "./sound.js";
import { onReset } from "./optimistic.js";

const KEY = "lifeinoau:prefs";
let current = SETTING_DEFAULTS;
let inited = false, appliedFrom = null;
const subs = new Set();

function readCache() {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? "null"); return j ? cleanSettings(j) : SETTING_DEFAULTS; } catch { return SETTING_DEFAULTS; }
}

/** Put the accessibility choices on <html>. prefs.css reads these attributes. */
function paint(p) {
  if (typeof document === "undefined") return;
  const h = document.documentElement, a = p.accessibility;
  const set = (name, on) => (on ? h.setAttribute(name, "") : h.removeAttribute(name));
  set("data-reduce-motion", a.reduceMotion); set("data-large-text", a.largeText); set("data-high-contrast", a.highContrast); set("data-hide-name-tags", !p.gameplay.nameTags);
  set("data-left-handed", p.gameplay.leftHanded); set("data-hide-hints", !p.gameplay.controlHints);
}

/** Make `settings` the live preferences: store, page, sound. `cache` keeps a copy in this browser. */
export function applyPrefs(settings, { cache = true } = {}) {
  const next = cleanSettings(settings);
  current = next; paint(next);
  const au = next.audio; setSoundSettings({ music: au.music, sfx: au.sfx, musicVolume: au.musicVolume, sfxVolume: au.sfxVolume });
  if (cache) { try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* private mode: only this page remembers */ } }
  subs.forEach((f) => f());
}

/** Start once (Shell): show the cached look at once, and forget everything when someone logs out, so the next player on this device starts clean. */
export function initPrefs() {
  if (inited || typeof window === "undefined") return;
  inited = true;
  current = readCache(); paint(current); subs.forEach((f) => f());
  onReset(() => { appliedFrom = null; try { localStorage.removeItem(KEY); } catch { /* nothing to forget */ } applyPrefs(SETTING_DEFAULTS, { cache: false }); });
}

/** Called with the player's character every time the game state arrives. The saved preferences are applied when they are new to this page (first load, or changed
 *  on another device); in between, a quick mute from the sound button is left alone. */
export function syncPrefsFrom(character) {
  if (!character) return;
  const s = settingsOf(character), k = JSON.stringify(s);
  if (k === appliedFrom) return;
  appliedFrom = k; applyPrefs(s);
}

export const getPrefs = () => current;
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export const usePrefs = () => useSyncExternalStore(subscribe, getPrefs, () => SETTING_DEFAULTS);
