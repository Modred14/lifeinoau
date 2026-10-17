import { PX_PER_METER } from "@campuslife/shared/map";
import { hash, type Vec2 } from "./types";

export interface RectFrame {
  corners: readonly [Vec2, Vec2, Vec2, Vec2];
  length: number;
  depth: number;
}

export interface Footprint {
  pts: Vec2[];
  area: number;
  sign: number;
  centre: Vec2;
  longest: number;
  shortest: number;
  rect: RectFrame | null;
}

const RIGHT_ANGLE_TOLERANCE = 0.12;
const SIDE_TOLERANCE = 0.08;

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

function rectFrame(pts: readonly Vec2[], id: number): RectFrame | null {
  if (pts.length !== 4) return null;
  const sides = pts.map((p, i) => dist(p, pts[(i + 1) % 4]));
  if (Math.min(...sides) < 1.5) return null;
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[(i + 1) % 4], c = pts[(i + 2) % 4];
    const cos = ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (sides[i] * sides[(i + 1) % 4]);
    if (Math.abs(cos) > RIGHT_ANGLE_TOLERANCE) return null;
    if (Math.abs(sides[i] - sides[(i + 2) % 4]) > SIDE_TOLERANCE * Math.max(sides[i], sides[(i + 2) % 4])) return null;
  }
  const longFirst = sides[0] + sides[2] >= sides[1] + sides[3] ? 0 : 1;
  const start = longFirst + (hash(id, 11) < 0.5 ? 0 : 2);
  const corners: [Vec2, Vec2, Vec2, Vec2] = [pts[start % 4], pts[(start + 1) % 4], pts[(start + 2) % 4], pts[(start + 3) % 4]];
  return {
    corners,
    length: (dist(corners[0], corners[1]) + dist(corners[2], corners[3])) / 2,
    depth: (dist(corners[1], corners[2]) + dist(corners[3], corners[0])) / 2,
  };
}

export function footprintOf(poly: readonly number[], id: number): Footprint {
  const pts: Vec2[] = [];
  for (let i = 0; i < poly.length; i += 2) {
    const p: Vec2 = [poly[i] / PX_PER_METER, poly[i + 1] / PX_PER_METER];
    const last = pts[pts.length - 1];
    if (!last || dist(last, p) > 0.01) pts.push(p);
  }
  if (pts.length > 1 && dist(pts[0], pts[pts.length - 1]) <= 0.01) pts.pop();
  let twice = 0, cx = 0, cz = 0, perimeter = 0, bx = 0, bz = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const cross = a[0] * b[1] - b[0] * a[1];
    twice += cross;
    cx += (a[0] + b[0]) * cross;
    cz += (a[1] + b[1]) * cross;
    perimeter += dist(a, b);
    bx += a[0] / n;
    bz += a[1] / n;
  }
  const area = Math.abs(twice) / 2;
  const centre: Vec2 = area > 0.5 ? [cx / (3 * twice), cz / (3 * twice)] : [bx, bz];
  const rect = rectFrame(pts, id);
  let longest = 0, shortest = 0;
  if (rect) {
    longest = rect.length;
    shortest = rect.depth;
  } else {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      z0 = Math.min(z0, p[1]);
      z1 = Math.max(z1, p[1]);
    }
    longest = Math.max(x1 - x0, z1 - z0, perimeter / 4);
    shortest = Math.min(x1 - x0, z1 - z0);
  }
  return { pts, area, sign: twice >= 0 ? 1 : -1, centre, longest, shortest, rect };
}

export function outward(fp: Footprint, a: Vec2, b: Vec2): Vec2 {
  const length = dist(a, b) || 1;
  return [((b[1] - a[1]) / length) * fp.sign, (-(b[0] - a[0]) / length) * fp.sign];
}

export function at(frame: RectFrame, along: number, across: number): Vec2 {
  const s = along / frame.length;
  const t = across / frame.depth;
  const [c0, c1, c2, c3] = frame.corners;
  const fx = c0[0] + (c1[0] - c0[0]) * s, fz = c0[1] + (c1[1] - c0[1]) * s;
  const bx = c3[0] + (c2[0] - c3[0]) * s, bz = c3[1] + (c2[1] - c3[1]) * s;
  return [fx + (bx - fx) * t, fz + (bz - fz) * t];
}

export function insidePoly(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
