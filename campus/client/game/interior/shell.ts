import * as THREE from "three";
import { levelAt, type Template } from "@campuslife/shared/interiors";
import { boxAt, type Kit } from "./kit";
import { NOSING } from "./palette";

export const WALL_H = 3.4;
export const DOOR_W = 2.2;
const THICK = 0.3;

export interface ShellLook {
  wallH: number;
  wallMaterial: () => THREE.Material;
}

export function topLevel(t: Template): number {
  return t.levels.reduce((top, level) => Math.max(top, level.h), 0);
}

export function entryFloor(t: Template): number {
  return levelAt(t.levels, t.entry.x, t.entry.y);
}

export function buildShell(kit: Kit, t: Template, look: ShellLook) {
  const wall = (x: number, z: number, w: number, d: number, h: number) => kit.add("wall", look.wallMaterial, boxAt(w, h, d, x, 0, z));
  wall(t.w / 2, -THICK / 2, t.w + THICK * 2, THICK, look.wallH);
  wall(-THICK / 2, t.d / 2, THICK, t.d, look.wallH);
  wall(t.w + THICK / 2, t.d / 2, THICK, t.d, look.wallH);
  const landing = entryFloor(t);
  const side = (t.w - DOOR_W) / 2;
  wall(side / 2, t.d + THICK / 2, side + THICK, THICK, landing + 1);
  wall(t.w - side / 2, t.d + THICK / 2, side + THICK, THICK, landing + 1);
  if (landing > 0) wall(t.w / 2, t.d + THICK / 2, DOOR_W, THICK, landing);
  kit.box(0x6b625a, t.w, 0.12, 0.02, t.w / 2, 0, 0.01);
  kit.box(0x3b3a36, DOOR_W, 0.02, 1.2, t.w / 2, landing + 0.01, t.d - 0.6);
  const shade = new THREE.Color(t.floor).multiplyScalar(0.93).getHex();
  for (const level of t.levels) {
    kit.box(shade, level.w, level.h, level.d, level.x + level.w / 2, 0, level.y + level.d / 2);
    kit.box(NOSING, level.w, 0.012, 0.06, level.x + level.w / 2, level.h, level.y + 0.03);
  }
}
