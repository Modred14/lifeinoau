// lib/sound.js
// All sound in the game: the background song and the UI sounds (taps, clicks, chimes).
// Plain module state + subscribe (same idea as lib/toast.js), so any client code can call playSound("tap") with no hook or
// context, and the Settings app reads and writes the same store with useSoundSettings().
// <SoundEngine /> (mounted once in the root layout) calls initSound(), which wires up the page-wide listeners.
//
//   playSound("coin")                       one UI sound (see lib/sfx.js for the list)
//   const stop = playReel(5600)             slot-machine ticks that slow down over 5.6s; stop() cancels them
//   const { music, sfx } = useSoundSettings()
//   setSoundSettings({ music: false })      saved on this device
//
// Taps and clicks need no code: any button or link makes a sound by itself. To change that for one element add
// data-sound="none" (silent) or data-sound="confirm" (any sound name) to it or to a parent.
import { useSyncExternalStore } from "react";
import { makeKit, SOUNDS } from "./sfx.js";

/** The song is a 2:35 cut of the track, 0:50 to 3:25 (see public/audio). It loops. */
export const MUSIC = {
  src: "/audio/jack-in-the-box.mp3",
  title: "Jack In The Box",
  artist: "Stanky Deejay ft. Luzyo Keys",
  volume: 0.4,
};
const SFX_VOLUME = 2.5; // effects are written quiet; this brings them up so they sit clearly on top of the song
const STORAGE_KEY = "lifeinoau:sound";

/* ---------------------------------- settings ---------------------------------- */

const DEFAULTS = Object.freeze({ music: true, sfx: true, musicVolume: 100, sfxVolume: 100 }); // volumes: percent of the normal level
let settings = DEFAULTS; // replaced, never mutated
let loaded = false;
const listeners = new Set();
const emit = () => { for (const l of listeners) l(); };

const pct = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 100);
let ducked = false; // a club DJ is playing: the background song gives way (see duckMusic)
const musicLevel = () => (ducked ? 0 : MUSIC.volume * (settings.musicVolume / 100));
let masterGain = null; // the sound effects' volume knob, once the audio context exists
function read() {
  try {
    const j = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return j && typeof j === "object" ? Object.freeze({ music: j.music !== false, sfx: j.sfx !== false, musicVolume: pct(j.musicVolume), sfxVolume: pct(j.sfxVolume) }) : DEFAULTS;
  } catch {
    return DEFAULTS; // storage blocked or corrupt: fall back to everything on
  }
}
function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  settings = read();
}

export const getSoundSettings = () => { load(); return settings; };
const subscribe = (l) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** { music, sfx } for the Settings app. Re-renders when either changes (also from another tab). */
export const useSoundSettings = () => useSyncExternalStore(subscribe, getSoundSettings, () => DEFAULTS);

/** setSoundSettings({ music: false }) or ({ music: false, sfx: false }). Saved on this device. */
export function setSoundSettings(patch) {
  load();
  const next = Object.freeze({ ...settings, ...patch, ...(patch.musicVolume !== undefined ? { musicVolume: pct(patch.musicVolume) } : {}), ...(patch.sfxVolume !== undefined ? { sfxVolume: pct(patch.sfxVolume) } : {}) });
  if (next.music === settings.music && next.sfx === settings.sfx && next.musicVolume === settings.musicVolume && next.sfxVolume === settings.sfxVolume) return;
  const musicVolumeChanged = next.musicVolume !== settings.musicVolume;
  settings = next;
  if (masterGain) masterGain.gain.setTargetAtTime(SFX_VOLUME * (settings.sfxVolume / 100), ctx.currentTime, 0.015);
  if (el && intent && settings.music && musicVolumeChanged) { clearFade(); el.volume = musicLevel(); } // slider changes take effect immediately, even during a fade
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode: it just won't be remembered */ }
  syncMusic();
  emit();
}

/* ---------------------------------- background music ---------------------------------- */

let el = null;       // the <audio>, created the first time music is wanted
let armed = false;   // the browser has let us play (a tap or key has happened, or autoplay is allowed)
let intent = false;  // we are currently trying to have the song audible
let fade = null;

const clearFade = () => { if (fade) { clearInterval(fade); fade = null; } };
function fadeTo(a, to, ms, done) {
  clearFade();
  const from = a.volume, t0 = performance.now();
  fade = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.min(1, Math.max(0, from + (to - from) * k));
    if (k >= 1) { clearFade(); done?.(); }
  }, 30);
}

function music() {
  if (el || typeof Audio === "undefined") return el;
  el = new Audio(MUSIC.src);
  el.loop = true;
  el.preload = "auto";
  el.volume = 0; // faded up when it starts
  return el;
}

/** A club's DJ (lib/clubDj.js) takes the speakers: the background song fades out while it plays (true) and back in when it stops (false). Safe to call any time. */
export function duckMusic(on) {
  const next = !!on; if (next === ducked) return;
  ducked = next;
  if (typeof window === "undefined") return;
  if (el && intent && settings.music) fadeTo(el, musicLevel(), ducked ? 500 : 900);
}

