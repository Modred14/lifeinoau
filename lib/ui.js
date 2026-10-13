// lib/ui.js
// Tiny shared screen state: is the player on the plain home view or in Buy mode. The bottom bar (in the shell) sets it, the room screen reads it.
import { useSyncExternalStore } from "react";
let mode = "home"; const subs = new Set();
export const setPlayMode = (m) => { if (m === mode) return; mode = m; subs.forEach((f) => f()); };
export const getPlayMode = () => mode;
export const usePlayMode = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => mode, () => "home");
/** Anything that changes the player's cash or stats calls this so the top bar refreshes at once instead of waiting for its next poll. */
export const refreshShell = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("game:refresh")); };
/** "Bare" screens (first load, character creation, life roll, hostel pick) have no top bar or bottom nav. The play page sets this, the shell reads it. */
let bare = false; const bareSubs = new Set();
export const setBare = (v) => { if (v === bare) return; bare = v; bareSubs.forEach((f) => f()); };
export const useBare = () => useSyncExternalStore((f) => { bareSubs.add(f); return () => bareSubs.delete(f); }, () => bare, () => false);
/** Once the game home has been shown in this browser session, later loads of /play keep the bars so they don't blink in and out. Cleared on log out. */
let booted = false;
export const markBooted = () => { booted = true; };
export const isBooted = () => booted;
export const resetBoot = () => { booted = false; };