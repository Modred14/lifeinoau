// lib3d/worldsvc.js
// The world's movement services, built once per map and shared: the road graph (lanes, junctions, routing), the collision world (every solid thing),
// the walking planner, and the old road net (which still knows where each building's door is). The travel sheet's estimates and the trip itself both
// use THIS object, so what the sheet promises is what the trip does. Pure JS apart from fetching the road graph in the browser.
import { buildRoadGraph } from "./roadgraph.js";
import { buildWorldCollision } from "./collide.js";
import { createNav } from "./walker.js";
import { buildRoadNet } from "./roadnet.js";
import { dataUrl } from "./dataUrl.js";
import { addBillboardCollision } from "./billboardSite.js";

/**
 * The columns of the expressway are solid on the ground (people and ground vehicles cannot walk or drive through one); the deck itself is 10 m up and is not. Columns standing in the lake need
 * nothing: the water already is. Each is the circle that holds the column's footprint.
 */
export function addPierCollision(world, hw) {
  if (!hw) return 0; let n = 0;
  for (const p of hw.piers ?? []) if (!p.water) { world.addPost(p.x, p.z, Math.hypot(hw.pierSpec.col[0], hw.pierSpec.col[1]) / 2, { kind: "pier" }); n++; }
  for (const p of hw.rampPiers ?? []) { world.addPost(p.x, p.z, 1.1, { kind: "pier" }); n++; }
  return n;
}

/** Builds the services from the merged map data and the generated road graph JSON (`rawGraph`). Takes about a quarter of a second. */
export function buildServices(data, rawGraph) {
  const world = buildWorldCollision(data), graph = buildRoadGraph(rawGraph, { sdf: (x, z) => world.sdf(x, z, 16) });
  addPierCollision(world, rawGraph.expressway);   // after the graph: ground roads are laid out against buildings and water only, the piers were placed clear of them
  addBillboardCollision(world, data.places);       // the two concrete footings of each billboard are solid (the screen is 8 m up and is not); they stand well clear of every road, so nothing that drives or walks is ever in their way
  const nav = createNav({ world, graph }), net = buildRoadNet(data);
  return { data, world, graph, nav, net };
}

let cache = null, rawFetch = null;
/**
 * The generated road graph JSON, fetched ONCE per page (the fetch does not need the map data, so it can start the moment the world starts loading, long before the map opens).
 * A failed fetch is not remembered, so a retry can succeed.
 */
export function fetchRoadGraphRaw() {
  return (rawFetch ??= fetch(dataUrl("oau-roadgraph.json")).then((r) => { if (!r.ok) throw new Error("road graph " + r.status); return r.json(); }).catch((e) => { rawFetch = null; throw e; }));
}

/** The shared services for this map data (browser). Fetches the road graph the first time (or uses the one already on its way); later calls return the same promise. */
export function loadServices(data) {
  if (cache?.data === data) return cache.promise;
  const entry = { data, promise: null, svc: null };
  entry.promise = fetchRoadGraphRaw().then((raw) => (entry.svc = buildServices(data, raw))).catch((e) => { if (cache === entry) cache = null; throw e; });
  cache = entry; return entry.promise;
}

/** The services for this map data if they are already built (no waiting, no building), else null. The map uses it to draw the roads in the very first frame. */
export const peekServices = (data) => (cache?.data === data ? cache.svc : null);