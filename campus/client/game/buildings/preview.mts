import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import * as THREE from "three";
import { BUILDINGS, PX_PER_METER } from "@campuslife/shared/map";
import { buildBuilding } from "./archetypes.ts";
import { paintAtlas } from "./atlas.ts";
import { emptyBuffers } from "./types.ts";
import { footprintOf } from "./footprint.ts";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.local/verification/buildings");
const atlas = paintAtlas();
const W = 1500, H = 940, SS = 2;
const toLinear = new Float32Array(256).map((_, i) => Math.pow(i / 255, 2.2));
const toSrgb = (v: number) => Math.round(255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2));

interface Shot {
  name: string;
  target: number;
  radius: number;
  distance: number;
  height: number;
  angle: number;
  night?: boolean;
}

function sample(data: Uint8ClampedArray, width: number, height: number, u: number, v: number, o: Float32Array) {
  const x = Math.floor((u - Math.floor(u)) * width) % width;
  const y = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
  const i = (y * width + x) * 4;
  o[0] = toLinear[data[i]];
  o[1] = toLinear[data[i + 1]];
  o[2] = toLinear[data[i + 2]];
}

async function render(shot: Shot) {
  const centre = BUILDINGS[shot.target].bbox;
  const cx = (centre.x + centre.w / 2) / PX_PER_METER, cz = (centre.y + centre.h / 2) / PX_PER_METER;
  const buf = emptyBuffers();
  for (const b of BUILDINGS) {
    const x = (b.bbox.x + b.bbox.w / 2) / PX_PER_METER, z = (b.bbox.y + b.bbox.h / 2) / PX_PER_METER;
    if (Math.hypot(x - cx, z - cz) < shot.radius) buildBuilding(buf, b);
  }
  const w = W * SS, h = H * SS;
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.5, 2000);
  camera.position.set(cx + Math.cos(shot.angle) * shot.distance, shot.height, cz + Math.sin(shot.angle) * shot.distance);
  camera.lookAt(cx, Math.min(6, shot.height * 0.4), cz);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const view = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const day = shot.night ? 0.12 : 1;
  const sun = new THREE.Vector3(-0.45, 0.75, 0.5).normalize();
  const pixels = new Float32Array(w * h * 3);
  const depth = new Float32Array(w * h).fill(Infinity);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const horizon = 0.46;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if (t < horizon) pixels.set([(0.25 + 0.4 * (t / horizon)) * day, (0.45 + 0.35 * (t / horizon)) * day, (0.8 + 0.05 * (t / horizon)) * day], i);
      else pixels.set([0.14 * day, 0.3 * day, 0.08 * day], i);
    }
  }
  const p = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const tex = new Float32Array(3), glow = new Float32Array(3);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), normal = new THREE.Vector3();
  for (let t = 0; t < buf.idx.length; t += 3) {
    const ids = [buf.idx[t], buf.idx[t + 1], buf.idx[t + 2]];
    let behind = false;
    for (let k = 0; k < 3; k++) {
      p[k].set(buf.pos[ids[k] * 3], buf.pos[ids[k] * 3 + 1], buf.pos[ids[k] * 3 + 2], 1).applyMatrix4(view);
      if (p[k].w < 0.5) behind = true;
    }
    if (behind) continue;
    const sx = p.map((q) => ((q.x / q.w) * 0.5 + 0.5) * w), sy = p.map((q) => (1 - ((q.y / q.w) * 0.5 + 0.5)) * h);
    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (area >= 0) continue;
    e1.set(buf.pos[ids[1] * 3] - buf.pos[ids[0] * 3], buf.pos[ids[1] * 3 + 1] - buf.pos[ids[0] * 3 + 1], buf.pos[ids[1] * 3 + 2] - buf.pos[ids[0] * 3 + 2]);
    e2.set(buf.pos[ids[2] * 3] - buf.pos[ids[0] * 3], buf.pos[ids[2] * 3 + 1] - buf.pos[ids[0] * 3 + 1], buf.pos[ids[2] * 3 + 2] - buf.pos[ids[0] * 3 + 2]);
    normal.crossVectors(e1, e2).normalize();
    const light = (0.42 + 0.14 * normal.y + 0.85 * Math.max(0, normal.dot(sun))) * day;
    const x0 = Math.max(0, Math.floor(Math.min(...sx))), x1 = Math.min(w - 1, Math.ceil(Math.max(...sx)));
    const y0 = Math.max(0, Math.floor(Math.min(...sy))), y1 = Math.min(h - 1, Math.ceil(Math.max(...sy)));
    const iw = p.map((q) => 1 / q.w);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const a = ((sx[1] - x) * (sy[2] - y) - (sx[2] - x) * (sy[1] - y)) / area;
        const b = ((sx[2] - x) * (sy[0] - y) - (sx[0] - x) * (sy[2] - y)) / area;
        const c = 1 - a - b;
        if (a < 0 || b < 0 || c < 0) continue;
        const inv = a * iw[0] + b * iw[1] + c * iw[2];
        const z = 1 / inv;
        const at = y * w + x;
        if (z >= depth[at]) continue;
        depth[at] = z;
        const wa = (a * iw[0]) / inv, wb = (b * iw[1]) / inv, wc = (c * iw[2]) / inv;
        const u = wa * buf.uv[ids[0] * 2] + wb * buf.uv[ids[1] * 2] + wc * buf.uv[ids[2] * 2];
        const v = wa * buf.uv[ids[0] * 2 + 1] + wb * buf.uv[ids[1] * 2 + 1] + wc * buf.uv[ids[2] * 2 + 1];
        sample(atlas.color, atlas.width, atlas.height, u, v, tex);
        sample(atlas.glow, atlas.glowWidth, atlas.glowHeight, u, v, glow);
        for (let k = 0; k < 3; k++) {
          const tint = wa * buf.col[ids[0] * 3 + k] + wb * buf.col[ids[1] * 3 + k] + wc * buf.col[ids[2] * 3 + k];
          pixels[at * 3 + k] = tex[k] * tint * light + (shot.night ? glow[k] * [1, 0.64, 0.25][k] * 0.8 : 0);
        }
      }
    }
  }
  const bytes = Buffer.alloc(w * h * 3);
  for (let i = 0; i < pixels.length; i++) bytes[i] = toSrgb(pixels[i]);
  await sharp(bytes, { raw: { width: w, height: h, channels: 3 } }).resize(W, H).png().toFile(path.join(out, `${shot.name}.png`));
  console.log(shot.name, buf.idx.length / 3, "triangles");
}

