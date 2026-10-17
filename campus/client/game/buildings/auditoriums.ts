import { ROW, flatUv } from "./atlas-layout";
import { type Footprint } from "./footprint";
import { circularPanel, facadeBox, facadeFrame, facadePoint, facadeWall } from "./landmark-details";
import { beam, quad, wall } from "./mesh";
import { insetOutline, outlineWalls } from "./polygon";
import { flatRoof, tentRoof } from "./roofs";
import { rgb, shade, type BuildingBuffers, type BuildingSpec, type Vec2 } from "./types";

function section(fp: Footprint, origin: Vec2, forward: Vec2, t: number): readonly [Vec2, Vec2] | null {
  const across: Vec2 = [-forward[1], forward[0]];
  const intersections: number[] = [];
  for (let i = 0; i < fp.pts.length; i++) {
    const a = fp.pts[i], b = fp.pts[(i + 1) % fp.pts.length];
    const ta = (a[0] - origin[0]) * forward[0] + (a[1] - origin[1]) * forward[1];
    const tb = (b[0] - origin[0]) * forward[0] + (b[1] - origin[1]) * forward[1];
    if ((ta <= t && tb > t) || (tb <= t && ta > t)) {
      const k = (t - ta) / (tb - ta);
      intersections.push((a[0] + (b[0] - a[0]) * k - origin[0]) * across[0] + (a[1] + (b[1] - a[1]) * k - origin[1]) * across[1]);
    }
  }
  if (intersections.length < 2) return null;
  const left = Math.min(...intersections) + 0.65, right = Math.max(...intersections) - 0.65;
  if (right - left < 1) return null;
  const point = (s: number): Vec2 => [origin[0] + forward[0] * t + across[0] * s, origin[1] + forward[1] * t + across[1] * s];
  return [point(left), point(right)];
}

function seating(buf: BuildingBuffers, fp: Footprint, stageEdge: number, rows: number, rise: number, color: ReturnType<typeof rgb>, base = 0.5) {
  const stage = facadeFrame(fp, stageEdge);
  const origin = facadePoint(stage, stage.length / 2);
  const forward: Vec2 = [-stage.normal[0], -stage.normal[1]];
  const depth = Math.max(...fp.pts.map((p) => (p[0] - origin[0]) * forward[0] + (p[1] - origin[1]) * forward[1]));
  const from = depth * 0.17, to = depth * 0.83;
  for (let i = 0; i < rows; i++) {
    const a = section(fp, origin, forward, from + (to - from) * i / rows);
    const b = section(fp, origin, forward, from + (to - from) * (i + 1) / rows);
    if (!a || !b) continue;
    const y0 = base + rise * i / rows, y1 = base + rise * (i + 1) / rows;
    quad(buf, [a[0][0], y1, a[0][1]], [a[1][0], y1, a[1][1]], [b[1][0], y1, b[1][1]], [b[0][0], y1, b[0][1]], flatUv(ROW.plain), color, color, [0, 1, 0]);
    wall(buf, a[0], a[1], y0, y1, flatUv(ROW.plain), shade(color, 0.6), color, [-forward[0], -forward[1]]);
    quad(buf, [a[0][0], y0 - 0.18, a[0][1]], [a[1][0], y0 - 0.18, a[1][1]], [b[1][0], y1 - 0.18, b[1][1]], [b[0][0], y1 - 0.18, b[0][1]], flatUv(ROW.plain), shade(color, 0.5), shade(color, 0.5), [0, -1, 0]);
    wall(buf, b[0], b[1], y0, y1, flatUv(ROW.plain), shade(color, 0.6), color, forward);
  }
}

function approachStairs(buf: BuildingBuffers, fp: Footprint, from: number, to: number, color: ReturnType<typeof rgb>) {
  const frame = facadeFrame(fp, 0), normal = frame.normal;
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const s0 = from + (to - from) * i / steps, s1 = from + (to - from) * (i + 1) / steps;
    const y0 = 0.5 + 4.2 * i / steps, y1 = 0.5 + 4.2 * (i + 1) / steps;
    const a = facadePoint(frame, s0, 0.55), b = facadePoint(frame, s1, 0.55), c = facadePoint(frame, s1, 2.4), d = facadePoint(frame, s0, 2.4);
    quad(buf, [a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]], flatUv(ROW.plain), color, color, [0, 1, 0]);
    wall(buf, a, d, y0, y1, flatUv(ROW.plain), color, color, [-frame.along[0] * Math.sign(to - from), -frame.along[1] * Math.sign(to - from)]);
  }
  const a = facadePoint(frame, from, 0.5), b = facadePoint(frame, to, 0.5);
  quad(buf, [a[0], 0.8, a[1]], [b[0], 4.7, b[1]], [b[0], 5.7, b[1]], [a[0], 1.8, a[1]], flatUv(ROW.plain), color, color, [normal[0], 0, normal[1]]);
}

