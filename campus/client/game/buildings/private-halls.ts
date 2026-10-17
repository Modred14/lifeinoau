import { BAYS_PER_ROW, ROW, flatUv, rowUv } from "./atlas-layout";
import { at, outward, type Footprint } from "./footprint";
import { beam, prism, quad, wall } from "./mesh";
import { flatRoof, pitchedRoof, safeOverhang } from "./roofs";
import { rgb, shade, type BuildingBuffers, type BuildingSpec, type Rgb, type Vec2, type Vec3 } from "./types";

const BASE_HEIGHT = 0.48;
const SLAB_DEPTH = 0.18;
const COLUMN_WIDTH = 0.32;
const MAX_COLUMN_BAYS = 16;
const MAX_RAIL_INTERVALS = 50;
const METAL = rgb(0x212321);

export function buildPrivateHall(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec): boolean {
  const frame = fp.rect;
  if (!frame) return false;
  const { length, depth, corners } = frame;
  const framed = spec.facade === "shg";
  const columnWidth = framed ? 0.9 : COLUMN_WIDTH;
  const height = spec.floors * spec.storey;
  const recess = Math.min(1.2, depth * 0.18);
  const flat = flatUv(ROW.plain);
  const dark = shade(spec.wall, 0.56);
  const point = (s: number, t: number, y: number): Vec3 => {
    const p = at(frame, s, t);
    return [p[0], y, p[1]];
  };
  const rectangle = (s0: number, s1: number, t0: number, t1: number): Vec2[] => [at(frame, s0, t0), at(frame, s1, t0), at(frame, s1, t1), at(frame, s0, t1)];
  const box = (base: readonly Vec2[], y0: number, y1: number, color: Rgb, caps: boolean) => {
    prism(buf, base, y0, y1, { side: color, top: caps ? color : null, bottom: caps ? shade(color, 0.65) : null, flat });
  };
  const front = outward(fp, corners[0], corners[1]);
  const back = outward(fp, corners[2], corners[3]);
  const ends = [outward(fp, corners[3], corners[0]), outward(fp, corners[1], corners[2])] as const;
  const bays = Math.max(1, Math.round(length / Math.max(2.8, spec.bay)));
  const corridorUv = rowUv(ROW.hostelCorridor, 0, bays / BAYS_PER_ROW, 0.34, 0.8);
  const endUv = rowUv(ROW.hostelRooms, 0, Math.max(1, Math.round(depth / Math.max(2.8, spec.bay))) / BAYS_PER_ROW);
  const screen = length <= 28 && depth >= 5.5 && height >= 8;
  const screenWidth = Math.min(2.8, depth * 0.42);
  const screenStart = (depth - screenWidth) / 2;
  const screenEnd = screenStart + screenWidth;

  prism(buf, corners, 0, 0.45, { side: dark, top: null, bottom: null, flat });
  prism(buf, corners, 0.45, BASE_HEIGHT, { side: dark, top: spec.trim, bottom: null, flat });
  for (let floor = 0; floor < spec.floors; floor++) {
    const y0 = floor === 0 ? BASE_HEIGHT : floor * spec.storey;
    const y1 = (floor + 1) * spec.storey - SLAB_DEPTH;
    wall(buf, at(frame, 0, recess), at(frame, length, recess), y0, y1, corridorUv, spec.wall, spec.wall, front);
    wall(buf, at(frame, length, depth - recess), at(frame, 0, depth - recess), y0, y1, corridorUv, spec.wall, spec.wall, back);
    const spans = screen ? [[0, screenStart], [screenEnd, depth]] : [[0, depth]];
    for (const [t0, t1] of spans) wall(buf, at(frame, 0, t0), at(frame, 0, t1), y0, y1, endUv, spec.wall, spec.wall, ends[0]);
    wall(buf, at(frame, length, depth), at(frame, length, 0), y0, y1, endUv, spec.wall, spec.wall, ends[1]);
    const slabY = (floor + 1) * spec.storey;
    box(corners, slabY - SLAB_DEPTH, slabY, spec.trim, true);
  }

  const columns = Math.max(1, Math.min(MAX_COLUMN_BAYS, Math.ceil(length / (framed ? 5.2 : 4.2))));
  for (let i = 0; i <= columns; i++) {
    const inset = columnWidth / 2 + 0.03;
    const s = inset + ((length - 2 * inset) * i) / columns;
    for (const t of [inset, depth - inset]) {
      box(rectangle(s - columnWidth / 2, s + columnWidth / 2, t - columnWidth / 2, t + columnWidth / 2), BASE_HEIGHT, height, spec.trim, false);
    }
  }

  const intervals = Math.max(2, Math.min(MAX_RAIL_INTERVALS, Math.ceil(length / (framed ? 5.2 : 0.72))));
  for (let floor = 1; floor < spec.floors; floor++) {
    const y = floor * spec.storey;
    for (const [t, normal] of [[0.13, front], [depth - 0.13, back]] as const) {
      for (const railY of (framed ? [y + 0.2, y + 0.64, y + 1.08] : [y + 0.2, y + 1.08])) beam(buf, point(0.18, t, railY), point(length - 0.18, t, railY), 0.045, METAL, flat);
      for (let i = 0; i <= intervals; i++) {
        const s = 0.18 + ((length - 0.36) * i) / intervals;
        wall(buf, at(frame, s - 0.02, t), at(frame, s + 0.02, t), y + 0.2, y + 1.08, flat, METAL, METAL, normal);
      }
    }
  }

  if (screen) {
    const y0 = BASE_HEIGHT + 0.12, y1 = height - 0.32;
    wall(buf, at(frame, 0.7, screenStart), at(frame, 0.7, screenEnd), y0, y1, corridorUv, shade(spec.wall, 0.48), shade(spec.wall, 0.48), ends[0]);
    const screenHeight = y1 - y0;
    for (const slope of [-1.4, 1.4]) {
      const low = Math.min(0, -slope * screenWidth);
      const high = screenHeight + Math.max(0, -slope * screenWidth);
      for (let offset = low + 0.35; offset < high; offset += 0.85) {
        const hits: Vec2[] = [];
        const add = (x: number, y: number) => {
          if (x < -0.001 || x > screenWidth + 0.001 || y < -0.001 || y > screenHeight + 0.001) return;
          if (hits.some((p) => Math.hypot(x - p[0], y - p[1]) < 0.001)) return;
          hits.push([x, y]);
        };
        add(0, offset);
        add(screenWidth, offset + slope * screenWidth);
        add(-offset / slope, 0);
        add((screenHeight - offset) / slope, screenHeight);
        if (hits.length !== 2) continue;
        const [a, b] = hits;
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (distance < 0.08) continue;
        const dx = ((b[1] - a[1]) / distance) * 0.04;
        const dy = (-(b[0] - a[0]) / distance) * 0.04;
        const p = [point(0.02, screenStart + a[0] - dx, y0 + a[1] - dy), point(0.02, screenStart + b[0] - dx, y0 + b[1] - dy), point(0.02, screenStart + b[0] + dx, y0 + b[1] + dy), point(0.02, screenStart + a[0] + dx, y0 + a[1] + dy)] as const;
        const normal: Vec3 = [ends[0][0], 0, ends[0][1]];
        quad(buf, ...p, flat, spec.trim, spec.trim, normal);
        quad(buf, ...p, flat, spec.trim, spec.trim, [-normal[0], 0, -normal[2]]);
      }
    }
  }

  if (spec.roof === "flat") flatRoof(buf, fp, height, height + 0.22, spec.roofColor, dark);
  else {
    const rise = Math.min(3.4, Math.max(0.7, (depth / 2) * spec.slope));
    const over = safeOverhang(Math.min(0.48, spec.overhang), height, rise / (depth / 2));
    pitchedRoof(buf, frame, { from: 0, to: length, y: height, rise, over, overEnd: over, hip: spec.roof === "hip", gables: true, color: spec.roofColor, wall: spec.wall, fascia: spec.trim });
  }
  return true;
}