await mkdir(out, { recursive: true });
await sharp(Buffer.from(atlas.color.buffer), { raw: { width: atlas.width, height: atlas.height, channels: 4 } }).png().toFile(path.join(out, "atlas.png"));
await sharp(Buffer.from(atlas.glow.buffer), { raw: { width: atlas.glowWidth, height: atlas.glowHeight, channels: 4 } }).png().toFile(path.join(out, "atlas-glow.png"));
const wanted = process.argv.slice(2);
function frontAngle(target: number): number {
  const fp = footprintOf(BUILDINGS[target].poly, target);
  if (!fp.rect) return 0;
  const [a, b] = fp.rect.corners;
  return Math.atan2((a[1] + b[1]) / 2 - fp.centre[1], (a[0] + b[0]) / 2 - fp.centre[0]);
}
const shots: Shot[] = [
  { name: "ojaja-hostel", target: 684, radius: 105, distance: 140, height: 90, angle: 1.1 },
  { name: "akintola-hall", target: 194, radius: 110, distance: 115, height: 45, angle: 1.0 },
  { name: "new-market", target: 1490, radius: 235, distance: 260, height: 190, angle: 1.4 },
  { name: "amazing-grace-hostel", target: 1755, radius: 90, distance: 105, height: 75, angle: 1.3 },
  { name: "shg-hostel", target: 1752, radius: 90, distance: 110, height: 90, angle: 1.3 },
  { name: "library-front", target: 95, radius: 1, distance: 110, height: 14, angle: 3.3 },
  { name: "amphitheatre-front", target: 101, radius: 1, distance: 95, height: 8, angle: 4.55 },
  { name: "oduduwa-front", target: 102, radius: 1, distance: 80, height: 8, angle: 1.55 },
  { name: "senate-complex", target: 103, radius: 140, distance: 145, height: 34, angle: 1.15 },
  { name: "hall-moremi-front", target: 201, radius: 1, distance: 75, height: 10, angle: frontAngle(201) },
  { name: "hall-awolowo-front", target: 164, radius: 1, distance: 70, height: 10, angle: frontAngle(164) },
  { name: "hall-fajuyi-front", target: 211, radius: 1, distance: 85, height: 10, angle: frontAngle(211) },
  { name: "faculty-administration", target: 94, radius: 1, distance: 110, height: 13, angle: 1.73 },
  { name: "hostel-awolowo-low", target: 164, radius: 130, distance: 62, height: 9, angle: 0.6 },
  { name: "hostel-awolowo-street", target: 164, radius: 90, distance: 26, height: 2.2, angle: 1.9 },
  { name: "hostel-awolowo-high", target: 164, radius: 220, distance: 170, height: 120, angle: 2.4 },
  { name: "hostel-angola-bungalows", target: 117, radius: 130, distance: 60, height: 14, angle: 0.9 },
  { name: "hostel-moremi", target: 201, radius: 140, distance: 70, height: 16, angle: 4.0 },
  { name: "hostel-night", target: 164, radius: 130, distance: 62, height: 9, angle: 0.6, night: true },
  { name: "faculty-arts", target: 96, radius: 170, distance: 95, height: 24, angle: 2.2 },
  { name: "faculty-arts-low", target: 99, radius: 120, distance: 55, height: 3, angle: 5.2 },
  { name: "senate-library", target: 95, radius: 220, distance: 150, height: 60, angle: 1.0 },
  { name: "staff-quarters", target: 700, radius: 160, distance: 90, height: 30, angle: 0.8 },
  { name: "quarters-low", target: 1100, radius: 120, distance: 45, height: 5, angle: 2.6 },
  { name: "mosque-etf", target: 88, radius: 90, distance: 40, height: 10, angle: 1.2 },
  { name: "banks-sub", target: 83, radius: 150, distance: 80, height: 22, angle: 3.6 },
];
for (const shot of shots) if (!wanted.length || wanted.includes(shot.name)) await render(shot);
