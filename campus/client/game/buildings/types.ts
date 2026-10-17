export interface BuildingBuffers {
  pos: number[];
  uv: number[];
  col: number[];
  idx: number[];
}

export type Rgb = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type UvRect = readonly [number, number, number, number];

export type Archetype =
  | "hostel"
  | "faculty"
  | "lectureTheatre"
  | "bungalow"
  | "block"
  | "mosque"
  | "chapel"
  | "shopRow"
  | "kiosk"
  | "civic"
  | "sports"
  | "shed"
  | "generic";

export type RoofKind = "flat" | "gable" | "hip";

export interface BuildingSpec {
  archetype: Archetype;
  floors: number;
  storey: number;
  roof: RoofKind;
  slope: number;
  overhang: number;
  wall: Rgb;
  trim: Rgb;
  roofColor: Rgb;
  frontRow: number;
  backRow: number;
  endRow: number;
  groundRow: number;
  bandRow: number;
  bay: number;
  bandStep: number;
  balconies: boolean;
  towers: boolean;
  sunshade: boolean;
  canopy: boolean;
  dome: boolean;
  cross: boolean;
  tanks: boolean;
  facade?: string;
}

export const emptyBuffers = (): BuildingBuffers => ({ pos: [], uv: [], col: [], idx: [] });

export function hash(id: number, salt: number): number {
  let h = (Math.imul(id + 1, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const pick = <T>(list: readonly T[], id: number, salt: number): T => list[Math.floor(hash(id, salt) * list.length)];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

export function rgb(hex: number): Rgb {
  return [toLinear(((hex >> 16) & 255) / 255), toLinear(((hex >> 8) & 255) / 255), toLinear((hex & 255) / 255)];
}

export const parseHex = (css: string): number => parseInt(css.replace("#", ""), 16);

export const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

export const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
