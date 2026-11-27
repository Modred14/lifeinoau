// lib3d/plot3d.js
// Draws the home's plot (lib/plot.js) around the room: a square lawn inside a boundary wall, the garage beside the house, a paved driveway from the
// garage door through the vehicle gate to the road, the footpath and front walk, hedges and trees, and the neighbouring plots either side.
// Everything is placed from the same rectangles the server uses to check where outdoor things may stand, so what you see is what is allowed.
// World coordinates: x = cell - w/2, z = cell - d/2 (the room is centred on the origin); the lawn's top is at y = GROUND.
import * as THREE from "three";
import { plotFor, PLOT_RULES } from "../lib/plot.js";
import { homeStyle } from "../lib/homeStyle.js";
import { createHolder } from "./modelCache.js";

export const GROUND = -0.36;
const hits = (r, x, z, w, d) => x < r.x1 && x + w > r.x0 && z < r.z1 && z + d > r.z0;

/**
 * Returns { group, trees, plot, release } where trees are the palms and bushes that the room fades out when they stand between you and the house.
 * A plot is a few hundred boxes and hedges, and most of them share one of a few dozen sizes (every wall run, pillar, paving joint and bush), so the geometry is shared through
 * lib3d/modelCache.js: building the plot again (re-entering the home, resizing it) makes new meshes and materials over geometry that is already built. Each mesh keeps its own
 * position, material and shadow flags. Call release() (or dispose the group with room.js's dispose(), which does) when the plot goes.
 */
