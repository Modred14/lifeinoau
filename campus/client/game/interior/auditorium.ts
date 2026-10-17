import { SEATS, type Prop } from "@campuslife/shared/interiors";
import { boxAt, placed, type Kit } from "./kit";
import * as THREE from "three";
import { WOOD_DARK } from "./palette";

const CUSHION = 0x8e1b1b;
const SEAT_BACK = 0x7a1515;
const PLINTH = 0x2a2422;
const CURTAIN = 0x8b0d12;
const CURTAIN_FOLD = 0x6f0a0e;
const PARAPET = 0xd9cfbd;
const RAIL = 0x7a5a2e;
const CURTAIN_H = 4.2;
const FOLD_EVERY = 0.45;
const PARAPET_H = 0.95;

export function seatRow(kit: Kit, p: Prop) {
  const seat = SEATS.fixed;
  const floor = p.floor ?? 0;
  kit.box(CUSHION, p.w, 0.1, seat.depth, p.x, floor + seat.h - 0.1, p.y);
  kit.box(SEAT_BACK, p.w, seat.back + 0.12, 0.07, p.x, floor + seat.h - 0.02, p.y + seat.depth / 2 + 0.035);
  kit.box(PLINTH, p.w - 0.1, seat.h - 0.1, 0.1, p.x, floor, p.y + 0.08);
  for (const side of [-1, 1]) {
    kit.instance("row-end", () => ({ geometry: boxAt(0.06, seat.h + 0.22, seat.depth + 0.1, 0, 0, 0.03), material: () => new THREE.MeshLambertMaterial({ color: WOOD_DARK }) }), placed(p.x + side * (p.w / 2 + 0.03), floor, p.y));
  }
}

export function curtain(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(CURTAIN, p.w, CURTAIN_H, p.d * 0.6, p.x, floor, p.y);
  for (let x = p.x - p.w / 2 + FOLD_EVERY / 2; x < p.x + p.w / 2; x += FOLD_EVERY) kit.box(CURTAIN_FOLD, 0.12, CURTAIN_H, 0.06, x, floor, p.y + p.d * 0.3 + 0.03);
}

export function parapet(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(PARAPET, p.w, PARAPET_H, p.d, p.x, floor, p.y);
  kit.box(RAIL, p.w, 0.05, p.d + 0.08, p.x, floor + PARAPET_H, p.y);
}
