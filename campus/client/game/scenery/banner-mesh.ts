import * as THREE from "three";
import { BANNER_FLAG_COLORS, BANNER_SIZES, PX_PER_METER, type BannerSpot } from "@campuslife/shared";
import type { Part } from "./kit";

export const BANNER_CHUNK_M = 250;
export const VERTS_PER_COLUMN = 6;

export interface FaceQuad {
  spot: number;
  slot: number;
  start: number;
  cols: number;
}

export interface BannerChunk {
  cx: number;
  cz: number;
  parts: Part[];
  positions: number[];
  normals: number[];
  sway: number[];
  quads: FaceQuad[];
}

const M = PX_PER_METER;
const COLOR = { bamboo: 0xb99a5b, pipe: 0x6d7379, rope: 0xd9d2bd, post: 0x5a4632, baize: 0x2f5d46, roof: 0x8a3b2a, steel: 0x3b3f45, inside: 0x4a3a2a, flagPole: 0xc9ccd1 };
const CLOTH = { flexCols: 4, crossCols: 6, crossEdge: 0.8, proud: 0.03, boardGap: 0.06, aframeFoot: 0.26, aframeTop: 0.02, billboardProud: 0.06, flagLength: 1.2, flagDrop: 0.12 };

interface Frame {
  cx: number;
  cz: number;
  ax: number;
  az: number;
  nx: number;
  nz: number;
  yaw: number;
}

function frameOf(s: BannerSpot): Frame {
  return { cx: s.x / M, cz: s.y / M, ax: -Math.sin(s.face), az: Math.cos(s.face), nx: Math.cos(s.face), nz: Math.sin(s.face), yaw: Math.PI / 2 - s.face };
}

function quad(c: BannerChunk, spot: number, slot: number, f: Frame, side: 1 | -1, along: number, hw: number, y0: number, y1: number, foot: number, top: number, cols: number, sway: number) {
  const ax = f.ax * side, az = f.az * side, nx = f.nx * side, nz = f.nz * side;
  const ox = f.cx + f.ax * along;
  const oz = f.cz + f.az * along;
  const rise = y1 - y0;
  const len = Math.hypot(rise, foot - top) || 1;
  const normal = [(nx * rise) / len, (foot - top) / len, (nz * rise) / len];
  const corner = (t: number, up: boolean) => {
    const a = hw * (1 - 2 * t);
    const out = up ? top : foot;
    c.positions.push(ox + ax * a + nx * out, up ? y1 : y0, oz + az * a + nz * out);
    c.normals.push(normal[0], normal[1], normal[2]);
    c.sway.push(side * sway * Math.sin(Math.PI * t));
  };
  c.quads.push({ spot, slot, start: c.positions.length / 3, cols });
  for (let k = 0; k < cols; k++) {
    const t0 = k / cols;
    const t1 = (k + 1) / cols;
    corner(t0, false);
    corner(t1, false);
    corner(t1, true);
    corner(t0, false);
    corner(t1, true);
    corner(t0, true);
  }
}

function both(c: BannerChunk, spot: number, f: Frame, hw: number, y0: number, y1: number, foot: number, top: number, cols: number, sway: number) {
  quad(c, spot, 0, f, 1, 0, hw, y0, y1, foot, top, cols, sway);
  quad(c, spot, 0, f, -1, 0, hw, y0, y1, foot, top, cols, sway);
}

