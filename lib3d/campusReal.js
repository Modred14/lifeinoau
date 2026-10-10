// lib3d/campusReal.js
// The OAU campus drawn from real footprints, roads and landcover (public/data/oau-campus.json, made by tools/oau/vectorize.py).
// 1 scene unit = 10 m. Building heights are exaggerated by EX for readability; the true height of every building stays in the data.
// Layout, footprints and road shapes come from the supplied OpenStreetMap render. Facades and roofs are generic, NOT photo-verified.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const S = 0.1;   // metres -> scene units
export const EX = 2;    // visual height exaggeration (buildings only)
const WALLS = ["#d9ceb4", "#c6b08a", "#d8d8d0", "#aab7c4", "#d3c3a6", "#b98b73", "#e2dccb"];
const KIND_WALL = { hostel: "#c58b6e", block: "#c58b6e", library: "#cdbb92", hall: "#e4dcc6", faculty: "#d8d2bf", lecture: "#d3cdb9", bank: "#9fb4c8", shop: "#d9a86a", worship: "#e8e4d4", sports: "#b9c9a9", admin: "#d6d0c0" };
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
  m.position.y = y; m.receiveShadow = true; gs.forEach((g) => g.dispose()); return m;
}

/** data: parsed oau-campus.json. meta: optional { [placeId]: {blurb, actions, ...} } merged onto the places. */
export function buildRealCampus(data, meta = {}) {
  const root = new THREE.Group(), b = data.bounds, disposables = [];
  const x0 = b.x0 * S, x1 = b.x1 * S, z0 = b.z0 * S, z1 = b.z1 * S;
  // ---- ground: unsurveyed margin, the mapped campus, and the area outside the campus boundary ----
  const gx0 = x0 - 120, gx1 = x1 + 120, gz0 = z0 - 120, gz1 = z1 + 420; // extra room to the south for places that lie beyond the screenshot
  const far = new THREE.Mesh(new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0), new THREE.MeshStandardMaterial({ color: "#35603f", roughness: 1 })); far.rotation.x = -Math.PI / 2; far.position.set((gx0 + gx1) / 2, -0.02, (gz0 + gz1) / 2); far.receiveShadow = true; root.add(far);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), new THREE.MeshStandardMaterial({ color: "#3f7d4e", roughness: 1 })); grass.rotation.x = -Math.PI / 2; grass.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2); grass.receiveShadow = true; root.add(grass);
  const soil = new THREE.Mesh(new THREE.BoxGeometry(gx1 - gx0, 7, gz1 - gz0), new THREE.MeshStandardMaterial({ color: "#3a2d24", roughness: 1 })); soil.position.set((gx0 + gx1) / 2, -3.6, (gz0 + gz1) / 2); root.add(soil);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map(([x, z]) => new THREE.Vector3(x, 0.08, z))), new THREE.LineBasicMaterial({ color: "#6fa2d8", transparent: true, opacity: 0.35 })); root.add(edge); // edge of the surveyed screenshot
  for (const m of [flat(data.outside, "#6e6a58", 0.02, { layer: 1 }), flat(data.areas.park, "#5aa064", 0.03, { layer: 2 }), flat(data.areas.sports, "#4c9a68", 0.035, { layer: 2 }), flat(data.areas.wood, "#2f6b3b", 0.04, { layer: 2 }),
    flat(data.areas.pitch, "#2fb98a", 0.06, { layer: 3 }), flat(data.areas.water, "#2f6f95", 0.05, { layer: 3, rough: 0.15, metal: 0.2 }), flat(data.areas.parking, "#46505c", 0.06, { layer: 3 }), flat(data.roads, "#343b46", 0.08, { layer: 4 })]) if (m) root.add(m);

  // ---- buildings: real footprints, merged into one wall mesh and one roof mesh ----
  const win = windowTextures(5), rep = 1 / (12 * S); for (const t of [win.map, win.emis]) t.repeat.set(rep, rep);
  const placeAt = new Map(); for (const p of data.places) if (p.bid != null) placeAt.set(p.bid, p);
  const sides = [], caps = [], ranges = []; let vs = 0, vc = 0;
  const extrude = (pts, depth, y = 0) => { const shape = new THREE.Shape(pts.map(V)), g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); g.rotateX(-Math.PI / 2); if (y) g.translate(0, y, 0); return g; };
  const scaled = (pts, k) => { const [cx, cz] = centroid(pts); return pts.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]); };
  data.buildings.forEach((bd, i) => { try {
    const pl = placeAt.get(bd.id), kind = pl?.kind, col = KIND_WALL[kind] ?? WALLS[i % WALLS.length], roof = kind === "hostel" || kind === "block" ? "#5a4638" : "#3a4452", H = bd.h * S * EX;
    const parts = pl?.id === "amphitheatre" ? [0.9, 0.7, 0.5].map((k, j) => [scaled(bd.pts, k), 1.5 * S * EX, j * 1.5 * S * EX]) : [[bd.pts, H, 0]]; // stylised tiers; the real seating is not surveyed
    const s0 = vs, c0 = vc;
    for (const [pts, d, y] of parts) { const g = extrude(pts, d, y), [capG, sideG] = g.groups.length >= 2 ? g.groups : [g.groups[0], { start: 0, count: 0 }];
      const cg = paint(slice(g, capG.start, capG.count), roof); caps.push(cg); vc += cg.attributes.position.count;
      if (sideG.count) { const sg = paint(slice(g, sideG.start, sideG.count), col); sides.push(sg); vs += sg.attributes.position.count; } g.dispose(); }
    ranges.push({ bid: bd.id, s0, s1: vs, c0, c1: vc });
  } catch { /* a malformed footprint is skipped, never fatal */ } });
  const wallMesh = sides.length ? new THREE.Mesh(mergeGeometries(sides), new THREE.MeshStandardMaterial({ vertexColors: true, map: win.map, emissive: 0xffffff, emissiveMap: win.emis, emissiveIntensity: 0.8, roughness: 0.8 })) : null;
  const capMesh = caps.length ? new THREE.Mesh(mergeGeometries(caps), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })) : null;
  for (const m of [wallMesh, capMesh]) if (m) { m.castShadow = m.receiveShadow = true; root.add(m); } sides.forEach((g) => g.dispose()); caps.forEach((g) => g.dispose());

  // ---- trees: only inside the wooded area the map actually shows ----
  const rnd = rngOf(7), trees = [];
  for (const w of data.areas.wood) { const xs = w.pts.map((p) => p[0]), zs = w.pts.map((p) => p[1]), ax = Math.min(...xs), bx = Math.max(...xs), az = Math.min(...zs), bz = Math.max(...zs);
    for (let t = 0; t < 4000 && trees.length < 900; t++) { const x = ax + rnd() * (bx - ax), z = az + rnd() * (bz - az); if (inPoly(x, z, w.pts) && !trees.some((q) => Math.hypot(q[0] - x, q[1] - z) < 8)) trees.push([x, z, 0.8 + rnd() * 0.9]); } }
  if (trees.length) { const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 1.0, 6), new THREE.MeshStandardMaterial({ color: "#4a3426" }), trees.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.75, 0), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, flatShading: true }), trees.length), d = new THREE.Object3D(), c = new THREE.Color();
    trees.forEach(([x, z, k], i) => { d.position.set(x * S, 0.5 * k, z * S); d.scale.setScalar(k); d.updateMatrix(); trunk.setMatrixAt(i, d.matrix); d.position.set(x * S, 1.5 * k, z * S); d.updateMatrix(); crown.setMatrixAt(i, d.matrix); crown.setColorAt(i, c.set("#2f6b3b").lerp(new THREE.Color("#4f8f3f"), rnd())); });
    trunk.castShadow = crown.castShadow = true; root.add(trunk, crown); }

  // ---- places: label anchors sit above the roof (true or estimated height, times the exaggeration) ----
  const bById = new Map(data.buildings.map((q) => [q.id, q])), anchors = new Map(), places = [], pinMat = new THREE.MeshStandardMaterial({ color: "#f0c05a", emissive: "#6a4a10", emissiveIntensity: 0.6 });
  for (const p of data.places) {
    const bd = p.bid != null ? bById.get(p.bid) : null, x = p.x * S, z = p.z * S; let top, h;
    if (bd) { h = bd.h; top = h * S * EX; if (p.id === "amphitheatre") top = 4.5 * S * EX; }
    else { h = null; top = 1.6; const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, top, 6), pinMat), cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), pinMat); pole.position.set(x, top / 2, z); cap.position.set(x, top, z); root.add(pole, cap); } // no footprint known: a marker, not an invented building
    const pos = new THREE.Vector3(x, top + 1.2, z); anchors.set(p.id, pos);
    places.push({ ...meta[p.id], id: p.id, name: p.name, kind: p.kind, tier: p.tier, conf: p.conf, src: p.src, x, z, h, hSrc: bd?.hSrc ?? null, hasFootprint: !!bd, approx: p.conf === "approximate", offmap: !!p.offmap, unnamed: !!p.unnamed, osmLabel: p.osmLabel, pos, radius: bd ? Math.max(3, Math.sqrt(bd.area) * S * 0.7) : 3 });
  }
  const sel = new THREE.Mesh(new THREE.RingGeometry(1, 1.2, 48), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.9, side: THREE.DoubleSide })); sel.rotation.x = -Math.PI / 2; sel.visible = false; root.add(sel);
  const setSelected = (id) => { const L = places.find((l) => l.id === id); if (!L) { sel.visible = false; return; } sel.position.set(L.x, 0.2, L.z); sel.scale.setScalar(L.radius); sel.visible = true; };
  const update = (t) => { if (sel.visible) { sel.material.opacity = 0.65 + Math.sin(t * 3) * 0.25; sel.rotation.z = t * 0.4; } };

  /** Which named place is under a raycaster? Returns a place id or null. Only buildings that carry a name answer. */
  const pick = (ray) => { const hit = ray.intersectObjects([wallMesh, capMesh].filter(Boolean), false)[0]; if (!hit) return null; const isW = hit.object === wallMesh, v = hit.face.a;
    const r = ranges.find((q) => (isW ? v >= q.s0 && v < q.s1 : v >= q.c0 && v < q.c1)); return r ? placeAt.get(r.bid)?.id ?? null : null; };
  const extent = Math.max(x1 - x0, z1 - z0) / 2, dispose = () => { root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((q) => q.dispose()); }); win.map.dispose(); win.emis.dispose(); };
  return { root, anchors, places, pick, update, setSelected, dispose, bounds: { x0, x1, z0, z1 }, extent, attribution: data.meta.attribution,
    camera: { home: { x: 0, z: 8, dist: 210, az: 0.7, pol: 0.95 }, min: 10, max: 520 } };
}

/** Dusk sky, fog and light. The sun follows the camera target so shadows stay sharp wherever you look. Returns { sun, follow(target) }. */
export function addRealLighting(scene) {
  const c = document.createElement("canvas"); c.width = 2; c.height = 256; const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#0a1120"); gr.addColorStop(0.55, "#16294a"); gr.addColorStop(0.85, "#3a4a6e"); gr.addColorStop(1, "#6a5a6a"); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const bg = new THREE.CanvasTexture(c); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg; scene.fog = new THREE.FogExp2(0x22335a, 0.0017);
  scene.add(new THREE.HemisphereLight(0xa9bdf0, 0x5a5a3e, 1.35));
  const sun = new THREE.DirectionalLight(0xffcf9a, 3.4); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 5, far: 400 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.25; scene.add(sun, sun.target);
  const moon = new THREE.DirectionalLight(0x7f9fe8, 1.1); moon.position.set(80, 60, -60); scene.add(moon);
  const follow = (t) => { sun.target.position.copy(t); sun.position.set(t.x - 90, 70, t.z + 70); };
  follow(new THREE.Vector3()); return { sun, follow };
}