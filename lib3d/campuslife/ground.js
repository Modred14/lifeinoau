// lib3d/campuslife/ground.js
// The ground of the Campuslife look: speckled grass, striped sports fields, speckled car parks, paved footpaths and the red laterite verges beside the roads. All textures are painted on small canvases in
// the browser (no downloads). Textures and layout from campus/client/game/world.ts (commit c2b9477). Flat geometry here is in SCENE units (metres * S), like the rest of the map's ground layers.
import * as THREE from "three";

const hex = (c) => "#" + c.toString(16).padStart(6, "0");
const rng = (seed) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function canvasTex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
const canvas = (size) => { const c = document.createElement("canvas"); c.width = c.height = size; return c; };
function noiseTexture(size, palette, blotch) {
  const c = canvas(size), g = c.getContext("2d"), rand = rng(size * 31 + palette[0][0]);
  g.fillStyle = hex(palette[0][0]); g.fillRect(0, 0, size, size);
  for (let i = 0; i < 40 * blotch; i++) {
    const [col] = palette[1 + Math.floor(rand() * (palette.length - 1))], x = rand() * size, y = rand() * size, r = (0.08 + rand() * 0.2) * size;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) { const grad = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); grad.addColorStop(0, hex(col) + "88"); grad.addColorStop(1, hex(col) + "00"); g.fillStyle = grad; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); }
  }
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) { const n = (rand() - 0.5) * 22; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  return canvasTex(c);
}
function paverTexture(a, b) {
  const c = canvas(128), g = c.getContext("2d"), rand = rng(a);
  g.fillStyle = hex(b); g.fillRect(0, 0, 128, 128);
  for (let row = 0; row < 8; row++) for (let col = -1; col < 5; col++) { g.fillStyle = "#" + new THREE.Color(a).multiplyScalar(0.9 + rand() * 0.2).getHexString(); g.fillRect(col * 32 + (row % 2) * 16 + 1, row * 16 + 1, 30, 14); }
  return canvasTex(c);
}
function stripeTexture(a, b) { const c = canvas(64), g = c.getContext("2d"); g.fillStyle = hex(a); g.fillRect(0, 0, 64, 64); g.fillStyle = hex(b); g.fillRect(0, 0, 32, 64); return canvasTex(c); }

/** The painted textures, each with the size in metres that one tile covers. */
export function groundTextures() {
  const t = {
    grass: { map: noiseTexture(256, [[0x6c9a48, 0.5], [0x7fa955, 0.25], [0x5d8a3d, 0.17], [0x9a9a5a, 0.08]], 0.55), metres: 14 },
    parking: { map: noiseTexture(128, [[0x6f7176, 0.6], [0x64666b, 0.3], [0x7d7f84, 0.1]], 0.4), metres: 6 },
    pitch: { map: stripeTexture(0x4f9a48, 0x5aa652), metres: 10 },
    path: { map: paverTexture(0xbfa48a, 0xa08670), metres: 2.4 },
    verge: { map: noiseTexture(128, [[0xa6643f, 0.5], [0x93583a, 0.3], [0xb87a52, 0.2]], 0.5), metres: 3 },
  };
  return { ...t, dispose() { for (const q of Object.values(t)) q.map.dispose(); } };
}
/** Flat geometry shows its texture at the true size when its UVs are its own x, y (ShapeGeometry) or x, z in scene units: this sets the repeat. */
export const tiled = (tex, S) => { tex.map.repeat.setScalar(1 / (tex.metres * S)); return tex.map; };

/** The grass under everything: one plane well past the map's rim (the expressway runs 600 m beyond it), where the fog takes it. Same name, height and polygon offset as the classic ground. */
export function buildGrass(data, S, tex, { margin = 1200 } = {}) {
  const b = data.bounds, W = (b.x1 - b.x0 + margin * 2) * S, D = (b.z1 - b.z0 + margin * 2) * S;
  const g = new THREE.PlaneGeometry(W, D), uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W, uv.getY(i) * D);
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tiled(tex, S), roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(((b.x0 + b.x1) / 2) * S, 0, ((b.z0 + b.z1) / 2) * S); mesh.receiveShadow = true; mesh.renderOrder = -2; mesh.name = "ground";
  return mesh;
}

/** Does point i of a line need its round joint: an end of the line, or a bend sharp enough to leave a notch more than 0.3 m deep without one? */
function rounded(pts, i, half) {
  const o = pts[i - 1], a = pts[i], b = pts[i + 1]; if (!o || !b) return true;
  const turn = Math.atan2(b[1] - a[1], b[0] - a[0]) - Math.atan2(a[1] - o[1], a[0] - o[0]);
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn))) * half > 0.3;
}

/** Bands along polylines ([{ pts: [[x, z]], half }] in metres) with round joints, as one flat mesh at height y; `layer` is the polygon offset, as for the other ground layers. */
export function buildStrips(lines, S, tex, y, layer) {
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0] * S, 0, a[1] * S, b[0] * S, 0, b[1] * S, c[0] * S, 0, c[1] * S);
  for (const { pts, half } of lines) for (let i = 0; i < pts.length; i++) {
    const a = pts[i]; if (rounded(pts, i, half)) for (let k = 0; k < 8; k++) { const u = (k / 8) * Math.PI * 2, v = ((k + 1) / 8) * Math.PI * 2; tri(a, [a[0] + Math.cos(v) * half, a[1] + Math.sin(v) * half], [a[0] + Math.cos(u) * half, a[1] + Math.sin(u) * half]); }
    const b = pts[i + 1]; if (!b) continue;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (-(b[1] - a[1]) / len) * half, nz = ((b[0] - a[0]) / len) * half;
    tri([a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] - nx, b[1] - nz]); tri([a[0] + nx, a[1] + nz], [b[0] - nx, b[1] - nz], [a[0] - nx, a[1] - nz]);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry(), uv = new Float32Array((pos.length / 3) * 2), nor = new Float32Array(pos.length);
  for (let i = 0; i < pos.length / 3; i++) { uv[i * 2] = pos[i * 3]; uv[i * 2 + 1] = pos[i * 3 + 2]; nor[i * 3 + 1] = 1; }
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tiled(tex, S), roughness: 0.95, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer }));
  m.position.y = y; m.userData.layerY = y; m.receiveShadow = true;
  return m;
}

/** The red laterite verge beside every ground road: the road graph's own carriageway and pavement, widened by VERGE metres (the road is drawn over its middle). */
export function vergeLines(graph, VERGE = 1.1) {
  const out = [], at = {};
  for (const e of graph.edges) {
    if (e.hw || e.lv || e.fixed) continue;   // not the expressway or anything raised
    const pts = [], step = 6; for (let s = 0; ; s += step) { e.path.at(Math.min(s, e.len), at); pts.push([at.x, at.z]); if (s >= e.len) break; }
    out.push({ pts, half: e.half + (e.sw ?? 0) + VERGE });
  }
  return out;
}
