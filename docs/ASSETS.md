# Assets: how they load, how they are cached, how to add one

**The rule: you never write caching code for an asset.** Put the file in the right folder and ask for it through `lib3d/assets`. Versioning, deduplication, saving for the next visit,
cleanup and measuring all happen there. A build that loads an asset any other way fails (`scripts/check-assets.mjs`, also run by `npm test`).

## What is an "asset"?

Any file under `public/models`, `public/data`, `public/textures`, `public/maps` or `public/audio` (the list is `ASSET_ROOTS` in `assets.config.mjs`).

In this game the buildings, houses, cars, trees and roads are built from code, so they download nothing: their cost is building geometry, which `lib3d/modelCache.js` and
`lib3d/roadAssets.js` already share and budget. What is actually downloaded today: the map data (`/data/oau-campus.json`, `/data/oau-roadgraph.json`), the avatar models
(`/models/avatars/**.glb`) and the music (`/audio/*.mp3`). Everything you add later (a downloadable building, car or tree model, a texture, a new map file) follows the same path.

## Adding an asset: the whole procedure

| You are adding | Do this |
|---|---|
| a 3D model (`.glb` / `.gltf`) | put it in `public/models/<area>/`, then `const h = await acquireGltf("/models/<area>/<name>.glb")`; use `h.value.scene` (clone it for each use); `h.release()` when you are done with it |
| a texture | put it in `public/textures/`, then `const h = await acquireTexture("/textures/<name>.png", { colorSpace: "srgb" })`; `h.release()` when done |
| map or game data (JSON) | put it in `public/data/`, then `await loadJson("/data/<name>.json")` |
| a sound or music file | put it in `public/audio/`, then `new Audio(assetUrl("/audio/<name>.mp3"))` |
| a new map or building file | the same: a file in one of the folders above, loaded through the functions above |

Then run `npm run assets:build` (it also runs by itself before `npm run dev` and `npm run build`) and commit the two generated files it updates. That is all. The file now has
a content-hashed URL, is downloaded once, is saved in the browser for the next visit, is replaced automatically when you change it, and is deleted from players' storage when you remove it.

Import everything from `lib3d/assets` (`@/lib3d/assets`): `loadJson`, `assetBytes`, `acquireGltf`, `acquireTexture`, `assetUrl`, `hasAsset`, `preloadAssets`, `registerSpatialAssets`,
`updateAssetFocus`, `onAssetProgress`, `assetStats`.

### Making an asset load sooner

New files are `background` by default: fetched when something asks for them. If the game cannot start without a file, or needs it within the first seconds, give it a tier in
`TIER_RULES` in `assets.config.mjs` (one line):

- `critical`: fetched at once, ahead of everything, kept longest when storage is tight (the campus map and road graph).
- `high`: fetched right after, in idle time (the player's body models).
- `background`: on demand, or when the player is heading towards it.

To fetch things ahead of need by position, register them once (`registerSpatialAssets([{ path, x, z, radius }])`) and call `updateAssetFocus({ x, z, dx, dz })` as the player moves
(a few times a second is plenty). Only files within reach of where the player is and where they are heading are fetched, nearest first.
Players with data saver on, or on a 2G-class connection, get critical files only.

### Rules for shared models

- What `acquireGltf` returns is **shared and read-only**. Clone the scene (`SkeletonUtils.clone` for skinned models) for each use; give per-object changes (colours, morph weights,
  visibility) to your clone or to a material you made yourself, and mark it `userData.owned = true` so your dispose frees it.
- Always `release()` the handle when the object that uses the model is disposed. A model somebody holds is never evicted; a released one stays warm and is evicted (and its GPU memory
  freed) only when the cache is over its memory budget. Never call `dispose()` on a geometry, material or texture that came from `acquireGltf` / `acquireTexture`.
- Many cars of one model: ask once per model and clone. They share vertex data and textures; nothing else.

## How it works

```
asset file in public/ ──build──> manifest (hash, size, tier) ──> assetUrl("/models/x.glb") = "/models/x.glb?v=3fa9c1d2e4"
                                           │ compiled into the game's code AND written to public/asset-manifest.json
request ──> already in flight? join it ──> saved copy in Cache Storage (this version)? use it ──> network (priority queue, progress) ──> save for next time
```

| Layer | File | What it does |
|---|---|---|
| Manifest + versions | `scripts/assets-manifest.mjs`, `lib3d/assets/manifest.js` | content hash per file, tiers; the hash is the `?v=` on every URL |
| Loader | `lib3d/assets/loader.js` | one download per file at a time, priority queue + parallel limit, progress, validation, retry, saved copies |
| Persistent store | `lib3d/assets/store.js` | Cache Storage with a size budget, eviction by tier then age, pruning of old versions, never throws |
| Models, textures | `lib3d/assets/gltf.js` | parse once, share, reference counting, eviction that frees GPU memory, Meshopt and Draco decoders |
| Preloading | `lib3d/assets/preload.js` | critical/high tiers, position- and direction-based preloading |
| Service worker | `public/sw.js` | serves versioned assets from the same cache with no network, prunes old versions on update, leaves everything else alone |
| Headers | `next.config.mjs` | versioned asset URLs `immutable` for a year; the same path without a version must revalidate |
| Guard | `scripts/check-assets.mjs`, `tests/assets.test.mjs` | fails the build when an asset is loaded around the shared system |

### Versioning and updates

- A changed file has a different hash, so a different URL: it is downloaded once, and the old copy is deleted from players' storage (the page prunes on start, the service worker on
  update, using `/asset-manifest.json`, which is served `no-store`).
- A file that did not change keeps its URL, so it is **not** downloaded again after a deployment.
- The manifest is compiled into the game's code, so a given build only ever asks for the file versions it was built with: new code cannot get an old model, old code cannot get a new one
  (an old page that is still open simply keeps asking for its own versions, which are fetched again if they were pruned).
- The same file requested without `?v=` is served with `must-revalidate` and is never answered from the service worker cache while online.

### What is never cached

The service worker only handles `/models`, `/data`, `/textures`, `/maps` (assets), `/_next/static` and `/app-icons`. `/api/*`, sockets, authentication, banking, betting,
multiplayer and every non-GET request are never touched. Audio is left to the browser's HTTP cache (media elements use byte ranges). Player-specific data never goes in a managed folder.

### Storage limits and failure

The persistent store takes at most a quarter of the browser's quota (capped at 400 MB, 120 MB on phones). Over budget, background-tier files go first, then high, then critical, oldest
first. A full disk, a browser without Cache Storage, private mode, or a corrupt entry only means "not saved": the file is downloaded again and the game carries on.

## Exceptions

If a file must load something its own way, add it to `ALLOWED` in `scripts/check-assets.mjs` with the reason. Today: the DJ track list (`/audio/club/manifest.json`, dropped in by hand and
always revalidated). The radio station list (`/data/radio-stations.json`) is excluded from the manifest because it is rewritten at every build and fetched with `no-cache`.

## Measuring

In the browser console of a production build: `await __oauAssets.stats()` gives, for this page load, the files downloaded from the network (`loader.networkFetches`, `loader.networkBytes`),
the files served from the saved copy (`loader.persistentHits`), the hit rate (`loader.cacheHitRate`), shared-model counts, and how much the store holds. For a full before/after, use
DevTools > Network ("Disable cache" off): first visit, reload, and a visit after a deployment; compare "transferred" sizes and the request count. `window.__oauRoadPerf` (see
`lib3d/roadPreload.js`) shows when the road finished preparing.
