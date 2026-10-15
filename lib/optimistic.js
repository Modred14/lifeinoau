// lib/optimistic.js
// "Show it first, tell the server second, undo it if the server says no."
//
// A store holds the last answer the server gave (`base`) plus a list of pending changes (`ops`) that the player made since.
// What the screen shows is always  base + ops.  So:
//   - a tap changes the screen at once (push an op), and the request goes out in the background;
//   - if the request FAILS, only that one op is removed: the screen goes back to what it was, and any other change the player
//     made in the meantime stays (no "restore a snapshot" that would wipe their newer taps);
//   - if it WORKS, the op stays on screen until a fresh answer from the server arrives and replaces it.
// A fresh answer is only used when no change was in flight while it travelled, otherwise it could undo something the player just did.
import { useSyncExternalStore } from "react";

const all = new Set();
/** Forget everything every store knows (called on login / logout so one player never sees another's data). */
const resetHooks = new Set();
/** Run `fn` whenever everything is forgotten (login / logout). Returns a function that stops listening. Used by the chat, which keeps its own copy. */
export const onReset = (fn) => { resetHooks.add(fn); return () => resetHooks.delete(fn); };
export const resetAll = () => { all.forEach((s) => s.reset()); resetHooks.forEach((f) => { try { f(); } catch { /* one bad listener must not stop the rest */ } }); };

export function createStore(fetcher, { dropOn = [401, 404], settleMs = 150 } = {}) {
  let base = null, ops = [], view = null, seq = 0, changed = 0, inflight = null, timer = null, gen = 0;
  const subs = new Set();
  const pending = () => ops.reduce((n, o) => n + (o.done ? 0 : 1), 0);
  const emit = () => {
    let v = base;
    if (v != null) for (const o of ops) { try { v = o.fn(v) ?? v; } catch { /* a bad patch must never break the screen */ } }
    view = v;
    subs.forEach((f) => f());
  };
  // waits until nothing is in flight, then a moment more so the server has surely committed
  const quiet = () => new Promise((res) => {
    const t = setInterval(() => { if (!pending()) { clearInterval(t); setTimeout(res, 80); } }, 60);
  });

  const store = {
    get: () => view,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    pending,

    /** Apply a change to the screen right now. Returns its id. */
    push(fn) { const id = ++seq; ops.push({ id, fn, done: false }); changed = seq; emit(); return id; },
    /** A change that the server already confirmed (for example the exact amount a hustle paid). */
    pushDone(fn) { const id = ++seq; ops.push({ id, fn, done: true }); changed = seq; emit(); return id; },
    /** The server said yes. The change stays on screen until the next fresh answer replaces it. */
    done(id) { const o = ops.find((x) => x.id === id); if (o) o.done = true; changed = ++seq; },
    /** The server said no: take that one change back. */
    rollback(id) { ops = ops.filter((x) => x.id !== id); changed = ++seq; emit(); },
    /** The server said yes AND its answer is the whole new truth (the room does this). If nothing else is in flight, use it directly. */
    settle(id, truth) {
      const o = ops.find((x) => x.id === id); if (o) o.done = true; changed = ++seq;
      if (truth != null && !pending()) { base = truth; ops = []; }
      emit();
    },

    /** Ask the server for the truth (one request at a time, however many callers). Resolves with the response. */
    refresh() {
      if (inflight) return inflight;
      const g = gen;
      const p = (async () => {
        let r;
        for (let i = 0; i < 4; i++) {
          const c0 = changed, p0 = pending();
          r = await fetcher();
          if (g !== gen) return r; // the session changed while we waited: this answer belongs to someone else
          if (r.failed) {
            if (dropOn.includes(r.status)) { base = null; ops = []; emit(); }
            return r;
          }
          if (p0 === 0 && !pending() && changed === c0) { base = r; ops = []; emit(); return r; }
          await quiet(); // a change was in flight while this travelled: its result may be stale, so ask again
          if (g !== gen) return r;
        }
        return r;
      })().finally(() => { if (inflight === p) inflight = null; });
      inflight = p;
      return p;
    },
    /** Refresh shortly, once, however many changes just finished. */
    scheduleRefresh() { clearTimeout(timer); timer = setTimeout(() => { store.refresh(); }, settleMs); },
    reset() { gen++; base = null; ops = []; inflight = null; clearTimeout(timer); emit(); },
  };
  all.add(store);
  return store;
}

/** Subscribe a component to a store. */
export const useStore = (store) => useSyncExternalStore(store.subscribe, store.get, () => null);

/** Step 1 of a change: show it on every screen it touches. effects = [{ store, patch?, settle? }] */
export function begin(effects = []) {
  return effects.filter(Boolean).map((e) => ({ e, id: e.patch ? e.store.push(e.patch) : null }));
}

/** Step 2: the server answered. Keep the change (and ask for the truth soon) or take it back. */
export function finish(handles, res, after) {
  const refresh = new Set(handles.map(({ e }) => e.store)), settled = new Set();
  if (res.failed) {
    handles.forEach(({ e, id }) => { if (id != null) e.store.rollback(id); });
  } else {
    handles.forEach(({ e, id }) => {
      const truth = e.settle ? e.settle(res) : null;
      if (id == null) return;
      if (truth != null) { e.store.settle(id, truth); settled.add(e.store); } else e.store.done(id);
    });
    (after?.(res) ?? []).forEach((x) => x?.patch && x.store.pushDone(x.patch));
  }
  refresh.forEach((s) => { if (res.failed || !settled.has(s)) s.scheduleRefresh(); });
  return res;
}

/** Show the change, send the request, keep or undo. */
export async function act({ request, effects, after }) {
  const handles = begin(effects);
  let res;
  try { res = await request(); } catch { res = { failed: true, status: 0, error: "No connection. Check your network and try again." }; }
  return finish(handles, res, after);
}