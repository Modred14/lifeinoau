// lib3d/campusReal.js
// The OAU campus drawn from real footprints, roads and landcover (public/data/oau-campus.json, made by tools/oau/vectorize.py).
// 1 scene unit = 10 m. Building heights are exaggerated by EX for readability; the true height of every building stays in the data.
// Layout, footprints and road shapes come from the supplied OpenStreetMap render. Facades and roofs are generic, NOT photo-verified.
import * as THREE from "three";
import { buildRoadMeshes, ROAD_COLORS } from "./roadmesh.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { buildGround } from "./ground.js";
import { buildEdges } from "./edges.js";
import { buildBillboards } from "./billboards3d.js";
import { buildGrounds } from "./grounds.js";
import { destinationOf } from "./roadnet.js";
import { hasInterior } from "./interiors/registry.js";

export const S = 0.1;   // metres -> scene units
export const EX = 2;    // visual height exaggeration (buildings only)
export const MAP_BG = "#a9cbe8"; // sky and horizon (and what shows past the faded rim of the ground). The ground itself is grass and sand (ground.js). Keep .mapwrap .stage in globals.css the same.
const WALLS = ["#d9ceb4", "#c6b08a", "#d8d8d0", "#aab7c4", "#d3c3a6", "#b98b73", "#e2dccb"];
const KIND_WALL = { hostel: "#c58b6e", block: "#c58b6e", library: "#cdbb92", hall: "#e4dcc6", faculty: "#d8d2bf", lecture: "#d3cdb9", bank: "#9fb4c8", shop: "#d9a86a", worship: "#e8e4d4", sports: "#b9c9a9", admin: "#d6d0c0", club: "#5b4a8a", jail: "#8d99a8" };
const rngOf = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

function windowTextures(seed) { // one tile = 4 x 4 windows; some are lit
  const mk = (lit) => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), r = rngOf(seed);
    g.fillStyle = lit ? "#000" : "#fff"; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const on = r() < 0.5; g.fillStyle = lit ? (on ? ["#ffd48a", "#ffc46b", "#fff0c4"][Math.floor(r() * 3)] : "#000") : "#2b394b"; g.fillRect(x * 32 + 6, y * 32 + 8, 20, 16); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: mk(false), emis: mk(true) };
}
const slice = (g, start, count) => { const r = new THREE.BufferGeometry(); for (const k of ["position", "normal", "uv"]) { const a = g.attributes[k], n = a.itemSize, arr = new Float32Array(count * n); arr.set(a.array.subarray(start * n, (start + count) * n)); r.setAttribute(k, new THREE.BufferAttribute(arr, n)); } return r; };
const paint = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g; };
const V = (p) => new THREE.Vector2(p[0] * S, -p[1] * S); // data z grows south; shapes live in XY and are rotated flat, which flips y
const centroid = (pts) => [pts.reduce((t, p) => t + p[0], 0) / pts.length, pts.reduce((t, p) => t + p[1], 0) / pts.length];
const inPoly = (x, z, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

function flat(areas, color, y, o = {}) { // flat polygons (roads, parking, pitches ...) as one mesh
  const gs = []; for (const a of areas) { try { const s = new THREE.Shape(a.pts.map(V)); for (const h of a.holes ?? []) s.holes.push(new THREE.Path(h.map(V))); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); gs.push(g); } catch { /* a malformed outline is skipped */ } }
  if (!gs.length) return null; const m = new THREE.Mesh(mergeGeometries(gs), new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.95, metalness: o.metal ?? 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -(o.layer ?? 1), polygonOffsetUnits: -(o.layer ?? 1) }));
  m.position.y = y; m.userData.layerY = y; m.receiveShadow = true; gs.forEach((g) => g.dispose()); return m;
}

