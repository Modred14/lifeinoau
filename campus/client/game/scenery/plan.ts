import {
  AREAS,
  GATE,
  LINES,
  MAP_HEIGHT_PX,
  MAP_WIDTH_PX,
  MOTOR_PARK,
  PLACES,
  PX_PER_METER,
  ROADS,
  SPAWN_POINT,
  STALLS,
  nearBuilding,
  onRoad,
  pointInPoly,
  type Point,
} from "@campuslife/shared";
import { bedPoint, insideBed, planFlowerBeds, type FlowerBed } from "./planting";
import vegetation from "./vegetation.json";

const M = PX_PER_METER;

export const SCATTER_KINDS = ["tree", "palm", "bush", "scrub", "rock", "tuft", "flower", "bed"] as const;
export type ScatterKind = (typeof SCATTER_KINDS)[number];

export const SCATTER_STRIDE = 5;
export const SCATTER_CHUNK_M = 250;

export interface ScatterChunk {
  cx: number;
  cz: number;
  items: Record<ScatterKind, number[]>;
}

export interface ScatterPlan {
  chunks: ScatterChunk[];
  counts: Record<ScatterKind, number>;
  beds: FlowerBed[];
}

const CELL = 8 * M;
const COARSE = 16 * M;
const ROADSIDE_CELLS = 3;
const SEED = 20261006;

const CLEAR: Record<ScatterKind, { road: number; building: number }> = {
  tree: { road: 2.8 * M, building: 4.2 * M },
  palm: { road: 2.4 * M, building: 3 * M },
  bush: { road: 1.9 * M, building: 1.7 * M },
  scrub: { road: 2.4 * M, building: 2.2 * M },
  rock: { road: 1.9 * M, building: 2 * M },
  tuft: { road: 1.4 * M, building: 1 * M },
  flower: { road: 1.4 * M, building: 1 * M },
  bed: { road: 1.2 * M, building: 1.2 * M },
};

const NEAR = { rock: 0.012, tuft: 0.07 };
const FAR = { rock: 0.016, tuft: 0 };
const LAWN = { rock: 0, tuft: 0 };

export const REAL_TREES: readonly number[] = vegetation.trees;
export const REAL_SHRUBS: readonly number[] = vegetation.shrubs;
export const REAL_TREE_STRIDE = 3;
const PALM = { minM: 6, maxM: 16, share: 0.22, heightM: 7 };

export const treeScale = (heightM: number) => Math.min(2.3, Math.max(0.75, 0.55 + heightM * 0.075));
const palmScale = (heightM: number) => Math.min(1.5, Math.max(0.8, heightM / PALM.heightM));
const scrubScale = (heightM: number) => 0.9 + heightM * 0.3;

const KEEP_OUT: { at: Point; radius: number }[] = [
  ...PLACES.map((p) => ({ at: p.door, radius: 4.5 * M })),
  ...LINES.flatMap((l) => l.stops.flatMap((s) => [{ at: s.kerb, radius: 5 * M }])),
  ...STALLS.flatMap((s) => [{ at: { x: s.x, y: s.y }, radius: 3.4 * M }, { at: { x: s.npc.x, y: s.npc.y }, radius: 1.6 * M }]),
  { at: MOTOR_PARK, radius: 5 * M },
  { at: SPAWN_POINT, radius: 7 * M },
  ...(GATE ? [{ at: { x: GATE.x, y: GATE.y }, radius: 22 * M }] : []),
];

function hash(a: number, b: number, c: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul(c | 0, 2147483647) + SEED) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function buildRoadside(): { near: Uint8Array; w: number; h: number } {
  const w = Math.ceil(MAP_WIDTH_PX / COARSE);
  const h = Math.ceil(MAP_HEIGHT_PX / COARSE);
  let near = new Uint8Array(w * h);
  for (const r of ROADS) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by = r.pts[i + 3];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (COARSE / 2)));
      for (let k = 0; k <= steps; k++) {
        const cx = Math.floor((ax + ((bx - ax) * k) / steps) / COARSE);
        const cy = Math.floor((ay + ((by - ay) * k) / steps) / COARSE);
        if (cx >= 0 && cy >= 0 && cx < w && cy < h) near[cy * w + cx] = 1;
      }
    }
  }
  for (let pass = 0; pass < ROADSIDE_CELLS; pass++) {
    const next = new Uint8Array(near);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (near[y * w + x]) continue;
        if ((x > 0 && near[y * w + x - 1]) || (x < w - 1 && near[y * w + x + 1]) || (y > 0 && near[(y - 1) * w + x]) || (y < h - 1 && near[(y + 1) * w + x])) next[y * w + x] = 1;
      }
    near = next;
  }
  return { near, w, h };
}

