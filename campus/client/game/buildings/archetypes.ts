import type { Building } from "@campuslife/shared/map";
import { ROW } from "./atlas-layout";
import { classify, fasciaColor } from "./classify";
import { buildFaculty } from "./faculty";
import { buildLandmark } from "./landmarks";
import { buildPrivateHall } from "./private-halls";
import { buildMaintenanceHall } from "./maintenance-halls";
import { hallDetails } from "./hall-details";
import { balcony, cross, ledge, minaret, mosqueDome, towerCap } from "./features";
import { at, footprintOf, insidePoly, outward, type Footprint, type RectFrame } from "./footprint";
import { flatRoof, pitchedRoof, safeOverhang, tentRoof } from "./roofs";
import { hash, shade, type BuildingBuffers, type BuildingSpec, type Vec2 } from "./types";
import { PARAPET_HEIGHT, wallRun } from "./walls";

const TOWER_LENGTH = 3.6;
const BALCONY_DEPTH = 0.72;
const SUNSHADE_DEPTH = 0.45;
const SUNSHADE_HEAD = 2.64;
const CANOPY_DEPTH = 0.76;
const MAX_BAND_DEPTH = 0.78;
const MAX_RISE = 3.4;
const MAX_REACH = 0.7;
const MAX_HIP_OVERHANG = 0.48;

function rectWalls(buf: BuildingBuffers, fp: Footprint, frame: RectFrame, spec: BuildingSpec, id: number, tower: number, top: number) {
  const length = frame.length, depth = frame.depth;
  const run = (a: Vec2, b: Vec2, row: number, groundRow: number, salt: number) =>
    wallRun(buf, { a, b, normal: outward(fp, a, b), row, groundRow, salt }, spec, id, top, spec.archetype === "faculty" ? spec.trim : spec.wall);
  const cuts = tower > 0 ? [0, tower, length - tower, length] : [0, length];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const stair = tower > 0 && i !== 1;
    const front = stair ? ROW.stairScreen : spec.frontRow;
    const back = stair ? ROW.stairScreen : spec.backRow;
    run(at(frame, cuts[i], 0), at(frame, cuts[i + 1], 0), front, stair ? ROW.stairScreen : spec.groundRow, i);
    run(at(frame, cuts[i + 1], depth), at(frame, cuts[i], depth), back, stair ? ROW.stairScreen : spec.groundRow !== spec.frontRow ? spec.groundRow : back, 4 + i);
  }
  const endGround = spec.endRow === ROW.plain ? ROW.plain : spec.groundRow;
  run(at(frame, length, 0), at(frame, length, depth), spec.endRow, endGround, 8);
  run(at(frame, 0, depth), at(frame, 0, 0), spec.endRow, endGround, 9);
}

function rectDetails(buf: BuildingBuffers, frame: RectFrame, spec: BuildingSpec, id: number, tower: number) {
  const from = tower, to = frame.length - tower;
  const dark = shade(spec.wall, 0.45);
  if (spec.balconies && spec.facade !== "boxed") for (let k = 1; k < spec.floors; k++) balcony(buf, frame, "front", from, to, k * spec.storey, BALCONY_DEPTH, spec.wall, spec.trim, spec.bay, id, k);
  if (spec.facade) hallDetails(buf, frame, spec, from, to);
  if (spec.sunshade && spec.storey >= SUNSHADE_HEAD + 0.2) {
    for (let k = 0; k < spec.floors; k++) {
      const y = k * spec.storey + SUNSHADE_HEAD;
      ledge(buf, frame, "back", from, to, y, y + 0.1, SUNSHADE_DEPTH, { side: spec.wall, top: shade(spec.wall, 0.85), bottom: dark }, id);
    }
  }
  if (spec.bandStep > 0) {
    for (let k = 1; k <= spec.floors; k++) {
      const reach = Math.min(MAX_BAND_DEPTH, 0.3 + spec.bandStep * (k - 1));
      const y = k * spec.storey;
      const style = { side: spec.trim, top: shade(spec.trim, 0.9), bottom: dark, row: spec.bandRow, bay: spec.bay, salt: k };
      for (const side of ["front", "back"] as const) ledge(buf, frame, side, 0, frame.length, y - 0.3, y + (k === spec.floors ? PARAPET_HEIGHT : 0.85), reach, style, id);
    }
  }
  if (spec.canopy) ledge(buf, frame, "front", 0, frame.length, 2.72, 2.9, CANOPY_DEPTH, { side: spec.trim, top: shade(spec.trim, 0.8), bottom: dark }, id);
}

