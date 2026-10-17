import { ATLAS_HEIGHT, ATLAS_WIDTH, ROW, ROW_PX, flatUv, rowBottom, rowTop } from "./atlas-layout";
import { at, outward, type Footprint, type RectFrame } from "./footprint";
import { UP, prism, tri, wall } from "./mesh";
import { pitchedRoof } from "./roofs";
import { rgb, shade, type BuildingBuffers, type BuildingSpec, type Rgb, type UvRect, type Vec2 } from "./types";

const BASE_HEIGHT = 0.48;
const SKIN_INSET = 0.04;
const WHITE = rgb(0xf4f1e6);
const WINDOW_UV: UvRect = [9 / ATLAS_WIDTH, (ROW.office * ROW_PX + 85) / ATLAS_HEIGHT, 61 / ATLAS_WIDTH, (ROW.office * ROW_PX + 31) / ATLAS_HEIGHT];

export function buildMaintenanceHall(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec): boolean {
  const frame = fp.rect;
  if (!frame) return false;
  const { length, depth, corners } = frame;
  const floors = spec.floors;
  const height = floors * spec.storey;
  const recess = Math.min(0.7, depth * 0.14);
  const flat = flatUv(ROW.plain);
  const dark = shade(spec.wall, 0.55);
  const front = outward(fp, corners[0], corners[1]);
  const back = outward(fp, corners[2], corners[3]);
  const start = outward(fp, corners[3], corners[0]);
  const end = outward(fp, corners[1], corners[2]);
  let modules = Math.max(1, Math.min(18, Math.ceil(length / Math.min(8, (depth - 2 * recess) * 0.85))));
  while (modules > 1 && 18 + 22 * modules + floors * (20 * Math.ceil(modules / 2) + 8 * Math.floor(modules / 2) + 4) >= 890) modules--;
  const span = length / modules;
  const insetOf = (i: number) => i % 2 === 0 ? SKIN_INSET : recess;
  const window = (a: Vec2, b: Vec2, y0: number, y1: number, normal: Vec2) => wall(buf, a, b, y0, y1, WINDOW_UV, WHITE, WHITE, normal);

  prism(buf, corners, 0, 0.45, { side: dark, top: null, bottom: null, flat });
  prism(buf, corners, 0.45, BASE_HEIGHT, { side: dark, top: spec.wall, bottom: null, flat });
  for (let i = 0; i < modules; i++) {
    const s0 = i * span + (i === 0 ? SKIN_INSET : 0);
    const s1 = (i + 1) * span - (i === modules - 1 ? SKIN_INSET : 0);
    const inset = insetOf(i);
    const projecting = i % 2 === 0;
    const color: Rgb = projecting ? spec.wall : spec.trim;
    for (const [t, normal, offset] of [[inset, front, -0.018], [depth - inset, back, 0.018]] as const) {
      wall(buf, at(frame, s0, t), at(frame, s1, t), BASE_HEIGHT, height, flat, color, color, normal);
      const positions = projecting ? [0.18, 0.35, 0.65, 0.82] : [0.28, 0.72];
      const width = Math.min(projecting ? 0.68 : 1.45, span * (projecting ? 0.1 : 0.28));
      for (let floor = 0; floor < floors; floor++) {
        const y0 = floor * spec.storey + spec.storey * (projecting ? 0.39 : 0.27);
        const y1 = y0 + spec.storey * (projecting ? 0.21 : 0.43);
        for (const fraction of positions) {
          const s = i * span + span * fraction;
          window(at(frame, s - width / 2, t + offset), at(frame, s + width / 2, t + offset), y0, y1, normal);
        }
        if (projecting) {
          const s = i * span + span / 2;
          wall(buf, at(frame, s - 0.075, t + offset), at(frame, s + 0.075, t + offset), floor * spec.storey + spec.storey * 0.16, floor * spec.storey + spec.storey * 0.92, flat, dark, dark, normal);
        }
      }
    }
    if (i > 0) {
      const previous = insetOf(i - 1);
      const normal = inset > previous ? end : start;
      wall(buf, at(frame, i * span, previous), at(frame, i * span, inset), BASE_HEIGHT, height, flat, color, color, normal);
      wall(buf, at(frame, i * span, depth - previous), at(frame, i * span, depth - inset), BASE_HEIGHT, height, flat, color, color, normal);
    }

    const roofInset = projecting ? 0 : recess;
    const roofDepth = depth - 2 * roofInset;
    const roofCorners = [at(frame, i * span, roofInset), at(frame, (i + 1) * span, roofInset), at(frame, (i + 1) * span, depth - roofInset), at(frame, i * span, depth - roofInset)] as const;
    prism(buf, roofCorners, height - 0.16, height, { side: WHITE, top: null, bottom: null, flat });
    const moduleFrame: RectFrame = span < roofDepth
      ? { corners: [roofCorners[0], roofCorners[3], roofCorners[2], roofCorners[1]], length: roofDepth, depth: span }
      : { corners: roofCorners, length: span, depth: roofDepth };
    const rise = Math.min(2.2, Math.max(0.45, moduleFrame.depth * spec.slope / 2));
    if (moduleFrame.length - moduleFrame.depth < 0.01) {
      const centre = at(moduleFrame, moduleFrame.length / 2, moduleFrame.depth / 2);
      const low = rowBottom(ROW.roofZinc), high = rowTop(ROW.roofZinc);
      for (let edge = 0; edge < 4; edge++) {
        const a = roofCorners[edge], b = roofCorners[(edge + 1) % 4];
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        tri(buf, [[a[0], height, a[1]], [b[0], height, b[1]], [centre[0], height + rise, centre[1]]], [[0, low], [distance / 26, low], [distance / 52, high]], [shade(spec.roofColor, 0.8), shade(spec.roofColor, 0.8), spec.roofColor], UP);
      }
    } else pitchedRoof(buf, moduleFrame, { from: 0, to: moduleFrame.length, y: height, rise, over: 0, overEnd: 0, hip: true, gables: false, color: spec.roofColor, wall: color, fascia: WHITE });
  }

  for (const [s, inset, normal, offset] of [[SKIN_INSET, insetOf(0), start, -0.018], [length - SKIN_INSET, insetOf(modules - 1), end, 0.018]] as const) {
    wall(buf, at(frame, s, inset), at(frame, s, depth - inset), BASE_HEIGHT, height, flat, spec.wall, spec.wall, normal);
    const width = Math.min(1.45, depth * 0.3);
    for (let floor = 0; floor < floors; floor++) window(at(frame, s + offset, (depth - width) / 2), at(frame, s + offset, (depth + width) / 2), floor * spec.storey + spec.storey * 0.27, floor * spec.storey + spec.storey * 0.7, normal);
  }
  return true;
}
