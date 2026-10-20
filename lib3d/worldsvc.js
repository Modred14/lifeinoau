// lib3d/worldsvc.js
// The world's movement services, built once per map and shared: the road graph (lanes, junctions, routing), the collision world (every solid thing),
// the walking planner, and the old road net (which still knows where each building's door is). The travel sheet's estimates and the trip itself both
// use THIS object, so what the sheet promises is what the trip does. Pure JS apart from fetching the road graph in the browser.
import { buildRoadGraph } from "./roadgraph.js";
import { buildWorldCollision } from "./collide.js";
import { createNav } from "./walker.js";
import { buildRoadNet } from "./roadnet.js";

/** Builds the services from the merged map data and the generated road graph JSON (`rawGraph`). Takes about a quarter of a second. */
export function buildServices(data, rawGraph) {
  const world = buildWorldCollision(data), graph = buildRoadGraph(rawGraph, { sdf: (x, z) => world.sdf(x, z, 12) }), nav = createNav({ world, graph }), net = buildRoadNet(data);
  return { data, world, graph, nav, net };
}

let cache = null;
/** The shared services for this map data (browser). Fetches the road graph the first time; later calls return the same promise. */
export function loadServices(data) {
  if (cache?.data === data) return cache.promise;
  const promise = fetch("/data/oau-roadgraph.json").then((r) => { if (!r.ok) throw new Error("road graph " + r.status); return r.json(); }).then((raw) => buildServices(data, raw)).catch((e) => { if (cache?.data === data) cache = null; throw e; });
  cache = { data, promise }; return promise;
}