// lib3d/assets/index.js
// THE entry point for assets. Import from here (or lib3d/assets/*.js), never load a file from /models, /data, /textures or /audio any other way: tests/assets.test.mjs fails the build
// if a direct GLTFLoader / TextureLoader / fetch of a managed path appears anywhere else. Anything that goes through here is versioned, deduplicated, saved for the next visit and measured.
//
//   import { loadJson, acquireGltf, acquireTexture, assetUrl, assetBytes, preloader, initAssets, assetStats } from "@/lib3d/assets";
//
// Adding an asset: put the file in public/models | data | textures | maps | audio, then ask for it by its path. See docs/ASSETS.md.
import { manifest, assetUrl, hasAsset } from "./manifest.js";
import { createStore } from "./store.js";
import { createAssetLoader } from "./loader.js";
import { createPreloader, idleRun } from "./preload.js";

const hasCaches = typeof caches !== "undefined" && typeof Response !== "undefined";
let store, assets, preloader, models = null, started = false;

function build() {
  store = hasCaches ? createStore({ isCurrent: (url) => { const u = new URL(url); return manifest.currentUrls().has(u.pathname + u.search); } }) : null;
  assets = createAssetLoader({ manifest, store });
  preloader = createPreloader({ assets, manifest });
}
build();

/** The model service is created on first use, so pages that never load a 3D model do not pay for three's glTF loader. */
async function modelService() {
  if (!models) { const { createModelService } = await import("./gltf.js"); models = models ?? createModelService({ assets }); }
  return models;
}

export { assetUrl, hasAsset };
export const assetBytes = (path, opt) => assets.bytes(path, opt);
export const loadJson = (path, opt) => assets.json(path, opt);
export const acquireGltf = async (path, opt) => (await modelService()).acquireGltf(path, opt);
export const acquireTexture = async (path, opt) => (await modelService()).acquireTexture(path, opt);
export const onAssetProgress = (fn) => assets.onProgress(fn);
/** Live handles, not snapshots, so a caller that imported them early still talks to the current runtime. */
export const preloadAssets = (paths, priority) => preloader.preload(paths, priority);
export const registerSpatialAssets = (list) => preloader.registerSpatial(list);
export const updateAssetFocus = (pos, opt) => preloader.update(pos, opt);

/** For measuring: what was downloaded, what came from the saved copy, how much the persistent store holds. Also on window.__oauAssets in the browser. */
export async function assetStats() {
  return { manifest: manifest.version, loader: assets.stats(), preload: preloader.stats(), models: models?.stats() ?? null, store: store ? await store.usage() : null, progress: assets.progress() };
}

/**
 * Starts the asset system once per page: throws away saved files that are no longer current, then fetches the essentials in the background. Safe to call any number of times,
 * never throws, never blocks the first paint.
 */
export function initAssets({ preload = true } = {}) {
  if (started) return; started = true;
  try { globalThis.__oauAssets = { stats: assetStats, loader: assets, preloader, manifest }; } catch { /* no global object to hang it on */ }
  idleRun(() => { store?.prune(manifest.currentUrls()).catch(() => {}); }, 4000);
  if (preload) { try { preloader.preloadEssentials(); } catch { /* preloading is best effort */ } }
}

/** For tests: a clean runtime with a fresh in-memory state (what a new page load starts with). `opt` is passed to the loader (fetchImpl, concurrency...). */
export function resetAssets(opt = {}) {
  started = false; models?.clear?.(); models = null; build();
  if (opt.fetchImpl || opt.store !== undefined || opt.concurrency) { assets = createAssetLoader({ manifest, store: opt.store === undefined ? store : opt.store, fetchImpl: opt.fetchImpl, concurrency: opt.concurrency ?? 4, retryDelayMs: opt.retryDelayMs ?? 300 }); preloader = createPreloader({ assets, manifest }); }
  return { assets, store, preloader };
}