function buildRect(buf: BuildingBuffers, b: Building, fp: Footprint, frame: RectFrame, spec: BuildingSpec) {
  const id = b.id;
  const wallTop = spec.floors * spec.storey;
  const flat = spec.roof === "flat";
  const tower = spec.towers ? TOWER_LENGTH : 0;
  const rise = Math.min(MAX_RISE, Math.max(0.7, (frame.depth / 2) * spec.slope));
  const top = flat ? wallTop + PARAPET_HEIGHT : wallTop;
  rectWalls(buf, fp, frame, spec, id, tower, top);
  rectDetails(buf, frame, spec, id, tower);
  if (flat) flatRoof(buf, fp, wallTop, top, spec.roofColor, shade(spec.wall, 0.8));
  else {
    const hip = spec.roof === "hip";
    const over = safeOverhang(hip ? Math.min(spec.overhang, MAX_HIP_OVERHANG) : spec.overhang, wallTop, rise / (frame.depth / 2));
    pitchedRoof(buf, frame, {
      from: tower,
      to: frame.length - tower,
      y: wallTop,
      rise,
      over,
      overEnd: tower > 0 ? 0 : Math.min(over, 0.5, Math.sqrt(Math.max(0, MAX_REACH * MAX_REACH - over * over))),
      hip,
      gables: tower === 0,
      color: spec.roofColor,
      wall: spec.wall,
      fascia: fasciaColor(spec),
    });
  }
  if (tower > 0) {
    const capTop = top + (flat ? 0.9 : rise + 0.3);
    const tanks = hash(id, 31);
    towerCap(buf, frame, 0, tower, wallTop, capTop, spec.wall, shade(spec.wall, 0.7), spec.tanks && tanks < 0.75, id);
    towerCap(buf, frame, frame.length - tower, frame.length, wallTop, capTop, spec.wall, shade(spec.wall, 0.7), spec.tanks && tanks > 0.4, id + 7919);
  }
  if (spec.dome) {
    const radius = Math.min(frame.depth * 0.28, 4.5);
    mosqueDome(buf, at(frame, frame.length / 2, frame.depth / 2), wallTop, radius, spec.wall, spec.trim);
    if (frame.depth > 5) minaret(buf, frame, 1.5, 1.5, wallTop, wallTop + Math.max(6, b.height * 0.7), spec.wall, spec.trim);
  }
  if (spec.cross && !flat) cross(buf, frame, wallTop + rise, spec.trim);
}

function buildFree(buf: BuildingBuffers, b: Building, fp: Footprint, spec: BuildingSpec) {
  const wallTop = spec.floors * spec.storey;
  const pitched = spec.roof !== "flat";
  const rise = Math.min(2.2, Math.max(0.8, fp.shortest * 0.16));
  const tent = pitched && tentRoof(buf, fp, wallTop, rise, spec.roofColor);
  const top = tent ? wallTop : wallTop + PARAPET_HEIGHT;
  const n = fp.pts.length;
  for (let i = 0; i < n; i++) {
    const p = fp.pts[i], q = fp.pts[(i + 1) % n];
    const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const row = length >= 6 ? (i % 2 ? spec.backRow : spec.frontRow) : length >= 3 ? spec.backRow : spec.endRow;
    const ground = row === spec.frontRow ? spec.groundRow : row;
    wallRun(buf, { a: p, b: q, normal: outward(fp, p, q), row, groundRow: ground, salt: i }, spec, b.id, top, spec.archetype === "faculty" ? spec.trim : spec.wall);
  }
  if (!tent) flatRoof(buf, fp, wallTop, top, spec.roofColor, shade(spec.wall, 0.8));
  if (spec.dome && insidePoly(fp.centre, fp.pts)) mosqueDome(buf, fp.centre, wallTop, Math.min(4.5, fp.shortest * 0.18), spec.wall, spec.trim);
}

export interface BuiltInfo {
  spec: BuildingSpec;
  footprint: Footprint;
}

export function buildBuilding(buf: BuildingBuffers, b: Building): BuiltInfo {
  const footprint = footprintOf(b.poly, b.id);
  const spec = classify(b, footprint);
  if (footprint.pts.length >= 3) {
    if (buildLandmark(buf, b, footprint, spec)) return { spec, footprint };
    if ((spec.facade === "private" || spec.facade === "shg") && buildPrivateHall(buf, footprint, spec)) return { spec, footprint };
    if (spec.facade === "maintenance" && buildMaintenanceHall(buf, footprint, spec)) return { spec, footprint };
    if (spec.archetype === "faculty" && spec.bandStep > 0 && footprint.pts.length <= 12) buildFaculty(buf, footprint, spec);
    else if (footprint.rect) buildRect(buf, b, footprint, footprint.rect, spec);
    else buildFree(buf, b, footprint, spec);
  }
  return { spec, footprint };
}