export function buildAmphitheatre(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  outlineWalls(buf, fp, fp.pts, 0, 0.45, shade(spec.wall, 0.55));
  const roofBase = 10.4, roofTop = 12.1;
  outlineWalls(buf, fp, fp.pts, roofBase, roofTop, rgb(0x955354));
  if (!tentRoof(buf, fp, roofTop, 0.55, spec.roofColor)) flatRoof(buf, fp, roofTop, roofTop, spec.roofColor, spec.wall);
  flatRoof(buf, fp, roofBase, roofBase, shade(spec.trim, 0.6), spec.wall);
  const roofStart = buf.idx.length;
  flatRoof(buf, fp, roofBase, roofBase, shade(spec.trim, 0.6), spec.wall);
  for (let i = roofStart; i < buf.idx.length; i += 3) [buf.idx[i + 1], buf.idx[i + 2]] = [buf.idx[i + 2], buf.idx[i + 1]];
  seating(buf, fp, 3, 20, 6.2, rgb(0xaba696));
  for (const i of [1, 5]) {
    const frame = facadeFrame(fp, i);
    facadeWall(buf, frame, 0.1, frame.length - 0.1, 0.5, 3.8, spec.wall);
  }
  const inset = insetOutline(fp, 1.25);
  const steel = rgb(0x7d393e), flat = flatUv(ROW.plain);
  for (const index of [0, 1]) {
    const p = inset[index];
    const q: Vec2 = [p[0] + (fp.centre[0] - p[0]) * 0.06, p[1] + (fp.centre[1] - p[1]) * 0.06];
    beam(buf, [p[0], 0.5, p[1]], [p[0], roofBase, p[1]], 0.28, steel, flat);
    beam(buf, [q[0], 0.5, q[1]], [q[0], roofBase, q[1]], 0.28, steel, flat);
    for (let k = 0; k < 3; k++) beam(buf, [p[0], 0.7 + k * 3.1, p[1]], [q[0], 3.7 + k * 3.1, q[1]], 0.16, steel, flat);
  }
  const stage = facadeFrame(fp, 3);
  for (const [from, to] of [[0.7, 3.8], [stage.length - 3.8, stage.length - 0.7]]) {
    facadeBox(buf, stage, from, to, 0.7, 3.5, 0.5, 17, spec.wall);
    facadeWall(buf, stage, from + 0.55, to - 0.55, 13.8, 16, rgb(0x406475), ROW.plain, 0.69);
  }
  const front = facadeFrame(fp, 0);
  facadeBox(buf, front, 1, front.length - 1, 0.4, 2, 4.7, 5.05, spec.trim);
  for (const s of [front.length * 0.25, front.length * 0.75]) facadeBox(buf, front, s - 0.18, s + 0.18, 0.7, 0.4, 0.5, 4.7, spec.trim);
  approachStairs(buf, fp, 0.8, front.length / 2 - 1, spec.wall);
  approachStairs(buf, fp, front.length - 0.8, front.length / 2 + 1, spec.wall);
  for (const [from, to] of [[1.1, front.length / 2 - 1.5], [front.length / 2 + 1.5, front.length - 1.1]]) {
    circularPanel(buf, front, from, to, 0.5, 3.6, 1.95, 0.8, spec.trim, ROW.plain, 0.9);
    facadeWall(buf, front, from, to, 0.5, 3.6, rgb(0x282b29), ROW.plain, 1.2);
  }
}

export function buildOduduwa(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  const height = 15, glazingBase = 9.6;
  outlineWalls(buf, fp, fp.pts, 0, 0.45, shade(spec.wall, 0.55));
  const recess = insetOutline(fp, 0.7);
  outlineWalls(buf, fp, recess, 0.47, 3.6, shade(spec.wall, 0.35), ROW.pilotis);
  outlineWalls(buf, fp, recess, glazingBase, 12.4, spec.trim, ROW.ribbon);
  outlineWalls(buf, fp, fp.pts, 12.4, height, spec.wall, ROW.grooved);
  flatRoof(buf, fp, height, height, rgb(0xa8a69a), spec.wall);
  for (let i = 0; i < fp.pts.length; i++) {
    const frame = facadeFrame(fp, i);
    if (frame.length < 3) continue;
    facadeBox(buf, frame, 0.15, 1.65, 0.1, 1.2, 0.47, height + 0.5, spec.wall);
    facadeWall(buf, frame, 1.65, frame.length - 0.15, glazingBase - 1.05, glazingBase, spec.trim);
    facadeWall(buf, frame, 1.65, frame.length - 0.15, 3.6, 4.35, spec.trim);
  }
  seating(buf, fp, 5, 16, 4.7, shade(spec.trim, 0.6), 4.5);
  const front = facadeFrame(fp, 2);
  const centre = front.length / 2;
  facadeBox(buf, front, centre - 4.8, centre + 4.8, 0.1, 3.2, 3.05, 3.35, spec.trim);
  for (const s of [centre - 4.4, centre + 4.4]) facadeBox(buf, front, s - 0.2, s + 0.2, 0.6, 0.4, 0.47, 3.05, spec.trim);
  const side = facadeFrame(fp, 1);
  const w = Math.min(7, side.length * 0.45);
  const s = (side.length - w) / 2;
  circularPanel(buf, side, s, s + w, 4.5, 9.1, 6.8, 1.65, spec.trim, ROW.plain, 0.15);
  facadeWall(buf, side, s, s + w, 4.5, 9.1, rgb(0x252a28), ROW.plain, 0.42);
}