interface Zone {
  poly: readonly number[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function zonesOf(kinds: readonly string[]): Zone[] {
  return AREAS.filter((a) => kinds.includes(a.kind)).map((a) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < a.poly.length; i += 2) {
      x0 = Math.min(x0, a.poly[i]);
      x1 = Math.max(x1, a.poly[i]);
      y0 = Math.min(y0, a.poly[i + 1]);
      y1 = Math.max(y1, a.poly[i + 1]);
    }
    return { poly: a.poly, x0, y0, x1, y1 };
  });
}

const inZones = (zones: readonly Zone[], x: number, y: number, pad = 0) =>
  zones.some((z) => x >= z.x0 - pad && x <= z.x1 + pad && y >= z.y0 - pad && y <= z.y1 + pad && (pointInPoly(x, y, z.poly) || (pad > 0 && (pointInPoly(x + pad, y, z.poly) || pointInPoly(x - pad, y, z.poly) || pointInPoly(x, y + pad, z.poly) || pointInPoly(x, y - pad, z.poly)))));

export function clearOfRoad(x: number, y: number, margin: number): boolean {
  return !onRoad(x, y) && !onRoad(x + margin, y) && !onRoad(x - margin, y) && !onRoad(x, y + margin) && !onRoad(x, y - margin);
}

