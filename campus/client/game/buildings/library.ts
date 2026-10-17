import { ROW } from "./atlas-layout";
import type { Footprint } from "./footprint";
import { buildFaculty } from "./faculty";
import { circularPanel, facadeBox, facadeFrame, facadeWall } from "./landmark-details";
import { rgb, type BuildingBuffers, type BuildingSpec } from "./types";

export function buildLibrary(buf: BuildingBuffers, fp: Footprint, spec: BuildingSpec) {
  buildFaculty(buf, fp, { ...spec, backRow: spec.frontRow });
  const entrance = facadeFrame(fp, 5);
  const height = spec.floors * spec.storey + 0.6;
  const width = Math.min(10.8, entrance.length * 0.72);
  const start = (entrance.length - width) / 2, end = start + width;
  const stone = rgb(0x68685b), white = rgb(0xf4f2e9), dark = rgb(0x1c2528);
  for (const i of [0, 2]) {
    const endWall = facadeFrame(fp, i);
    facadeWall(buf, endWall, 0, endWall.length, 0.47, height, stone, ROW.grooved);
  }
  const radius = Math.min(width * 0.27, spec.storey * 0.62);
  const circleY = height * 0.65;
  circularPanel(buf, entrance, start, end, 3.7, height, circleY, radius, stone);
  facadeWall(buf, entrance, start, start + 0.6, 0.47, 3.7, stone, ROW.grooved);
  facadeWall(buf, entrance, end - 0.6, end, 0.47, 3.7, stone, ROW.grooved);
  facadeWall(buf, entrance, start, end, circleY - radius - 0.1, circleY + radius + 0.1, dark, ROW.plain, 0.28);
  facadeWall(buf, entrance, start + 1, end - 1, 0.47, 3.25, dark, ROW.plain, 0.1);
  facadeBox(buf, entrance, start + 0.6, start + 0.95, 0, 0.65, 0.47, 3.7, white);
  facadeBox(buf, entrance, end - 0.95, end - 0.6, 0, 0.65, 0.47, 3.7, white);
  facadeBox(buf, entrance, start + 0.6, end - 0.6, 0, 0.65, 3.25, 3.7, white);
  const left = Math.max(0.2, start - 2.2), right = Math.min(entrance.length - 0.2, end + 2.2);
  for (const [from, to] of [[left, start], [end, right]]) {
    if (to - from < 0.1) continue;
    facadeWall(buf, entrance, from, to, spec.storey * 1.45, spec.storey * 1.75, stone, ROW.grooved);
    facadeWall(buf, entrance, from, to, spec.storey * 1.75, spec.storey * 2.25, dark, ROW.ribbon);
  }
}
