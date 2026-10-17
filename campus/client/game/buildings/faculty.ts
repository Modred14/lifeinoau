import { ROW } from "./atlas-layout";
import { outward, type Footprint } from "./footprint";
import { insetOutline, outlineRing, outlineWalls } from "./polygon";
import { flatRoof } from "./roofs";
import { shade, type BuildingBuffers, type BuildingSpec } from "./types";
import { PARAPET_HEIGHT, PLINTH_HEIGHT } from "./walls";

export function buildFaculty(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec, base = true, insetBase = 0) {
  if (base) outlineWalls(buf, fp, fp.pts, 0, PLINTH_HEIGHT, shade(spec.wall, 0.55));
  const step = Math.max(0.18, spec.bandStep * 2.5);
  const rowFor = (edge: number, length: number, ground: boolean) => {
    if (fp.rect) {
      const front = outward(fp, fp.rect.corners[0], fp.rect.corners[1]);
      const normal = outward(fp, fp.pts[edge], fp.pts[(edge + 1) % fp.pts.length]);
      const alignment = front[0] * normal[0] + front[1] * normal[1];
      if (Math.abs(alignment) < 0.7) return spec.endRow === ROW.plain || !ground ? spec.endRow : spec.groundRow;
      if (ground) return spec.groundRow === spec.frontRow && alignment < 0 ? spec.backRow : spec.groundRow;
      return alignment > 0 ? spec.frontRow : spec.backRow;
    }
    return length < 3 ? spec.endRow : ground ? spec.groundRow : edge % 2 ? spec.backRow : spec.frontRow;
  };
  for (let k = 0; k < spec.floors; k++) {
    const inset = insetBase + (spec.floors - k - 1) * step;
    const outer = insetOutline(fp, inset);
    const glazing = insetOutline(fp, inset + 0.48);
    const y0 = k === 0 ? PLINTH_HEIGHT : k * spec.storey;
    const y1 = (k + 1) * spec.storey - Math.min(1, spec.storey * 0.3);
    outlineWalls(buf, fp, glazing, y0, y1, spec.wall, (edge, length) => rowFor(edge, length, k === 0), spec.bay);
    outlineRing(buf, outer, glazing, y1, shade(spec.trim, 0.42), false);
    outlineWalls(buf, fp, outer, y1, (k + 1) * spec.storey, spec.trim, spec.bandRow, spec.bay);
    const next = insetOutline(fp, Math.max(insetBase, inset - step) + 0.48);
    outlineRing(buf, outer, next, (k + 1) * spec.storey, shade(spec.trim, 0.82), true);
  }
  const top = spec.floors * spec.storey;
  outlineWalls(buf, fp, fp.pts, top, top + PARAPET_HEIGHT, spec.trim);
  flatRoof(buf, fp, top, top + PARAPET_HEIGHT, spec.roofColor, shade(spec.trim, 0.72));
}
