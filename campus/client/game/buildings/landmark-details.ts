import * as THREE from "three";
import { ROW, flatUv, rowUv } from "./atlas-layout";
import { outward, type Footprint } from "./footprint";
import { prism, quad, tri, wall } from "./mesh";
import type { BuildingBuffers, Rgb, Vec2, Vec3 } from "./types";

export interface FacadeFrame {
  origin: Vec2;
  along: Vec2;
  normal: Vec2;
  length: number;
}

export function facadeFrame(fp: Footprint, edge: number): FacadeFrame {
  const a = fp.pts[edge], b = fp.pts[(edge + 1) % fp.pts.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { origin: a, along: [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal: outward(fp, a, b), length };
}

export function facadePoint(frame: FacadeFrame, s: number, inward = 0): Vec2 {
  return [frame.origin[0] + frame.along[0] * s - frame.normal[0] * inward, frame.origin[1] + frame.along[1] * s - frame.normal[1] * inward];
}

export function facadeBox(buf: BuildingBuffers, frame: FacadeFrame, s0: number, s1: number, inward: number, depth: number, y0: number, y1: number, color: Rgb) {
  prism(buf, [facadePoint(frame, s0, inward), facadePoint(frame, s1, inward), facadePoint(frame, s1, inward + depth), facadePoint(frame, s0, inward + depth)], y0, y1, { side: color, top: color, bottom: y0 > 0.46 ? color : null, flat: flatUv(ROW.plain) });
}

export function circularPanel(buf: BuildingBuffers, frame: FacadeFrame, s0: number, s1: number, y0: number, y1: number, centreY: number, radius: number, color: Rgb, row: number = ROW.grooved, inward = 0) {
  const centreS = (s0 + s1) / 2;
  const contour = [new THREE.Vector2(s0, y0), new THREE.Vector2(s1, y0), new THREE.Vector2(s1, y1), new THREE.Vector2(s0, y1)];
  const hole = Array.from({ length: 20 }, (_, i) => new THREE.Vector2(centreS + Math.cos(i * Math.PI / 10) * radius, centreY + Math.sin(i * Math.PI / 10) * radius));
  const vertices = [...contour, ...hole];
  const uv = rowUv(row, 0, (s1 - s0) / 24);
  const at = (s: number, y: number, offset = inward): Vec3 => {
    const p = facadePoint(frame, s, offset);
    return [p[0], y, p[1]];
  };
  for (const face of THREE.ShapeUtils.triangulateShape(contour, [hole])) {
    const pts = face.map((i) => vertices[i]);
    tri(buf, pts.map((p) => at(p.x, p.y)) as [Vec3, Vec3, Vec3], pts.map((p): Vec2 => [uv[0] + (uv[2] - uv[0]) * (p.x - s0) / (s1 - s0), uv[1] + (uv[3] - uv[1]) * (p.y - y0) / (y1 - y0)]) as [Vec2, Vec2, Vec2], [color, color, color], [frame.normal[0], 0, frame.normal[1]]);
  }
  for (let i = 0; i < hole.length; i++) {
    const a = hole[i], b = hole[(i + 1) % hole.length];
    quad(buf, at(a.x, a.y), at(b.x, b.y), at(b.x, b.y, inward + 0.25), at(a.x, a.y, inward + 0.25), flatUv(ROW.plain), color, color, [-frame.along[0] * ((a.x + b.x) / 2 - centreS), centreY - (a.y + b.y) / 2, -frame.along[1] * ((a.x + b.x) / 2 - centreS)]);
  }
}

export function facadeWall(buf: BuildingBuffers, frame: FacadeFrame, s0: number, s1: number, y0: number, y1: number, color: Rgb, row: number = ROW.plain, inward = 0) {
  const uv = row === ROW.plain ? flatUv(row) : rowUv(row, 0, (s1 - s0) / 27);
  wall(buf, facadePoint(frame, s0, inward), facadePoint(frame, s1, inward), y0, y1, uv, color, color, frame.normal);
}
