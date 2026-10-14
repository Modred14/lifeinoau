// lib/cache.js
// Tiny in-memory cache for data that many players share (faculty list, leaderboards, billboards, party attendance).
// - cached(): if 1,000 players ask at the same moment, ONE query runs and everybody gets its answer.
// - invalidate(): call it after a write so the next read is fresh.
// Each server instance has its own copy, which is fine for data that is allowed to be a few seconds old.
const store = new Map(); // key -> { at, value }
const inflight = new Map(); // key -> Promise
const MAX_KEYS = 500;
let epoch = 0; // bumped by invalidate(), so a query that started before a write can never save its (old) answer

export async function cached(key, ttlMs, load) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const born = epoch;
  const p = (async () => {
    try {
      const value = await load();
      if (born === epoch) {
        if (store.size >= MAX_KEYS) store.clear();
        store.set(key, { at: Date.now(), value });
      }
      return value;
    } finally {
      if (inflight.get(key) === p) inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Forget every cached entry whose key starts with `prefix` (no prefix = everything). */
export function invalidate(prefix = "") {
  epoch++;
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
}

// A short id for a database client, so two different clients (for example two fakes in a test) never share cached rows.
const ids = new WeakMap();
let nextId = 1;
export const scopeOf = (db) => {
  if (!db || (typeof db !== "object" && typeof db !== "function")) return 0;
  if (!ids.has(db)) ids.set(db, nextId++);
  return ids.get(db);
};