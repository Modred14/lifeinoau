// lib3d/campuslife/props/shapes.js
// What each prop is made of. Ported from campus/client/game/scenery/stalls.ts, hustle-props.ts, banner-mesh.ts and the Main Gate of world.ts (commit c2b9477). Type annotations removed.
// A "bag" collects the parts of one object: solid (one-sided), canopy (seen from both sides), coals (always bright). Parts are what scenery/kit.js mergeParts takes, in METRES.
import * as THREE from "three";
import { BANNER_SIZES, FLAG_COLORS } from "../banners.js";

const WOOD = 0x9a7048, DARK_WOOD = 0x6e4d30, STEEL = 0x8a9096;
const UMBRELLAS = [0xd94f3d, 0xf2b134, 0x2f8f6b, 0x3d6fd9], KIOSKS = [0x2f6fb5, 0x2f8f6b, 0xd9a520, 0xb5462f], CANOPIES = [...UMBRELLAS, ...KIOSKS];
const GOODS = [[0xf28c1c, 0xf2a01c, 0xe8c63a, 0x7fae3a], [0xe8c24a, 0xd9a520, 0x5b3a66], [0xc98a3c, 0xb8752e, 0xd9a05a], [0xc8322a, 0xf28c1c, 0x7a1f3a, 0x2f8f6b], [0xb8752e, 0xe6d3a8, 0xc98a3c], [0xb98a5a, 0xf4ecd6, 0xa0703c], [0x8fae4a, 0xa9b85a, 0x6f8f3a], [0xd94f3d, 0x3d6fd9, 0xf2b134, 0x2f8f6b]];

const unit = {
  box: () => new THREE.BoxGeometry(1, 1, 1), ball: () => new THREE.IcosahedronGeometry(0.5, 0), tube: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: () => new THREE.ConeGeometry(1, 1, 8, 1, true), drum: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 1, false, 0, Math.PI),
};
export const newBag = () => ({ solid: [], canopy: [], coals: [] });
const add = (g, shape, color, scale, at, rot) => g.solid.push({ geo: unit[shape](), color, scale, at, rot });
const shade = (g, shape, canopy, scale, at, rot) => g.canopy.push({ geo: unit[shape](), color: CANOPIES[canopy], scale, at, rot });
const parasol = (g, i, x, z, radius = 1.6) => { add(g, "tube", STEEL, [0.07, 2.6, 0.07], [x, 1.3, z]); shade(g, "cone", i % UMBRELLAS.length, [radius, 0.7, radius], [x, 2.75, z]); };
const heap = (g, colors, cx, y, cz, w, d, size, n) => {
  const cols = Math.max(1, Math.round(Math.sqrt((n * w) / d))), rows = Math.ceil(n / cols);
  for (let k = 0; k < n; k++) { const col = k % cols, row = Math.floor(k / cols); add(g, "ball", colors[(col + row) % colors.length], [size, size, size], [cx + ((col + 0.5) / cols - 0.5) * w, y + size / 2, cz + ((row + 0.5) / rows - 0.5) * d]); }
};
const table = (g, w, d, top = 0.78) => { add(g, "box", WOOD, [w, 0.07, d], [0, top, 0]); for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, "box", DARK_WOOD, [0.07, top, 0.07], [sx * (w / 2 - 0.08), top / 2, sz * (d / 2 - 0.08)]); };

