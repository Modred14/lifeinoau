// lib3d/interiors/routing.js
// Where an automatic walk goes, including up and down the stairs. Pure functions (no 3D library, no React) so the scene walks the route and the
// tests walk the very same route against every real interior.
//
// The scene's follower (lib3d/interiors/scene.js) moves the character toward one waypoint after another with the ordinary movePlayer(), so a route is
// just a list of points. Stairs need no special case: the ramp lifts the character as they walk along it, and the floor changes by itself once they are
// past the halfway point (movePlayer in compile.js). A route to another floor is therefore
//     [walk on this floor to a spot on the ramp BEFORE halfway]  +  [climb along the ramp to a spot AFTER halfway]  +  [walk on the other floor].
// The two spots are real free cells of that floor's walking grid, so the walk on each floor goes through the doorways people really use (the top of a
// staircase often ends at a wall, with the way out through a side door part-way up the last stretch).

const FOOT = [0.1, 0.22, 0.34]; // where on the ramp (0 = bottom, 1 = top) to step on or off at the bottom: before the floor changes
const TOP = [0.62, 0.74, 0.86, 0.96]; // and at the top: after the floor has changed

/** A point on the middle line of a stair, `t` of the way up (0 = bottom end, 1 = top end). */
export function stairPoint(s, t) {
  const mx = (s.x0 + s.x1) / 2, mz = (s.z0 + s.z1) / 2;
  if (s.dx) return [s.dx > 0 ? s.x0 + t * s.len : s.x1 - t * s.len, mz];
  return [mx, s.dz > 0 ? s.z0 + t * s.len : s.z1 - t * s.len];
}

const lengthOf = (from, pts) => { let len = 0, px = from[0], pz = from[1]; for (const q of pts) { len += Math.hypot(q[0] - px, q[1] - pz); px = q[0]; pz = q[1]; } return len; };

/** The waypoints of a walk on ONE floor from (ax, az) to (bx, bz), or null when there is no way. The first point (where you stand) is left out. */
function onFloor(nav, ax, az, bx, bz) {
  const path = nav.path(ax, az, bx, bz); if (!path || path.length < 1) return null;
  return [...path.slice(1), [bx, bz]];
}

/** The shortest of several walks, one to or from each candidate spot. `walk(spot)` gives { pts, from } (the waypoints and where they start), or null. Returns { spot, pts, length } or null. */
function bestOf(spots, walk) {
  let best = null;
  for (const spot of spots) { const w = walk(spot); if (!w) continue; const length = lengthOf(w.from, w.pts); if (!best || length < best.length) best = { spot, pts: w.pts, length }; }
  return best;
}

/**
 * The route from where the player stands to (x, z) on `floor`.
 *   c      the compiled interior (buildInterior)
 *   from   { x, z, fl }: where the player stands and on which floor
 * Returns { pts, length } (the waypoints to walk, and the walking distance in metres), or null when the spot cannot be reached
 * (no route on a floor, a floor the building does not have, or another floor with no stairs to it).
 */
export function planRoute(c, from, x, z, floor) {
  const fl = Number.isInteger(floor) ? floor : from.fl;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(from.x) || !Number.isFinite(from.z) || fl < 0 || fl >= c.floors) return null;
  if (fl === from.fl) { const pts = onFloor(c.navPlayer[fl], from.x, from.z, x, z); return pts ? { pts, length: lengthOf([from.x, from.z], pts) } : null; }
  // another floor: use the stairs that give the shortest walk
  const up = fl > from.fl; let best = null;
  for (const s of c.stairs ?? []) {
    const nvA = c.navPlayer[from.fl], nvB = c.navPlayer[fl];
    const enter = bestOf((up ? FOOT : TOP).map((t) => stairPoint(s, t)).filter((p) => nvA.isFree(p[0], p[1])), (p) => { const pts = onFloor(nvA, from.x, from.z, p[0], p[1]); return pts && { pts, from: [from.x, from.z] }; }); if (!enter) continue;
    const leave = bestOf((up ? TOP : FOOT).map((t) => stairPoint(s, t)).filter((p) => nvB.isFree(p[0], p[1])), (p) => { const pts = onFloor(nvB, p[0], p[1], x, z); return pts && { pts, from: p }; }); if (!leave) continue;
    const pts = [...enter.pts, leave.spot, ...leave.pts], length = lengthOf([from.x, from.z], pts);
    if (!best || length < best.length) best = { pts, length };
  }
  return best;
}
