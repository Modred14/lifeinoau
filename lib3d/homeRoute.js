// lib3d/homeRoute.js
// Walking about INSIDE the house on the map. The street planner (lib3d/walker.js createNav) keeps over a metre away from every wall, which a room does not have; indoors the home's own
// planner is used instead: the room's grid (lib/room.js findPath: furniture cells are blocked, a wall is crossed only through its doorway), in the map's metres. Pure JS (no three.js).
import { blockedCells, findPath } from "../lib/room.js";
import { WALK_R } from "./walker.js";

/**
 * site: the compound's site (lib3d/homeSite.js, `interior`), room, items. `world`: the collision world (used only to straighten a route where a straight line is clear).
 * Returns { route(from, to) -> [[x, z]...] | null, cellOf(x, z) -> [i, j] }. Points are { x, z } in metres on the map.
 */
export function createIndoorRouter(site, room, items, world = null) {
  let blocked = blockedCells(items ?? [], room);
  const cellOf = (x, z) => { const [cx, cz] = site.toCell(x, z); return [Math.min(room.w - 1, Math.max(0, Math.floor(cx))), Math.min(room.d - 1, Math.max(0, Math.floor(cz)))]; };
  const centre = (c) => site.F.toWorld(c[0] + 0.5, c[1] + 0.5);
  /** Takes out the corners of the cell-by-cell route wherever the person can walk straight (never closer to a wall than their own radius and a little more). */
  function pull(pts) {
    if (!world || pts.length < 3) return pts; const out = [pts[0]]; let i = 0;
    while (i < pts.length - 1) { let j = pts.length - 1; for (; j > i + 1; j--) if (world.segmentClear(pts[i][0], pts[i][1], pts[j][0], pts[j][1], WALK_R + 0.1, { bodies: false })) break; out.push(pts[j]); i = j; }
    return out;
  }
  return {
    cellOf, setItems(next) { blocked = blockedCells(next ?? [], room); },
    route(from, to) {
      const a = cellOf(from.x, from.z), b = cellOf(to.x, to.z);
      if (a[0] === b[0] && a[1] === b[1]) return [[from.x, from.z], [to.x, to.z]];
      const cells = findPath(room, blocked, a, b); if (!cells.length) return null;
      return pull([[from.x, from.z], ...cells.slice(0, -1).map(centre), [to.x, to.z]]);
    },
  };
}
