import type { BannerTone } from "../banner-art";
import { PLACES } from "../map";
import type { BannerKind, BannerZone, PlacedArt } from "./types";

export interface Palette {
  color: number;
  ink: number;
  accent: number;
}

export const PALETTES = {
  green: { color: 0x1f7a4d, ink: 0xffffff, accent: 0xf2c230 },
  white: { color: 0xf7f4ea, ink: 0x1c1d20, accent: 0xc0392b },
  red: { color: 0xb3261e, ink: 0xffffff, accent: 0xffe08a },
  blue: { color: 0x1d4f91, ink: 0xffffff, accent: 0x8fd3ff },
  yellow: { color: 0xf2c230, ink: 0x1c1d20, accent: 0x1c1d20 },
  purple: { color: 0x5b2a86, ink: 0xffffff, accent: 0xf7c8ff },
  black: { color: 0x17181c, ink: 0xf6d55c, accent: 0xffffff },
  orange: { color: 0xe8711a, ink: 0xffffff, accent: 0x1c1d20 },
  teal: { color: 0x0f766e, ink: 0xffffff, accent: 0xfde68a },
  pink: { color: 0xd6336c, ink: 0xffffff, accent: 0xffe3ec },
  paper: { color: 0xefe6cf, ink: 0x2b2118, accent: 0x1d4f91 },
  sky: { color: 0xcfe8f7, ink: 0x12304d, accent: 0xe8711a },
} satisfies Record<string, Palette>;

export type PaletteName = keyof typeof PALETTES;

export interface ArtEntry extends PlacedArt {
  days?: readonly number[];
}

export interface ArtOptions {
  footer?: string;
  weight?: number;
  days?: readonly number[];
  kinds?: readonly BannerKind[];
  zones?: readonly BannerZone[];
  near?: RegExp;
}

export const WEEKDAYS: readonly number[] = [0, 1, 2, 3, 4];
export const POSTER_ONLY: readonly BannerKind[] = ["board"];
export const SMALL_PRINT: readonly BannerKind[] = ["board", "aframe"];
export const BIG_PRINT: readonly BannerKind[] = ["flex", "cross", "billboard"];
const DEFAULT_WEIGHT = 1;

export function placeNamed(re: RegExp): number | undefined {
  const i = PLACES.findIndex((p) => re.test(p.name));
  return i >= 0 ? i : undefined;
}

export function makeArt(tone: BannerTone, id: string, title: string, lines: string[], palette: PaletteName, opts: ArtOptions = {}): ArtEntry {
  const art: ArtEntry = { id: `${tone}-${id}`, tone, title, lines, ...PALETTES[palette], weight: opts.weight ?? DEFAULT_WEIGHT };
  if (opts.footer) art.footer = opts.footer;
  if (opts.days) art.days = opts.days;
  if (opts.kinds) art.kinds = opts.kinds;
  if (opts.zones) art.zones = opts.zones;
  const near = opts.near ? placeNamed(opts.near) : undefined;
  if (near !== undefined) art.near = near;
  return art;
}
