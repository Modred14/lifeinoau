// lib/toast.js
// Global toast store. Plain module state + subscribe, so toast.success(...) works from any client
// component, handler or effect without a hook or context. <Toaster /> (mounted once in the root
// layout) renders it. Calls made on the server are ignored.

import { playSound } from "./sound.js";

const MAX_VISIBLE = 4;
const EXIT_MS = 240;
const MIN_MS = 1500, MAX_MS = 60000;
const DEFAULT_MS = { success: 4000, info: 4500, error: 5000, pending: 45000 }; // pending: a safety net only, it is replaced or dismissed when the answer arrives
const MAX_LEN = 280;
const EMPTY = Object.freeze([]);

let toasts = EMPTY;          // newest first; replaced (never mutated) on every change
let seq = 0;
const listeners = new Set();
const exitTimers = new Map(); // id -> timeout, so removal timers never leak

const emit = () => { for (const l of listeners) l(); };
const commit = (next) => { toasts = next; emit(); };

export const subscribe = (l) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const getSnapshot = () => toasts;
export const getServerSnapshot = () => EMPTY;

function resolveDuration(type, o) {
  if (o.persistent || o.duration === Infinity || o.duration === 0 || o.duration === null) return null; // stays until closed
  const ms = Number.isFinite(o.duration) ? o.duration : DEFAULT_MS[type];
  return Math.min(MAX_MS, Math.max(MIN_MS, ms));
}

function remove(id) {
  clearTimeout(exitTimers.get(id));
  exitTimers.delete(id);
  if (toasts.some((t) => t.id === id)) commit(toasts.filter((t) => t.id !== id));
}

function dismiss(id) {
  const t = toasts.find((x) => x.id === id);
  if (!t || t.state === "out") return;
  commit(toasts.map((x) => (x.id === id ? { ...x, state: "out" } : x)));
  exitTimers.set(id, setTimeout(() => remove(id), EXIT_MS));
  try { t.onDismiss?.(); } catch { /* a bad callback must never break the stack */ }
}

function push(type, message, o = {}) {
  if (typeof window === "undefined") return null;
  const text = String(message ?? "").trim().slice(0, MAX_LEN);
  if (!text) return null;
  const duration = resolveDuration(type, o);
  const live = toasts.filter((t) => t.state !== "out");

  // Same id, or same type + text already on screen: refresh it instead of stacking a copy.
  const dupe = live.find((t) => (o.id != null ? t.id === o.id : t.type === type && t.message === text));
  if (dupe) {
    const same = dupe.type === type && dupe.message === text;
    commit(toasts.map((t) => (t.id === dupe.id
      ? { ...t, type, message: text, duration, action: o.action ?? null, onDismiss: o.onDismiss ?? t.onDismiss, stamp: t.stamp + 1, count: same && o.id == null ? t.count + 1 : 1 }
      : t)));
    if (dupe.type !== type && type !== "pending" && o.sound !== false) playSound(o.sound ?? type); // e.g. "Paying…" becoming "Paid"
    return dupe.id;
  }

  const id = o.id ?? `t${++seq}`;
  clearTimeout(exitTimers.get(id)); exitTimers.delete(id); // reusing the id of a toast that is mid-exit
  const next = { id, type, message: text, duration, action: o.action ?? null, onDismiss: o.onDismiss ?? null, count: 1, stamp: 1, state: "in" };
  commit([next, ...toasts.filter((t) => t.id !== id)]);
  if (o.sound !== false && type !== "pending") playSound(o.sound ?? type); // success, error and info each have their own sound; o.sound picks another; "pending" is silent

  // Keep the stack short: retire the oldest auto-dismissing toasts first; persistent ones are never evicted.
  const over = toasts.filter((t) => t.state !== "out").length - MAX_VISIBLE;
  if (over > 0) toasts.filter((t) => t.state !== "out" && t.duration != null && t.id !== id).slice(-over).forEach((t) => dismiss(t.id));
  return id;
}

/**
 * toast.success("Saved")                        green, ~4s
 * toast.error("Could not save", { duration: 6000 })   red, ~5s
 * toast.info("Draft kept on this device")       light, ~4.5s
 * const id = toast.pending("Paying bail…")      light with a spinner, until you answer it:
 *   toast.success("Bail paid.", { id })  /  toast.error("…", { id })  /  toast.dismiss(id)
 * Options: duration (ms), persistent (stay until closed), id (replace/dedupe by id),
 *          action: { label, onClick }, onDismiss: () => void,
 *          sound: a sound name from lib/sfx.js (for example "coin"), or false for none. Default: the toast type's sound.
 */
export const toast = Object.assign((message, o) => push("info", message, o), {
  success: (message, o) => push("success", message, o),
  error: (message, o) => push("error", message, o),
  info: (message, o) => push("info", message, o),
  /** "Paying…": shown the moment a money action starts. Replace it with success()/error() using the SAME id, or dismiss() it. */
  pending: (message, o) => push("pending", message, o),
  dismiss,
  clear: () => toasts.forEach((t) => dismiss(t.id)),
});