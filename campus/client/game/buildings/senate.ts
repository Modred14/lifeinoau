import { PX_PER_METER } from "@campuslife/shared/map";
import { ROW, flatUv } from "./atlas-layout";
import { buildFaculty } from "./faculty";
import { footprintOf, type Footprint } from "./footprint";
import { circularPanel, facadeBox, facadeFrame, facadePoint, facadeWall, type FacadeFrame } from "./landmark-details";
import { prism } from "./mesh";
import { insetOutline, outlineWalls } from "./polygon";
import { flatRoof } from "./roofs";
import { rgb, shade, type BuildingBuffers, type BuildingSpec } from "./types";

function fins(buf: BuildingBuffers, frame: FacadeFrame, y0: number, y1: number, spacing: number, color: ReturnType<typeof rgb>) {
  const count = Math.max(1, Math.floor((frame.length - 1.6) / spacing));
  for (let i = 0; i < count; i++) {
    const s = 0.8 + (i + 0.5) * (frame.length - 1.6) / count;
    const base = [facadePoint(frame, s - 0.1, 0.75), facadePoint(frame, s + 0.1, 0.75), facadePoint(frame, s + 0.1, 0.06), facadePoint(frame, s - 0.1, 0.06)];
    prism(buf, base, y0, y1, { side: color, top: null, bottom: null, flat: flatUv(ROW.plain), sideUv: (edge) => edge === 0 ? null : flatUv(ROW.plain) });
  }
}

export function buildSenateTower(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  outlineWalls(buf, fp, fp.pts, 0, 0.45, shade(spec.wall, 0.55));
  outlineWalls(buf, fp, insetOutline(fp, 0.9), 0.47, 4.65, spec.wall, ROW.ribbon);
  outlineWalls(buf, fp, fp.pts, 4.65, 5.65, spec.trim);
  flatRoof(buf, fp, 5.65, 5.65, spec.roofColor, spec.wall);
  for (const i of [4, 6]) {
    const frame = facadeFrame(fp, i);
    if (frame.length > 7) fins(buf, frame, 0.5, 4.4, 1.5, spec.trim);
  }
  const tower = footprintOf(fp.pts.slice(0, 4).flatMap((p) => [p[0] * PX_PER_METER, p[1] * PX_PER_METER]), 103);
  buildFaculty(buf, tower, { ...spec, backRow: spec.frontRow }, false);
  for (const i of [1, 3]) {
    const endWall = facadeFrame(tower, i);
    facadeWall(buf, endWall, 0, endWall.length, 0.47, spec.floors * spec.storey + 0.6, spec.trim);
  }
  const front = facadeFrame(tower, 2);
  const centre = front.length * 0.58, width = 7;
  const height = spec.floors * spec.storey + 2.2;
  const core = rgb(0x716d60);
  facadeBox(buf, front, centre - width / 2, centre + width / 2, 0.1, 4.5, 0.5, height - 2.5, core);
  circularPanel(buf, front, centre - width / 2, centre + width / 2, height - 2.5, height, height - 1.25, 0.55, core, ROW.grooved, 0.08);
  facadeWall(buf, front, centre - width / 2, centre + width / 2, height - 2.5, height, rgb(0x2a2b27), ROW.plain, 0.11);
}

export function buildSenateOffices(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  const top = spec.floors * spec.storey;
  outlineWalls(buf, fp, fp.pts, 0, 0.45, shade(spec.wall, 0.6));
  const recess = insetOutline(fp, 0.9);
  for (let k = 0; k < spec.floors; k++) {
    outlineWalls(buf, fp, recess, Math.max(0.47, k * spec.storey), (k + 1) * spec.storey - 0.6, spec.wall, ROW.ribbon);
    outlineWalls(buf, fp, insetOutline(fp, 0.4), (k + 1) * spec.storey - 0.6, (k + 1) * spec.storey, spec.wall);
  }
  outlineWalls(buf, fp, fp.pts, top - 0.9, top + 0.5, spec.trim);
  flatRoof(buf, fp, top + 0.5, top + 0.5, spec.roofColor, spec.wall);
  const longest = fp.pts.map((_, i) => ({ i, frame: facadeFrame(fp, i) })).sort((a, b) => b.frame.length - a.frame.length).slice(0, 3);
  for (const { frame } of longest) {
    for (let k = 0; k < spec.floors; k++) facadeWall(buf, frame, 0.2, frame.length - 0.2, k * spec.storey + 0.6, (k + 1) * spec.storey - 0.65, rgb(0x6b7779), ROW.ribbon, 0.8);
    fins(buf, frame, spec.storey + 0.3, top - spec.storey - 0.15, 2.3, rgb(0x9b594d));
    if (frame.length > 15) {
      const s = frame.length * 0.7;
      circularPanel(buf, frame, s - 1.4, s + 1.4, 0.6, 3.1, 1.85, 0.95, spec.wall, ROW.plain);
      facadeWall(buf, frame, s - 1.4, s + 1.4, 0.6, 3.1, rgb(0x252b2b), ROW.plain, 0.15);
    }
  }
}
