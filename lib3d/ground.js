// lib3d/ground.js
// The ground of the campus map: patchy grass and sand that ends in a beach and shallow water, with the sky-blue showing beyond.
// One canvas texture is painted from soft noise, so grass and sand sit in organic patches. Sand also gathers along the lake shore and beside roads
// (the mapped data has no soil or sand layer, so these patches are decoration, not survey). Pure canvas work, no network.
import * as THREE from "three";

const GRASS = ["#7aa966", "#8bb86f", "#9bc27a"], DRY = "#b3be7e", SAND = ["#e6d6a8", "#d9c696"], SHALLOW = "#9fd3de";
const hash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, y, s) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
const fbm = (x, y, s) => (vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.15);
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r * 255, c.g * 255, c.b * 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Box-blur a Float32 field `r` cells, twice, so masks drawn from outlines fade out softly. */
function blur(f, w, h, r) { const t = new Float32Array(f.length);
  for (let pass = 0; pass < 2; pass++) { for (let y = 0; y < h; y++) { let acc = 0; for (let x = -r; x <= r; x++) acc += f[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = acc / (2 * r + 1); acc += f[y * w + Math.min(w - 1, x + r + 1)] - f[y * w + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += t[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { f[y * w + x] = acc / (2 * r + 1); acc += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } } } return f; }

/**
 * data: parsed map. S: metres to scene units. Returns a Mesh lying at y = 0 that covers the mapped area plus a margin, fading to transparent at its rim.
 * Options: margin (m, default 700), cell (metres per field cell, default 6), px (texture width, default 3072).
 */
export function buildGround(data, S, { margin = 700, cell = 6, px = 3072 } = {}) {
  const b = data.bounds, x0 = b.x0 - margin, x1 = b.x1 + margin, z0 = b.z0 - margin, z1 = b.z1 + margin + 500, W = x1 - x0, H = z1 - z0;
  const fw = Math.ceil(W / cell), fh = Math.ceil(H / cell), toF = (x, z) => [(x - x0) / cell, (z - z0) / cell];
  // masks: where the lake shore and the roads are, painted as thick outlines on a small canvas, then read back
  const mask = (draw, lw) => { const c = document.createElement("canvas"); c.width = fw; c.height = fh; const g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, fw, fh); g.strokeStyle = g.fillStyle = "#fff"; g.lineJoin = g.lineCap = "round"; g.lineWidth = lw / cell; draw(g);
    const px4 = g.getImageData(0, 0, fw, fh).data, f = new Float32Array(fw * fh); for (let i = 0; i < f.length; i++) f[i] = px4[i * 4] / 255; return f; };
  const trace = (g, a, fill) => { g.beginPath(); a.pts.forEach((p, i) => { const [x, y] = toF(p[0], p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); fill ? g.fill() : g.stroke(); };
  const shore = blur(mask((g) => data.areas.water.forEach((a) => { trace(g, a, true); trace(g, a, false); }), 90), fw, fh, Math.round(40 / cell));
  const verge = blur(mask((g) => data.roads.forEach((a) => trace(g, a, false)), 26), fw, fh, Math.round(14 / cell));

  const img = new ImageData(fw, fh), gr = GRASS.map(rgb), dry = rgb(DRY), sd = SAND.map(rgb), shallow = rgb(SHALLOW), d = img.data;
  // the land ends in a rounded, wobbly coast: a pale beach, then shallow water that melts into the sky-blue, so there is no straight cut-off line
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2 + 125, hx = (b.x1 - b.x0) / 2 + 380, hz = (b.z1 - b.z0) / 2 + 505, rr = 420; // coast: 380 m past the map at the sides, 505 m to the south
  for (let j = 0; j < fh; j++) for (let i = 0; i < fw; i++) { const k = j * fw + i, x = x0 + i * cell, z = z0 + j * cell;
    const big = fbm(x / 520, z / 520, 11), mid = fbm(x / 170, z / 170, 23), small = fbm(x / 45, z / 45, 37);
    const qx = Math.abs(x - cx) - (hx - rr), qz = Math.abs(z - cz) - (hz - rr), land = rr - (Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0)) + (fbm(x / 260, z / 260, 91) - 0.5) * 300 + (fbm(x / 70, z / 70, 53) - 0.5) * 40; // metres inside the coast; negative at sea
    const beach = 1 - smooth(15, 120, land), sandy = Math.max(beach, smooth(0.52, 0.64, big + shore[k] * 0.5 + verge[k] * 0.1 + (mid - 0.5) * 0.18)), dryness = smooth(0.5, 0.7, mid + (big - 0.5) * 0.3);
    let c = mix(mix(gr[0], gr[1], smooth(0.3, 0.7, mid)), gr[2], smooth(0.55, 0.8, small));
    c = mix(c, dry, dryness * 0.55); c = mix(c, mix(sd[0], sd[1], smooth(0.3, 0.7, small)), sandy);
    const g = 0.94 + hash(i, j, 5) * 0.1, sea = land < 0, shoal = smooth(-170, 0, land); // shallow water thins out to nothing 170 m offshore
    if (sea) c = mix(sd[1], shallow, smooth(0, 40, -land));
    d[k * 4] = c[0] * (sea ? 1 : g); d[k * 4 + 1] = c[1] * (sea ? 1 : g); d[k * 4 + 2] = c[2] * (sea ? 1 : g); d[k * 4 + 3] = sea ? 255 * shoal * 0.85 : 255; }
  // painted at low resolution, then scaled up smoothly so every edge is soft
  const src = document.createElement("canvas"); src.width = fw; src.height = fh; src.getContext("2d").putImageData(img, 0, 0);
  const cv = document.createElement("canvas"); cv.width = px; cv.height = Math.round((px * H) / W); const cg = cv.getContext("2d"); cg.imageSmoothingEnabled = true; cg.imageSmoothingQuality = "high"; cg.drawImage(src, 0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W * S, H * S), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(((x0 + x1) / 2) * S, 0, ((z0 + z1) / 2) * S); mesh.receiveShadow = true; mesh.renderOrder = -2; mesh.name = "ground";
  return mesh;
}