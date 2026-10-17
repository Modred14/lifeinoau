import * as THREE from "three";
import { PX_PER_METER, STALLS, type Stall } from "@campuslife/shared";
import { mergeParts, type Part } from "./kit";

export interface StallKit {
  shadows: boolean;
  track<T extends { dispose(): void }>(d: T): T;
  patch(mat: THREE.Material): void;
}

const M = PX_PER_METER;
const WOOD = 0x9a7048;
const DARK_WOOD = 0x6e4d30;
const STEEL = 0x8a9096;
const UMBRELLAS = [0xd94f3d, 0xf2b134, 0x2f8f6b, 0x3d6fd9];
const KIOSKS = [0x2f6fb5, 0x2f8f6b, 0xd9a520, 0xb5462f];
const TARP = 0x3d4a5c;
const TARP_SIZE: [number, number, number] = [2.5, 1.2, 1.2];
const COALS = 0xff7a2a;
const CANOPIES = [...UMBRELLAS, ...KIOSKS];
const CULL_MARGIN_M = 6;
export const STALLS_GROUP = "stalls";

type Vec3 = [number, number, number];

interface Bag {
  solid: Part[];
  canopy: Part[];
  coals: { size: Vec3; at: Vec3 }[];
}

export function cullStalls(group: THREE.Object3D, focus: THREE.Vector3, viewFar: number) {
  const reach = viewFar + CULL_MARGIN_M;
  for (const stall of group.children) stall.visible = Math.hypot(stall.position.x - focus.x, stall.position.z - focus.z) < reach;
}

export function shutterStalls(group: THREE.Object3D, shut: (index: number) => boolean) {
  group.children.forEach((stall, index) => {
    const closed = shut(index);
    if (stall.userData.closed === closed) return;
    stall.userData.closed = closed;
    for (const part of stall.children) part.visible = (part.userData.cover === true) === closed;
  });
}
const GOODS: Record<number, number[]> = {
  0: [0xf28c1c, 0xf2a01c, 0xe8c63a, 0x7fae3a],
  1: [0xe8c24a, 0xd9a520, 0x5b3a66],
  2: [0xc98a3c, 0xb8752e, 0xd9a05a],
  3: [0xc8322a, 0xf28c1c, 0x7a1f3a, 0x2f8f6b],
  4: [0xb8752e, 0xe6d3a8, 0xc98a3c],
  5: [0xb98a5a, 0xf4ecd6, 0xa0703c],
  6: [0x8fae4a, 0xa9b85a, 0x6f8f3a],
  7: [0xd94f3d, 0x3d6fd9, 0xf2b134, 0x2f8f6b],
};

