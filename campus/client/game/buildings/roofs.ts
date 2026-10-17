import * as THREE from "three";
import { ROW, flatUv, rowBottom, rowTop } from "./atlas-layout";
import { at, outward, type Footprint, type RectFrame } from "./footprint";
import { DOWN, UP, quadUv, tri, wall } from "./mesh";
import { shade, type BuildingBuffers, type Rgb, type Vec2, type Vec3 } from "./types";

const SHEET_SPAN = 26;
const PLAIN_SPAN = 27;
const FASCIA = 0.16;
export const MIN_OVERHANG_HEIGHT = 2.62;

export interface PitchOptions {
  from: number;
  to: number;
  y: number;
  rise: number;
  over: number;
  overEnd: number;
  hip: boolean;
  gables: boolean;
  color: Rgb;
  wall: Rgb;
  fascia: Rgb;
}

export function safeOverhang(wanted: number, y: number, slope: number): number {
  const room = (y - MIN_OVERHANG_HEIGHT - FASCIA) / Math.max(slope, 0.01);
  const over = Math.min(wanted, room);
  return over < 0.08 ? 0 : over;
}

export function pitchedRoof(buf: BuildingBuffers, frame: RectFrame, o: PitchOptions) {
  const depth = frame.depth;
  const half = depth / 2;
  const slope = o.rise / half;
  const eave = o.y - o.over * slope;
  const endOver = o.hip ? o.over : o.overEnd;
  const inset = o.hip ? Math.min(half, (o.to - o.from) / 2) : -endOver;
  const ridge = o.y + (o.hip ? slope * inset : o.rise);
  const p = (s: number, t: number, y: number): Vec3 => {
    const q = at(frame, s, t);
    return [q[0], y, q[1]];
  };
  const s0 = o.from - endOver, s1 = o.to + endOver;
  const a0 = p(s0, -o.over, eave), a1 = p(s1, -o.over, eave), b1 = p(s1, depth + o.over, eave), b0 = p(s0, depth + o.over, eave);
  const r0 = p(o.from + inset, half, ridge), r1 = p(o.to - inset, half, ridge);
  const low = rowBottom(ROW.roofZinc), high = rowTop(ROW.roofZinc);
  const dark = shade(o.color, 0.8), soffit = shade(o.color, 0.32);
  const flat = flatUv(ROW.plain);
  const flatPoint: Vec2 = [flat[0], flat[1]];
  const slopeFace = (v: readonly [Vec3, Vec3, Vec3, Vec3], u: readonly [number, number, number, number]) => {
    quadUv(buf, v, [[u[0] / SHEET_SPAN, low], [u[1] / SHEET_SPAN, low], [u[2] / SHEET_SPAN, high], [u[3] / SHEET_SPAN, high]], [dark, dark, o.color, o.color], UP);
    if (o.over > 0 || endOver > 0) quadUv(buf, v, [flatPoint, flatPoint, flatPoint, flatPoint], [soffit, soffit, soffit, soffit], DOWN);
  };
  slopeFace([a0, a1, r1, r0], [s0, s1, o.to - inset, o.from + inset]);
  slopeFace([b1, b0, r0, r1], [s1, s0, o.from + inset, o.to - inset]);
  const centre = at(frame, (o.from + o.to) / 2, half);
  const hintFrom = (m: Vec3): Vec3 => [m[0] - centre[0], 0, m[2] - centre[1]];
  const fascia = (a: Vec3, b: Vec3) => {
    if (o.over <= 0) return;
    const drop = (v: Vec3): Vec3 => [v[0], v[1] - FASCIA, v[2]];
    quadUv(buf, [drop(a), drop(b), b, a], [flatPoint, flatPoint, flatPoint, flatPoint], [o.fascia, o.fascia, o.fascia, o.fascia], hintFrom([(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2]));
  };
  fascia(a0, a1);
  fascia(b1, b0);
  if (o.hip) {
    const width = depth + 2 * o.over;
    for (const [e0, e1, r] of [[a1, b1, r1], [b0, a0, r0]] as const) {
      const uv: [Vec2, Vec2, Vec2] = [[0, low], [width / SHEET_SPAN, low], [width / 2 / SHEET_SPAN, high]];
      tri(buf, [e0, e1, r], uv, [dark, dark, o.color], UP);
      if (o.over > 0) tri(buf, [e0, e1, r], [flatPoint, flatPoint, flatPoint], [soffit, soffit, soffit], DOWN);
      fascia(e0, e1);
    }
  } else if (o.gables) {
    const plainLow = rowBottom(ROW.plain), plainHigh = rowTop(ROW.plain);
    for (const s of [o.from, o.to]) {
      const apex = p(s, half, o.y + o.rise);
      const uv: [Vec2, Vec2, Vec2] = [[0.1, plainLow], [0.1 + depth / PLAIN_SPAN, plainLow], [0.1 + depth / 2 / PLAIN_SPAN, plainHigh]];
      tri(buf, [p(s, 0, o.y), p(s, depth, o.y), apex], uv, [o.wall, o.wall, o.wall], hintFrom(apex));
    }
  }
}

export function flatRoof(buf: BuildingBuffers, fp: Footprint, y: number, top: number, color: Rgb, inner: Rgb) {
  let z0 = Infinity, z1 = -Infinity;
  for (const q of fp.pts) {
    z0 = Math.min(z0, q[1]);
    z1 = Math.max(z1, q[1]);
  }
  const low = rowBottom(ROW.roofConcrete), high = rowTop(ROW.roofConcrete);
  const uvOf = (q: Vec2): Vec2 => [q[0] / 27 + q[1] / 43, low + ((high - low) * (q[1] - z0)) / Math.max(z1 - z0, 0.01)];
  const faces = THREE.ShapeUtils.triangulateShape(fp.pts.map((q) => new THREE.Vector2(q[0], q[1])), []);
  for (const [i, j, k] of faces) {
    const a = fp.pts[i], b = fp.pts[j], c = fp.pts[k];
    tri(buf, [[a[0], y, a[1]], [b[0], y, b[1]], [c[0], y, c[1]]], [uvOf(a), uvOf(b), uvOf(c)], [color, color, color], UP);
  }
  if (top <= y + 0.01) return;
  const n = fp.pts.length;
  for (let i = 0; i < n; i++) {
    const a = fp.pts[i], b = fp.pts[(i + 1) % n];
    const out = outward(fp, a, b);
    wall(buf, a, b, y, top, flatUv(ROW.plain), inner, inner, [-out[0], -out[1]]);
  }
}

function sees(apex: Vec2, fp: Footprint): boolean {
  const n = fp.pts.length;
  for (let i = 0; i < n; i++) {
    const a = fp.pts[i], b = fp.pts[(i + 1) % n];
    const cross = (b[0] - a[0]) * (apex[1] - a[1]) - (b[1] - a[1]) * (apex[0] - a[0]);
    if (cross * fp.sign < 0.05 * Math.hypot(b[0] - a[0], b[1] - a[1])) return false;
  }
  return true;
}

export function tentRoof(buf: BuildingBuffers, fp: Footprint, y: number, rise: number, color: Rgb): boolean {
  if (!sees(fp.centre, fp)) return false;
  const low = rowBottom(ROW.roofZinc), high = rowTop(ROW.roofZinc);
  const apex: Vec3 = [fp.centre[0], y + rise, fp.centre[1]];
  const dark = shade(color, 0.8);
  const n = fp.pts.length;
  for (let i = 0; i < n; i++) {
    const a = fp.pts[i], b = fp.pts[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    tri(buf, [[a[0], y, a[1]], [b[0], y, b[1]], apex], [[0, low], [length / SHEET_SPAN, low], [length / 2 / SHEET_SPAN, high]], [dark, dark, color], UP);
  }
  return true;
}
