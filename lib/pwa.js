// lib/pwa.js
// Installing Life in OAU on a phone (a PWA): what this device and browser can do, and the install prompt itself.
//
// Browsers differ a lot, so the Settings app asks this module ONE question, `useInstall()`, and gets a status it can show honestly:
//   installed    the game is running as an installed app (or was just installed)
//   available    the browser handed us its install prompt: one tap installs (Chrome, Edge, Samsung Internet, Opera on Android and desktop)
//   ios          iPhone / iPad: there is no prompt; the player adds it from the Share menu (the steps are shown)
//   manual       a browser that can install apps but has not offered the prompt (yet): the steps are in its menu
//   unsupported  this browser or window cannot install web apps (an in-app browser, Firefox on desktop, an insecure page...): says why and what to do
//
// `beforeinstallprompt` fires once, early, and is lost if nobody is listening, so initPwa() runs at startup (components/OfflineGate.js), not when Settings opens.
// detectInstall() is pure (it only reads the facts it is given), so it is tested without a browser (tests/pwa.test.mjs).
import { useSyncExternalStore } from "react";

/** The facts about this device, as plain values. */
export function factsOf(w = typeof window === "undefined" ? null : window) {
  if (!w) return null;
  const n = w.navigator ?? {};
  let standalone = false;
  try { standalone = !!(w.matchMedia?.("(display-mode: standalone)").matches || w.matchMedia?.("(display-mode: fullscreen)").matches || w.matchMedia?.("(display-mode: minimal-ui)").matches || n.standalone === true); } catch { /* no matchMedia: not standalone as far as we can tell */ }
  return { ua: String(n.userAgent ?? ""), platform: String(n.platform ?? ""), touchPoints: Number(n.maxTouchPoints ?? 0), standalone, hasSW: "serviceWorker" in n, secure: w.isSecureContext !== false };
}

const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|Pinterest|GSA\/|; wv\)|WebView/i;

/** Which kind of device and browser this is (from the user agent only; used to pick the right words). */
export function classify(ua, platform = "", touchPoints = 0) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (platform === "MacIntel" && touchPoints > 1); // an iPad that asks for the desktop site calls itself a Mac
  const android = /Android/i.test(ua);
  const inApp = IN_APP.test(ua);
  const edge = /EdgA?\/|EdgiOS\//.test(ua), opera = /OPR\/|OPT\//.test(ua), samsung = /SamsungBrowser/i.test(ua), firefox = /Firefox\/|FxiOS\//.test(ua);
  const chromium = /Chrome\/|CriOS\//.test(ua) && !firefox;
  const safari = /Safari\//.test(ua) && !chromium && !edge && !opera && !firefox && !inApp;
  const browser = edge ? "edge" : opera ? "opera" : samsung ? "samsung" : firefox ? "firefox" : ios && /CriOS\//.test(ua) ? "chrome-ios" : chromium ? "chrome" : safari ? "safari" : "other";
  return { ios, android, inApp, browser, mobile: ios || android || /Mobile/i.test(ua) };
}

/** The status the Settings screen shows, from the facts and whether the browser gave us an install prompt. Pure. */
export function detectInstall(facts, { hasPrompt = false, justInstalled = false } = {}) {
  if (!facts) return { kind: "checking" };
  const c = classify(facts.ua, facts.platform, facts.touchPoints);
  const base = { device: c.ios ? "ios" : c.android ? "android" : "desktop", browser: c.browser };
  if (facts.standalone || justInstalled) return { ...base, kind: "installed" };
  if (c.inApp) return { ...base, kind: "unsupported", why: "This is an in-app browser, which cannot install apps.", fix: c.ios ? "Open lifeinoau.com in Safari, then come back here." : "Open lifeinoau.com in Chrome, then come back here." };
  if (!facts.secure) return { ...base, kind: "unsupported", why: "Apps can only be installed from a secure (https) page.", fix: "Open the game at its https address." };
  if (c.ios) {
    // iOS 16.4 and later can add web apps from Safari, Chrome, Edge and Firefox; before that only Safari could, and nothing can offer a prompt.
    return { ...base, kind: "ios", steps: c.browser === "safari"
      ? ["Tap the Share button (the square with an arrow) in Safari's toolbar.", "Scroll down and tap Add to Home Screen.", "Tap Add. Life in OAU now opens from your home screen, like an app."]
      : ["Tap the Share button in your browser (or the ⋯ menu, then Share).", "Choose Add to Home Screen. If you do not see it, open lifeinoau.com in Safari and do it there.", "Tap Add. Life in OAU now opens from your home screen, like an app."] };
  }
  if (hasPrompt) return { ...base, kind: "available" };
  if (!facts.hasSW) return { ...base, kind: "unsupported", why: "This browser does not support installing web apps.", fix: c.android ? "Open the game in Chrome." : "Use Chrome, Edge or Safari." };
  if (c.browser === "firefox") return { ...base, kind: "unsupported", why: c.android ? "Firefox on Android adds web apps from its menu, but cannot show an install button here." : "Firefox on a computer cannot install web apps.", fix: c.android ? "Open the ⋮ menu and tap Install." : "Use Chrome or Edge to install the game." };
  if (c.browser === "safari") return { ...base, kind: "manual", steps: ["In Safari's menu bar choose File, then Add to Dock.", "Confirm the name and click Add."] };
  // Chrome, Edge, Samsung Internet, Opera: they can install, but the browser decides when to offer the prompt (it may also already be installed, or was dismissed earlier).
  return { ...base, kind: "manual", steps: c.android
    ? [`Open the browser menu (⋮) and tap ${c.browser === "samsung" ? "Add page to, then Home screen" : "Install app or Add to Home screen"}.`, "Confirm. Life in OAU now opens from your home screen, like an app."]
    : ["Click the install icon at the right end of the address bar, or open the ⋮ menu and choose Install Life in OAU.", "Confirm. The game then opens in its own window."] };
}

