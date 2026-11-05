// lib3d/modelCache.js
// The game's one shared cache of built 3D geometry (see assetCache.js for the rules), plus the small helpers the model builders use to take part in it.
//
// WHAT IS CACHED: geometry only, which is immutable once built (merged vehicle bodies, door skins, wheels, low-poly traffic shapes). Every object that USES it still
// makes its own meshes, groups, pivots and materials where it needs them (lamps, door hinges, wheel spin), so two cars of one model share vertex data and nothing
// else: opening one door, braking one car or disposing one car cannot touch another.
// WHAT IS NOT: anything with state. Materials that change per object (lamps) are never cached here.
//
// MEMORY: three.js geometry.dispose() frees only the GPU copy; the object stays valid and uploads again if it is drawn later. So a stray dispose() elsewhere (a scene
// teardown that walks every mesh) can never break a cached geometry, it only costs a re-upload. The cache's own accounting is about the CPU copy, and eviction
// calls dispose() so the GPU copy goes too.
import { createAssetCache, geometryBytes } from "./assetCache.js";

export const modelCache = createAssetCache();

/** Every BufferGeometry reachable from a cached value (arrays, Maps, plain objects, K.Parts), so the cache can size and free what a builder returns. Functions are skipped. */
export function geometriesIn(value, out = new Set(), depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return out;
  if (value.isBufferGeometry) { out.add(value); return out; }
  if (value.isMaterial || value.isTexture || value.isObject3D) return out;
  if (Array.isArray(value)) { for (const v of value) if (v && typeof v === "object") geometriesIn(v, out, depth + 1); return out; }
  if (value instanceof Map) { for (const v of value.values()) geometriesIn(v, out, depth + 1); return out; }
  for (const k in value) { const v = value[k]; if (v && typeof v === "object") geometriesIn(v, out, depth + 1); }
  return out;
}

/** Cache options for a value made of geometry: its size is the bytes of its vertex data and freeing it releases each geometry's GPU copy. */
export const geometryEntry = {
  bytes: (v) => { let n = 0; for (const g of geometriesIn(v)) n += geometryBytes(g); return n; },
  dispose: (v) => { for (const g of geometriesIn(v)) g.dispose?.(); },
};

/**
 * What one object (a vehicle) holds from the cache. get() returns the shared value and remembers the handle; releaseAll() lets every one go (call it from the
 * object's dispose()); owns(geometry) says whether a geometry belongs to the cache, so dispose() frees only the geometry it made itself.
 */
export function createHolder(cache = modelCache) {
  const handles = [], owned = new Set(); let open = true;
  return {
    get(key, build, opt = {}) {
      const h = cache.acquire(key, build, { ...geometryEntry, ...opt });
      if (open) { handles.push(h); for (const g of geometriesIn(h.value)) { owned.add(g); g.userData.shared = true; } } else h.release(); // userData.shared: "other objects use this: do not dispose it just because you are done"
      return h.value;
    },
    owns: (g) => owned.has(g),
    releaseAll() { open = false; for (const h of handles) h.release(); handles.length = 0; },
    get count() { return handles.length; },
  };
}

/**
 * Frees the GPU copy of every cached geometry (the CPU copy stays cached and uploads again when next drawn). Call it when a renderer is torn down: a geometry that was drawn
 * keeps a "dispose" listener pointing at that renderer, and cached geometry outlives any one renderer, so without this an old renderer could be kept alive by the cache.
 */
export function freeGpuCopies(cache = modelCache) { cache.each((value) => geometryEntry.dispose(value)); for (const f of gpuFreers) { try { f(); } catch { /* freeing must never throw into the game */ } } }
const gpuFreers = new Set();
/** Other caches of three.js objects (the road cache) add their own "drop the GPU copies" step here, so one renderer teardown frees everything cached. */
export function registerGpuFree(fn) { gpuFreers.add(fn); return () => gpuFreers.delete(fn); }

/** Runs a build step for the preloader: whatever it needs from the cache is held until the step ends (so nothing it just built can be evicted half-way), then let go. */
export function warmScope(fn, cache = modelCache) {
  const hold = createHolder(cache); try { return fn(hold); } finally { hold.releaseAll(); }
}