export function buildStalls(kit: StallKit): THREE.Group {
  const group = new THREE.Group();
  group.name = STALLS_GROUP;
  const solidMat = kit.track(new THREE.MeshLambertMaterial({ vertexColors: true }));
  const canopyMat = kit.track(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  kit.patch(canopyMat);
  const tarpMat = kit.track(new THREE.MeshLambertMaterial({ color: TARP }));
  const coalsMat = kit.track(new THREE.MeshBasicMaterial({ color: COALS }));
  const boxGeo = kit.track(new THREE.BoxGeometry(1, 1, 1));
  const ballGeo = kit.track(new THREE.IcosahedronGeometry(0.5, 0));
  const tubeGeo = kit.track(new THREE.CylinderGeometry(0.5, 0.5, 1, 8));
  const coneGeo = kit.track(new THREE.ConeGeometry(1, 1, 8, 1, true));
  const drumGeo = kit.track(new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, 0, Math.PI));

  const add = (g: Bag, geo: THREE.BufferGeometry, color: number, size: Vec3, at: Vec3, rot?: Vec3) => {
    g.solid.push(rot ? { geo: geo.clone(), color, scale: size, at, rot } : { geo: geo.clone(), color, scale: size, at });
  };
  const shade = (g: Bag, geo: THREE.BufferGeometry, canopy: number, size: Vec3, at: Vec3, rot?: Vec3) => {
    g.canopy.push(rot ? { geo: geo.clone(), color: CANOPIES[canopy], scale: size, at, rot } : { geo: geo.clone(), color: CANOPIES[canopy], scale: size, at });
  };
  const parasol = (g: Bag, i: number, x: number, z: number, radius = 1.6) => {
    add(g, tubeGeo, STEEL, [0.07, 2.6, 0.07], [x, 1.3, z]);
    shade(g, coneGeo, i % UMBRELLAS.length, [radius, 0.7, radius], [x, 2.75, z]);
  };
  const heap = (g: Bag, colors: number[], cx: number, y: number, cz: number, w: number, d: number, size: number, n: number) => {
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d)));
    const rows = Math.ceil(n / cols);
    for (let k = 0; k < n; k++) {
      const col = k % cols;
      const row = Math.floor(k / cols);
      add(g, ballGeo, colors[(col + row) % colors.length], [size, size, size], [cx + ((col + 0.5) / cols - 0.5) * w, y + size / 2, cz + ((row + 0.5) / rows - 0.5) * d]);
    }
  };
  const table = (g: Bag, w: number, d: number, top = 0.78) => {
    add(g, boxGeo, WOOD, [w, 0.07, d], [0, top, 0]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, boxGeo, DARK_WOOD, [0.07, top, 0.07], [sx * (w / 2 - 0.08), top / 2, sz * (d / 2 - 0.08)]);
  };

  const draw: Record<Stall["style"], (g: Bag, s: Stall, i: number) => void> = {
    umbrella(g, _s, i) {
      add(g, boxGeo, WOOD, [2.4, 1, 1.1], [0, 0.5, 0]);
      parasol(g, i, 0, 0);
    },
    table(g, s, i) {
      const colors = GOODS[s.goods] ?? GOODS[2];
      table(g, 2.2, 0.95);
      for (const x of [-0.7, 0, 0.7]) {
        add(g, tubeGeo, 0xd8d2c4, [0.52, 0.12, 0.52], [x, 0.87, 0.05]);
        heap(g, colors, x, 0.9, 0.05, 0.36, 0.36, 0.13, 6);
      }
      add(g, boxGeo, 0x3d6fd9, [0.42, 0.3, 0.32], [0.75, 0.15, -0.75]);
      if (i % 2 === 0) parasol(g, i, -0.2, -0.55, 1.5);
    },
    barrow(g, s) {
      const colors = GOODS[s.goods] ?? GOODS[0];
      const cane = s.goods === 6;
      add(g, boxGeo, 0x2f6b4f, [0.95, 0.34, 1.3], [0, 0.62, 0]);
      add(g, boxGeo, 0x275a43, [0.75, 0.1, 1.05], [0, 0.42, 0]);
      add(g, tubeGeo, 0x1b1b1d, [0.5, 0.12, 0.5], [0, 0.25, 0.86], [0, 0, Math.PI / 2]);
      for (const sx of [-1, 1]) {
        add(g, boxGeo, DARK_WOOD, [0.06, 0.06, 1.1], [sx * 0.42, 0.6, -1.1]);
        add(g, boxGeo, STEEL, [0.05, 0.5, 0.05], [sx * 0.38, 0.25, -0.5]);
      }
      if (cane) {
        for (let k = 0; k < 9; k++) {
          add(g, tubeGeo, colors[k % colors.length], [0.07, 1.9, 0.07], [(k % 3 - 1) * 0.22, 0.86 + Math.floor(k / 3) * 0.07, -0.15], [Math.PI / 2 - 0.12, 0, 0]);
        }
      } else {
        heap(g, colors, 0, 0.78, 0, 0.8, 1.1, 0.19, 20);
        heap(g, colors, 0, 0.94, 0, 0.5, 0.8, 0.19, 8);
      }
      add(g, boxGeo, DARK_WOOD, [0.4, 0.42, 0.4], [1.0, 0.21, -0.3]);
    },
    grill(g, s, i) {
      const colors = GOODS[s.goods] ?? GOODS[1];
      add(g, drumGeo, 0x2a2b2e, [0.62, 1.15, 0.62], [0, 0.8, 0], [0, Math.PI / 2, Math.PI / 2]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, boxGeo, STEEL, [0.05, 0.8, 0.05], [sx * 0.45, 0.4, sz * 0.22]);
      g.coals.push({ size: [0.95, 0.03, 0.42], at: [0, 0.82, 0] });
      for (let k = 0; k < 5; k++) {
        add(g, tubeGeo, colors[k % 2], [0.09, 0.32, 0.09], [-0.4 + k * 0.2, 0.88, 0], [Math.PI / 2, 0, 0]);
      }
      add(g, boxGeo, WOOD, [0.7, 0.5, 0.5], [0.95, 0.25, 0]);
      heap(g, [colors[2] ?? colors[0]], 0.95, 0.5, 0, 0.5, 0.36, 0.11, 8);
      parasol(g, i + 1, -0.1, -0.6, 1.45);
    },
    cooler(g, s, i) {
      const colors = GOODS[s.goods] ?? GOODS[3];
      add(g, boxGeo, 0x2f6fb5, [0.95, 0.62, 0.6], [-0.6, 0.31, 0]);
      add(g, boxGeo, 0xf4f1e6, [0.98, 0.08, 0.63], [-0.6, 0.66, 0]);
      add(g, boxGeo, 0xc8322a, [0.8, 0.5, 0.55], [0.5, 0.25, 0]);
      add(g, boxGeo, 0xf4f1e6, [0.83, 0.07, 0.58], [0.5, 0.53, 0]);
      for (let k = 0; k < 8; k++) add(g, tubeGeo, colors[k % colors.length], [0.085, 0.26, 0.085], [0.22 + (k % 4) * 0.18, 0.7, -0.12 + Math.floor(k / 4) * 0.22]);
      for (let k = 0; k < 2; k++) add(g, boxGeo, 0xd9a520, [0.5, 0.3, 0.36], [1.05, 0.15 + k * 0.31, -0.5]);
      parasol(g, i + 2, 0, -0.45, 1.7);
    },
    kiosk(g, s, i) {
      const colors = GOODS[s.goods] ?? GOODS[7];
      const paint = KIOSKS[i % KIOSKS.length];
      add(g, boxGeo, paint, [2.3, 0.95, 1.05], [0, 0.475, 0]);
      add(g, boxGeo, paint, [2.3, 1.25, 0.06], [0, 1.58, -0.5]);
      for (const sx of [-1, 1]) add(g, boxGeo, paint, [0.06, 1.25, 1.05], [sx * 1.12, 1.58, 0]);
      shade(g, boxGeo, UMBRELLAS.length + (i % KIOSKS.length), [2.6, 0.06, 1.5], [0, 2.24, 0.12]);
      shade(g, boxGeo, UMBRELLAS.length + (i % KIOSKS.length), [2.4, 0.05, 0.75], [0, 2.02, 1.02], [0.42, 0, 0]);
      add(g, boxGeo, WOOD, [2.2, 0.05, 0.3], [0, 1.5, -0.3]);
      for (let k = 0; k < 9; k++) add(g, boxGeo, colors[k % colors.length], [0.17, 0.2, 0.14], [-0.9 + k * 0.225, 1.06, 0.3]);
      for (let k = 0; k < 7; k++) add(g, boxGeo, colors[(k + 2) % colors.length], [0.2, 0.24, 0.16], [-0.8 + k * 0.27, 1.65, -0.3]);
    },
  };

  STALLS.forEach((s, i) => {
    const bag: Bag = { solid: [], canopy: [], coals: [] };
    draw[s.style](bag, s, i);
    const g = new THREE.Group();
    const body = new THREE.Mesh(kit.track(mergeParts(bag.solid)), solidMat);
    body.castShadow = kit.shadows;
    g.add(body);
    if (bag.canopy.length > 0) {
      const canopy = new THREE.Mesh(kit.track(mergeParts(bag.canopy)), canopyMat);
      canopy.castShadow = kit.shadows;
      g.add(canopy);
    }
    for (const coal of bag.coals) {
      const glow = new THREE.Mesh(boxGeo, coalsMat);
      glow.scale.set(...coal.size);
      glow.position.set(...coal.at);
      g.add(glow);
    }
    const cover = new THREE.Mesh(boxGeo, tarpMat);
    cover.scale.set(...TARP_SIZE);
    cover.position.set(0, TARP_SIZE[1] / 2, 0);
    cover.userData.cover = true;
    cover.visible = false;
    g.add(cover);
    g.position.set(s.x / M, 0, s.y / M);
    g.rotation.y = Math.atan2(Math.cos(s.face), Math.sin(s.face));
    group.add(g);
  });
  return group;
}