function dress(c: BannerChunk, s: BannerSpot, i: number) {
  const f = frameOf(s);
  const size = BANNER_SIZES[s.kind];
  const hw = size.width / 2;
  const top = size.lift + size.height;
  const at = (along: number, up: number): [number, number, number] => [f.cx + f.ax * along, up, f.cz + f.az * along];
  const rot: [number, number, number] = [0, f.yaw, 0];
  const pole = (along: number, r: number, color: number) => c.parts.push({ geo: new THREE.CylinderGeometry(r * 0.8, r, size.pole, 5), color, at: at(along, size.pole / 2) });
  const box = (w: number, h: number, d: number, along: number, up: number, color: number) => c.parts.push({ geo: new THREE.BoxGeometry(w, h, d), color, at: at(along, up), rot });

  if (s.kind === "flex") {
    for (const side of [-1, 1]) pole(side * (hw + 0.04), 0.045, i % 3 ? COLOR.bamboo : COLOR.pipe);
    both(c, i, f, hw, size.lift, top, 0, 0, CLOTH.flexCols, 1);
  } else if (s.kind === "cross") {
    for (const side of [-1, 1]) pole((side * s.span) / 2, 0.08, COLOR.pipe);
    for (const y of [size.lift + 0.04, top - 0.04]) box(s.span, 0.025, 0.025, 0, y, COLOR.rope);
    both(c, i, f, Math.min(size.width, s.span - CLOTH.crossEdge) / 2, size.lift, top, 0, 0, CLOTH.crossCols, 1);
  } else if (s.kind === "board") {
    for (const side of [-1, 1]) box(0.09, size.pole, 0.09, side * (hw + 0.05), size.pole / 2, COLOR.post);
    box(size.width, size.height, 0.05, 0, size.lift + size.height / 2, COLOR.baize);
    box(size.width + 0.5, 0.06, 0.75, 0, size.pole + 0.03, COLOR.roof);
    const rows = Math.ceil(size.slots / size.cols);
    const pw = (size.width - (size.cols + 1) * CLOTH.boardGap) / size.cols;
    const ph = (size.height - (rows + 1) * CLOTH.boardGap) / rows;
    for (let slot = 0; slot < size.slots; slot++) {
      const col = slot % size.cols;
      const row = Math.floor(slot / size.cols);
      const y1 = top - CLOTH.boardGap - row * (ph + CLOTH.boardGap);
      quad(c, i, slot, f, 1, hw - CLOTH.boardGap - pw / 2 - col * (pw + CLOTH.boardGap), pw / 2, y1 - ph, y1, CLOTH.proud, CLOTH.proud, 1, 0);
    }
  } else if (s.kind === "aframe") {
    box(size.width, size.height * 0.9, 0.03, 0, size.lift + size.height * 0.45, COLOR.inside);
    both(c, i, f, hw, size.lift, top, CLOTH.aframeFoot, CLOTH.aframeTop, 1, 0);
  } else if (s.kind === "billboard") {
    for (const side of [-1, 1]) box(0.28, top, 0.28, side * hw * 0.55, top / 2, COLOR.steel);
    box(size.width + 0.3, size.height + 0.3, 0.1, 0, size.lift + size.height / 2, COLOR.steel);
    both(c, i, f, hw, size.lift, top, CLOTH.billboardProud, CLOTH.billboardProud, 1, 0);
  } else {
    const pitch = size.width / Math.max(1, size.cols - 1);
    for (let k = 0; k < size.cols; k++) {
      const along = -hw + k * pitch;
      pole(along, 0.06, COLOR.flagPole);
      box(CLOTH.flagLength, size.height, 0.02, along - CLOTH.flagLength / 2 - 0.05, size.pole - CLOTH.flagDrop - size.height / 2, BANNER_FLAG_COLORS[k % BANNER_FLAG_COLORS.length]);
    }
  }
}

export function planChunks(spots: readonly BannerSpot[]): BannerChunk[] {
  const chunks = new Map<string, BannerChunk>();
  spots.forEach((s, i) => {
    const gx = Math.floor(s.x / M / BANNER_CHUNK_M);
    const gz = Math.floor(s.y / M / BANNER_CHUNK_M);
    const key = `${gx},${gz}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { cx: (gx + 0.5) * BANNER_CHUNK_M, cz: (gz + 0.5) * BANNER_CHUNK_M, parts: [], positions: [], normals: [], sway: [], quads: [] };
      chunks.set(key, chunk);
    }
    dress(chunk, s, i);
  });
  return [...chunks.values()];
}
