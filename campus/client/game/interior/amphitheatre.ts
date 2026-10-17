import { SEATS, type Prop, type Template } from "@campuslife/shared/interiors";
import type { Kit } from "./kit";
import { STEEL, WOOD_DARK } from "./palette";

const CONCRETE = 0xbdb8ad;
const CONCRETE_TOP = 0xcfcabf;
const DECK = 0x6b4a2e;
const SKIRT = 0x1c1c20;
const SPEAKER = 0x141416;
const GRILLE = 0x3a3a40;
const LAMP = 0x26262b;
const BACKDROP = 0x1f2a44;
const TRUSS_H = 4.4;
const BACKDROP_H = 3.8;
const LAMP_EVERY = 2.2;
const WING_OVER = 2.6;

export const trussHeight = (p: Prop) => (p.floor ?? 0) + TRUSS_H;

export function terraceBench(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  const h = SEATS.bench.h;
  kit.box(CONCRETE, p.w, h - 0.03, p.d, p.x, floor, p.y);
  kit.box(CONCRETE_TOP, p.w, 0.03, p.d, p.x, floor + h - 0.03, p.y);
}

export function stageDeck(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(DECK, p.w - 0.1, 0.03, p.d - 0.1, p.x, floor, p.y);
  kit.box(SKIRT, p.w, floor, 0.06, p.x, 0, p.y + p.d / 2 + 0.03);
  for (const side of [-1, 1]) kit.box(WOOD_DARK, 1.2, floor / 2, 0.5, p.x + side * (p.w / 2 - 1.5), 0, p.y + p.d / 2 + 0.3);
}

export function speakerStack(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(SPEAKER, p.w, 1.2, p.d, p.x, floor, p.y);
  kit.box(SPEAKER, p.w * 0.85, 0.9, p.d * 0.85, p.x, floor + 1.2, p.y);
  kit.box(GRILLE, p.w * 0.7, 0.8, 0.02, p.x, floor + 0.2, p.y + p.d / 2 + 0.01);
  kit.box(GRILLE, p.w * 0.55, 0.55, 0.02, p.x, floor + 1.38, p.y + (p.d * 0.85) / 2 + 0.01);
}

export function lightingTruss(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  for (const side of [-1, 1]) kit.box(STEEL, 0.16, TRUSS_H, 0.16, p.x + side * (p.w / 2), floor, p.y);
  kit.box(STEEL, p.w + 0.16, 0.08, 0.3, p.x, floor + TRUSS_H, p.y);
  kit.box(STEEL, p.w + 0.16, 0.08, 0.3, p.x, floor + TRUSS_H - 0.4, p.y);
  const count = Math.max(2, Math.floor(p.w / LAMP_EVERY));
  for (let i = 0; i < count; i++) kit.box(LAMP, 0.26, 0.3, 0.26, p.x - p.w / 2 + (p.w / count) * (i + 0.5), floor + TRUSS_H - 0.72, p.y);
}

export function backdrop(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(STEEL, p.w + 0.3, BACKDROP_H + 0.2, 0.08, p.x, floor, p.y - 0.06);
  kit.box(p.color ?? BACKDROP, p.w, BACKDROP_H, p.d * 0.5, p.x, floor + 0.1, p.y);
}

export function wing(kit: Kit, t: Template, p: Prop) {
  const top = t.levels.reduce((h, level) => Math.max(h, level.h), 0);
  kit.box(t.wall, p.w, top + WING_OVER, p.d, p.x, 0, p.y);
}
