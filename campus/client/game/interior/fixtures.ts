import * as THREE from "three";
import type { Prop } from "@campuslife/shared/interiors";
import { dishFor } from "./dishes";
import type { Kit } from "./kit";
import { CHALKBOARD, FRAME, SCREEN, STAINLESS, WOOD, WOOD_DARK } from "./palette";

export function board(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(FRAME, p.w + 0.12, 1.42, 0.04, p.x, floor + 0.89, p.y);
  kit.box(p.color ?? CHALKBOARD, p.w, 1.3, 0.05, p.x, floor + 0.95, p.y + 0.01);
  kit.box(WOOD, p.w + 0.1, 0.04, 0.1, p.x, floor + 0.87, p.y + 0.06);
}

export function screen(kit: Kit, p: Prop) {
  const floor = p.floor ?? 0;
  kit.box(0x2a2a2a, p.w + 0.08, 0.08, 0.08, p.x, floor + 2.85, p.y);
  kit.box(SCREEN, p.w, 1.75, 0.02, p.x, floor + 1.1, p.y + 0.02, 0, { emissive: 0x9a9a94, emissiveIntensity: 0.35 });
}

export function servingCounter(kit: Kit, p: Prop) {
  const { x, y: z, w, d } = p;
  kit.box(0x7b4f2c, w, 0.94, d, x, 0, z);
  kit.box(0xe8e2d4, w, 0.5, 0.02, x, 0.3, z + d / 2 + 0.01);
  kit.box(0xd9cfc0, w + 0.06, 0.06, d + 0.1, x, 0.94, z);
  const dish = dishFor(p.label);
  const colors = dish.plate?.map((mound) => mound.color) ?? [dish.held?.color ?? 0xc98a3a];
  const trays = Math.max(3, Math.min(4, Math.floor((w - 1.6) / 0.75)));
  for (let i = 0; i < trays; i++) {
    const tx = x - w / 2 + 0.55 + i * 0.72;
    kit.box(STAINLESS, 0.62, 0.1, 0.42, tx, 1.0, z);
    kit.box(colors[i % colors.length], 0.54, 0.04, 0.34, tx, 1.08, z);
  }
  const guard = x - w / 2 + 0.55 + (trays - 1) * 0.36;
  kit.box(0xcfe3ec, trays * 0.72, 0.42, 0.015, guard, 1.12, z + d / 2 - 0.08, 0, { transparent: true, opacity: 0.28 });
  kit.box(STAINLESS, trays * 0.72 + 0.04, 0.02, 0.3, guard, 1.54, z + d / 2 - 0.2);
  const cx = x + w / 2 - 0.5;
  for (const [i, color] of [0x1565c0, 0xc62828].entries()) {
    const cooler = new THREE.CylinderGeometry(0.21, 0.19, 0.3, 14).translate(cx - i * 0.5, 1.15, z - 0.1);
    kit.solid(color, cooler);
    kit.solid(0xf4f4f0, new THREE.CylinderGeometry(0.215, 0.215, 0.04, 14).translate(cx - i * 0.5, 1.32, z - 0.1));
  }
}

export function fridge(kit: Kit, p: Prop) {
  const { x, y: z, w, d } = p;
  kit.box(0xf0f0ec, w, 1.9, d, x, 0, z);
  kit.box(0xc62828, w, 0.22, 0.02, x, 1.68, z + d / 2 + 0.01);
  kit.box(0x9fd3f0, w - 0.1, 1.45, 0.02, x, 0.18, z + d / 2 + 0.01, 0, { emissive: 0x2c4a5a, transparent: true, opacity: 0.75 });
  const drinks = [0xb5651d, 0xe8a317, 0x2e7d32, 0x6a1026];
  for (let shelf = 0; shelf < 4; shelf++) kit.box(drinks[shelf], w - 0.16, 0.2, 0.05, x, 0.28 + shelf * 0.34, z + d / 2 - 0.05);
}

export function handWash(kit: Kit, p: Prop) {
  const { x, y: z, w, d } = p;
  kit.box(WOOD_DARK, w, 0.78, d, x, 0, z);
  kit.solid(0x2a6fb5, new THREE.CylinderGeometry(0.19, 0.16, 0.42, 14).translate(x - w / 4, 0.99, z));
  kit.solid(0xf4f4f0, new THREE.CylinderGeometry(0.195, 0.195, 0.03, 14).translate(x - w / 4, 1.215, z));
  kit.box(0xd0d0d0, 0.03, 0.03, 0.09, x - w / 4, 0.86, z - 0.22);
  kit.solid(STAINLESS, new THREE.CylinderGeometry(0.2, 0.13, 0.12, 14).translate(x + w / 4, 0.84, z));
}