const STALL = {
  umbrella(g, goods, i) { add(g, "box", WOOD, [2.4, 1, 1.1], [0, 0.5, 0]); parasol(g, i, 0, 0); },
  table(g, goods, i) {
    const colors = GOODS[goods] ?? GOODS[2];
    table(g, 2.2, 0.95);
    for (const x of [-0.7, 0, 0.7]) { add(g, "tube", 0xd8d2c4, [0.52, 0.12, 0.52], [x, 0.87, 0.05]); heap(g, colors, x, 0.9, 0.05, 0.36, 0.36, 0.13, 6); }
    add(g, "box", 0x3d6fd9, [0.42, 0.3, 0.32], [0.75, 0.15, -0.75]);
    if (i % 2 === 0) parasol(g, i, -0.2, -0.55, 1.5);
  },
  barrow(g, goods) {
    const colors = GOODS[goods] ?? GOODS[0];
    add(g, "box", 0x2f6b4f, [0.95, 0.34, 1.3], [0, 0.62, 0]); add(g, "box", 0x275a43, [0.75, 0.1, 1.05], [0, 0.42, 0]);
    add(g, "tube", 0x1b1b1d, [0.5, 0.12, 0.5], [0, 0.25, 0.86], [0, 0, Math.PI / 2]);
    for (const sx of [-1, 1]) { add(g, "box", DARK_WOOD, [0.06, 0.06, 1.1], [sx * 0.42, 0.6, -1.1]); add(g, "box", STEEL, [0.05, 0.5, 0.05], [sx * 0.38, 0.25, -0.5]); }
    if (goods === 6) for (let k = 0; k < 9; k++) add(g, "tube", colors[k % colors.length], [0.07, 1.9, 0.07], [((k % 3) - 1) * 0.22, 0.86 + Math.floor(k / 3) * 0.07, -0.15], [Math.PI / 2 - 0.12, 0, 0]);
    else { heap(g, colors, 0, 0.78, 0, 0.8, 1.1, 0.19, 20); heap(g, colors, 0, 0.94, 0, 0.5, 0.8, 0.19, 8); }
    add(g, "box", DARK_WOOD, [0.4, 0.42, 0.4], [1.0, 0.21, -0.3]);
  },
  grill(g, goods, i) {
    const colors = GOODS[goods] ?? GOODS[1];
    add(g, "drum", 0x2a2b2e, [0.62, 1.15, 0.62], [0, 0.8, 0], [0, Math.PI / 2, Math.PI / 2]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, "box", STEEL, [0.05, 0.8, 0.05], [sx * 0.45, 0.4, sz * 0.22]);
    g.coals.push({ geo: unit.box(), color: 0xff7a2a, scale: [0.95, 0.03, 0.42], at: [0, 0.82, 0] });
    for (let k = 0; k < 5; k++) add(g, "tube", colors[k % 2], [0.09, 0.32, 0.09], [-0.4 + k * 0.2, 0.88, 0], [Math.PI / 2, 0, 0]);
    add(g, "box", WOOD, [0.7, 0.5, 0.5], [0.95, 0.25, 0]);
    heap(g, [colors[2] ?? colors[0]], 0.95, 0.5, 0, 0.5, 0.36, 0.11, 8);
    parasol(g, i + 1, -0.1, -0.6, 1.45);
  },
  cooler(g, goods, i) {
    const colors = GOODS[goods] ?? GOODS[3];
    add(g, "box", 0x2f6fb5, [0.95, 0.62, 0.6], [-0.6, 0.31, 0]); add(g, "box", 0xf4f1e6, [0.98, 0.08, 0.63], [-0.6, 0.66, 0]);
    add(g, "box", 0xc8322a, [0.8, 0.5, 0.55], [0.5, 0.25, 0]); add(g, "box", 0xf4f1e6, [0.83, 0.07, 0.58], [0.5, 0.53, 0]);
    for (let k = 0; k < 8; k++) add(g, "tube", colors[k % colors.length], [0.085, 0.26, 0.085], [0.22 + (k % 4) * 0.18, 0.7, -0.12 + Math.floor(k / 4) * 0.22]);
    for (let k = 0; k < 2; k++) add(g, "box", 0xd9a520, [0.5, 0.3, 0.36], [1.05, 0.15 + k * 0.31, -0.5]);
    parasol(g, i + 2, 0, -0.45, 1.7);
  },
  kiosk(g, goods, i) {
    const colors = GOODS[goods] ?? GOODS[7], paint = KIOSKS[i % KIOSKS.length];
    add(g, "box", paint, [2.3, 0.95, 1.05], [0, 0.475, 0]); add(g, "box", paint, [2.3, 1.25, 0.06], [0, 1.58, -0.5]);
    for (const sx of [-1, 1]) add(g, "box", paint, [0.06, 1.25, 1.05], [sx * 1.12, 1.58, 0]);
    shade(g, "box", UMBRELLAS.length + (i % KIOSKS.length), [2.6, 0.06, 1.5], [0, 2.24, 0.12]);
    shade(g, "box", UMBRELLAS.length + (i % KIOSKS.length), [2.4, 0.05, 0.75], [0, 2.02, 1.02], [0.42, 0, 0]);
    add(g, "box", WOOD, [2.2, 0.05, 0.3], [0, 1.5, -0.3]);
    for (let k = 0; k < 9; k++) add(g, "box", colors[k % colors.length], [0.17, 0.2, 0.14], [-0.9 + k * 0.225, 1.06, 0.3]);
    for (let k = 0; k < 7; k++) add(g, "box", colors[(k + 2) % colors.length], [0.2, 0.24, 0.16], [-0.8 + k * 0.27, 1.65, -0.3]);
  },
};
/** A food stall of look.stalls, in its own frame (facing +z). `i` is its number, which picks its colours. */
export function stallBag([, , , style, goods], i) { const g = newBag(); (STALL[style] ?? STALL.umbrella)(g, goods, i); return g; }

