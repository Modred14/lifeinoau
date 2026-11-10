// lib3d/woodland.js
// The woodland trees of the map: where they stand, which of them are shown, and the solid trunk of each. Pure JS (no three.js), so lib3d/campusReal.js (which draws them) and lib3d/worldsvc.js (which makes
// them solid) work from the very same list: a tree you can see is a tree you cannot walk through, and a tree that is hidden (because a road runs there) is not an obstacle either.
const rngOf = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

/** The trunk of a woodland tree at scale k is drawn 0.14 map units thick at its foot (the map is drawn at 0.1 units per metre, so the trees are deliberately big): 1.4 m * k. */
export const TRUNK_M = 1.4;

/** [x, z, k] of every woodland tree: scattered inside the wooded areas at least 8 m apart, up to 900. The same seed the drawing has always used. */
export function woodlandTrees(data) {
  const rnd = rngOf(7), trees = [];
  for (const w of data.areas.wood) {
    const xs = w.pts.map((p) => p[0]), zs = w.pts.map((p) => p[1]), ax = Math.min(...xs), bx = Math.max(...xs), az = Math.min(...zs), bz = Math.max(...zs);
    for (let t = 0; t < 4000 && trees.length < 900; t++) { const x = ax + rnd() * (bx - ax), z = az + rnd() * (bz - az); if (inPoly(x, z, w.pts) && !trees.some((q) => Math.hypot(q[0] - x, q[1] - z) < 8)) trees.push([x, z, 0.8 + rnd() * 0.9]); }
  }
  return trees;
}
/** Is this tree hidden because a road or its pavement lies on it (or within 2.2 m)? The trees were scattered before there were roads; this is the rule that keeps a trunk from growing through asphalt. */
export const treeOnRoad = (graph, x, z, surf = {}) => !!graph && [[0, 0], [2.2, 0], [-2.2, 0], [0, 2.2], [0, -2.2]].some(([dx, dz]) => graph.surfaceAt(x + dx, z + dz, surf).cls !== 0);

/** Every tree that is shown becomes a solid trunk. Returns how many. */
export function addWoodlandCollision(world, trees, graph) {
  let n = 0; const surf = {};
  for (const [x, z, k] of trees) { if (treeOnRoad(graph, x, z, surf)) continue; world.addPost(x, z, TRUNK_M * k, { kind: "wood-tree" }); n++; }
  return n;
}
