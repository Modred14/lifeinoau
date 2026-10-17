import * as THREE from "three";
import { levelAt, type Template } from "@campuslife/shared/interiors";
import { boxAt, mergeParts, type Kit } from "./kit";
import { FRAME, GLASS, STEEL } from "./palette";

export interface Dressing {
  wallH: number;
  dado: number;
  fans: [number, number][];
  windowEvery: number;
  windowFrom: number;
  beam: () => THREE.Material;
}

const BAY = 2;
const WINDOW_W = 1.3;
const WINDOW_H = 1.15;
const BLADES = 7;

function louvreWindow(kit: Kit, x: number, sill: number, z: number, inward: number) {
  const face = x + inward * 0.02;
  kit.box(FRAME, 0.05, WINDOW_H + 0.1, WINDOW_W + 0.1, face, sill - 0.05, z);
  for (let i = 0; i < BLADES; i++) {
    const blade = new THREE.BoxGeometry(0.012, WINDOW_H / BLADES - 0.02, WINDOW_W - 0.06);
    blade.rotateZ(inward * 0.5).translate(face + inward * 0.045, sill + (WINDOW_H / BLADES) * (i + 0.5), z);
    kit.solid(GLASS, blade, { transparent: true, opacity: 0.6, emissive: 0x33505c });
  }
  kit.box(FRAME, 0.03, WINDOW_H, 0.03, face + inward * 0.04, sill, z);
}

function sideWalls(kit: Kit, t: Template, look: Dressing) {
  for (let y = 0, bay = 0; y + BAY <= t.d + 0.01; y += BAY, bay++) {
    const mid = y + BAY / 2;
    for (const [x, inward] of [[0, 1], [t.w, -1]] as const) {
      const floor = levelAt(t.levels, x + inward * 0.5, mid);
      kit.box(look.dado, 0.02, 1.1, BAY, x + inward * 0.01, floor, mid);
      if (bay >= look.windowFrom && bay % look.windowEvery === 0 && floor + 2.6 < look.wallH) louvreWindow(kit, x, floor + 1.3, mid, inward);
    }
  }
  kit.box(look.dado, t.w, 1.1, 0.02, t.w / 2, 0, 0.01);
}

function ceilingFans(kit: Kit, t: Template, look: Dressing) {
  if (!look.fans.length) return;
  const blades = kit.track(mergeParts([0, 1, 2].map((i) => boxAt(0.62, 0.012, 0.13, 0.36, 0, 0).rotateY((i * Math.PI * 2) / 3)).concat(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10))));
  const material = kit.track(new THREE.MeshLambertMaterial({ color: 0xe9e4d8 }));
  const rows = new Set<number>();
  for (const [x, z] of look.fans) {
    rows.add(z);
    const y = look.wallH - 0.55;
    kit.box(STEEL, 0.03, 0.5, 0.03, x, y, z);
    const fan = new THREE.Mesh(blades, material);
    fan.position.set(x, y, z);
    const phase = x * 1.7 + z;
    fan.onBeforeRender = () => {
      fan.rotation.y = phase + performance.now() * 0.009;
    };
    kit.object(fan);
    for (const side of [-1, 1]) {
      kit.box(0xd9d9d4, 0.08, 0.05, 1.25, x + side * 1.6, look.wallH - 0.1, z);
      kit.box(0xfffbe8, 0.05, 0.03, 1.2, x + side * 1.6, look.wallH - 0.13, z, 0, { emissive: 0xfff3c4, emissiveIntensity: 0.9 });
    }
  }
  for (const z of rows) kit.add("wall", look.beam, boxAt(t.w, 0.08, 0.06, t.w / 2, look.wallH - 0.04, z));
}

export function dressRoom(kit: Kit, t: Template, look: Dressing) {
  sideWalls(kit, t, look);
  ceilingFans(kit, t, look);
}
