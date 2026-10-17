import { BUILDING_PRESETS, BUILDING_STYLE, PLACES, type Building, type BuildingStylePreset } from "@campuslife/shared/map";
import { ROW } from "./atlas-layout";
import type { Footprint } from "./footprint";
import { hash, parseHex, pick, rgb, shade, type Archetype, type BuildingSpec, type Rgb, type RoofKind } from "./types";

const ARCHETYPES: readonly Archetype[] = ["hostel", "faculty", "lectureTheatre", "bungalow", "block", "mosque", "chapel", "shopRow", "kiosk", "civic", "sports", "shed", "generic"];
const HOSTEL_WALLS = [0xeee4cf, 0xe8dcc0, 0xf2ead8, 0xe6d3b0];
const HOSTEL_TRIMS = [0x8a3b2e, 0x3f7a57, 0x4a6f9a, 0xc79a4a];
const HOUSE_WALLS = [0xf1e8dc, 0xe9dfc8, 0xf4f1e8, 0xe3d2b4, 0xd9e2d0, 0xe8cfc0, 0xdcd9d2, 0xf0e2a8];
const ZINC = [0x8a5a3c, 0x9c6844, 0x7a4e36, 0x8a5a3c, 0x9a9a94, 0xb0aca4, 0xc9cdd0, 0x4f8a68, 0x8f3d33, 0x3f6f9f];
const CONCRETE_ROOF = [0xb9b6ae, 0xa9a69e, 0xc6c2b8];
const WHITE = 0xf4f2ec;
const MIN_PITCHED_STOREY = 3.0;

const HALLS = PLACES.filter((p) => p.building === undefined && BUILDING_PRESETS.halls[p.name]);

function hallPreset(b: Building): BuildingStylePreset | undefined {
  const cx = b.bbox.x + b.bbox.w / 2, cy = b.bbox.y + b.bbox.h / 2;
  let best: BuildingStylePreset | undefined;
  let bestDistance = Infinity;
  for (const hall of HALLS) {
    const d = Math.hypot(hall.label.x - cx, hall.label.y - cy);
    if (d < bestDistance) {
      bestDistance = d;
      best = BUILDING_PRESETS.halls[hall.name];
    }
  }
  return best;
}

function archetypeOf(b: Building, fp: Footprint): Archetype {
  const name = (b.name ?? "").toLowerCase();
  const long = fp.longest, deep = Math.max(fp.shortest, 0.1), aspect = long / deep;
  const roll = hash(b.id, 21);
  switch (b.kind) {
    case "hostel":
      if (fp.area < 30) return "kiosk";
      if (fp.rect ? long >= 24 && deep >= 6.5 && deep <= 18 : fp.area > 300) return "hostel";
      return "bungalow";
    case "academic":
      if (/lecture|theat|auditorium|hslt|\blt\b|\baud\b/.test(name)) return "lectureTheatre";
      return b.height >= 9 ? "faculty" : "block";
    case "residence":
      return "bungalow";
    case "worship":
      return /mosque|masjid/.test(name) ? "mosque" : "chapel";
    case "commercial":
      return /bank/.test(name) ? "civic" : "shopRow";
    case "sports":
      return "sports";
    case "civic":
      return "civic";
    default:
      if (fp.area < 28) return "kiosk";
      if (!fp.rect) return fp.area < 330 ? "bungalow" : "generic";
      if (deep <= 5.6 && aspect >= 2.6) return "shopRow";
      if (b.height >= 7) return aspect >= 2.5 && deep <= 16 ? "block" : roll < 0.5 ? "shed" : "block";
      if (fp.area <= 330) return aspect >= 3 ? "block" : "bungalow";
      return aspect >= 3 ? "block" : roll < 0.6 ? "shed" : "block";
  }
}