/** Make the song match the settings: on (after the first tap) and the tab is showing = playing, otherwise paused. Safe to call any time. */
function syncMusic() {
  if (typeof window === "undefined") return;
  const want = armed && settings.music && !document.hidden;
  if (want) {
    const a = music();
    if (!a || (intent && !a.paused)) return;
    intent = true;
    a.play()?.catch((e) => {
      // Browsers refuse to start sound before the first tap. Wait for the next tap and try again.
      if (e?.name === "NotAllowedError") armed = false;
      intent = false;
    });
    fadeTo(a, musicLevel(), 800);
  } else {
    if (!el || (!intent && el.paused)) return;
    intent = false;
    if (document.hidden) { clearFade(); el.pause(); } // leaving the tab: silence at once
    else fadeTo(el, 0, 350, () => el.pause());
  }
}

/* ---------------------------------- sound effects ---------------------------------- */

let ctx = null, kit = null;
let gestured = false; // no sound effects until the person has tapped something (browser rule)
const last = new Map();

function makeCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: "interactive" });
    const master = ctx.createGain();
    master.gain.value = SFX_VOLUME * (settings.sfxVolume / 100);
    masterGain = master;
    const limiter = ctx.createDynamicsCompressor(); // only there to tame several sounds landing at once
    limiter.threshold.value = -12;
    limiter.knee.value = 12;
    limiter.ratio.value = 6;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination);
    kit = makeKit(ctx, master);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Play one UI sound by name. Silent when sound effects are off, before the first tap, or for an unknown name. */
export function playSound(name) {
  if (typeof window === "undefined" || !gestured) return;
  load();
  if (!settings.sfx) return;
  const recipe = SOUNDS[name];
  if (!recipe) return;
  const now = performance.now();
  if (now - (last.get(name) ?? -1e9) < 28) return; // never machine-gun the same sound
  last.set(name, now);
  const c = makeCtx();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  try { recipe(kit); } catch { /* a sound must never break the game */ }
}

/** Slot-machine ticks that start fast and slow down over `ms`. Returns a function that cancels the rest. */
export function playReel(ms = 5600) {
  const timers = [];
  for (let t = 0; t < ms - 250; t += 40 + Math.pow(t / ms, 2.2) * 420) timers.push(setTimeout(() => playSound("reel"), t));
  return () => timers.forEach(clearTimeout);
}

/* ---------------------------------- page-wide listeners ---------------------------------- */

const CLICKABLE = 'button, a[href], [role="button"], [role="tab"], [role="switch"], [role="menuitem"], [role="option"], summary, select, input[type="checkbox"], input[type="radio"]';
const TYPEABLE = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea';

/** Which sound a click should make. null = none. */
function soundFor(target) {
  if (!(target instanceof Element)) return null;
  const tagged = target.closest("[data-sound]");
  if (tagged) { const s = tagged.getAttribute("data-sound"); return s && s !== "none" ? s : null; }
  if (target.classList.contains("ph-sheet-scrim")) return "close"; // tapping outside a sheet
  const hit = target.closest(CLICKABLE);
  if (!hit || hit.matches(':disabled, [aria-disabled="true"]')) return null;
  if (hit.closest(".ph-app")) return "app";
  if (hit.closest(".ph-home")) return "home";
  if (hit.closest(".pa-back, .ms-back")) return "back";
  if (hit.closest(".ph-close")) return "close";
  if (hit.closest(".go")) return "confirm";
  if (hit.closest(".danger")) return "warn";
  if (hit.closest(".nav")) return "nav";
  if (hit.closest('[role="tab"], .ms-chips, .tabs, select, input')) return "tick";
  return "tap";
}

let started = false;
/** Wire up the page-wide listeners. Called once by <SoundEngine />. Returns the cleanup. */
export function initSound() {
  if (typeof window === "undefined" || started) return () => {};
  started = true;
  load();
  const offs = [];
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); offs.push(() => target.removeEventListener(type, fn, opts)); };
  const opts = { capture: true, passive: true };

  // The first tap or key press is what lets the browser start sound. Every one after that is a cheap no-op, except it
  // retries the song if the browser turned it down earlier.
  const gesture = () => {
    gestured = true;
    if (ctx) { if (ctx.state !== "running") ctx.resume().catch(() => {}); }
    else if (settings.sfx) makeCtx();
    armed = true;
    syncMusic();
  };
  for (const type of ["pointerdown", "pointerup", "touchend", "keydown", "click"]) on(document, type, gesture, opts);

  on(document, "click", (e) => { const s = soundFor(e.target); if (s) playSound(s); }, opts);

  let lastKey = 0;
  on(document, "keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !(e.target instanceof Element) || !e.target.matches(TYPEABLE)) return;
    if (e.key.length !== 1 && e.key !== "Backspace") return;
    const now = performance.now();
    if (now - lastKey < 45) return;
    lastKey = now;
    playSound("key");
  }, opts);

  on(document, "visibilitychange", syncMusic);
  on(window, "storage", (e) => {
    if (e.key !== STORAGE_KEY) return; // another tab changed the settings
    settings = read();
    syncMusic();
    emit();
  });

  // Returning visitors may already be allowed to autoplay. Try straight away; if the browser says no, the first tap does it.
  armed = true;
  syncMusic();

  return () => { offs.forEach((f) => f()); started = false; };
}
