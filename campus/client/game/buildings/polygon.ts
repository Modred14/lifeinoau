import { outward, insidePoly, type Footprint } from "./footprint";
import { quad, wall } from "./mesh";
import { ROW, flatUv, rowUv } from "./atlas-layout";
import type { BuildingBuffers, Rgb, Vec2 } from "./types";

export function insetOutline(fp: Footprint, distance: number): Vec2[] {
  if (distance <= 0.001) return fp.pts;
  for (let attempt = 0; attempt < 7; attempt++) {
    const amount = distance / 2 ** attempt;
    const pts = fp.pts.map((p, i): Vec2 => {
      const prev = fp.pts[(i + fp.pts.length - 1) % fp.pts.length];
      const next = fp.pts[(i + 1) % fp.pts.length];
      const a = outward(fp, prev, p), b = outward(fp, p, next);
      const divisor = Math.max(0.15, 1 + a[0] * b[0] + a[1] * b[1]);
      return [p[0] - amount * (a[0] + b[0]) / divisor, p[1] - amount * (a[1] + b[1]) / divisor];
    });
    const valid = pts.every((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const source = fp.pts[i], end = fp.pts[(i + 1) % pts.length];
      if ((q[0] - p[0]) * (end[0] - source[0]) + (q[1] - p[1]) * (end[1] - source[1]) <= 0.001) return false;
      return [0, 0.25, 0.5, 0.75, 1].every((t) => insidePoly([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t], fp.pts));
    });
    if (valid) return pts;
  }
  return fp.pts;
}

export function outlineWalls(buf: BuildingBuffers, fp: Footprint, pts: readonly Vec2[], y0: number, y1: number, color: Rgb, row: number | ((edge: number, length: number) => number) = ROW.plain, bay = 3.4) {
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 0.02 || y1 - y0 < 0.001) continue;
    const useRow = typeof row === "function" ? row(i, length) : row;
    const uv = useRow === ROW.plain ? flatUv(useRow) : rowUv(useRow, 0, Math.max(1, Math.round(length / bay)) / 8);
    wall(buf, a, b, y0, y1, uv, color, color, outward(fp, a, b));
  }
}

export function outlineRing(buf: BuildingBuffers, outer: readonly Vec2[], inner: readonly Vec2[], y: number, color: Rgb, up: boolean) {
  for (let i = 0; i < outer.length; i++) {
    const j = (i + 1) % outer.length;
    if (Math.hypot(outer[i][0] - inner[i][0], outer[i][1] - inner[i][1]) < 0.001 || Math.hypot(outer[j][0] - inner[j][0], outer[j][1] - inner[j][1]) < 0.001) continue;
    quad(buf, [outer[i][0], y, outer[i][1]], [outer[j][0], y, outer[j][1]], [inner[j][0], y, inner[j][1]], [inner[i][0], y, inner[i][1]], flatUv(ROW.plain), color, color, [0, up ? 1 : -1, 0]);
  }
}
