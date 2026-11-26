// lib3d/campus.js
// The stylised OAU campus at dusk. Schematic, not to scale. Browser only.
import * as THREE from "three";
import { LANDMARKS, ROADS, SLAB } from "./landmarks.js";

const rngOf = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
const PAL = { cream: "#d9ceb4", sand: "#c6b08a", stone: "#d8d8d0", brick: "#a5664e", slate: "#aab7c4", white: "#e8e6dc", teal: "#2f6f6a", dark: "#2a3340", roof: "#8f4a37", gold: "#d9a441" };

export function windowTextures(seed) { // one tile = 4 x 4 windows; some are lit
  const mk = (lit) => { const c = document.createElement("canvas"); c.width = c.height = 128; const g = c.getContext("2d"), r = rngOf(seed);
    g.fillStyle = lit ? "#000" : "#fff"; g.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const on = r() < 0.55; g.fillStyle = lit ? (on ? ["#ffd48a", "#ffc46b", "#fff0c4"][Math.floor(r() * 3)] : "#000") : "#2b394b"; g.fillRect(x * 32 + 6, y * 32 + 8, 20, 16); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = lit ? THREE.SRGBColorSpace : THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  return { map: mk(false), emis: mk(true) };
}

export function buildCampus() {
  const root = new THREE.Group(), rnd = rngOf(11), disposables = [];
  const wins = [windowTextures(3), windowTextures(8), windowTextures(21)], wallCache = new Map();
  const wall = (color, v = 0) => { const k = color + v; if (!wallCache.has(k)) wallCache.set(k, mat(color, { map: wins[v].map, emissive: 0xffffff, emissiveMap: wins[v].emis, emissiveIntensity: 0.85, roughness: 0.8 })); return wallCache.get(k); };
  const roofMat = (c = PAL.dark) => mat(c, { roughness: 0.9 });

  const box = (p, w, h, d, m, x, y, z, shadow = true) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = shadow; o.receiveShadow = true; p.add(o); return o; };
  const cyl = (p, r1, r2, h, m, x, y, z, seg = 20) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };
  const lit = (p, w, h, d, color, x, y, z, v = 0, roof = PAL.dark) => { // a building block with lit windows on the sides
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, wd = [d, d, 1, 1, w, w];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * (f === 2 || f === 3 ? 1 : wd[f] / 12), uv.getY(k) * (f === 2 || f === 3 ? 1 : h / 12)); }
    const o = new THREE.Mesh(g, [wall(color, v), wall(color, v), roofMat(roof), roofMat(roof), wall(color, v), wall(color, v)]); o.position.set(x, y + h / 2, z); o.castShadow = true; o.receiveShadow = true; p.add(o); return o; };

  // ---- ground slab ----
  const W = SLAB.x1 - SLAB.x0, D = SLAB.z1 - SLAB.z0, cx = (SLAB.x0 + SLAB.x1) / 2, cz = (SLAB.z0 + SLAB.z1) / 2;
  const gg = new THREE.PlaneGeometry(W, D, 90, 70); gg.rotateX(-Math.PI / 2); const gp = gg.attributes.position, col = new Float32Array(gp.count * 3), c1 = new THREE.Color("#3c8250"), c2 = new THREE.Color("#58a862");
  for (let i = 0; i < gp.count; i++) { const x = gp.getX(i), z = gp.getZ(i), n = 0.5 + 0.25 * Math.sin(x * 0.11) * Math.cos(z * 0.09) + 0.25 * Math.sin(x * 0.31 + z * 0.23); const c = c1.clone().lerp(c2, n); col.set([c.r, c.g, c.b], i * 3); }
  gg.setAttribute("color", new THREE.BufferAttribute(col, 3)); const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); ground.position.set(cx, 0, cz); ground.receiveShadow = true; root.add(ground);
  box(root, W, 7, D, mat("#3a2d24"), cx, -7.1, cz, false); box(root, W + 2, 0.7, D + 2, mat("#4b3a2d"), cx, -0.9, cz, false); // soil sits just BELOW the grass so the two never z-fight
  // the town half is dustier
  const town = new THREE.Mesh(new THREE.PlaneGeometry(W, SLAB.z1 - 56), mat("#6b7a55", { roughness: 1 })); town.rotation.x = -Math.PI / 2; town.position.set(cx, 0.03, (56 + SLAB.z1) / 2); town.receiveShadow = true; root.add(town);

  // ---- roads ----
  const roadMat = mat("#1e242c", { roughness: 0.95 }), dashMat = mat("#d8c98a", { roughness: 0.7 }); const segs = [];
  ROADS.forEach((r, ri) => { for (let i = 0; i < r.pts.length - 1; i++) { const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1], len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(x1 - x0, z1 - z0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(r.w, 0.12, len + r.w * 0.5), roadMat); m.position.set((x0 + x1) / 2, 0.06 + ri * 0.003, (z0 + z1) / 2); m.rotation.y = ang; m.receiveShadow = true; root.add(m); segs.push({ x0, z0, x1, z1, w: r.w, len });
    if (r.w >= 6) for (let d = 3; d < len - 3; d += 6) { const t = d / len, dm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.04, 2.6), dashMat); dm.position.set(x0 + (x1 - x0) * t, 0.13 + ri * 0.003, z0 + (z1 - z0) * t); dm.rotation.y = ang; root.add(dm); } } });
  const distToRoad = (x, z) => Math.min(...segs.map((s) => { const dx = s.x1 - s.x0, dz = s.z1 - s.z0, t = Math.max(0, Math.min(1, ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - (s.x0 + dx * t), z - (s.z0 + dz * t)) - s.w / 2; }));

  // ---- the quadrangle ----
  const lawn = new THREE.Mesh(new THREE.BoxGeometry(46, 0.2, 34), mat("#63b06a")); lawn.position.set(0, 0.1, 0); lawn.receiveShadow = true; root.add(lawn);
  for (const [w, d] of [[46, 3], [3, 34]]) box(root, w, 0.24, d, mat("#c9bb98"), 0, 0, 0, false);
  const fountain = cyl(root, 3.2, 3.4, 0.7, mat(PAL.stone), 0, 0.2, 4); cyl(root, 2.6, 2.6, 0.2, mat("#3b6f8f", { roughness: 0.2, metalness: 0.2 }), 0, 0.85, 4);

  // ---- landmark buildings ----
  const anchors = new Map(), groups = new Map(), foot = []; let fi = 0;
  const sparkle = (g, y) => g.userData.top = y;
  for (const L of LANDMARKS) {
    const g = new THREE.Group(); g.position.set(L.x, 0.1, L.z); root.add(g); groups.set(L.id, g); let top = 12, r = 12;
    switch (L.kind) {
      case "hall": if (L.id === "oduduwa") { // Oduduwa Hall: portico facing the quad, zig-zag roof
          lit(g, 26, 9, 12, PAL.cream, 0, 0, 0, 1, "#355a5a");
          for (let i = 0; i < 9; i++) cyl(g, 0.55, 0.6, 8, mat(PAL.white), -10 + i * 2.5, 0, 7.4, 14);
          box(g, 26, 1.2, 4.6, mat(PAL.white), 0, 8, 7.2); for (let s = 0; s < 3; s++) box(g, 26 + s * 2, 0.35, 2.2 - s * 0.3, mat("#cfc6b0"), 0, s * 0.35, 10.6 + s * 0.8, false);
          for (let i = 0; i < 8; i++) { const z = box(g, 3.4, 0.5, 11, mat("#3c6b66"), -11.5 + i * 3.3, 9.6 + (i % 2) * 0.9, 0); z.rotation.z = (i % 2 ? 1 : -1) * 0.32; } top = 14; r = 20;
        } else if (L.id === "amphitheatre") { // tiered half-bowl
          for (let i = 0; i < 6; i++) { const s = new THREE.Shape(), r0 = 5 + i * 1.7, r1 = r0 + 1.7; s.absarc(0, 0, r1, 0, Math.PI, false); s.absarc(0, 0, r0, Math.PI, 0, true);
            const eg = new THREE.ExtrudeGeometry(s, { depth: 0.7 + i * 0.7, bevelEnabled: false, curveSegments: 28 }); eg.rotateX(Math.PI / 2); eg.translate(0, 0.7 + i * 0.7, 0); const m = new THREE.Mesh(eg, mat(i % 2 ? "#cfc6b0" : "#b9ad93")); m.castShadow = m.receiveShadow = true; m.rotation.y = Math.PI; g.add(m); }
          box(g, 14, 0.7, 6, mat("#7c6a54"), 0, 0, 3.4); top = 9; r = 15;
        } else { // Senate: long block with a tower
          lit(g, 32, 7, 10, PAL.stone, 0, 0, 0, 2); lit(g, 7, 17, 7, PAL.white, 0, 0, 0, 0, "#355a5a"); cyl(g, 0.12, 0.12, 8, mat("#ccc"), 0, 17, 0, 8); box(g, 2.4, 1.4, 0.1, mat("#1f8a4c"), 1.3, 22.6, 0, false); top = 25; r = 18; } break;
      case "library": lit(g, 8, 28, 8, PAL.sand, 0, 0, 0, 1, "#2e4a52"); lit(g, 26, 6, 16, PAL.stone, 0, 0, 0, 2); box(g, 9, 0.5, 6, mat(PAL.gold), 0, 28, 0, false); top = 31; r = 17; break;
      case "social": { const sub = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 6, 28, 1, false, 0, Math.PI), wall(PAL.sand, 2)); sub.position.y = 3; sub.castShadow = true; sub.rotation.y = -Math.PI / 2; g.add(sub); box(g, 18, 6, 0.4, wall(PAL.sand, 2), 0, 0, 0); box(g, 20, 0.3, 8, mat("#c9bb98"), 0, 0, 7, false); top = 9; r = 12; break; }
      case "statue": cyl(g, 2.4, 2.8, 0.8, mat(PAL.stone), 0, 0, 0); box(g, 2.2, 3, 2.2, mat(PAL.stone), 0, 0.8, 0); { const gm = mat("#d9a441", { metalness: 0.6, roughness: 0.35 }); const b = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 2.2, 6, 12), gm); b.position.y = 5.6; b.castShadow = true; g.add(b); const h = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), gm); h.position.y = 7.7; g.add(h); const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.6, 4, 8), gm); a.position.set(0.9, 7.2, 0); a.rotation.z = -0.5; g.add(a); } top = 10; r = 6; break;
      case "faculty": { const cols = [PAL.cream, PAL.sand, PAL.stone, PAL.slate, "#d3c3a6"], c = cols[fi++ % cols.length], acc = ["#2f6f6a", "#8c3b46", "#355a8a", "#6b7f3a", "#a1692f"][fi % 5];
        lit(g, 16, 8.5, 9, c, 0, 0, 0, fi % 3, "#2c3540"); lit(g, 8, 6, 8, c, 9, 0, 3, (fi + 1) % 3); box(g, 16.4, 1, 9.4, mat(acc), 0, 8.5, 0, false); box(g, 5, 0.4, 2.6, mat("#ddd"), 0, 0, 5.6, false); top = 12; r = 14; break; }
      case "hospital": if (L.id === "health_centre") { lit(g, 13, 6, 8, PAL.white, 0, 0, 0, 1, "#cfd6dd"); box(g, 0.5, 3.2, 1.1, mat("#c0343a", { emissive: "#7a1218", emissiveIntensity: 0.5 }), 0, 6.6, 4.1, false); box(g, 0.5, 1.1, 3.2, mat("#c0343a", { emissive: "#7a1218", emissiveIntensity: 0.5 }), 0, 7.6, 4.1, false); top = 11; r = 10; break; }
        lit(g, 20, 11, 10, PAL.white, 0, 0, 0, 1, "#cfd6dd"); lit(g, 8, 8, 14, PAL.white, 11, 0, 4, 2); box(g, 0.5, 5, 1.6, mat("#c0343a", { emissive: "#7a1218", emissiveIntensity: 0.5 }), 0, 11.8, 5.1, false); box(g, 0.5, 1.6, 5, mat("#c0343a", { emissive: "#7a1218", emissiveIntensity: 0.5 }), 0, 13.4, 5.1, false); top = 18; r = 16; break;
      case "farm": for (let i = 0; i < 9; i++) box(g, 22, 0.25, 1.6, mat(i % 2 ? "#6f8f3a" : "#4f6f2c"), 0, 0, -8 + i * 2, false); box(g, 7, 4, 5, mat("#a1442f"), -14, 0, 4); { const rf = new THREE.Mesh(new THREE.ConeGeometry(5.2, 2.6, 4), roofMat("#5b2d22")); rf.position.set(-14, 5.3, 4); rf.rotation.y = Math.PI / 4; rf.castShadow = true; g.add(rf); } top = 8; r = 16; break;
      case "hostel": { const male = L.id === "h_awo" || L.id === "h_fajuyi" || L.id === "h_angola" || L.id === "h_etf", oj = L.id === "h_ojaja", pg = L.id === "h_pg";
        const c = oj ? "#26303a" : pg ? PAL.slate : male ? PAL.brick : "#d7e2dc", rf = oj ? "#101419" : pg ? "#3a4654" : male ? "#53392e" : PAL.teal;
        lit(g, 15, 9.5, 6.5, c, 0, 0, -5, (L.x | 0) % 3 < 0 ? 0 : Math.abs(L.x | 0) % 3, rf); lit(g, 15, 9.5, 6.5, c, 0, 0, 6, Math.abs(L.z | 0) % 3, rf); box(g, 15.4, 0.8, 6.9, mat(oj ? PAL.gold : rf), 0, 9.5, -5, false); box(g, 15.4, 0.8, 6.9, mat(oj ? PAL.gold : rf), 0, 9.5, 6, false);
        box(g, 4, 0.2, 5, mat("#b9ad93"), 0, 0, 0.5, false); top = 14; r = 16; break; }
      case "gate": for (const s of [-1, 1]) lit(g, 3, 8, 3, PAL.stone, s * 6.5, 0, 0, 0); box(g, 16, 2, 3.4, mat("#1f6f4a", { emissive: "#0d3b27", emissiveIntensity: 0.6 }), 0, 8, 0); box(g, 8, 0.4, 0.4, mat("#d33"), 0, 1.4, 4, false); top = 12; r = 10; break;
      case "club": { const neon = { club_quantum: "#3de6ff", club_0203: "#ffb13d", club_divas: "#ff4f87" }[L.id] ?? "#fff"; lit(g, 12, 6.5, 9, "#2c3340", 0, 0, 0, 0, "#12161c"); box(g, 9, 1.8, 0.4, mat(neon, { emissive: neon, emissiveIntensity: 2.2, toneMapped: false }), 0, 7.2, 4.7, false);
        const gl = new THREE.PointLight(neon, 120, 22, 2); gl.position.set(0, 5, 8); g.add(gl); top = 10; r = 11; break; }
      case "town": { const hc = ["#c8b79a", "#b5503c", "#d9d1c0", "#7a9c8a", "#c9a24a", "#9a8268", "#a9b8a0"], rr = rngOf(Math.abs(L.x * 7 + L.z * 3 | 0));
        for (let i = 0; i < 13; i++) { const a = rr() * Math.PI * 2, d = 2 + rr() * 11, w = 3.2 + rr() * 2.4, h = 2.6 + rr() * 2.2, x = Math.cos(a) * d, z = Math.sin(a) * d * 0.8, c = hc[Math.floor(rr() * hc.length)];
          lit(g, w, h, w * 0.9, c, x, 0, z, Math.floor(rr() * 3), "#5a3b30"); const rf = new THREE.Mesh(new THREE.ConeGeometry(w * 0.78, 1.5, 4), roofMat(["#7a3b2c", "#4f5a63", "#8a5a3a"][Math.floor(rr() * 3)])); rf.position.set(x, h + 0.75, z); rf.rotation.y = Math.PI / 4; rf.castShadow = true; g.add(rf); } top = 7; r = 14; break; }
    }
    foot.push({ x: L.x, z: L.z, r }); anchors.set(L.id, new THREE.Vector3(L.x, top + 2.5, L.z));
  }

  // ---- trees (instanced) ----
  const trees = []; let tries = 0;
  while (trees.length < 420 && tries++ < 6000) { const x = SLAB.x0 + 6 + rnd() * (W - 12), z = SLAB.z0 + 6 + rnd() * (D - 12);
    if (distToRoad(x, z) < 3.2 || foot.some((f) => Math.hypot(f.x - x, f.z - z) < f.r)) continue; if (Math.abs(x) < 24 && Math.abs(z) < 18 && rnd() < 0.85) continue; if (z > 56 && rnd() < 0.55) continue; trees.push([x, z, 0.8 + rnd() * 0.9]); }
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.28, 0.4, 2.2, 7), mat("#4a3426"), trees.length), crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1), mat("#ffffff", { roughness: 1, flatShading: true }), trees.length), dm = new THREE.Object3D(), cc = new THREE.Color();
  trees.forEach(([x, z, s], i) => { dm.position.set(x, 1.1 * s, z); dm.scale.setScalar(s); dm.rotation.set(0, 0, 0); dm.updateMatrix(); trunk.setMatrixAt(i, dm.matrix);
    dm.position.set(x, 3.3 * s, z); dm.scale.set(s, s * (0.9 + rnd() * 0.3), s); dm.rotation.y = rnd() * 6; dm.updateMatrix(); crown.setMatrixAt(i, dm.matrix); crown.setColorAt(i, cc.set("#2f6b3b").lerp(new THREE.Color("#4f8f3f"), rnd())); });
  trunk.castShadow = crown.castShadow = true; root.add(trunk, crown);

  // ---- lamp posts ----
  const lamps = []; for (const s of segs) if (s.w >= 6) for (let d = 5; d < s.len; d += 15) { const t = d / s.len, nx = (s.z1 - s.z0) / s.len, nz = -(s.x1 - s.x0) / s.len; lamps.push([s.x0 + (s.x1 - s.x0) * t + nx * (s.w / 2 + 1), s.z0 + (s.z1 - s.z0) * t + nz * (s.w / 2 + 1)]); }
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 4.4, 6), mat("#3a4048"), lamps.length), bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffd9a0" }), lamps.length);
  lamps.forEach(([x, z], i) => { dm.rotation.set(0, 0, 0); dm.scale.setScalar(1); dm.position.set(x, 2.2, z); dm.updateMatrix(); poles.setMatrixAt(i, dm.matrix); dm.position.set(x, 4.5, z); dm.updateMatrix(); bulbs.setMatrixAt(i, dm.matrix); }); root.add(poles, bulbs);

  // ---- life: cars and students ----
  const ring = ROADS[2].pts, ede = ROADS[0].pts, paths = [ring, ede, [[0, 54], [0, 24]]], carMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.1, 1.1, 4.2), mat("#ffffff", { roughness: 0.4 }), 12), cars = [];
  for (let i = 0; i < 12; i++) { cars.push({ path: paths[i % 3], t: rnd(), sp: (0.012 + rnd() * 0.012) * (i % 2 ? 1 : -1), off: i % 2 ? 1.4 : -1.4 }); carMesh.setColorAt(i, cc.set(["#c0392b", "#e8e6dc", "#2a6f97", "#d9a441", "#222", "#6b8f3a"][i % 6])); } carMesh.castShadow = true; root.add(carMesh);
  const poly = (pts, t) => { let tot = 0; const ls = []; for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); ls.push(l); tot += l; } let d = ((t % 1) + 1) % 1 * tot; for (let i = 0; i < ls.length; i++) { if (d <= ls[i]) { const k = d / ls[i]; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k, Math.atan2(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])]; } d -= ls[i]; } return [pts[0][0], pts[0][1], 0]; };
  const folks = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.28, 0.9, 3, 6), mat("#ffffff", { roughness: 0.8 }), 70), walkers = [];
  for (let i = 0; i < 70; i++) { const q = rnd() < 0.7, x = q ? (rnd() - 0.5) * 40 : (rnd() - 0.5) * 220, z = q ? (rnd() - 0.5) * 28 : 54 + rnd() * 40; walkers.push({ x, z, tx: x, tz: z, sp: 1.2 + rnd() * 1.6, q }); folks.setColorAt(i, cc.set(["#d9a441", "#e8e6dc", "#2f6f6a", "#b3283c", "#2a3f8f", "#c9c3b0"][i % 6])); } root.add(folks);

  // ---- selection ring ----
  const sel = new THREE.Mesh(new THREE.RingGeometry(1, 1.25, 56), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.9, side: THREE.DoubleSide })); sel.rotation.x = -Math.PI / 2; sel.visible = false; root.add(sel);
  let selId = null;
  const setSelected = (id) => { selId = id; const L = LANDMARKS.find((l) => l.id === id); if (!L) { sel.visible = false; return; } const f = foot.find((q) => q.x === L.x && q.z === L.z); sel.position.set(L.x, 0.3, L.z); sel.scale.setScalar(Math.max(6, (f?.r ?? 10) * 0.8)); sel.visible = true; };

  const tmp = new THREE.Object3D();
  function update(t, dt) {
    cars.forEach((c, i) => { c.t += c.sp * dt * 0.35; const [x, z, a] = poly(c.path, c.t); tmp.position.set(x + Math.cos(a) * c.off, 0.75, z - Math.sin(a) * c.off); tmp.rotation.set(0, a + (c.sp < 0 ? Math.PI : 0), 0); tmp.scale.setScalar(1); tmp.updateMatrix(); carMesh.setMatrixAt(i, tmp.matrix); }); carMesh.instanceMatrix.needsUpdate = true;
    walkers.forEach((w, i) => { const dx = w.tx - w.x, dz = w.tz - w.z, d = Math.hypot(dx, dz); if (d < 0.6) { w.tx = w.q ? (rnd() - 0.5) * 42 : w.x + (rnd() - 0.5) * 30; w.tz = w.q ? (rnd() - 0.5) * 30 : Math.max(58, Math.min(100, w.z + (rnd() - 0.5) * 20)); } else { w.x += (dx / d) * w.sp * dt; w.z += (dz / d) * w.sp * dt; }
      tmp.position.set(w.x, 0.95 + Math.abs(Math.sin(t * 6 + i)) * 0.06, w.z); tmp.rotation.set(0, Math.atan2(dx, dz), 0); tmp.scale.setScalar(1); tmp.updateMatrix(); folks.setMatrixAt(i, tmp.matrix); }); folks.instanceMatrix.needsUpdate = true;
    if (sel.visible) { const k = 1 + Math.sin(t * 3) * 0.05; sel.scale.z = 1; sel.material.opacity = 0.65 + Math.sin(t * 3) * 0.25; sel.rotation.z = t * 0.4; sel.scale.x = sel.scale.y = sel.scale.x * 0 + (sel.scale.x || 1) * (k / (sel.userData.k || 1)); sel.userData.k = k; }
  }
  const dispose = () => { root.traverse((o) => { o.geometry?.dispose?.(); const m = o.material; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { x.map?.dispose?.(); x.emissiveMap?.dispose?.(); x.dispose(); }); }); wins.forEach((w) => { w.map.dispose(); w.emis.dispose(); }); };
  return { root, anchors, groups, update, setSelected, dispose, bounds: SLAB };
}

/** Dusk sky, fog and light for the campus. Returns the sun so callers can tune shadows. */
export function addCampusLighting(scene, extent = 135) {
  const c = document.createElement("canvas"); c.width = 2; c.height = 256; const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#0a1120"); gr.addColorStop(0.55, "#16294a"); gr.addColorStop(0.85, "#3a4a6e"); gr.addColorStop(1, "#6a5a6a"); g.fillStyle = gr; g.fillRect(0, 0, 2, 256);
  const bg = new THREE.CanvasTexture(c); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg; scene.fog = new THREE.FogExp2(0x22335a, 0.0028 * (135 / extent));
  scene.add(new THREE.HemisphereLight(0xa9bdf0, 0x5a5a3e, 1.35));
  const sun = new THREE.DirectionalLight(0xffcf9a, 3.4); sun.position.set(-extent * 0.67, extent * 0.52, extent * 0.52); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent * 0.93, bottom: -extent * 0.67, near: 10, far: extent * 2.5 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.4; scene.add(sun);
  const moon = new THREE.DirectionalLight(0x7f9fe8, 1.1); moon.position.set(extent * 0.6, extent * 0.45, -extent * 0.45); scene.add(moon);
  return sun;
}