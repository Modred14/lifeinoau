// lib3d/roadAssets.js
// The road's drawn assets, built ONCE per road graph and shared by every map that shows it: the surface layers (with their textures and materials), the expressway and its ramps, and the street furniture.
// Before this, every time the map opened it rebuilt all of it (~0.3 s on a desktop, several times that on a phone) and generated its textures again.
//
// HOW IT FITS
//  - It extends the game's existing cache (lib3d/assetCache.js: reference counted, size-budgeted, never frees what is in use) with a road cache of its own, and joins modelCache's renderer teardown (registerGpuFree).
//  - What is cached is a TEMPLATE group per part. Each map takes a clone: its own Group / Mesh / InstancedMesh objects (so each keeps its own position.y: trips lower the flat layers with layerY, and that must never leak
//    between maps) that SHARE the template's geometry, materials and textures. So a road segment's position, rotation, elevation and layer offsets stay per use; only immutable vertex data and materials are shared.
//  - The cache key holds the identity of the road graph the parts were built from. The drawn road and the collision/driving data are both made from that one graph object, so a cached drawing can never belong to a different
//    road than the one vehicles drive on (the bridge heights, ramps and piers are in the graph and therefore in the drawing; nothing about them is recomputed or approximated here).
//  - A clone's userData.dispose does NOT free anything shared: release() on the scene lets go of the cache handles. The GPU copy of an idle entry is dropped when a renderer is torn down (freeGpuCopies) and when the cache evicts it.
import { createAssetCache, defaultBudgetBytes, geometryBytes } from "./assetCache.js";
import { registerGpuFree } from "./modelCache.js";
import { buildRoadMeshes } from "./roadmesh.js";
import { buildHighwayMeshes } from "./highwaymesh.js";
import { buildRoadFurniture } from "./roadfurniture.js";

/** One whole road is ~19 MB of vertex data (14 MB of it the surface), so the budget is sized to hold exactly one road (26 MB on phones, 40 MB elsewhere) and not much more: an idle road stays warm for the next map,
 *  but at most one stale graph can ever linger. Entries in use are never evicted, so this is a ceiling for IDLE entries only. (A fraction of the model cache's budget would evict the road the moment a map closed.) */
const ROAD_BUDGET = defaultBudgetBytes() <= 12 * 1048576 ? 26 * 1048576 : 40 * 1048576;
export const roadCache = createAssetCache({ budgetBytes: ROAD_BUDGET });

const ids = new WeakMap(); let nextId = 1;
const idOf = (o) => { let i = ids.get(o); if (!i) ids.set(o, (i = nextId++)); return i; };

/** Calls fn(geometry | material | texture) once for each distinct resource a group uses. */
function eachResource(root, fn) {
  const seen = new Set(), see = (r) => { if (r && !seen.has(r)) { seen.add(r); fn(r); } };
  root.traverse((o) => {
    see(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) { see(m); for (const k in m) if (m[k]?.isTexture) see(m[k]); }
  });
}
const bytesOf = (root) => { let n = 0; eachResource(root, (r) => { if (r.isBufferGeometry) n += geometryBytes(r); else if (r.isTexture) n += r.image?.data?.byteLength ?? 0; }); root.traverse((o) => { n += (o.instanceMatrix?.array?.byteLength ?? 0) + (o.instanceColor?.array?.byteLength ?? 0); }); return n; };
/** Frees the GPU copy of everything in a template. The CPU data stays valid: three.js uploads it again the next time it is drawn. */
const freeGpu = (root) => eachResource(root, (r) => r.dispose?.());

const PARTS = {
  surface: { priority: 3, build: (graph, S, y) => buildRoadMeshes(graph, S, y) },
  highway: { priority: 3, build: (graph, S) => (graph.expressway ? buildHighwayMeshes(graph.expressway, S) : null) },
  furniture: { priority: 1, build: (graph, S) => buildRoadFurniture(graph, S) },
};
// priority = graph age first (ids only grow, so a newer road always outranks an older one and a stale graph is evicted first), then how much the part matters
const entryOpts = (kind, graph) => ({ bytes: (v) => (v ? bytesOf(v) : 0), dispose: (v) => v && freeGpu(v), priority: idOf(graph) * 10 + PARTS[kind].priority });
export const roadKey = (kind, graph, S, y) => `road:${kind}:${idOf(graph)}:${S}:${y}`;
const buildTemplate = (kind, graph, S, y) => () => { const g = PARTS[kind].build(graph, S, y); if (g) eachResource(g, (r) => { if (r.isBufferGeometry) r.userData.shared = true; }); return g; };

/**
 * The road as one map shows it: { surface, highway, furniture } (highway is null when the graph has no expressway), each a fresh group sharing the cached geometry, materials and textures,
 * plus release() to call when the map lets go of them (the shared parts then become evictable, but stay warm for the next map). `fromCache` tells how many parts were already built.
 */
export function acquireRoadScene(graph, S = 0.1, y = 0.08) {
  const handles = []; let fromCache = 0;
  const take = (kind) => {
    const key = roadKey(kind, graph, S, y); if (roadCache.has(key)) fromCache++;
    const h = roadCache.acquire(key, buildTemplate(kind, graph, S, y), entryOpts(kind, graph)); handles.push(h);
    if (!h.value) return null;
    const c = h.value.clone(true); c.userData.dispose = () => {}; // shared resources are freed by the cache, never by one map's teardown
    return c;
  };
  const scene = { surface: take("surface"), highway: take("highway"), furniture: take("furniture"), fromCache };
  scene.release = () => { for (const h of handles) h.release(); handles.length = 0; };
  return scene;
}

/** Jobs that build each part into the cache without showing it, in the order the player needs them: the road surface first, then the bridge, then the street furniture. */
export function roadWarmSteps(graph, S = 0.1, y = 0.08) {
  return ["surface", "highway", "furniture"].filter((kind) => kind !== "highway" || graph.expressway)
    .map((kind) => ({ kind, key: roadKey(kind, graph, S, y), run: () => roadCache.warm(roadKey(kind, graph, S, y), buildTemplate(kind, graph, S, y), entryOpts(kind, graph)) }));
}

export const isRoadWarm = (graph, S = 0.1, y = 0.08) => roadWarmSteps(graph, S, y).every((st) => roadCache.has(st.key));

registerGpuFree(() => roadCache.each((root) => root && freeGpu(root)));
