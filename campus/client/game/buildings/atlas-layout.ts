import type { UvRect } from "./types";

export const ATLAS_WIDTH = 1024;
export const ATLAS_HEIGHT = 2048;
export const ROW_PX = 128;
export const BAY_PX = 128;
export const BAYS_PER_ROW = ATLAS_WIDTH / BAY_PX;
export const GLOW_SCALE = 0.5;

export const ROW = {
  plain: 0,
  hostelRooms: 1,
  hostelCorridor: 2,
  hostelRail: 3,
  stairScreen: 4,
  ribbon: 5,
  brise: 6,
  pilotis: 7,
  grooved: 8,
  bungalow: 9,
  shop: 10,
  office: 11,
  worship: 12,
  shed: 13,
  roofZinc: 14,
  roofConcrete: 15,
} as const;

export const ROW_COUNT = ATLAS_HEIGHT / ROW_PX;
const INSET_PX = 2;

export const rowTop = (row: number): number => (row * ROW_PX + INSET_PX) / ATLAS_HEIGHT;
export const rowBottom = (row: number): number => ((row + 1) * ROW_PX - INSET_PX) / ATLAS_HEIGHT;

export function rowUv(row: number, u0: number, u1: number, from = 0, to = 1): UvRect {
  const bottom = rowBottom(row);
  const top = rowTop(row);
  return [u0, bottom + (top - bottom) * from, u1, bottom + (top - bottom) * to];
}

export function flatUv(row: number): UvRect {
  const v = (row * ROW_PX + ROW_PX * 0.5) / ATLAS_HEIGHT;
  const u = 24 / ATLAS_WIDTH;
  return [u, v, u, v];
}