/** A hawker's tray, in its own frame. */
export function trayBag() {
  const g = newBag(), TOP = 0.74, W = 0.9, D = 0.55;
  add(g, "box", WOOD, [W, 0.05, D], [0, TOP, 0]);
  for (const sx of [-1, 1]) add(g, "box", DARK_WOOD, [0.05, TOP, D - 0.1], [sx * (W / 2 - 0.06), TOP / 2, 0]);
  add(g, "box", 0xd8d2c4, [W - 0.16, 0.03, D - 0.14], [0, TOP + 0.04, 0]);
  [0xf2b134, 0xd94f3d, 0x2f8f6b, 0x3d6fd9].forEach((color, k) => add(g, "box", color, [0.13, 0.03 + (k % 2) * 0.02, 0.2], [-0.27 + k * 0.18, TOP + 0.075, 0]));
  return g;
}
/** The board of a business centre's sign, in the stall's frame; the lettering is a plane just in front of it. */
export const SIGN = { width: 2.4, height: 0.62, y: 2.62, z: 0.78 };
export function signBag() { const g = newBag(); add(g, "box", 0x1f3b73, [SIGN.width + 0.1, SIGN.height + 0.1, 0.06], [0, SIGN.y, SIGN.z]); return g; }

const COLOR = { bamboo: 0xb99a5b, pipe: 0x6d7379, rope: 0xd9d2bd, post: 0x5a4632, baize: 0x2f5d46, roof: 0x8a3b2a, steel: 0x3b3f45, inside: 0x4a3a2a, flagPole: 0xc9ccd1 };
const CLOTH = { flexCols: 4, crossCols: 6, crossEdge: 0.8, proud: 0.03, boardGap: 0.06, aframeFoot: 0.26, aframeTop: 0.02, billboardProud: 0.06, flagLength: 1.2, flagDrop: 0.12 };
/**
 * A banner { k, x, z, f, s } in WORLD metres: its frame (bag.solid) and its printed faces, bag.quads = [{ slot, positions, normals, cols }], each `cols` strips of two triangles, ready for a texture.
 */
