// lib3d/worldsvc.js
// The world's movement services, built once per map and shared: the road graph (lanes, junctions, routing), the collision world (every solid thing),
// the walking planner, and the old road net (which still knows where each building's door is). The travel sheet's estimates and the trip itself both
// use THIS object, so what the sheet promises is what the trip does. Pure JS apart from fetching the road graph in the browser.
import { buildRoadGraph } from "./roadgraph.js";
import { buildWorldCollision } from "./collide.js";
import { createNav } from "./walker.js";
import { buildRoadNet } from "./roadnet.js";

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
  const nav = createNav({ world, graph }), net = buildRoadNet(data);
  return { data, world, graph, nav, net };
}

let cache = null;
/** The shared services for this map data (browser). Fetches the road graph the first time; later calls return the same promise. */
export function loadServices(data) {
  if (cache?.data === data) return cache.promise;
  const promise = fetch("/data/oau-roadgraph.json").then((r) => { if (!r.ok) throw new Error("road graph " + r.status); return r.json(); }).then((raw) => buildServices(data, raw)).catch((e) => { if (cache?.data === data) cache = null; throw e; });
  cache = { data, promise }; return promise;
}