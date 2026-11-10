// lib3d/structuresolid.js
// The solid things on and beside the roads that people and vehicles must not pass through, added to the collision world from the same data the meshes are built from (pure JS, no three.js):
//   street furniture   every street light, tree and stop sign (lib3d/furnitureplan.js) is a small solid post. They are "soft" for the walking PLANNER only (it may route people past one on a pavement),
//                      but as solid as a wall to everything that moves.
//   embankments        where a ramp or a descent is within walking-under height of the ground (below WALK_UNDER_H) it is solid fill: a person cannot walk into it or under it. Walls run along both
//                      sides and across the low mouth. They stop only people (tag foot): a car drives ALONG the road on top, so the road itself is never blocked.
import { heightOn, LV_RAMP } from "./roadgraph.js";
import { WALK_UNDER_H } from "./highwaytails.js";

/** Below this height the deck is flush with the ground (no wall: there is nothing to walk into). */
export const FLUSH_H = 0.25;
const SOFT_FURNITURE = 0.55, SOFT_WALL = 0.5, STEP = 3;

/** One post per standing thing in the plan. Returns the number added. */
export function addFurnitureCollision(world, plan) {
  for (const [x, z, r, kind] of plan.solids) world.addPost(x, z, r, { kind, soft: SOFT_FURNITURE });
  return plan.solids.length;
}

/** Foot-only walls round the low (solid) part of every ramp and descent of the graph. Returns the number of wall segments. */
export function addEmbankmentCollision(world, graph) {
  let n = 0; const tag = { kind: "embankment", foot: true, soft: SOFT_WALL };
  const wall = (a, b) => { world.addWall(a[0], a[1], b[0], b[1], tag); n++; };
  for (const e of graph.edges) {
    if (!e.hw || e.mask !== LV_RAMP) continue;                       // ramps and descents
    const m = Math.ceil(e.len / STEP), sOf = (i) => Math.min(e.len, i * STEP), lowAt = (i) => { const h = heightOn(e, sOf(i)); return h >= FLUSH_H && h <= WALK_UNDER_H; };
    const side = (s, k) => { const p = e.path.at(s, {}); return [p.x - p.hz * k * e.half, p.z + p.hx * k * e.half]; };
    for (let i = 0; i <= m; i++) {
      if (!lowAt(i)) continue;
      let j = i; while (j + 1 <= m && lowAt(j + 1)) j++;               // the run i..j is solid fill
      for (let k = i; k < j; k++) for (const sg of [-1, 1]) wall(side(sOf(k), sg), side(sOf(k + 1), sg));
      // across the mouth, where the road comes up out of the ground (not at the end where it is high enough to walk under)
      for (const [at, beyond] of [[i, i - 1], [j, j + 1]]) { const sb = Math.max(0, Math.min(e.len, sOf(beyond))); if (beyond < 0 || beyond > m || heightOn(e, sb) < FLUSH_H) wall(side(sOf(at), -1), side(sOf(at), 1)); }
      i = j;
    }
  }
  return n;
}