/** data: parsed oau-campus.json. meta: optional { [placeId]: {blurb, actions, ...} } merged onto the places. */
export function buildRealCampus(data, meta = {}) {
  const root = new THREE.Group(), b = data.bounds, disposables = [];
  const mapDoors = [], doorFrame = new THREE.MeshStandardMaterial({ color: "#eee5d2", roughness: 0.85 }), doorPanel = new THREE.MeshStandardMaterial({ color: "#68432e", roughness: 0.78 }), doorDark = new THREE.MeshBasicMaterial({ color: "#161a20" }), doorMat = new THREE.MeshStandardMaterial({ color: "#8f342f", roughness: 0.9 });
  const x0 = b.x0 * S, x1 = b.x1 * S, z0 = b.z0 * S, z1 = b.z1 * S;
  // ---- ground: patchy grass and sand that fades into the sky-blue at its rim, so the map ends softly (ground.js). Water stays blue. ----
  const ground = buildGround(data, S); root.add(ground);
  const rimKeep = data.places.filter((p) => p.x < b.x0 + 60 || p.x > b.x1 - 60 || p.z < b.z0 + 60 || p.z > b.z1 - 160).map((p) => [p.x, p.z, 60]);
  let roadFlat = null, roadSurface = null, tripOn = false;
  const edges = buildEdges(data, S, { keepOut: rimKeep }); root.add(edges.group); // roads that run off the map, and a belt of trees along its rim
  for (const m of [flat(data.areas.park, "#5aa064", 0.03, { layer: 2 }), flat(data.areas.sports, "#4c9a68", 0.035, { layer: 2 }), flat(data.areas.wood, "#2f6b3b", 0.04, { layer: 2 }),
    flat(data.areas.pitch, "#2fb98a", 0.06, { layer: 3 }), flat(data.areas.water, "#2f6f95", 0.05, { layer: 3, rough: 0.15, metal: 0.2 }), flat(data.areas.parking, "#46505c", 0.06, { layer: 3 }), (roadFlat = flat(data.roads, "#343b46", 0.08, { layer: 4 }))]) if (m) root.add(m);

  // ---- buildings: real footprints, merged into one wall mesh and one roof mesh ----
  const win = windowTextures(5), rep = 1 / (12 * S); for (const t of [win.map, win.emis]) t.repeat.set(rep, rep);
  const placeAt = new Map(); for (const p of data.places) if (p.bid != null) placeAt.set(p.bid, p);
  const sides = [], caps = [], ranges = []; let vs = 0, vc = 0;
  const extrude = (pts, depth, y = 0) => { const shape = new THREE.Shape(pts.map(V)), g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); if (y) g.translate(0, y, 0); return g; };
  const scaled = (pts, k) => { const [cx, cz] = centroid(pts); return pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]); };
  data.buildings.forEach((bd, i) => { try {
    const pl = placeAt.get(bd.id), kind = pl?.kind, col = bd.wall ?? KIND_WALL[kind] ?? WALLS[i % WALLS.length], roof = bd.roof ?? (kind === "hostel" || kind === "block" ? "#5a4638" : "#3a4452"), H = bd.h * S * EX;
    const parts = pl?.id === "amphitheatre" ? [0.9, 0.7, 0.5].map((k, j) => [scaled(bd.pts, k), 1.5 * S * EX, j * 1.5 * S * EX]) : [[bd.pts, H, 0]]; // stylised tiers; the real seating is not surveyed
    const s0 = vs, c0 = vc;
    for (const [pts, d, y] of parts) { const g = extrude(pts, d, y), [capG, sideG] = g.groups.length >= 2 ? g.groups : [g.groups[0], { start: 0, count: 0 }];
      const cg = paint(slice(g, capG.start, capG.count), roof); caps.push(cg); vc += cg.attributes.position.count;
      if (sideG.count) { const sg = paint(slice(g, sideG.start, sideG.count), col); sides.push(sg); vs += sg.attributes.position.count; } g.dispose(); }
    ranges.push({ bid: bd.id, s0, s1: vs, c0, c1: vc });
  } catch { /* a malformed footprint is skipped, never fatal */ } });
  const wallMesh = sides.length ? new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ vertexColors: true, map: win.map, emissive: 0xffffff, emissiveMap: win.emis, emissiveIntensity: 0.18, roughness: 0.8 })) : null;
  const capMesh = caps.length ? new THREE.Mesh(mergeGeometries(caps), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })) : null;
  for (const m of [wallMesh, capMesh]) if (m) { m.castShadow = m.receiveShadow = true; root.add(m); } sides.forEach((g) => g.dispose()); caps.forEach((g) => g.dispose());

  // ---- the Motion Ground and the Religious Ground (game placements in clear space; mapExtras.js) ----
  if (data.grounds) root.add(buildGrounds(data.grounds, { S, EX }));

  // ---- trees: only inside the wooded area the map actually shows ----
  const rnd = rngOf(7), trees = [];
  for (const w of data.areas.wood) { const xs = w.pts.map((p) => p[0]), zs = w.pts.map((p) => p[1]), ax = Math.min(...xs), bx = Math.max(...xs), az = Math.min(...zs), bz = Math.max(...zs);
    for (let t = 0; t < 4000 && trees.length < 900; t++) { const x = ax + rnd() * (bx - ax), z = az + rnd() * (bz - az); if (inPoly(x, z, w.pts) && !trees.some((q) => Math.hypot(q[0] - x, q[1] - z) < 8)) trees.push([x, z, 0.8 + rnd() * 0.9]); } }
  if (trees.length) { const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 6), new THREE.MeshStandardMaterial({ color: "#4a3426" }), trees.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), trees.length), d = new THREE.Object3D(), c = new THREE.Color();
    trees.forEach(([x, z, k], i) => { d.position.set(x * S, 0.5 * k, z * S); d.scale.setScalar(k); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix); d.position.set(x * S, 1.5 * k, z * S); d.updateMatrix(); crown.setMatrixAt(i, d.matrix); crown.setColorAt(i, c.set("#2f6b3b").lerp(new THREE.Color("#4f8f3f"), rnd())); });
    trunk.castShadow = crown.castShadow = true; root.add(trunk, crown); }

  // ---- club neon and the Floor O siren (decoration on the game-placed buildings) ----
  const glow = [];
  for (const p of data.places) { const bd = p.bid != null ? data.buildings.find((q) => q.id === p.bid) : null; if (!bd) continue;
    if (bd.neon) { const [cx, cz] = centroid(bd.pts), xs = bd.pts.map((q) => q[0]), zs = bd.pts.map((q) => q[1]), w = (Math.max(...xs) - Math.min(...xs)) * S, d = (Math.max(...zs) - Math.min(...zs)) * S, top = bd.h * S * EX, m = new THREE.MeshBasicMaterial({ color: bd.neon, toneMapped: false });
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.16, 0.16), m); bar.position.set(cx * S, top + 0.06, (cz * S) + d / 2); const sign = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.6, 0.1), m); sign.position.set(cx * S, top + 0.6, (cz * S) + d / 2 - 0.1); root.add(bar, sign); }
    if (p.id === "floor0") { const top = bd.h * S * EX, m = new THREE.MeshBasicMaterial({ color: "#ff3b30", toneMapped: false }), [cx, cz] = centroid(bd.pts), lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), m); lamp.position.set(cx * S, top + 0.18, cz * S); root.add(lamp); glow.push(m); } }
  // ---- billboards: ten boards that cycle their posters ----
  const bbEntries = data.places.filter((p) => p.kind === "billboard").map((p) => ({ id: p.id, x: p.x * S, z: p.z * S, yaw: p.yaw, board: p.board })), bb = buildBillboards(bbEntries); root.add(bb.group);

  // ---- places: label anchors sit above the roof (true or estimated height, times the exaggeration) ----
  const bById = new Map(data.buildings.map((q) => [q.id, q])), anchors = new Map(), places = [], pinMat = new THREE.MeshStandardMaterial({ color: "#f0c05a", emissive: "#6a4a10", emissiveIntensity: 0.6 });
  for (const p of data.places) {
    const bd = p.bid != null ? bById.get(p.bid) : null, x = p.x * S, z = p.z * S; let top, h;
    if (p.kind === "billboard") { h = null; top = bb.height; }
    else if (bd) { h = bd.h; top = h * S * EX; if (p.id === "amphitheatre") top = 4.5 * S * EX; }
    else { h = null; top = 1.6; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top, 6), pinMat), cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), pinMat); pole.position.set(x, top / 2, z); cap.position.set(x, top, z); root.add(pole, cap); } // no footprint known: a marker, not an invented building
    const pos = new THREE.Vector3(x, top + 1.2, z); anchors.set(p.id, pos);
    places.push({ ...meta[p.id], id: p.id, name: p.name, kind: p.kind, tier: p.tier, conf: p.conf, src: p.src, x, z, h, hSrc: bd?.hSrc ?? null, hasFootprint: !!bd, approx: p.conf === "approximate" || p.conf === "game", offmap: !!p.offmap, unnamed: !!p.unnamed, osmLabel: p.osmLabel, pos, radius: bd ? Math.max(3, Math.sqrt(bd.area) * S * 0.7) : p.kind === "billboard" ? 5 : 3 });
  }
  const sel = new THREE.Mesh(new THREE.RingGeometry(1, 1.2, 48), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.9, side: THREE.DoubleSide })); sel.rotation.x = -Math.PI / 2; sel.visible = false; root.add(sel);
  /** Any place the player can pick: a named place, or a building with no name ("bld_12"). Returns { id, x, z, radius, pos, bid } in scene units, or null. */
  const unnamed = new Map(), resolve = (id) => { const L = places.find((l) => l.id === id); if (L) return L; if (!id?.startsWith("bld_")) return null; if (unnamed.has(id)) return unnamed.get(id); const bd = bById.get(Number(id.slice(4))); if (!bd) return null; const [cx, cz] = centroid(bd.pts), r = { id, name: "Building", kind: "building", bid: bd.id, x: cx * S, z: cz * S, radius: Math.max(3, Math.sqrt(bd.area ?? 400) * S * 0.7), pos: new THREE.Vector3(cx * S, bd.h * S * EX + 1.2, cz * S) }; unnamed.set(id, r); return r; };
  const setSelected = (id) => { const L = resolve(id); if (!L) { sel.visible = false; return; } sel.position.set(L.x, 0.2, L.z); sel.scale.setScalar(L.radius); sel.visible = true; };
  // "You are here": a pulsing gold ring and arrow over the building the player is at
  const here = new THREE.Group(), hereMat = new THREE.MeshBasicMaterial({ color: "#f0c05a", transparent: true, opacity: 0.95, side: THREE.DoubleSide }), hring = new THREE.Mesh(new THREE.RingGeometry(1, 1.14, 48), hereMat), harrow = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.1, 4), hereMat); hring.rotation.x = -Math.PI / 2; harrow.rotation.x = Math.PI; here.add(hring, harrow); here.visible = false; root.add(here);
  let hereId = null; const setYou = (id) => { hereId = id; const L = resolve(id); if (!L) { here.visible = false; return; } here.visible = true; here.position.set(L.x, 0, L.z); hring.position.y = 0.22; hring.scale.setScalar(L.radius * 1.1); harrow.position.y = (L.pos?.y ?? 3) + 0.6; };
  const update = (t, dt = 0.016) => { bb.update(dt); const k = 0.35 + 0.65 * Math.max(0, Math.sin(t * 5)); glow.forEach((m) => m.color.setRGB(k, k * 0.23, k * 0.19)); if (sel.visible) { sel.material.opacity = 0.65 + Math.sin(t * 3) * 0.25; sel.rotation.z = t * 0.4; } if (here.visible) { harrow.position.y += Math.sin(t * 4) * 0.004; hring.rotation.z = t * 0.3; } };
  /** While a trip runs, the flat ground layers sit almost on the ground so cars and people do not look like they stand on slabs, and the map's labels get out of the way. */
  const tripMode = (on) => { tripOn = on; for (const door of mapDoors) door.visible = !on; root.traverse((o) => { if (o.userData?.layerY != null) o.position.y = on ? o.userData.layerY * 0.12 : o.userData.layerY; }); edges.group.traverse((o) => { if (o.name === "road-stubs") { o.userData.layerY ??= o.position.y; o.position.y = on ? o.userData.layerY * 0.12 : o.userData.layerY; } }); };

  /** Which place is under a raycaster? Returns a place id, "bld_<n>" for a building with no name, or null. */
  const pick = (ray) => { const bh = ray.intersectObjects(bb.meshes, false)[0], h0 = ray.intersectObjects([wallMesh, capMesh].filter(Boolean), false)[0]; if (bh && (!h0 || bh.distance <= h0.distance)) return bh.object.userData.placeId; const hit = ray.intersectObjects([wallMesh, capMesh].filter(Boolean), false)[0]; if (!hit) return null; const isW = hit.object === wallMesh, v = hit.face.a;
    const r = ranges.find((q) => (isW ? v >= q.s0 && v < q.s1 : v >= q.c0 && v < q.c1)); return r ? placeAt.get(r.bid)?.id ?? "bld_" + r.bid : null; };
  const extent = Math.max(x1 - x0, z1 - z0) / 2, dispose = () => { bb.dispose(); edges.dispose(); root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((q) => q.dispose()); }); doorFrame.dispose(); doorPanel.dispose(); doorDark.dispose(); doorMat.dispose(); win.map.dispose(); win.emis.dispose(); };
  const setBillboards = (list) => bb.setBoards(list);
  const setDoors = (net) => {
    for (const door of mapDoors.splice(0)) { root.remove(door); door.traverse((o) => o.geometry?.dispose?.()); }
    for (const p of data.places) {
      if (!hasInterior(p.id, p.kind) || p.bid == null || !bById.has(p.bid)) continue;
      const d = destinationOf(net, p).door, w = d.width ?? 2, h = 2.5 * EX, group = new THREE.Group();
      const add = (geometry, material, x, y, z) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); };
      add(new THREE.BoxGeometry(w + 0.28, h, 0.08), doorDark, 0, h / 2, 0.04);
      add(new THREE.BoxGeometry(0.14, h + 0.14, 0.16), doorFrame, -w / 2 - 0.08, h / 2, 0.08);
      add(new THREE.BoxGeometry(0.14, h + 0.14, 0.16), doorFrame, w / 2 + 0.08, h / 2, 0.08);
      add(new THREE.BoxGeometry(w + 0.36, 0.14, 0.16), doorFrame, 0, h + 0.07, 0.08);
      add(new THREE.BoxGeometry(w * 0.86, h * 0.9, 0.07), doorPanel, 0, h * 0.45, 0.14);
      add(new THREE.BoxGeometry(w * 0.72, 0.045, 0.5), doorMat, 0, 0.035, 0.38);
      group.position.set((d.x + d.nx * 0.18) * S, 0, (d.z + d.nz * 0.18) * S); group.rotation.y = Math.atan2(d.nx, d.nz); group.scale.setScalar(S); group.visible = !tripOn;
      group.userData.mapDoor = true; root.add(group); mapDoors.push(group);
    }
  };
  /**
   * Gives the roads their proper shape: carriageways of the real width with a pavement each side, kerbs, centre dashes, stop lines and crossings, all drawn
   * from the road graph (the very geometry vehicles drive on and people collide with). The old flat road polygons stay underneath as paved apron.
   * Pass null to go back to the plain polygons.
   */
  const setRoadGraph = (graph) => {
    if (roadSurface) { root.remove(roadSurface); roadSurface.userData.dispose?.(); roadSurface = null; }
    if (!graph) { if (roadFlat) { roadFlat.material.color.set("#343b46"); roadFlat.userData.layerY = 0.08; } tripMode(tripOn); return; }
    roadSurface = buildRoadMeshes(graph, S, 0.08); root.add(roadSurface);
    if (roadFlat) { roadFlat.material.color.set(ROAD_COLORS.apron); roadFlat.userData.layerY = 0.0754; }
    tripMode(tripOn);
  };
  return { root, anchors, places, pick, resolve, update, setSelected, setYou, tripMode, setTripMode: tripMode, setRoadGraph, setBillboards, setDoors, dispose, bounds: { x0, x1, z0, z1 }, extent, attribution: data.meta.attribution,
    camera: { home: { x: 0, z: 8, dist: 210, az: 0.7, pol: 0.95 }, min: 10, max: 520 } };
}

/** Dusk sky, fog and light. The sun follows the camera target so shadows stay sharp wherever you look. Returns { sun, follow(target) }. */
export function addRealLighting(scene) {
  scene.background = new THREE.Color(MAP_BG); scene.fog = new THREE.FogExp2(MAP_BG, 0.0011); // far buildings fade into the same one colour
  scene.add(new THREE.HemisphereLight(0xf3f8ff, 0xc3cbbd, 1.5));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 5, far: 400 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.25; scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0xcfe0ff, 0.6); fill.position.set(80, 60, -60); scene.add(fill);
  const follow = (t) => { sun.target.position.copy(t); sun.position.set(t.x - 90, 70, t.z + 70); };
  follow(new THREE.Vector3()); return { sun, follow };
}