export function planScatter(density = 1): ScatterPlan {
  const roadside = buildRoadside();
  const hard = zonesOf(["water", "field", "parking", "plaza"]);
  const lawns = zonesOf(["grass"]);
  const chunkPx = SCATTER_CHUNK_M * M;
  const chunkCols = Math.ceil(MAP_WIDTH_PX / chunkPx);
  const chunks = new Map<number, ScatterChunk>();
  const counts: Record<ScatterKind, number> = { tree: 0, palm: 0, bush: 0, scrub: 0, rock: 0, tuft: 0, flower: 0, bed: 0 };
  const keepCell = 24 * M;
  const keepCols = Math.ceil(MAP_WIDTH_PX / keepCell);
  const keepOut = new Map<number, { at: Point; radius: number }[]>();
  for (const k of KEEP_OUT) {
    const cx = Math.floor(k.at.x / keepCell);
    const cy = Math.floor(k.at.y / keepCell);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const key = (cy + dy) * keepCols + cx + dx;
        const list = keepOut.get(key);
        if (list) list.push(k);
        else keepOut.set(key, [k]);
      }
  }
  const kept = (x: number, y: number) => {
    const list = keepOut.get(Math.floor(y / keepCell) * keepCols + Math.floor(x / keepCell));
    return !!list && list.some((k) => Math.hypot(k.at.x - x, k.at.y - y) < k.radius);
  };

  const clear = (kind: ScatterKind, x: number, y: number) => {
    if (x < 2 * M || y < 2 * M || x > MAP_WIDTH_PX - 2 * M || y > MAP_HEIGHT_PX - 2 * M) return false;
    const c = CLEAR[kind];
    return clearOfRoad(x, y, c.road) && !nearBuilding(x, y, c.building) && !kept(x, y) && !inZones(hard, x, y, kind === "tuft" ? 0 : M);
  };
  const beds = density > 0 ? planFlowerBeds((x, y) => clear("bed", x, y)) : [];
  const put = (kind: ScatterKind, x: number, y: number, scale: number, yaw: number, tint: number) => {
    if (!clear(kind, x, y)) return;
    if ((kind === "rock" || kind === "tuft" || kind === "scrub") && inZones(lawns, x, y)) return;
    if (kind !== "bed" && kind !== "flower" && kind !== "bush" && beds.some((bed) => insideBed(bed, x, y, kind === "tree" || kind === "palm" ? 4.5 * scale : 1.5 * scale))) return;
    const key = Math.floor(y / chunkPx) * chunkCols + Math.floor(x / chunkPx);
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = {
        cx: (Math.floor(x / chunkPx) + 0.5) * SCATTER_CHUNK_M,
        cz: (Math.floor(y / chunkPx) + 0.5) * SCATTER_CHUNK_M,
        items: { tree: [], palm: [], bush: [], scrub: [], rock: [], tuft: [], flower: [], bed: [] },
      };
      chunks.set(key, chunk);
    }
    chunk.items[kind].push(x / M, y / M, scale, yaw, tint);
    counts[kind]++;
  };

  for (const [i, bed] of beds.entries()) {
    put("bed", bed.x, bed.y, 1, bed.yaw, 0.5);
    for (const x of [-2.8, -1.4, 0, 1.4, 2.8]) {
      const at = bedPoint(bed, x, -0.85);
      put("bush", at.x, at.y, 0.62, bed.yaw, 0.5);
    }
    const spacing = density < 1 ? 0.8 : 0.55;
    for (let row = 0; row < 3; row++)
      for (let x = -3.6 + (row % 2) * spacing / 2, col = 0; x <= 3.6; x += spacing, col++) {
        const z = -0.05 + row * 0.55;
        if ((x / 4.1) ** 2 + (z / 1.45) ** 2 > 1) continue;
        const at = bedPoint(bed, x, z);
        put("flower", at.x, at.y, 0.9 + hash(i, row, col) * 0.2, bed.yaw + hash(i, col, row) * 0.4, hash(i, row, col + 10));
      }
  }

  for (let i = 0; i < REAL_TREES.length; i += REAL_TREE_STRIDE) {
    const mx = REAL_TREES[i];
    const my = REAL_TREES[i + 1];
    const heightM = REAL_TREES[i + 2];
    const r = (n: number) => hash(mx, my, n);
    if (r(30) >= density) continue;
    const palm = heightM >= PALM.minM && heightM <= PALM.maxM && r(40) < PALM.share;
    put(palm ? "palm" : "tree", (mx + r(31)) * M, (my + r(32)) * M, palm ? palmScale(heightM) : treeScale(heightM), r(34) * Math.PI * 2, r(35));
  }

  for (let i = 0; i < REAL_SHRUBS.length; i += REAL_TREE_STRIDE) {
    const mx = REAL_SHRUBS[i];
    const my = REAL_SHRUBS[i + 1];
    const r = (n: number) => hash(mx, my, n);
    if (r(60) >= density) continue;
    put("scrub", (mx + r(61)) * M, (my + r(62)) * M, scrubScale(REAL_SHRUBS[i + 2]) * (0.9 + r(63) * 0.2), r(64) * Math.PI * 2, r(65));
  }

  const cols = Math.ceil(MAP_WIDTH_PX / CELL);
  const rows = Math.ceil(MAP_HEIGHT_PX / CELL);
  for (let gy = 0; gy < rows; gy++)
    for (let gx = 0; gx < cols; gx++) {
      const r = (n: number) => hash(gx, gy, n);
      const x0 = gx * CELL;
      const y0 = gy * CELL;
      const mx = x0 + CELL / 2;
      const my = y0 + CELL / 2;
      const near = roadside.near[Math.min(roadside.h - 1, Math.floor(my / COARSE)) * roadside.w + Math.min(roadside.w - 1, Math.floor(mx / COARSE))] === 1;
      const lawn = inZones(lawns, mx, my);
      const p = lawn ? LAWN : near ? NEAR : FAR;
      if (r(50) < p.rock * density) {
        const n = 1 + Math.floor(r(51) * 2.4);
        const bx = x0 + r(52) * CELL;
        const by = y0 + r(53) * CELL;
        for (let k = 0; k < n; k++) put("rock", bx + (r(54 + k) - 0.5) * 2.2 * M, by + (r(58 + k) - 0.5) * 2.2 * M, 0.5 + r(62 + k) * 1.3, r(66 + k) * Math.PI * 2, r(70 + k));
      }
      if (r(80) < p.tuft * density) {
        const n = 1 + Math.floor(r(81) * 2.5);
        for (let k = 0; k < n; k++) {
          put("tuft", x0 + r(86 + k) * CELL, y0 + r(90 + k) * CELL, 0.7 + r(94 + k) * 0.8, r(98 + k) * Math.PI * 2, r(106 + k) * 0.99);
        }
      }
    }
  return { chunks: [...chunks.values()], counts, beds };
}
