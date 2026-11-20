// lib3d/assets/manifest.js
// Where an asset's VERSIONED URL comes from. Every managed file (see assets.config.mjs) has a content hash in the generated manifest, and the URL the game asks for carries it:
//   assetUrl("/models/avatars/base_male.glb")  ->  "/models/avatars/base_male.glb?v=3fa9c1d2e4"
// The hash changes exactly when the file does, so a versioned URL can be kept for a year (next.config.mjs says so), an unchanged file is never downloaded again after a deployment,
// and a changed one gets a new URL and is fetched once. The manifest is compiled into the game's code, so a given build of the code only ever asks for the files it was built with.
import generated from "./manifest.generated.js";

const TIER_ORDER = { critical: 0, high: 1, background: 3 };
export const tierPriority = (tier) => TIER_ORDER[tier] ?? 3;

/** Path as the manifest spells it: absolute, no query or hash, no "./" segments. Returns "" for anything that is not a same-site path. */
export function cleanPath(input) {
  let p = String(input ?? "");
  if (/^[a-z][a-z0-9+.-]*:/i.test(p) && !/^https?:/i.test(p)) return ""; // data:, blob: ...
  try { p = new URL(p, "http://x.invalid").pathname; } catch { return ""; }
  return p.replace(/\/{2,}/g, "/");
}

export function createManifest(data = generated) {
  const assets = data?.assets ?? {};
  const warned = new Set();
  const info = (p) => assets[cleanPath(p)] ?? null;
  return {
    version: data?.version ?? "",
    has: (p) => !!info(p),
    info,
    paths: () => Object.keys(assets),
    /** Versioned URL. A path that is not in the manifest is returned as it is (and reported once in development): it will still load, but without versioning. */
    url(p) {
      const clean = cleanPath(p), a = assets[clean];
      if (a) return `${clean}?v=${a.v}`;
      if (clean && !warned.has(clean)) { warned.add(clean); if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") console.warn(`[assets] ${clean} is not in the asset manifest (run "npm run assets:build"); loading it without a version.`); }
      return clean || String(p);
    },
    /** Every versioned URL that is current (what the cache may keep). */
    currentUrls: () => new Set(Object.entries(assets).map(([p, a]) => `${p}?v=${a.v}`)),
    byTier: (tier) => Object.entries(assets).filter(([, a]) => a.tier === tier).map(([p]) => p),
  };
}

export const manifest = createManifest();
export const assetUrl = (p) => manifest.url(p);
export const hasAsset = (p) => manifest.has(p);
