// lib3d/edges.js
// Makes the rim of the mapped area look finished instead of cut off. The source map is a rectangular screenshot, so roads and paved areas stop in a
// straight line at its edge. This file (1) carries every road that reaches the edge on outwards as a tapering, fading stub, so roads seem to leave
// the map, and (2) plants a belt of trees outside the edge, thick near it and thinning out, which also fills the empty wedge in the top-left corner
// that the screenshot does not cover. All of it is decoration, not survey. Browser only (three.js).
import * as THREE from "three";

const rng = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

/** Road edges that lie on the rim of `bounds` (within `tol` metres): [{ side, a, b }] with a and b along the rim, in metres. Pure. */
export function rimEdges(roads, bounds, tol = 3) {
  const out = [], { x0, x1, z0, z1 } = bounds;
  for (const r of roads) for (const ring of [r.pts, ...(r.holes ?? [])]) for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length];
    const on = (k, v) => Math.abs(p[k] - v) < tol && Math.abs(q[k] - v) < tol;
    for (const [side, k, v] of [["E", 0, x1], ["W", 0, x0], ["N", 1, z0], ["S", 1, z1]]) if (on(k, v)) { const o = 1 - k, a = Math.min(p[o], q[o]), bb = Math.max(p[o], q[o]); if (bb - a >= 3) out.push({ side, a, b: bb, at: v }); } }
  return out;
}

/** Merge touching/overlapping edges on the same side into runs, so a road cut into pieces becomes one stub. */
export function mergeRuns(edges, gap = 2) {
  const out = []; for (const side of ["E", "W", "N", "S"]) { const es = edges.filter((e) => e.side === side).sort((p, q) => p.a - q.a); let cur = null;
    for (const e of es) { if (cur && e.a <= cur.b + gap) { cur.b = Math.max(cur.b, e.b); } else { cur = { side, a: e.a, b: e.b, at: e.at }; out.push(cur); } } }
  return out;
}

/** data: map data, S: metres to scene units, color: road colour. Returns { group, dispose }. */
export function buildEdges(data, S, { color = "#343b46", keepOut = [] } = {}) {
  const b = data.bounds, group = new THREE.Group(), runs = mergeRuns(rimEdges(data.roads, b)), pos = [], col = [], idx = [], c = new THREE.Color(color), stubs = [];
  for (const r of runs) {
    const width = r.b - r.a, mid = (r.a + r.b) / 2, L = width < 30 ? 420 : 160, tip = width < 30 ? 0.7 : 0.45, sign = r.side === "E" || r.side === "S" ? 1 : -1, horiz = r.side === "E" || r.side === "W";
    const P = (along, out) => (horiz ? [r.at + sign * out, along] : [along, r.at + sign * out]); // [x, z] metres
    const q = [P(r.a, 0), P(r.b, 0), P(mid + (width * tip) / 2, L), P(mid - (width * tip) / 2, L)], base = pos.length / 3;
    q.forEach(([x, z], i) => { pos.push(x * S, 0, z * S); col.push(c.r, c.g, c.b, i < 2 ? 1 : 0); });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3); if (sign < 0 !== horiz && false) idx.reverse();
    stubs.push({ x0: Math.min(...q.map((p) => p[0])) - 10, x1: Math.max(...q.map((p) => p[0])) + 10, z0: Math.min(...q.map((p) => p[1])) - 10, z1: Math.max(...q.map((p) => p[1])) + 10 });
  }
  if (pos.length) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4)); g.setIndex(idx); g.computeVertexNormals();
    // the winding depends on the side; DoubleSide keeps every stub visible from above whichever way it faces
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.95, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })); m.position.y = 0.08; m.receiveShadow = true; m.renderOrder = 1; m.name = "road-stubs"; group.add(m); }

  // ---- tree belt: thick at the rim, thinning to nothing 260 m out; plus a light forest in the empty top-left wedge ----
  const rnd = rng(31), trees = [], depth = 260, step = 15, clear = (x, z) => !stubs.some((s) => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1) && !keepOut.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr);
  const sides = [["N", b.x0 - 250, b.x1 + 250, (t) => [t, b.z0], -1], ["S", b.x0 - 250, b.x1 + 250, (t) => [t, b.z1], 1], ["W", b.z0 - 250, b.z1 + 250, (t) => [b.x0, t], -1], ["E", b.z0 - 250, b.z1 + 250, (t) => [b.x1, t], 1]];
  for (const [side, from, to, at, dir] of sides) for (let t = from; t < to; t += step) { const [bx, bz] = at(t + rnd() * step), d = rnd() * depth, keep = Math.pow(1 - d / depth, 1.4); if (rnd() > keep) continue;
    const x = side === "E" || side === "W" ? bx + dir * d : bx + (rnd() - 0.5) * step, z = side === "N" || side === "S" ? bz + dir * d : bz + (rnd() - 0.5) * step;
    if (clear(x, z)) trees.push([x, z, 0.8 + rnd() * 0.9]); if (trees.length > 4200) break; }
  for (const o of data.outside ?? []) { const xs = o.pts.map((p) => p[0]), zs = o.pts.map((p) => p[1]), ax = Math.min(...xs), bx = Math.max(...xs), az = Math.min(...zs), bz = Math.max(...zs);
    for (let n = 0; n < 6000 && trees.length < 5200; n++) { const x = ax + rnd() * (bx - ax), z = az + rnd() * (bz - az); if (inPoly(x, z, o.pts) && rnd() < 0.5 && clear(x, z)) trees.push([x, z, 0.8 + rnd() * 0.9]); } }
  let mesh = null;
  if (trees.length) { const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 5), new THREE.MeshStandardMaterial({ color: "#4a3426" }), trees.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), trees.length), o = new THREE.Object3D(), cc = new THREE.Color();
    trees.forEach(([x, z, k], i) => { o.position.set(x * S, 0.5 * k, z * S); o.scale.setScalar(k); o.updateMatrix(); trunk.setMatrixAt(i, o.matrix); o.position.set(x * S, 1.5 * k, z * S); o.updateMatrix(); crown.setMatrixAt(i, o.matrix); crown.setColorAt(i, cc.set("#2f6b3b").lerp(new THREE.Color("#5b9a45"), rnd())); });
    trunk.castShadow = crown.castShadow = false; group.add(trunk, crown); mesh = { trunk, crown }; }
  return { group, runs, treeCount: trees.length, dispose() { group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); } };
}