export function buildPlot(room, { mat, tree, embedded = false, garage = true }) {
  const P = plotFor(room), st = homeStyle(room), W = room.w, D = room.d, g = new THREE.Group(), trees = [], R = PLOT_RULES, hold = createHolder();
  const boxGeo = (w, h, d) => hold.get(`plot:box:${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d), { priority: 1 });
  const icoGeo = (r, detail) => hold.get(`plot:ico:${r}|${detail}`, () => new THREE.IcosahedronGeometry(r, detail), { priority: 1 });
  g.userData.release = hold.releaseAll;
  const wx = (x) => x - W / 2, wz = (z) => z - D / 2;
  const M = {
    grass: mat("#8fb592", { roughness: 1 }), lawn: mat("#a3c9a3", { roughness: 1 }), lawn2: mat("#98c09a", { roughness: 1 }),
    paving: mat("#a2a39e"), pavingJoint: mat("#8b8c87"), path: mat("#d3cab6", { roughness: 0.95 }), garageFloor: mat("#8b8f8e"), concrete: mat("#bdb9ab", { roughness: 1 }),
    asphalt: mat("#3e4446", { roughness: 0.95 }), line: mat("#ece6cf"), kerb: mat("#c9c6bb"), pavement: mat("#c2bfb3"), verge: mat("#8fb592", { roughness: 1 }),
    wall: mat(st.fence), cap: mat(st.trim), garageWall: mat(st.garage), roof: mat(st.roofColor), door: mat("#6b747a", { metalness: 0.3, roughness: 0.5 }), trim: mat("#f5f1e7"),
    post: mat("#2b2f3a"), lamp: mat("#ffd98a", { emissive: "#ffcc67", emissiveIntensity: 1.1 }), hedge: mat("#4f7f4f", { roughness: 1 }), hedge2: mat("#5f9358", { roughness: 1 }),
    laneFloor: mat("#9a9e9c"),
  };
  // a box covering the rectangle r (cells), its bottom at y0 and height h
  // Everything beyond the boundary wall (the footpath, kerbs and the road) goes in `roadG`, which the room shows only while you are outside: from indoors the plot ends at its wall.
  const roadG = new THREE.Group(); roadG.name = "plot-road"; g.add(roadG); let into = g;
  const slab = (r, y0, h, m, cast = false) => { const w = r.x1 - r.x0, d = r.z1 - r.z0, mesh = new THREE.Mesh(boxGeo(w, h, d), m); mesh.position.set(wx((r.x0 + r.x1) / 2), y0 + h / 2, wz((r.z0 + r.z1) / 2)); mesh.receiveShadow = true; mesh.castShadow = cast; into.add(mesh); return mesh; };
  // paving that runs on out to the road: the part inside the wall is the plot's, the part beyond it belongs to the road
  const paved = (r, y0, h, m) => { const cut = pl.z1; if (r.z0 < cut) slab({ ...r, z1: Math.min(r.z1, cut) }, y0, h, m); if (r.z1 > cut) { into = roadG; slab({ ...r, z0: Math.max(r.z0, cut) }, y0, h, m); into = g; } };
  const at = (mesh, x, z) => { mesh.position.x = wx(x); mesh.position.z = wz(z); return mesh; };
  const pl = P.plot, T = 0.025; // paving lies this proud of the lawn

  // ---- the plot: a square slab with a lawn on top, striped like it was mown ----
  slab(pl, GROUND - 0.27, 0.27, M.grass);
  slab({ x0: pl.x0 + 0.15, x1: pl.x1 - 0.15, z0: pl.z0 + 0.15, z1: pl.z1 - 0.15 }, GROUND - 0.005, 0.01, M.lawn);
  for (let z = pl.z0 + 1; z < pl.z1 - 1; z += 2) slab({ x0: pl.x0 + 1, x1: pl.x1 - 1, z0: z, z1: Math.min(z + 1, pl.z1 - 1) }, GROUND + 0.004, 0.004, M.lawn2);

  // ---- paving: the driveway (joints every three cells), its flared mouth, the footpath, the front walk ----
  paved(P.drive, GROUND, T, M.paving); paved(P.apron, GROUND, T + 0.004, M.paving);
  for (let z = P.drive.z0 + 3; z < P.drive.z1; z += 3) paved({ x0: P.drive.x0, x1: P.drive.x1, z0: z - 0.03, z1: z + 0.03 }, GROUND + T, 0.004, M.pavingJoint);
  paved({ x0: (P.drive.x0 + P.drive.x1) / 2 - 0.03, x1: (P.drive.x0 + P.drive.x1) / 2 + 0.03, z0: P.drive.z0, z1: P.drive.z1 }, GROUND + T, 0.004, M.pavingJoint);
  for (const r of [...P.path, P.link]) paved(r, GROUND, T, M.path);
  slab({ x0: P.doorOut.x - 1.5, x1: P.doorOut.x + 1.5, z0: room.layout ? D : D - 2, z1: room.layout ? D + 1 : D }, GROUND, T + 0.004, M.concrete); // the step outside the front door

  // ---- the road along the south edge, beyond a footpath and a kerb ----
  into = roadG; const rd = P.road, strip = { x0: rd.x0, x1: rd.x1, z0: pl.z1, z1: rd.z0 };
  slab({ x0: strip.x0, x1: strip.x1, z0: strip.z0, z1: strip.z1 }, GROUND - 0.27, 0.27 + T, M.pavement);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z0, z1: rd.z1 }, GROUND - 0.27, 0.27 - 0.03, M.asphalt);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z0 - 0.12, z1: rd.z0 + 0.06 }, GROUND - 0.12, 0.15, M.kerb); slab({ x0: rd.x0, x1: rd.x1, z0: rd.z1 - 0.06, z1: rd.z1 + 0.12 }, GROUND - 0.12, 0.15, M.kerb);
  for (let x = rd.x0 + 1; x < rd.x1 - 2; x += 4) slab({ x0: x, x1: x + 2, z0: (rd.z0 + rd.z1) / 2 - 0.07, z1: (rd.z0 + rd.z1) / 2 + 0.07 }, GROUND - 0.03, 0.01, M.line);
  slab({ x0: rd.x0, x1: rd.x1, z0: rd.z1 + 0.12, z1: rd.z1 + 2.5 }, GROUND - 0.27, 0.27 + T, M.pavement);
  into = g;

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

  // ---- the garage: a hall east of the house, its front open to the driveway. A lane runs down the middle and the cars stand in painted bays either side of it, nose to the lane ----
  // (lib/plot.js: P.bays; lib3d/compoundParking.js puts the vehicles in them). Low walls and a frame keep it open to the camera, so every car can be seen.
  if (garage) { // the /buy preview shows the house and a small compound only: no garage hall, bays or lane (the vehicle storage in the game itself is untouched)
  const ga = P.garage, wallW = 0.3, wallH2 = 1.15, postH = 2.9, lane = P.lane;
  slab({ x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, GROUND, 0.03, M.garageFloor);
  slab({ x0: lane.x0, x1: lane.x1, z0: ga.z0 + wallW, z1: ga.z1 }, GROUND + 0.03, 0.004, M.laneFloor); // the lane is a shade lighter than the bays
  for (const side of [-1, 1]) for (let row = 0; row <= P.bays.length / 2; row++) { // the white lines between bays, and the line along the lane's edge
    const z = ga.z1 - PLOT_RULES.bayFront + PLOT_RULES.bayPitch / 2 - row * PLOT_RULES.bayPitch; if (z < ga.z0 + wallW + 0.2) continue;
    const x0 = side < 0 ? ga.x0 + wallW : lane.x1, x1 = side < 0 ? lane.x0 : ga.x1 - wallW;
    slab({ x0, x1, z0: z - 0.04, z1: z + 0.04 }, GROUND + 0.034, 0.004, M.line);
  }
  slab({ x0: lane.x0 - 0.04, x1: lane.x0 + 0.04, z0: ga.z0 + wallW, z1: ga.z1 }, GROUND + 0.034, 0.004, M.line); slab({ x0: lane.x1 - 0.04, x1: lane.x1 + 0.04, z0: ga.z0 + wallW, z1: ga.z1 }, GROUND + 0.034, 0.004, M.line);
  slab({ x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z0 + wallW }, GROUND, wallH2, M.garageWall, true); // back
  slab({ x0: ga.x0, x1: ga.x0 + wallW, z0: ga.z0, z1: ga.z1 }, GROUND, wallH2, M.garageWall, true); slab({ x0: ga.x1 - wallW, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, GROUND, wallH2, M.garageWall, true); // west and east sides
  slab({ x0: ga.x0, x1: P.door.x0, z0: ga.z1 - wallW, z1: ga.z1 }, GROUND, wallH2, M.garageWall, true); slab({ x0: P.door.x1, x1: ga.x1, z0: ga.z1 - wallW, z1: ga.z1 }, GROUND, wallH2, M.garageWall, true); // the front, either side of the open lane
  for (const r of [{ x0: ga.x0, x1: ga.x1, z0: ga.z0, z1: ga.z0 + wallW }, { x0: ga.x0, x1: ga.x0 + wallW, z0: ga.z0, z1: ga.z1 }, { x0: ga.x1 - wallW, x1: ga.x1, z0: ga.z0, z1: ga.z1 }, { x0: ga.x0, x1: P.door.x0, z0: ga.z1 - wallW, z1: ga.z1 }, { x0: P.door.x1, x1: ga.x1, z0: ga.z1 - wallW, z1: ga.z1 }])
    slab({ x0: r.x0 - 0.03, x1: r.x1 + 0.03, z0: r.z0 - 0.03, z1: r.z1 + 0.03 }, GROUND + wallH2, 0.06, M.cap); // a cap along every wall
  // the frame: a post at each corner and either side of the opening, and beams over the walls and across the lane (open to the sky, so nothing hides a car)
  const post = (x, z) => slab({ x0: x - 0.16, x1: x + 0.16, z0: z - 0.16, z1: z + 0.16 }, GROUND, postH, M.cap, true);
  for (const [x, z] of [[ga.x0 + 0.15, ga.z0 + 0.15], [ga.x1 - 0.15, ga.z0 + 0.15], [ga.x0 + 0.15, ga.z1 - 0.15], [ga.x1 - 0.15, ga.z1 - 0.15], [P.door.x0, ga.z1 - 0.15], [P.door.x1, ga.z1 - 0.15]]) post(x, z);
  for (let z = ga.z0 + 0.15 + PLOT_RULES.bayPitch * 2; z < ga.z1 - 1; z += PLOT_RULES.bayPitch * 2) { post(ga.x0 + 0.15, z); post(ga.x1 - 0.15, z); }
  const beam = (r) => slab(r, GROUND + postH, 0.14, M.cap, true), bt = 0.09;
  beam({ x0: ga.x0, x1: ga.x1, z0: ga.z0 + 0.15 - bt, z1: ga.z0 + 0.15 + bt }); beam({ x0: ga.x0, x1: ga.x1, z0: ga.z1 - 0.15 - bt, z1: ga.z1 - 0.15 + bt });
  beam({ x0: ga.x0 + 0.15 - bt, x1: ga.x0 + 0.15 + bt, z0: ga.z0, z1: ga.z1 }); beam({ x0: ga.x1 - 0.15 - bt, x1: ga.x1 - 0.15 + bt, z0: ga.z0, z1: ga.z1 });
  for (let z = ga.z0 + PLOT_RULES.bayPitch * 2; z < ga.z1 - 1; z += PLOT_RULES.bayPitch * 2) beam({ x0: ga.x0, x1: ga.x1, z0: z - bt, z1: z + bt }); // cross beams over the lane
  if (!embedded) for (const z of [ga.z1 - 4, (ga.z0 + ga.z1) / 2, ga.z0 + 4]) { const gl = new THREE.PointLight(0xffd9a0, 1.6, 12, 1.8); gl.position.set(wx((lane.x0 + lane.x1) / 2), GROUND + 2.6, wz(z)); g.add(gl); } // lamps down the lane

  } // garage
  // ---- hedges inside the wall (never across a gate or the driveway), and the trees ----
  const gate = (x, z) => [P.gate, P.footGate].some((gp) => x > gp.x0 - 0.9 && x < gp.x1 + 0.9 && z > pl.z1 - 1.6);
  const bush = (x, z, k, i) => { const m = new THREE.Mesh(icoGeo(0.34 * k, 1), i % 2 ? M.hedge : M.hedge2); m.position.set(wx(x), GROUND + 0.28 * k, wz(z)); m.scale.set(1.2, 0.9, 1.2); m.castShadow = true; g.add(m); };
  let n = 0;
  for (let x = pl.x0 + 1.2; x < pl.x1 - 0.8; x += 1.1) { if (!gate(x, pl.z1)) bush(x, pl.z1 - 0.62, 0.9, n++); bush(x, pl.z0 + 0.7, 1, n++); }
  for (let z = pl.z0 + 1.8; z < pl.z1 - 1.5; z += 1.1) { bush(pl.x0 + 0.7, z, 1, n++); bush(pl.x1 - 0.7, z, 1, n++); }
  const spots = [[pl.x0 + 0.65, pl.z0 + 0.65], [pl.x1 - 0.65, pl.z0 + 0.65], [pl.x0 + 0.65, pl.z1 - 0.65], [pl.x1 - 0.65, pl.z1 - 0.65]];
  for (let x = pl.x0 + 4; x < pl.x1 - 3; x += 5) spots.push([x, pl.z0 + 0.65]);
  for (let z = pl.z0 + 5; z < pl.z1 - 4; z += 5) { spots.push([pl.x0 + 0.65, z]); spots.push([pl.x1 - 0.65, z]); }
  spots.forEach(([x, z], i) => { if (P.reserved.some((r) => hits(r, x - 0.4, z - 0.4, 0.8, 0.8)) || gate(x, z)) return; const kind = i % 3 === 0 ? "palm" : "bush", t = tree(kind, i); t.position.set(wx(x), GROUND, wz(z)); t.rotation.y = i * 2.1; t.scale.setScalar(kind === "palm" ? 0.9 : 0.8); g.add(t); trees.push({ g: t, a: Math.atan2(wz(z), wx(x)), kind, s: 1, base: t.scale.x }); });

  // (no neighbouring lots: the plot ends at its wall, and nothing is drawn beyond it)
  void at; void R;
  if (embedded) g.remove(roadG); // on the map the road, kerb and pavement beyond the wall are the map's own
  return { group: g, trees, plot: P, road: roadG, release: hold.releaseAll };
}

/** Builds a home's plot geometry into the shared cache without keeping anything (for the idle preloader): the next buildPlot() of a home this size finds every box and hedge ready. */
export function warmPlot(room) {
  const mats = new Map(), mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshBasicMaterial()); return mats.get(k); };
  const built = buildPlot(room, { mat, tree: () => new THREE.Group() });
  built.release(); for (const m of mats.values()) m.dispose(); // the geometry stays cached, nothing else is kept
}
