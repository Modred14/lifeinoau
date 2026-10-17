import { ROW, flatUv } from "./atlas-layout";
import { PX_PER_METER } from "@campuslife/shared/map";
import { buildFaculty } from "./faculty";
import { footprintOf, type Footprint } from "./footprint";
import { facadeFrame, facadePoint } from "./landmark-details";
import { beam } from "./mesh";
import { outlineWalls } from "./polygon";
import { shade } from "./types";
import type { BuildingBuffers, BuildingSpec } from "./types";

export function buildAdministration(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  outlineWalls(buf, fp, fp.pts, 0, 0.45, shade(spec.wall, 0.55));
  const main = footprintOf(fp.pts.slice(0, 4).flatMap((p) => [p[0] * PX_PER_METER, p[1] * PX_PER_METER]), 94);
  buildFaculty(buf, main, spec, false, 2.6);
  const height = spec.floors * spec.storey;
  for (const i of [0, 2]) {
    const frame = facadeFrame(main, i);
    const count = Math.max(2, Math.floor(frame.length / 8));
    for (let k = 0; k < count; k++) {
      const s = 3 + k * (frame.length - 6) / (count - 1);
      const low = facadePoint(frame, s, 3.2), high = facadePoint(frame, s, 0.3);
      beam(buf, [low[0], 0.5, low[1]], [high[0], height + 0.2, high[1]], 0.34, spec.trim, flatUv(ROW.plain));
    }
  }
  outlineWalls(buf, main, main.pts, height - 0.1, height + 0.55, spec.trim);
}
