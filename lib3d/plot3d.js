// lib3d/plot3d.js
// Draws the home's plot (lib/plot.js) around the room: a square lawn inside a boundary wall, the garage beside the house, a paved driveway from the
// garage door through the vehicle gate to the road, the footpath and front walk, hedges and trees, and the neighbouring plots either side.
// Everything is placed from the same rectangles the server uses to check where outdoor things may stand, so what you see is what is allowed.
// World coordinates: x = cell - w/2, z = cell - d/2 (the room is centred on the origin); the lawn's top is at y = GROUND.
import * as THREE from "three";
import { plotFor, PLOT_RULES } from "../lib/plot.js";

export const GROUND = -0.36;
const hits = (r, x, z, w, d) => x < r.x1 && x + w > r.x0 && z < r.z1 && z + d > r.z0;

/** Returns { group, trees } where trees are the palms and bushes that the room fades out when they stand between you and the house. */
export function buildPlot(room, { mat, tree }) {
  const P = plotFor(room), W = room.w, D = room.d, g = new THREE.Group(), trees = [], R = PLOT_RULES;
  const wx = (x) => x - W / 2, wz = (z) => z - D / 2;
  const M = {
    grass: mat("#8fb592", { roughness: 1 }), lawn: mat("#a3c9a3", { roughness: 1 }), lawn2: mat("#98c09a", { roughness: 1 }),
    paving: mat("#a2a39e"), pavingJoint: mat("#8b8c87"), path: mat("#d3cab6", { roughness: 0.95 }), garageFloor: mat("#8b8f8e"), concrete: mat("#bdb9ab", { roughness: 1 }),
    asphalt: mat("#3e4446", { roughness: 0.95 }), line: mat("#ece6cf"), kerb: mat("#c9c6bb"), pavement: mat("#c2bfb3"), verge: mat("#8fb592", { roughness: 1 }),
    wall: mat("#e6dfd0"), cap: mat("#f6f2e7"), garageWall: mat("#ddd6c8"), roof: mat("#4b5962"), door: mat("#6b747a", { metalness: 0.3, roughness: 0.5 }), trim: mat("#f5f1e7"),
    post: mat("#2b2f3a"), lamp: mat("#ffd98a", { emissive: "#ffcc67", emissiveIntensity: 1.1 }), hedge: mat("#4f7f4f", { roughness: 1 }), hedge2: mat("#5f9358", { roughness: 1 }),
    nWall: mat("#d9cfc0"), nRoof: mat("#7b6a5a"), nGlass: mat("#8fb2c4", { roughness: 0.3 }),
  };
  // a box covering the rectangle r (cells), its bottom at y0 and height h
  const slab = (r, y0, h, m, cast = false) => { const w = r.x1 - r.x0, d = r.z1 - r.z0, mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(wx((r.x0 + r.x1) / 2), y0 + h / 2, wz((r.z0 + r.z1) / 2)); mesh.receiveShadow = true; mesh.castShadow = cast; g.add(mesh); return mesh; };
  const at = (mesh, x, z) => { mesh.position.x = wx(x); mesh.position.z = wz(z); return mesh; };
  const pl = P.plot, T = 0.025; // paving lies this proud of the lawn

  // ---- the plot: a square slab with a lawn on top, striped like it was mown ----
  slab(pl, GROUND - 0.27, 0.27, M.grass);
  slab({ x0: pl.x0 + 0.15, x1: pl.x1 - 0.15, z0: pl.z0 + 0.15, z1: pl.z1 - 0.15 }, GROUND - 0.005, 0.01, M.lawn);
  for (let z = pl.z0 + 1; z < pl.z1 - 1; z += 2) slab({ x0: pl.x0 + 1, x1: pl.x1 - 1, z0: z, z1: Math.min(z + 1, pl.z1 - 1) }, GROUND + 0.004, 0.004, M.lawn2);

  // ---- paving: the driveway (joints every three cells), its flared mouth, the footpath, the front walk ----
  slab(P.drive, GROUND, T, M.paving); slab(P.apron, GROUND, T + 0.004, M.paving);
  for (let z = P.drive.z0 + 3; z < P.drive.z1; z += 3) slab({ x0: P.drive.x0, x1: P.drive.x1, z0: z - 0.03, z1: z + 0.03 }, GROUND + T, 0.004, M.pavingJoint);
  slab({ x0: (P.drive.x0 + P.drive.x1) / 2 - 0.03, x1: (P.drive.x0 + P.drive.x1) / 2 + 0.03, z0: P.drive.z0, z1: P.drive.z1 }, GROUND + T, 0.004, M.pavingJoint);
  for (const r of [...P.path, P.link]) slab(r, GROUND, T, M.path);
  slab({ x0: P.doorOut.x - 1.5, x1: P.doorOut.x + 1.5, z0: room.layout ? D : D - 2, z1: room.layout ? D + 1 : D }, GROUND, T + 0.004, M.concrete); // the step outside the front door

  // ---- the road along the south edge, beyond a footpath and a kerb ----
  const rd = P.road, strip = { x0: rd.x0, x1: rd.x1, z0: pl.z1, z1: rd.z0 };
  slab({ x0: strip.x0, x1: strip.x1, z0: strip.z0, z1: strip.z1 }, GROUND - 0.27, 0.27 + T, M.pavement);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z0, z1: rd.z1 }, GROUND - 0.27, 0.27 - 0.03, M.asphalt);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z0 - 0.12, z1: rd.z0 + 0.06 }, GROUND - 0.12, 0.15, M.kerb); slab({ x0: rd.x0, x1: rd.x1, z0: rd.z1 - 0.06, z1: rd.z1 + 0.12 }, GROUND - 0.12, 0.15, M.kerb);
  for (let x = rd.x0 + 1; x < rd.x1 - 2; x += 4) slab({ x0: x, x1: x + 2, z0: (rd.z0 + rd.z1) / 2 - 0.07, z1: (rd.z0 + rd.z1) / 2 + 0.07 }, GROUND - 0.03, 0.01, M.line);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z1 + 0.12, z1: rd.z1 + 2.5 }, GROUND - 0.27, 0.27 + T, M.pavement);

  // ---- the boundary wall, with the vehicle gate and the pedestrian gate left open ----
  const wallH = 0.9, wallT = 0.3, bandC = (edge, dir) => edge + dir * 0.2;
  const run = (xa, xb, za, zb) => { const r = { x0: Math.min(xa, xb) - (xa === xb ? wallT / 2 : 0), x1: Math.max(xa, xb) + (xa === xb ? wallT / 2 : 0), z0: Math.min(za, zb) - (za === zb ? wallT / 2 : 0), z1: Math.max(za, zb) + (za === zb ? wallT / 2 : 0) }; if (r.x1 - r.x0 > 0.01 && r.z1 - r.z0 > 0.01) { slab(r, GROUND, wallH, M.wall, true); slab({ x0: r.x0 - 0.04, x1: r.x1 + 0.04, z0: r.z0 - 0.04, z1: r.z1 + 0.04 }, GROUND + wallH, 0.06, M.cap); } };
  const nz = bandC(pl.z0, 1), sz = bandC(pl.z1, -1), wxl = bandC(pl.x0, 1), exl = bandC(pl.x1, -1);
  run(pl.x0, pl.x1, nz, nz); run(pl.x0, pl.x0, pl.z0, pl.z1); run(pl.x1, pl.x1, pl.z0, pl.z1);
  const gaps = [P.gate, P.footGate].sort((a, b) => a.x0 - b.x0); let cx = pl.x0;
  for (const gp of gaps) { run(cx, gp.x0, sz + 0.5, sz + 0.5); cx = gp.x1; } run(cx, pl.x1, sz + 0.5, sz + 0.5);
  // pillars every four cells and either side of both gates
  const pillar = (x, z, h = 1.25) => { const m = slab({ x0: x - 0.22, x1: x + 0.22, z0: z - 0.22, z1: z + 0.22 }, GROUND, h, M.wall, true); slab({ x0: x - 0.3, x1: x + 0.3, z0: z - 0.3, z1: z + 0.3 }, GROUND + h, 0.08, M.cap); return m; };
  for (const gp of gaps) for (const x of [gp.x0, gp.x1]) pillar(x, sz + 0.5);
  for (let x = pl.x0 + 0.3; x <= pl.x1; x += 4) { if (!gaps.some((gp) => x > gp.x0 - 1 && x < gp.x1 + 1)) pillar(x, sz + 0.5, 1.1); pillar(x, nz, 1.1); }
  for (let z = pl.z0 + 0.3; z <= pl.z1; z += 4) { pillar(pl.x0 + 0.15, z, 1.1); pillar(pl.x1 - 0.15, z, 1.1); }
  for (const gp of gaps) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), M.lamp); lamp.position.set(wx(gp.x0), GROUND + 1.45, wz(sz + 0.5)); g.add(lamp); }

  // ---- the garage: east of the house, its open door facing the driveway ----
  const ga = P.garage, wallW = 0.3, gh = 2.9;
  slab({ x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, GROUND, 0.03, M.garageFloor);
  slab({ x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z0 + wallW }, GROUND, gh, M.garageWall, true);
  slab({ x0: ga.x0, x1: ga.x0 + wallW, z0: ga.z0, z1: ga.z1 }, GROUND, gh, M.garageWall, true); slab({ x0: ga.x1 - wallW, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, GROUND, gh, M.garageWall, true);
  slab({ x0: ga.x0, x1: P.door.x0, z0: ga.z1 - wallW, z1: ga.z1 }, GROUND, gh, M.garageWall, true); slab({ x0: P.door.x1, x1: ga.x1, z0: ga.z1 - wallW, z1: ga.z1 }, GROUND, gh, M.garageWall, true);
  slab({ x0: P.door.x0, x1: P.door.x1, z0: ga.z1 - wallW, z1: ga.z1 }, GROUND + 2.35, gh - 2.35, M.garageWall, true); // lintel over the open door
  slab({ x0: P.door.x0 + 0.05, x1: P.door.x1 - 0.05, z0: ga.z1 - 1.0, z1: ga.z1 - 0.7 }, GROUND + 2.3, 0.07, M.door); // the roll-up door, raised under the roof
  slab({ x0: ga.x0 - 0.35, x1: ga.x1 + 0.35, z0: ga.z0 - 0.35, z1: ga.z1 + 0.6 }, GROUND + gh, 0.22, M.roof, true);
  slab({ x0: P.door.x0 - 0.1, x1: P.door.x1 + 0.1, z0: ga.z1 - 0.02, z1: ga.z1 + 0.05 }, GROUND + 2.3, 0.1, M.trim);
  const gl = new THREE.PointLight(0xffd9a0, 2.2, 7, 1.8); gl.position.set(wx((ga.x0 + ga.x1) / 2), GROUND + 2.2, wz(ga.z1 - 1.5)); g.add(gl);

  // ---- hedges inside the wall (never across a gate or the driveway), and the trees ----
  const gate = (x, z) => [P.gate, P.footGate].some((gp) => x > gp.x0 - 0.9 && x < gp.x1 + 0.9 && z > pl.z1 - 1.6);
  const bush = (x, z, k, i) => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34 * k, 1), i % 2 ? M.hedge : M.hedge2); m.position.set(wx(x), GROUND + 0.28 * k, wz(z)); m.scale.set(1.2, 0.9, 1.2); m.castShadow = true; g.add(m); };
  let n = 0;
  for (let x = pl.x0 + 1.2; x < pl.x1 - 0.8; x += 1.1) { if (!gate(x, pl.z1)) bush(x, pl.z1 - 0.62, 0.9, n++); bush(x, pl.z0 + 0.7, 1, n++); }
  for (let z = pl.z0 + 1.8; z < pl.z1 - 1.5; z += 1.1) { bush(pl.x0 + 0.7, z, 1, n++); bush(pl.x1 - 0.7, z, 1, n++); }
  const spots = [[pl.x0 + 0.65, pl.z0 + 0.65], [pl.x1 - 0.65, pl.z0 + 0.65], [pl.x0 + 0.65, pl.z1 - 0.65], [pl.x1 - 0.65, pl.z1 - 0.65]];
  for (let x = pl.x0 + 4; x < pl.x1 - 3; x += 5) spots.push([x, pl.z0 + 0.65]);
  for (let z = pl.z0 + 5; z < pl.z1 - 4; z += 5) { spots.push([pl.x0 + 0.65, z]); spots.push([pl.x1 - 0.65, z]); }
  spots.forEach(([x, z], i) => { if (P.reserved.some((r) => hits(r, x - 0.4, z - 0.4, 0.8, 0.8)) || gate(x, z)) return; const kind = i % 3 === 0 ? "palm" : "bush", t = tree(kind, i); t.position.set(wx(x), GROUND, wz(z)); t.rotation.y = i * 2.1; t.scale.setScalar(kind === "palm" ? 0.9 : 0.8); g.add(t); trees.push({ g: t, a: Math.atan2(wz(z), wx(x)), kind, s: 1, base: t.scale.x }); });

  // ---- the lots either side: just their lawns and walls (no buildings), beyond a gap, so nothing here ever overlaps another plot ----
  const side = (x0, x1, dir) => {
    const lot = { x0, x1, z0: pl.z0, z1: pl.z1 };
    slab(lot, GROUND - 0.27, 0.27, M.grass); slab({ x0: lot.x0 + 0.1, x1: lot.x1 - 0.1, z0: lot.z0 + 0.1, z1: lot.z1 - 0.1 }, GROUND - 0.005, 0.01, M.lawn);
    slab({ x0: lot.x0, x1: lot.x1, z0: pl.z1 - 0.5, z1: pl.z1 - 0.2 }, GROUND, 0.7, M.wall); // their front wall continues ours along the road
    slab({ x0: dir < 0 ? lot.x1 - 0.1 : lot.x0, x1: dir < 0 ? lot.x1 : lot.x0 + 0.1, z0: lot.z0, z1: lot.z1 }, GROUND, 0.7, M.wall);
  };
  side(pl.x0 - 13, pl.x0 - 0.5, -1); side(pl.x1 + 0.5, pl.x1 + 13, 1);
  void at; void R;
  return { group: g, trees, plot: P };
}
