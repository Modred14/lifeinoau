// lib3d/assets/preload.js
// WHEN assets are fetched ahead of need. It only downloads bytes into the persistent store (no parsing, no memory held), in idle time, a few at a time, and never for a player who asked
// the browser to save data or is on a very slow connection (except the critical tier, which the game cannot start without).
//
//   tier preloading  critical files at once, high files after them in idle time, background files never in bulk
//   spatial preloading  register what lives where, tell it where the player is and which way they are heading, and it fetches only what is within reach, nearest-and-ahead first
import { manifest as defaultManifest } from "./manifest.js";

export function idleRun(fn, timeout = 2000) {
  if (typeof requestIdleCallback === "function") { const id = requestIdleCallback(() => fn(), { timeout }); return () => cancelIdleCallback(id); }
  const id = setTimeout(fn, 50); return () => clearTimeout(id);
}

/** True when optional downloads should be skipped: data saver on, or a 2G-class connection. */
export function isConstrained(env = globalThis) {
  try { const c = env.navigator?.connection; return !!c && (c.saveData === true || /(^|-)2g$/.test(String(c.effectiveType ?? ""))); } catch { return false; }
}

/** From items [{ path, x, z, radius? }], those worth fetching for a player at (x, z) heading along (dx, dz): inside `reach` of where they are, or of where they will be in `lookAhead` metres.
 *  Sorted nearest first, with what is ahead counted as closer. Pure. */
export function pickAhead(items, { x, z, dx = 0, dz = 0 }, { reach = 120, lookAhead = 80 } = {}) {
  const len = Math.hypot(dx, dz) || 0, ux = len ? dx / len : 0, uz = len ? dz / len : 0, fx = x + ux * lookAhead, fz = z + uz * lookAhead;
  const out = [];
  for (const it of items) {
    const r = it.radius ?? 0, here = Math.hypot(it.x - x, it.z - z) - r, ahead = len ? Math.hypot(it.x - fx, it.z - fz) - r : Infinity;
    if (here <= reach || ahead <= reach) out.push({ item: it, score: Math.min(here, ahead + 20) });
  }
  return out.sort((a, b) => a.score - b.score).map((o) => o.item);
}

export function createPreloader({ assets, manifest = defaultManifest, schedule = idleRun, constrained = isConstrained, maxParallel = 2 } = {}) {
  const queued = new Set(), items = []; let active = 0; const waiting = [];
  const done = new Set();

  function drain() {
    while (active < maxParallel && waiting.length) {
      waiting.sort((a, b) => a.priority - b.priority);
      const j = waiting.shift(); active++;
      assets.bytes(j.path, { priority: j.priority }).then(() => done.add(j.path), () => queued.delete(j.path)).finally(() => { active--; drain(); });
    }
  }
  function add(paths, priority, { force = false } = {}) {
    if (!force && constrained()) return 0; let n = 0;
    for (const p of paths) { if (!manifest.has(p) || queued.has(p)) continue; queued.add(p); waiting.push({ path: p, priority }); n++; }
    if (n) schedule(drain); return n;
  }
  return {
    /** The critical tier now (the game cannot start without it, so a data-saver player gets it too), then the high tier in idle time. */
    preloadEssentials() { const c = add(manifest.byTier("critical"), 0, { force: true }); drain(); const h = add(manifest.byTier("high"), 1); return { critical: c, high: h }; },
    preload(paths, priority = 3) { return add(paths, priority); },
    /** Registers what lives where: [{ path, x, z, radius? }]. */
    registerSpatial(list) { for (const it of list) if (manifest.has(it.path) && !items.some((x) => x.path === it.path && x.x === it.x && x.z === it.z)) items.push(it); },
    /** Call as the player moves (a few times a second is plenty): fetches what is within reach of where they are and where they are heading. Returns the paths it queued. */
    update(pos, opt) { const want = pickAhead(items, pos, opt).map((i) => i.path); add(want, 3); return want; },
    stats: () => ({ queued: queued.size, waiting: waiting.length, active, done: done.size, registered: items.length }),
  };
}
