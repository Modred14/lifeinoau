// lib/ui.js
// Tiny shared screen state: is the player on the plain home view or in Buy mode. The bottom bar (in the shell) sets it, the room screen reads it.
import { useSyncExternalStore } from "react";
let mode = "home"; const subs = new Set();
export const setPlayMode = (m) => { if (m === mode) return; mode = m; subs.forEach((f) => f()); };
export const getPlayMode = () => mode;
export const usePlayMode = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => mode, () => "home");
/** Anything that changes the player's cash or stats calls this so the top bar refreshes at once instead of waiting for its next poll. */
export const refreshShell = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("game:refresh")); };