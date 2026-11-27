// lib3d/worldsvc.js
// The world's movement services, built once per map and shared: the road graph (lanes, junctions, routing), the collision world (every solid thing),
// the walking planner, and the old road net (which still knows where each building's door is). The travel sheet's estimates and the trip itself both
// use THIS object, so what the sheet promises is what the trip does. Pure JS apart from fetching the road graph in the browser.
import { buildRoadGraph } from "./roadgraph.js";
import { buildWorldCollision } from "./collide.js";
import { createNav } from "./walker.js";
import { buildRoadNet } from "./roadnet.js";
import { loadJson } from "./assets/index.js";
import { addBillboardCollision } from "./billboardSite.js";
import { planFurniture } from "./furnitureplan.js";
import { woodlandTrees, addWoodlandCollision } from "./woodland.js";
import { addFurnitureCollision, addEmbankmentCollision } from "./structuresolid.js";
import { addCampusDecor } from "./campuslife/decor.js";
import { loadCampusLook } from "./campusData.js";
import { MAP_LOOK } from "./mapLook.js";

/**
 * The columns of the expressway are solid on the ground (people and ground vehicles cannot walk or drive through one); the deck itself is 10 m up and is not. Columns standing in the lake need
 * nothing: the water already is. Each is the circle that holds the column's footprint.
 */
export function addPierCollision(world, hw) {
  if (!hw) return 0; let n = 0;
  const [m0, m1] = hw.main ?? [-Infinity, Infinity];   // the straight deck is the main alignment; the tails beyond the rim are `outer` (they lie outside the map: lib3d/walker.js keeps them out of its grid's extent)
  for (const p of hw.piers ?? []) if (!p.water) { world.addPost(p.x, p.z, Math.hypot(hw.pierSpec.col[0], hw.pierSpec.col[1]) / 2, p.s < m0 || p.s > m1 ? { kind: "pier", outer: true } : { kind: "pier" }); n++; }
  for (const p of hw.rampPiers ?? []) { world.addPost(p.x, p.z, 1.1, { kind: "pier" }); n++; }
  return n;
}

/** Is the Campuslife look drawn on this map? (It is laid out on the new map only.) */
export const wantsLook = (data) => MAP_LOOK === "campuslife" && !!data.meta?.oldToNew;

/**
 * Builds the services from the merged map data and the generated road graph JSON (`rawGraph`). Takes about half a second. `look` (public/data/oau-campuslife.json), when given and drawn on this map,
 * adds its solid decoration (trees, stalls, banners, the gate) and leaves the list of it on graph.campusDecor for the map to draw (lib3d/campuslife/decor.js).
 */
export function buildServices(data, rawGraph, look = null) {
  const world = buildWorldCollision(data), graph = buildRoadGraph(rawGraph, { sdf: (x, z) => world.sdf(x, z, 16) });
  addPierCollision(world, rawGraph.expressway);   // after the graph: ground roads are laid out against buildings and water only, the piers were placed clear of them
  addBillboardCollision(world, data.places);       // the two concrete footings of each billboard are solid (the screen is 8 m up and is not); they stand well clear of every road, so nothing that drives or walks is ever in their way
  // Street furniture and the low parts of ramps and descents are solid too. The furniture is planned once, here, from the finished graph; the meshes (lib3d/roadfurniture.js) are built from the same plan, so what
  // stands in the street is exactly what cannot be walked or driven through. (Planned before its own posts exist, so the plan does not see them.)
  graph.furniturePlan = planFurniture(graph); addFurnitureCollision(world, graph.furniturePlan); addEmbankmentCollision(world, graph); addWoodlandCollision(world, woodlandTrees(data), graph);
  const net = buildRoadNet(data);
  // a failure in the decoration must never take driving and walking down with it
  if (look && wantsLook(data)) { try { graph.campusDecor = addCampusDecor(world, { data, look, graph, net }); } catch (e) { world.suspendDecor(); console.warn("campus decoration unavailable", e); } }
  const nav = createNav({ world, graph });
  return { data, world, graph, nav, net };
}

let cache = null, rawFetch = null;
/**
 * The generated road graph JSON, fetched ONCE per page (the fetch does not need the map data, so it can start the moment the world starts loading, long before the map opens).
 * A failed fetch is not remembered, so a retry can succeed.
 */
export function fetchRoadGraphRaw() {
  return (rawFetch ??= loadJson("/data/oau-roadgraph.json", { priority: 0 }).catch((e) => { rawFetch = null; throw e; }));
}

/** The shared services for this map data (browser). Fetches the road graph the first time (or uses the one already on its way); later calls return the same promise. */
export function loadServices(data) {
  if (cache?.data === data) return cache.promise;
  const entry = { data, promise: null, svc: null };
  entry.promise = Promise.all([fetchRoadGraphRaw(), wantsLook(data) ? loadCampusLook() : null]).then(([raw, look]) => (entry.svc = buildServices(data, raw, look))).catch((e) => { if (cache === entry) cache = null; throw e; });
  cache = entry; return entry.promise;
}

/** The services for this map data if they are already built (no waiting, no building), else null. The map uses it to draw the roads in the very first frame. */
export const peekServices = (data) => (cache?.data === data ? cache.svc : null);