const pitchedFloors = (height: number) => Math.max(1, Math.round((height - 1.5) / 3.1));
const flatFloors = (height: number) => Math.max(1, Math.floor((height - 0.6) / 2.9 + 0.2));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function classify(b: Building, fp: Footprint): BuildingSpec {
  const id = b.id;
  const preset = (b.preset ? BUILDING_PRESETS.landmarks[b.preset] : undefined) ?? (b.name ? BUILDING_PRESETS.landmarks[b.name] : undefined) ?? (b.kind === "hostel" ? hallPreset(b) : undefined);
  const wanted = preset?.archetype as Archetype | undefined;
  const archetype = wanted && ARCHETYPES.includes(wanted) ? wanted : archetypeOf(b, fp);
  const tint = 0.94 + hash(id, 1) * 0.1;
  const zinc = rgb(pick(ZINC, id, 2));
  const kindWall = rgb(BUILDING_STYLE[b.kind].wall);
  const spec: BuildingSpec = {
    archetype,
    floors: 1,
    storey: 3.1,
    roof: "gable",
    slope: 0.36,
    overhang: 0.55,
    wall: shade(kindWall, tint),
    trim: rgb(WHITE),
    roofColor: zinc,
    frontRow: ROW.office,
    backRow: ROW.office,
    endRow: ROW.plain,
    groundRow: ROW.office,
    bandRow: ROW.plain,
    bay: 3.4,
    bandStep: 0,
    balconies: false,
    towers: false,
    sunshade: false,
    canopy: false,
    dome: false,
    cross: false,
    tanks: true,
  };
  const rows = (front: number, back = front, end: number = ROW.plain, ground = front) => Object.assign(spec, { frontRow: front, backRow: back, endRow: end, groundRow: ground });
  const flat = (floors = flatFloors(b.height)) => {
    spec.roof = "flat";
    spec.floors = floors;
    spec.storey = clamp((b.height - 0.6) / floors, 2.8, 3.6);
    spec.roofColor = shade(rgb(pick(CONCRETE_ROOF, id, 3)), tint);
  };
  spec.floors = pitchedFloors(b.height);
  switch (archetype) {
    case "hostel": {
      const big = fp.longest >= 24;
      spec.floors = big ? preset?.floors ?? (preset?.roof === "flat" ? flatFloors(b.height) : spec.floors) : 1;
      spec.wall = shade(rgb(pick(HOSTEL_WALLS, id, 4)), tint);
      spec.trim = rgb(preset?.trim ? parseHex(preset.trim) : pick(HOSTEL_TRIMS, id, 5));
      spec.roof = hash(id, 6) < 0.7 ? "gable" : "hip";
      rows(ROW.hostelCorridor, ROW.hostelRooms);
      if (preset?.facade === "boxed") rows(ROW.hostelRooms, ROW.hostelRooms);
      if (preset?.facade === "veranda") spec.slope = 0.18;
      spec.balconies = spec.sunshade = true;
      spec.towers = spec.floors >= 2 && fp.longest >= 34;
      if (spec.floors === 1) spec.overhang = 0.7;
      break;
    }
    case "faculty": {
      flat(preset?.floors);
      spec.wall = shade(rgb(0xe9e7e1), tint);
      spec.bay = 3.6;
      spec.bandStep = preset?.bandStep ?? (hash(id, 7) < 0.5 ? 0.1 : 0.16);
      spec.bandRow = preset?.grooved ? ROW.grooved : ROW.plain;
      rows(ROW.ribbon, hash(id, 8) < 0.6 ? ROW.brise : ROW.ribbon, ROW.grooved, spec.floors >= 3 ? ROW.pilotis : ROW.ribbon);
      break;
    }
    case "lectureTheatre":
      flat(preset?.floors);
      spec.wall = shade(rgb(0xe4e1d8), tint);
      rows(ROW.grooved, ROW.grooved, ROW.grooved, ROW.pilotis);
      spec.canopy = true;
      break;
    case "bungalow":
      spec.wall = shade(rgb(pick(HOUSE_WALLS, id, 4)), tint);
      spec.roof = fp.longest / Math.max(fp.shortest, 0.1) < 1.5 || hash(id, 6) < 0.45 ? "hip" : "gable";
      spec.slope = pick([0.36, 0.42, 0.5], id, 9);
      rows(ROW.office, ROW.office, ROW.office, ROW.bungalow);
      break;
    case "block":
      spec.wall = shade(rgb(pick(HOUSE_WALLS, id, 4)), tint);
      spec.roof = hash(id, 6) < 0.75 ? "gable" : "hip";
      rows(b.kind === "academic" ? ROW.ribbon : ROW.office, ROW.office);
      break;
    case "mosque":
      flat(1);
      spec.storey = clamp(b.height * 0.55, 3.6, 5.5);
      spec.trim = rgb(0x2f7d5b);
      rows(ROW.worship, ROW.worship, ROW.worship);
      spec.dome = true;
      break;
    case "chapel":
      spec.floors = 1;
      spec.storey = clamp(b.height - 3, 3.4, 6);
      spec.slope = 0.62;
      spec.overhang = 0.4;
      rows(ROW.worship);
      spec.cross = /church|chapel|rccg|christ|cathol|parish/i.test(b.name ?? "");
      break;
    case "shopRow":
      flat(1);
      spec.storey = 3.1;
      spec.wall = shade(rgb(pick(HOUSE_WALLS, id, 4)), tint);
      rows(ROW.shop, ROW.plain);
      spec.canopy = true;
      break;
    case "kiosk":
      spec.floors = 1;
      spec.slope = 0.24;
      spec.overhang = 0.3;
      spec.wall = shade(rgb(pick(HOUSE_WALLS, id, 4)), tint);
      rows(ROW.shop, ROW.plain);
      break;
    case "civic":
      spec.wall = shade(kindWall, tint);
      spec.roof = "hip";
      if (b.kind === "commercial" || preset?.roof === "flat") {
        flat(preset?.floors);
        spec.canopy = true;
      }
      break;
    case "sports":
    case "shed":
      spec.floors = 1;
      spec.storey = clamp(b.height - 1.3, 3.2, 8);
      spec.slope = 0.2;
      spec.overhang = 0.3;
      spec.bay = 4.2;
      rows(ROW.shed, ROW.shed, ROW.shed);
      break;
    default:
      flat();
      rows(b.height >= 9 ? ROW.ribbon : ROW.office, ROW.office);
  }
  if (preset?.roof === "gable" || preset?.roof === "hip" || (preset?.roof === "flat" && (b.kind !== "hostel" || archetype === "hostel"))) spec.roof = preset.roof as RoofKind;
  if (preset?.floors !== undefined) spec.floors = preset.floors;
  if (preset?.storey) spec.storey = preset.storey;
  if (preset?.trim) spec.trim = rgb(parseHex(preset.trim));
  if (preset?.tanks !== undefined) spec.tanks = preset.tanks;
  if (preset?.facade) spec.facade = preset.facade;
  if (preset?.wall) spec.wall = rgb(parseHex(preset.wall));
  if (preset?.roofColor) spec.roofColor = rgb(parseHex(preset.roofColor));
  if (spec.roof !== "flat") spec.storey = Math.max(spec.storey, spec.floors === 1 ? MIN_PITCHED_STOREY : 2.9);
  return spec;
}

export const fasciaColor = (spec: BuildingSpec): Rgb => shade(spec.trim, 0.9);