export function bannerBag(s, i) {
  const bag = newBag(), size = BANNER_SIZES[s.k], hw = size.width / 2, top = size.lift + size.height, ax = -Math.sin(s.f), az = Math.cos(s.f), nx = Math.cos(s.f), nz = Math.sin(s.f), rot = [0, Math.PI / 2 - s.f, 0];
  bag.quads = [];
  const at = (along, up) => [s.x + ax * along, up, s.z + az * along];
  const pole = (along, r, color) => bag.solid.push({ geo: new THREE.CylinderGeometry(r * 0.8, r, size.pole, 5), color, at: at(along, size.pole / 2) });
  const box = (w, h, d, along, up, color) => bag.solid.push({ geo: new THREE.BoxGeometry(w, h, d), color, at: at(along, up), rot });
  const quad = (slot, side, along, half, y0, y1, foot, tip, cols) => {
    const qx = ax * side, qz = az * side, mx = nx * side, mz = nz * side, ox = s.x + ax * along, oz = s.z + az * along, rise = y1 - y0, len = Math.hypot(rise, foot - tip) || 1, normal = [(mx * rise) / len, (foot - tip) / len, (mz * rise) / len], positions = [], normals = [];
    const corner = (t, up) => { const a = half * (1 - 2 * t), out = up ? tip : foot; positions.push(ox + qx * a + mx * out, up ? y1 : y0, oz + qz * a + mz * out); normals.push(...normal); };
    for (let k = 0; k < cols; k++) { const t0 = k / cols, t1 = (k + 1) / cols; corner(t0, false); corner(t1, false); corner(t1, true); corner(t0, false); corner(t1, true); corner(t0, true); }
    bag.quads.push({ slot, positions, normals, cols });
  };
  const both = (half, y0, y1, foot, tip, cols) => { quad(0, 1, 0, half, y0, y1, foot, tip, cols); quad(0, -1, 0, half, y0, y1, foot, tip, cols); };

  if (s.k === "flex") { for (const side of [-1, 1]) pole(side * (hw + 0.04), 0.045, i % 3 ? COLOR.bamboo : COLOR.pipe); both(hw, size.lift, top, 0, 0, CLOTH.flexCols); }
  else if (s.k === "cross") { for (const side of [-1, 1]) pole((side * s.s) / 2, 0.08, COLOR.pipe); for (const y of [size.lift + 0.04, top - 0.04]) box(s.s, 0.025, 0.025, 0, y, COLOR.rope); both(Math.min(size.width, s.s - CLOTH.crossEdge) / 2, size.lift, top, 0, 0, CLOTH.crossCols); }
  else if (s.k === "board") {
    for (const side of [-1, 1]) box(0.09, size.pole, 0.09, side * (hw + 0.05), size.pole / 2, COLOR.post);
    box(size.width, size.height, 0.05, 0, size.lift + size.height / 2, COLOR.baize); box(size.width + 0.5, 0.06, 0.75, 0, size.pole + 0.03, COLOR.roof);
    const rows = Math.ceil(size.slots / size.cols), pw = (size.width - (size.cols + 1) * CLOTH.boardGap) / size.cols, ph = (size.height - (rows + 1) * CLOTH.boardGap) / rows;
    for (let slot = 0; slot < size.slots; slot++) { const col = slot % size.cols, row = Math.floor(slot / size.cols), y1 = top - CLOTH.boardGap - row * (ph + CLOTH.boardGap); quad(slot, 1, hw - CLOTH.boardGap - pw / 2 - col * (pw + CLOTH.boardGap), pw / 2, y1 - ph, y1, CLOTH.proud, CLOTH.proud, 1); }
  } else if (s.k === "aframe") { box(size.width, size.height * 0.9, 0.03, 0, size.lift + size.height * 0.45, COLOR.inside); both(hw, size.lift, top, CLOTH.aframeFoot, CLOTH.aframeTop, 1); }
  else if (s.k === "billboard") { for (const side of [-1, 1]) box(0.28, top, 0.28, side * hw * 0.55, top / 2, COLOR.steel); box(size.width + 0.3, size.height + 0.3, 0.1, 0, size.lift + size.height / 2, COLOR.steel); both(hw, size.lift, top, CLOTH.billboardProud, CLOTH.billboardProud, 1); }
  else { const pitch = size.width / Math.max(1, size.cols - 1); for (let k = 0; k < size.cols; k++) { const along = -hw + k * pitch; pole(along, 0.06, COLOR.flagPole); box(CLOTH.flagLength, size.height, 0.02, along - CLOTH.flagLength / 2 - 0.05, size.pole - CLOTH.flagDrop - size.height / 2, FLAG_COLORS[k % FLAG_COLORS.length]); } }
  return bag;
}

export const GATE_LOOK = { concrete: 0xe8e4da, trim: 0x2f6b4f, house: 0xd8d2c4, beamY: 7.6, sign: [14, 1.2] };
/** A pillar of the Main Gate, or its gatehouse, in its own frame. `size` is the width of a pillar. */
export function pillarBag(p, size) { const g = newBag(), h = p.tall ? 11 : 8.5; add(g, "box", GATE_LOOK.concrete, [size, h, size], [0, h / 2, 0]); add(g, "box", GATE_LOOK.trim, [size + 0.4, 0.4, size + 0.4], [0, h + 0.2, 0]); return g; }
export function gatehouseBag(half) { const g = newBag(); add(g, "box", GATE_LOOK.house, [half * 2, 2.8, half * 2], [0, 1.4, 0]); add(g, "box", GATE_LOOK.trim, [half * 2 + 0.5, 0.18, half * 2 + 0.5], [0, 2.89, 0]); return g; }
/** The closed gate drawn in the wall of a hostel compound, at its door { x, z, nx, nz } (the normal points out). */
export function compoundGateBag(door, height) {
  const g = newBag(), rot = [0, Math.atan2(door.nx, door.nz), 0], ux = door.nz, uz = -door.nx;
  add(g, "box", 0x24513d, [3, height + 0.15, 0.42], [door.x, (height + 0.15) / 2, door.z], rot);
  for (const s of [-1, 1]) add(g, "box", GATE_LOOK.concrete, [0.45, height + 0.5, 0.55], [door.x + ux * s * 1.72, (height + 0.5) / 2, door.z + uz * s * 1.72], rot);
  return g;
}
