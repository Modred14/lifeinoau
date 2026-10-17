import { ROW, flatUv, rowUv } from "./atlas-layout";
import { at, type RectFrame } from "./footprint";
import { quad, wall } from "./mesh";
import { rgb, shade, type BuildingBuffers, type BuildingSpec, type Vec3 } from "./types";

export function hallDetails(buf: BuildingBuffers, frame: RectFrame, spec: BuildingSpec, from: number, to: number) {
  const point = (s: number, t: number, y: number): Vec3 => {
    const p = at(frame, s, t);
    return [p[0], y, p[1]];
  };
  const [a, b] = [at(frame, 0, 0), at(frame, 0, 1)];
  const across = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const normal = [(a[0] - b[0]) / across, 0, (a[1] - b[1]) / across] as const;
  const bays = Math.max(1, Math.round((to - from) / spec.bay));
  const bay = (to - from) / bays;
  const flat = flatUv(ROW.plain);
  if (spec.facade === "boxed") {
    for (let i = 0; i < bays; i++) {
      const start = from + i * bay + 0.24, end = from + (i + 1) * bay - 0.24;
      for (let floor = 1; floor < spec.floors; floor++) {
        const y = floor * spec.storey;
        quad(buf, point(start, 0, y), point(end, 0, y), point(end, -0.65, y), point(start, -0.65, y), flat, spec.trim, spec.trim, [0, 1, 0]);
        quad(buf, point(start, -0.65, y - 0.12), point(end, -0.65, y - 0.12), point(end, 0, y - 0.12), point(start, 0, y - 0.12), flat, shade(spec.trim, 0.55), shade(spec.trim, 0.55), [0, -1, 0]);
        quad(buf, point(start, -0.65, y - 0.12), point(end, -0.65, y - 0.12), point(end, -0.65, y + 0.9), point(start, -0.65, y + 0.9), flat, spec.trim, spec.trim, normal);
        for (const s of [start, end]) quad(buf, point(s, 0, y), point(s, -0.65, y), point(s, -0.65, y + 0.9), point(s, 0, y + 0.9), flat, spec.trim, spec.trim, s === start ? [-frame.corners[1][0] + frame.corners[0][0], 0, -frame.corners[1][1] + frame.corners[0][1]] : [frame.corners[1][0] - frame.corners[0][0], 0, frame.corners[1][1] - frame.corners[0][1]]);
      }
      const s = from + i * bay;
      wall(buf, at(frame, s, -0.02), at(frame, s + 0.2, -0.02), 0.5, spec.floors * spec.storey, flat, rgb(0x6c767d), rgb(0x6c767d), [normal[0], normal[2]]);
    }
  }
  if (spec.facade === "screened" && spec.floors > 1) {
    const centre = (from + to) / 2, width = Math.min(4.8, (to - from) * 0.16);
    for (let floor = 0; floor < spec.floors; floor++) wall(buf, at(frame, centre - width / 2, -0.025), at(frame, centre + width / 2, -0.025), Math.max(0.5, floor * spec.storey), (floor + 1) * spec.storey, rowUv(ROW.stairScreen, 0, width / spec.bay / 8), spec.trim, spec.trim, [normal[0], normal[2]]);
  }
  if (spec.facade === "veranda" && spec.floors === 1) {
    for (let i = 0; i <= bays; i++) {
      const s = Math.min(frame.length - 0.15, Math.max(0.15, from + i * bay));
      const p = at(frame, s, 0.08), q = at(frame, s + 0.1, 0.08);
      wall(buf, p, q, 0.5, 2.9, flat, spec.trim, spec.trim, [normal[0], normal[2]]);
    }
  }
}
