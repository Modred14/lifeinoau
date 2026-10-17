import type { BannerArt, BannerTone } from "../banner-art";

export const BANNER_KINDS = ["flex", "cross", "board", "aframe", "billboard", "flags"] as const;
export type BannerKind = (typeof BANNER_KINDS)[number];

export const BANNER_ZONES = ["gate", "union", "hostel", "faculty", "faith", "sport", "commerce", "road"] as const;
export type BannerZone = (typeof BANNER_ZONES)[number];

export const FACE_SHAPES = ["wide", "strip", "poster", "big"] as const;
export type FaceShape = (typeof FACE_SHAPES)[number];

export interface BannerSize {
  width: number;
  height: number;
  lift: number;
  pole: number;
  slots: number;
  cols: number;
  margin: number;
  wall: number;
  shape: FaceShape | null;
}

export const BANNER_SIZES: Record<BannerKind, BannerSize> = {
  flex: { width: 3.2, height: 1.4, lift: 1.1, pole: 2.8, slots: 1, cols: 1, margin: 1, wall: 1.2, shape: "wide" },
  cross: { width: 8, height: 1.125, lift: 4.4, pole: 5.9, slots: 1, cols: 1, margin: 0.9, wall: 1.2, shape: "strip" },
  board: { width: 2.4, height: 1.3, lift: 0.9, pole: 2.5, slots: 8, cols: 4, margin: 0.9, wall: 1, shape: "poster" },
  aframe: { width: 0.75, height: 0.8, lift: 0.15, pole: 1, slots: 1, cols: 1, margin: 0.8, wall: 0.9, shape: "poster" },
  billboard: { width: 8, height: 4, lift: 3.4, pole: 7.6, slots: 1, cols: 1, margin: 1.5, wall: 2, shape: "big" },
  flags: { width: 9.6, height: 0.75, lift: 5.6, pole: 7, slots: 0, cols: 5, margin: 1, wall: 1.5, shape: null },
};

export const CROSS_RULES = {
  minRoadWidth: 6,
  setback: 1.3,
  vehicleHeadroom: 1.2,
};

export const FLAG_COLORS: readonly number[] = [0x1f7a4d, 0xf4f1e6, 0x1d4f91, 0xf2c230, 0x1f7a4d];

export interface BannerSpot {
  id: number;
  kind: BannerKind;
  x: number;
  y: number;
  face: number;
  span: number;
  place: number;
  zone: BannerZone;
  slots: number;
}

export interface PlacedArt extends BannerArt {
  kinds?: readonly BannerKind[];
  zones?: readonly BannerZone[];
}

export type ToneTable = Record<BannerTone, number>;
