// assets.config.mjs
// The ONE place that decides which files are "managed assets" and how important each is. scripts/assets-manifest.mjs reads it at build time and gives every file under these
// folders a content hash (the `?v=` on its URL), a size and a tier. Dropping a new file into one of the folders is all it takes: the next build (or `npm run dev`) picks it up,
// versions it and the shared loaders cache it. Nothing here needs editing for a new asset unless you want it to load EARLIER than "background".
//
// TIERS (what the runtime does with them, lib3d/assets/preload.js):
//   critical    needed before the first playable frame: fetched at once, ahead of everything else, and kept the longest when storage is tight.
//   high        needed very soon (the player's body, the shared animation library): fetched right after the critical tier, in idle time.
//   background  everything else: fetched when something asks for it (or when the player is heading towards it), never in bulk.

/** Folders under public/ whose files are managed. A file in any of them is versioned automatically. */
export const ASSET_ROOTS = ["models", "data", "textures", "maps", "audio"];

/** First match wins. `match` is tested against the URL path ("/models/avatars/base_male.glb"). */
export const TIER_RULES = [
  { match: /^\/data\/oau-(campus|roadgraph)\.json$/, tier: "critical" },
  { match: /^\/models\/avatars\/base_[mf]\w*\.glb$/, tier: "high" },
  { match: /^\/models\/avatars\/anim\//, tier: "high" },
];
export const DEFAULT_TIER = "background";

/** Files that live in a managed folder but are not runtime assets. */
export const EXCLUDE = [/(^|\/)\./, /\.map$/, /\.md$/, /\.txt$/, /^\/data\/radio-stations\.json$/ /* a station list that is rewritten at every build and fetched with "no-cache" (lib/radio/radio.js) */];

/** Tier name -> how long it is kept when storage is tight (higher = kept longer) and how soon it is fetched (lower = sooner). */
export const TIERS = { critical: { keep: 3, fetch: 0 }, high: { keep: 2, fetch: 1 }, background: { keep: 1, fetch: 3 } };