/* ---------------------------------- live state ---------------------------------- */

let deferred = null; // the browser's install prompt, kept until it is used
let justInstalled = false;
let started = false;
let snap = { kind: "checking" };
const subs = new Set();
let updateRegistration = null;
let updateAvailable = false;
const updateSubs = new Set();
const observedRegistrations = new WeakSet();

function setUpdateAvailable(value) {
  if (updateAvailable === value) return;
  updateAvailable = value;
  updateSubs.forEach((f) => f());
}

function observeRegistration(registration) {
  if (!registration || observedRegistrations.has(registration)) return;
  observedRegistrations.add(registration);
  updateRegistration = registration;
  const checkWaiting = () => setUpdateAvailable(!!registration.waiting && !!navigator.serviceWorker.controller);
  checkWaiting();
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed") checkWaiting();
    });
  });
  navigator.serviceWorker.addEventListener("controllerchange", checkWaiting);
}

/** Track an available service worker update for the home screen. */
export function watchPwaUpdates(registration) { observeRegistration(registration); }

/** Quietly ask the browser to check the registered worker for a newer build. */
export async function checkPwaUpdate() {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
  try {
    const registration = updateRegistration ?? await navigator.serviceWorker.getRegistration();
    if (!registration) return false;
    observeRegistration(registration);
    await registration.update();
    return !!registration.waiting && !!navigator.serviceWorker.controller;
  } catch {
    // Offline and browser update errors should never interrupt gameplay.
    return false;
  }
}

const subscribeUpdate = (f) => { updateSubs.add(f); return () => updateSubs.delete(f); };
const getUpdate = () => updateAvailable;
/** Whether a newer app version is waiting to be applied. */
export const usePwaUpdate = () => useSyncExternalStore(subscribeUpdate, getUpdate, () => false);

/** Activate the waiting version, then reload once it controls the page. */
export function applyPwaUpdate() {
  const waiting = updateRegistration?.waiting;
  if (!waiting || typeof navigator === "undefined" || !navigator.serviceWorker) {
    if (typeof window !== "undefined") window.location.reload();
    return;
  }
  let timeout;
  const reload = () => {
    window.clearTimeout(timeout);
    window.location.reload();
  };
  navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
  waiting.postMessage({ type: "SKIP_WAITING" });
  timeout = window.setTimeout(() => {
    navigator.serviceWorker.removeEventListener("controllerchange", reload);
    window.location.reload();
  }, 5000);
}

function recompute() {
  const next = detectInstall(factsOf(), { hasPrompt: !!deferred, justInstalled });
  if (JSON.stringify(next) === JSON.stringify(snap)) return;
  snap = next; subs.forEach((f) => f());
}

/** Start listening (once). Safe to call from anywhere on the client. */
export function initPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; recompute(); }); // we show our own button instead of the browser's mini-bar
  window.addEventListener("appinstalled", () => { deferred = null; justInstalled = true; recompute(); });
  try { window.matchMedia?.("(display-mode: standalone)").addEventListener?.("change", recompute); } catch { /* an old browser: the status is read again when Settings opens */ }
  recompute();
}

/** Ask the browser to install. Resolves "accepted", "dismissed" or "unavailable" (no prompt to show right now). Must be called from a tap. */
export async function promptInstall() {
  const p = deferred;
  if (!p) return "unavailable";
  deferred = null; recompute(); // a prompt can only be used once
  try {
    await p.prompt();
    const { outcome } = await p.userChoice;
    return outcome === "accepted" ? "accepted" : "dismissed";
  } catch { return "unavailable"; }
}

/** Read the device again (for when the player comes back to Settings). */
export const refreshInstall = () => { if (started) recompute(); };
const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
const get = () => { if (!started && typeof window !== "undefined") initPwa(); return snap; };
const SERVER = { kind: "checking" };
/** The install status, live: re-renders when the browser offers the prompt or the app gets installed. */
export const useInstall = () => useSyncExternalStore(subscribe, get, () => SERVER);
