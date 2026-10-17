/**
 * Procedural low-poly campus vehicles (no downloads): a white minibus for the
 * Halls Shuttle, a cream coaster bus for the Campus Bus, an okada with its
 * rider and a yellow keke. Front faces +Z, like characters, so
 * rotation.y = yawForVector(heading).
 */
import * as THREE from "three";
import { VEHICLE_SPECS, type LineKind, type VehicleKind } from "@campuslife/shared/transit";
import { uiFontFamily } from "./fonts";

interface Palette {
  body: number;
  band: number;
  roof: number;
}

const PALETTES: Record<LineKind, Palette> = {
  shuttle: { body: 0xf3f3ef, band: 0x1f7a4d, roof: 0xe6e6e1 },
  bus: { body: 0xefe2bf, band: 0x2a5f8f, roof: 0xe7dcc0 },
};

export type Livery = "campus" | "town";
const TOWN_PALETTE: Palette = { body: 0xf2c230, band: 0x1c1d20, roof: 0xe9b92a };
const BICYCLE_COLORS = { frames: [0x1f6fb5, 0xb3202a, 0x2f8f6b, 0x30333a], tyre: 0x1b1b1d, shirts: [0xe8e2d0, 0x3d5a9a, 0xc2542d, 0x5b7f6a], shorts: 0x2b3340, skin: 0x6b4226, bag: 0x7a4a2a };
const BICYCLE = { wheel: 0.33, wheelbase: 1.06, tube: 0.045, saddle: 0.92, bars: 1.02 };
let bicyclesBuilt = 0;

const shared = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = shared.get(key);
  if (!m) shared.set(key, (m = make()));
  return m;
}

const OKADA_COLORS = { tank: 0xb3202a, frame: 0x1c1d20, seat: 0x15161a, shirt: 0x2f6f4f, vest: 0xf2b21c, trousers: 0x2b3340, helmet: 0xd9d4c7, skin: 0x6b4226, passenger: 0x3d5a9a };
const KEKE_COLORS = { body: 0xf5c518, canopy: 0x1c1d20, stripe: 0x16181b, seat: 0x3a3028, shirt: 0x8a5a2b, skin: 0x6b4226, passenger: 0x5b7f6a };

const lambert = (key: string, color: number) => mat(key, () => new THREE.MeshLambertMaterial({ color }));

function addBox(g: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, shadows: boolean) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadows;
  g.add(mesh);
  return mesh;
}

function addWheel(g: THREE.Object3D, radius: number, width: number, x: number, z: number) {
  const tyreGeo = new THREE.CylinderGeometry(radius, radius, width, 14);
  tyreGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.02, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const tyre = new THREE.Mesh(tyreGeo, lambert("tyre", 0x1b1b1d));
  const hub = new THREE.Mesh(hubGeo, lambert("rim", 0xb8bcc2));
  tyre.position.set(x, radius, z);
  hub.position.copy(tyre.position);
  g.add(tyre, hub);
}

function seatedFigure(shirt: THREE.Material, legs: THREE.Material, skin: THREE.Material, shadows: boolean, helmet?: THREE.Material): THREE.Group {
  const f = new THREE.Group();
  addBox(f, shirt, 0.4, 0.52, 0.24, 0, 0.3, 0, shadows);
  addBox(f, legs, 0.14, 0.14, 0.42, -0.13, 0.02, 0.2, shadows);
  addBox(f, legs, 0.14, 0.14, 0.42, 0.13, 0.02, 0.2, shadows);
  addBox(f, legs, 0.13, 0.4, 0.13, -0.13, -0.2, 0.36, shadows);
  addBox(f, legs, 0.13, 0.4, 0.13, 0.13, -0.2, 0.36, shadows);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
  head.position.set(0, 0.7, 0.02);
  f.add(head);
  if (helmet) {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.155, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), helmet);
    shell.position.set(0, 0.72, 0.01);
    f.add(shell);
  }
  return f;
}

function addTube(g: THREE.Object3D, m: THREE.Material, y0: number, z0: number, y1: number, z1: number, thick: number, shadows: boolean) {
  const len = Math.hypot(y1 - y0, z1 - z0);
  const mesh = addBox(g, m, thick, thick, len, 0, (y0 + y1) / 2, (z0 + z1) / 2, shadows);
  mesh.rotation.x = -Math.atan2(y1 - y0, z1 - z0);
  return mesh;
}

function makeBicycle(shadows: boolean): THREE.Group {
  const g = new THREE.Group();
  const c = BICYCLE_COLORS;
  const b = BICYCLE;
  const n = bicyclesBuilt++;
  const frame = lambert(`bicycle-frame-${n % c.frames.length}`, c.frames[n % c.frames.length]);
  const shirt = lambert(`bicycle-shirt-${n % c.shirts.length}`, c.shirts[n % c.shirts.length]);
  const shorts = lambert("bicycle-shorts", c.shorts);
  const skin = lambert("bicycle-skin", c.skin);
  const dark = lambert("bicycle-dark", c.tyre);
  const front = b.wheelbase / 2;
  const rear = -b.wheelbase / 2;
  for (const z of [front, rear]) {
    const rim = new THREE.TorusGeometry(b.wheel - 0.03, 0.03, 6, 16);
    rim.rotateY(Math.PI / 2);
    const wheel = new THREE.Mesh(rim, dark);
    wheel.position.set(0, b.wheel, z);
    wheel.castShadow = shadows;
    g.add(wheel);
    addBox(g, lambert("rim", 0xb8bcc2), 0.02, b.wheel * 1.7, 0.02, 0, b.wheel, z, false);
    addBox(g, lambert("rim", 0xb8bcc2), 0.02, 0.02, b.wheel * 1.7, 0, b.wheel, z, false);
  }
  const crank = { y: b.wheel - 0.02, z: -0.08 };
  const seatTop = { y: b.saddle - 0.06, z: -0.28 };
  const headTop = { y: b.bars - 0.14, z: front - 0.2 };
  addTube(g, frame, crank.y, crank.z, seatTop.y, seatTop.z, b.tube, shadows);
  addTube(g, frame, seatTop.y - 0.06, seatTop.z, headTop.y, headTop.z, b.tube, shadows);
  addTube(g, frame, crank.y, crank.z, headTop.y - 0.1, headTop.z, b.tube, shadows);
  addTube(g, frame, crank.y, crank.z, b.wheel, rear, b.tube * 0.8, shadows);
  addTube(g, frame, seatTop.y - 0.08, seatTop.z, b.wheel, rear, b.tube * 0.8, shadows);
  addTube(g, frame, b.wheel, front, b.bars, front - 0.24, b.tube, shadows);
  addBox(g, dark, 0.5, 0.035, 0.035, 0, b.bars, front - 0.24, shadows);
  addBox(g, dark, 0.12, 0.05, 0.26, 0, b.saddle, seatTop.z, shadows);
  addBox(g, dark, 0.3, 0.03, 0.03, 0, crank.y, crank.z, false);

  const rider = new THREE.Group();
  const torso = addBox(rider, shirt, 0.38, 0.52, 0.22, 0, b.saddle + 0.3, -0.08, shadows);
  torso.rotation.x = 0.42;
  addBox(rider, lambert("bicycle-bag", c.bag), 0.3, 0.34, 0.14, 0, b.saddle + 0.32, -0.26, shadows).rotation.x = 0.42;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
  head.position.set(0, b.saddle + 0.68, 0.12);
  rider.add(head);
  for (const side of [-1, 1]) {
    const down = side < 0;
    const knee = { y: b.saddle - 0.2, z: 0.06 };
    const foot = { y: down ? crank.y - 0.14 : crank.y + 0.12, z: down ? crank.z + 0.02 : crank.z + 0.14 };
    const thigh = addTube(rider, shorts, b.saddle - 0.02, seatTop.z + 0.06, knee.y, knee.z, 0.13, shadows);
    thigh.position.x = side * 0.11;
    const shin = addTube(rider, skin, knee.y, knee.z, foot.y, foot.z, 0.1, shadows);
    shin.position.x = side * 0.13;
    const arm = addTube(rider, skin, b.saddle + 0.46, 0.04, b.bars + 0.02, front - 0.26, 0.085, shadows);
    arm.position.x = side * 0.2;
  }
  g.add(rider);
  return g;
}

function makeOkada(shadows: boolean): THREE.Group {
  const g = new THREE.Group();
  const c = OKADA_COLORS;
  const frame = lambert("okada-frame", c.frame);
  const tank = lambert("okada-tank", c.tank);
  const skin = lambert("okada-skin", c.skin);
  const trousers = lambert("okada-trousers", c.trousers);
  const chrome = lambert("rim", 0xb8bcc2);
  addWheel(g, 0.3, 0.11, 0, 0.68);
  addWheel(g, 0.3, 0.13, 0, -0.66);
  addBox(g, frame, 0.16, 0.2, 1.05, 0, 0.5, -0.02, shadows);
  addBox(g, frame, 0.24, 0.26, 0.34, 0, 0.42, 0.02, shadows);
  addBox(g, tank, 0.3, 0.22, 0.46, 0, 0.74, 0.2, shadows);
  addBox(g, lambert("okada-seat", c.seat), 0.28, 0.1, 0.78, 0, 0.74, -0.42, shadows);
  addBox(g, tank, 0.2, 0.05, 0.44, 0, 0.64, 0.7, shadows);
  addBox(g, tank, 0.22, 0.05, 0.4, 0, 0.66, -0.72, shadows);
  const fork = addBox(g, chrome, 0.06, 0.62, 0.06, 0, 0.62, 0.58, shadows);
  fork.rotation.x = -0.38;
  addBox(g, frame, 0.62, 0.05, 0.05, 0, 0.98, 0.44, shadows);
  addBox(g, mat("headlight", () => new THREE.MeshBasicMaterial({ color: 0xfff6d8 })), 0.16, 0.14, 0.06, 0, 0.84, 0.6, shadows);
  addBox(g, mat("taillight", () => new THREE.MeshBasicMaterial({ color: 0xc81e1e })), 0.12, 0.08, 0.04, 0, 0.7, -0.93, shadows);
  addBox(g, chrome, 0.07, 0.07, 0.6, 0.16, 0.34, -0.5, shadows);
  addBox(g, lambert("okada-plate", 0xf4f2df), 0.2, 0.12, 0.02, 0, 0.56, -0.95, shadows);
  const rider = seatedFigure(lambert("okada-vest", c.vest), trousers, skin, shadows, lambert("okada-helmet", c.helmet));
  rider.position.set(0, 0.86, -0.18);
  rider.rotation.x = 0.16;
  addBox(rider, lambert("okada-shirt", c.shirt), 0.1, 0.1, 0.46, -0.24, 0.4, 0.26, shadows);
  addBox(rider, lambert("okada-shirt", c.shirt), 0.1, 0.1, 0.46, 0.24, 0.4, 0.26, shadows);
  g.add(rider);
  const passenger = seatedFigure(lambert("okada-passenger", c.passenger), trousers, skin, shadows);
  passenger.position.set(0, 0.86, -0.56);
  passenger.visible = false;
  g.add(passenger);
  g.userData.passengers = [passenger];
  return g;
}

function makeKeke(shadows: boolean): THREE.Group {
  const g = new THREE.Group();
  const [L, Wd, H] = VEHICLE_SPECS.keke.size;
  const c = KEKE_COLORS;
  const body = lambert("keke-body", c.body);
  const canopy = lambert("keke-canopy", c.canopy);
  const stripe = lambert("keke-stripe", c.stripe);
  const seat = lambert("keke-seat", c.seat);
  const skin = lambert("keke-skin", c.skin);
  const legs = lambert("okada-trousers", OKADA_COLORS.trousers);
  const glass = mat("glass", () => new THREE.MeshLambertMaterial({ color: 0x1d2a35, emissive: 0x0b1218 }));
  const ground = 0.26;
  addWheel(g, 0.22, 0.12, 0, L / 2 - 0.3);
  addWheel(g, 0.22, 0.13, -(Wd / 2 - 0.08), -L / 2 + 0.42);
  addWheel(g, 0.22, 0.13, Wd / 2 - 0.08, -L / 2 + 0.42);
  addBox(g, body, Wd, 0.16, L * 0.86, 0, ground + 0.08, -0.12, shadows);
  addBox(g, body, Wd, 0.62, L * 0.34, 0, ground + 0.47, -L / 2 + L * 0.17 + 0.02, shadows);
  addBox(g, stripe, Wd + 0.02, 0.08, L * 0.34 + 0.02, 0, ground + 0.5, -L / 2 + L * 0.17 + 0.02, shadows);
  for (const side of [-1, 1]) addBox(g, body, 0.05, 0.42, L * 0.5, side * (Wd / 2 - 0.025), ground + 0.37, 0.12, shadows);
  const nose = addBox(g, body, Wd * 0.62, 0.6, 0.46, 0, ground + 0.46, L / 2 - 0.3, shadows);
  nose.rotation.x = -0.2;
  addBox(g, body, Wd * 0.5, 0.08, 0.34, 0, ground + 0.32, L / 2 - 0.2, shadows);
  const screen = addBox(g, glass, Wd * 0.78, 0.62, 0.04, 0, ground + 1.02, L / 2 - 0.56, shadows);
  screen.rotation.x = -0.22;
  for (const side of [-1, 1]) {
    addBox(g, canopy, 0.05, H - ground - 0.5, 0.05, side * (Wd / 2 - 0.04), (H + ground + 0.42) / 2, L / 2 - 0.66, shadows);
    addBox(g, canopy, 0.05, H - ground - 0.62, 0.05, side * (Wd / 2 - 0.04), (H + ground + 0.62) / 2, -L / 2 + 0.06, shadows);
  }
  addBox(g, canopy, Wd + 0.04, 0.09, L * 0.8, 0, H, -0.2, shadows);
  addBox(g, canopy, Wd, 0.5, 0.04, 0, H - 0.3, -L / 2 + 0.04, shadows);
  addBox(g, seat, Wd * 0.4, 0.12, 0.34, 0, ground + 0.34, 0.3, shadows);
  addBox(g, seat, Wd * 0.92, 0.12, 0.4, 0, ground + 0.42, -0.52, shadows);
  addBox(g, seat, Wd * 0.92, 0.46, 0.08, 0, ground + 0.7, -0.76, shadows);
  addBox(g, stripe, 0.5, 0.05, 0.05, 0, ground + 0.86, L / 2 - 0.62, shadows);
  addBox(g, mat("headlight", () => new THREE.MeshBasicMaterial({ color: 0xfff6d8 })), 0.18, 0.14, 0.05, 0, ground + 0.6, L / 2 - 0.05, shadows);
  for (const side of [-1, 1]) addBox(g, mat("taillight", () => new THREE.MeshBasicMaterial({ color: 0xc81e1e })), 0.12, 0.14, 0.04, side * (Wd / 2 - 0.12), ground + 0.5, -L / 2 + 0.01, shadows);
  const driver = seatedFigure(lambert("keke-shirt", c.shirt), legs, skin, shadows);
  driver.position.set(0, ground + 0.5, 0.26);
  g.add(driver);
  const passengers = [-1, 0, 1].map((k) => {
    const p = seatedFigure(lambert("keke-passenger", c.passenger), legs, skin, shadows);
    p.scale.setScalar(0.92);
    p.position.set(k * Wd * 0.3, ground + 0.58, -0.56);
    p.visible = false;
    g.add(p);
    return p;
  });
  g.userData.passengers = passengers;
  return g;
}

export function setVehiclePassengers(g: THREE.Group, count: number) {
  const seats: unknown = g.userData.passengers;
  if (!Array.isArray(seats)) return;
  seats.forEach((seat, i) => {
    if (seat instanceof THREE.Object3D) seat.visible = i < count;
  });
}

export function makeVehicle(kind: VehicleKind, lineName: string, shadows: boolean, livery: Livery = "campus"): THREE.Group {
  if (kind === "okada") return makeOkada(shadows);
  if (kind === "keke") return makeKeke(shadows);
  if (kind === "bicycle") return makeBicycle(shadows);
  const [L, Wd, H] = VEHICLE_SPECS[kind].size;
  const pal = livery === "town" ? TOWN_PALETTE : PALETTES[kind];
  const paint = `${kind}-${livery}`;
  const g = new THREE.Group();
  const body = mat(`body-${paint}`, () => new THREE.MeshLambertMaterial({ color: pal.body }));
  const band = mat(`band-${paint}`, () => new THREE.MeshLambertMaterial({ color: pal.band }));
  const glass = mat("glass", () => new THREE.MeshLambertMaterial({ color: 0x1d2a35, emissive: 0x0b1218 }));
  const tyre = mat("tyre", () => new THREE.MeshLambertMaterial({ color: 0x1b1b1d }));
  const rim = mat("rim", () => new THREE.MeshLambertMaterial({ color: 0xb8bcc2 }));
  const head = mat("headlight", () => new THREE.MeshBasicMaterial({ color: 0xfff6d8 }));
  const tail = mat("taillight", () => new THREE.MeshBasicMaterial({ color: 0xc81e1e }));
  const dark = mat("trim", () => new THREE.MeshLambertMaterial({ color: 0x2a2b2e }));

  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = shadows;
    g.add(mesh);
    return mesh;
  };

  const ground = 0.32;
  const bodyH = H - ground;
  // Lower body + upper body (slightly narrower), bumper, roof.
  box(Wd, bodyH * 0.5, L, body, 0, ground + bodyH * 0.25, 0);
  box(Wd * 0.98, bodyH * 0.5, L * (kind === "shuttle" ? 0.86 : 0.97), body, 0, ground + bodyH * 0.75, kind === "shuttle" ? -L * 0.07 : 0);
  box(Wd + 0.02, 0.22, L + 0.02, band, 0, ground + bodyH * 0.47, 0);
  box(Wd * 0.94, 0.08, L * 0.9, mat(`roof-${paint}`, () => new THREE.MeshLambertMaterial({ color: pal.roof })), 0, H + 0.02, -0.05);
  box(Wd + 0.04, 0.22, 0.14, dark, 0, ground + 0.12, L / 2 + 0.02);
  box(Wd + 0.04, 0.22, 0.14, dark, 0, ground + 0.12, -L / 2 - 0.02);

  // Windows: side strips + windscreen + rear window.
  const winY = ground + bodyH * 0.74;
  const winH = bodyH * 0.34;
  const sideLen = L * (kind === "shuttle" ? 0.72 : 0.86);
  for (const side of [-1, 1]) box(0.04, winH, sideLen, glass, side * (Wd / 2 + 0.005), winY, kind === "shuttle" ? -L * 0.1 : -0.15);
  if (kind === "shuttle") {
    // Sloped bonnet + windscreen of a minibus.
    const screen = box(Wd * 0.94, winH * 1.1, 0.06, glass, 0, winY - 0.05, L * 0.37);
    screen.rotation.x = -0.35;
    box(Wd * 0.98, 0.25, L * 0.14, body, 0, ground + bodyH * 0.52, L * 0.43);
  } else {
    box(Wd * 0.92, winH * 1.15, 0.05, glass, 0, winY, L / 2 + 0.005);
  }
  box(Wd * 0.8, winH * 0.8, 0.05, glass, 0, winY, -L / 2 - 0.005);

  // Lights.
  for (const side of [-1, 1]) {
    box(0.32, 0.14, 0.04, head, side * (Wd / 2 - 0.3), ground + 0.45, L / 2 + 0.03);
    box(0.18, 0.28, 0.04, tail, side * (Wd / 2 - 0.2), ground + 0.55, -L / 2 - 0.03);
  }

  // Wheels.
  const wheelR = kind === "bus" ? 0.42 : 0.34;
  const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.26, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.28, 8);
  hubGeo.rotateZ(Math.PI / 2);
  const axles = kind === "bus" ? [L * 0.33, -L * 0.3] : [L * 0.32, -L * 0.3];
  for (const z of axles)
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, tyre);
      w.position.set(side * (Wd / 2 - 0.12), wheelR, z);
      const hub = new THREE.Mesh(hubGeo, rim);
      hub.position.copy(w.position);
      g.add(w, hub);
    }

  // Route boards on both sides (canvas text).
  const board = routeBoard(lineName, pal.band);
  for (const side of [-1, 1]) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(3.4, L * 0.55), 0.42), board);
    plane.position.set(side * (Wd / 2 + 0.02), ground + bodyH * 0.25, 0);
    plane.rotation.y = side * (Math.PI / 2);
    g.add(plane);
  }
  return g;
}

function routeBoard(text: string, color: number): THREE.Material {
  return mat(`board-${text}`, () => {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
    g.fillRect(0, 0, 512, 64);
    g.fillStyle = "#ffffff";
    g.font = `800 38px ${uiFontFamily()}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text.toUpperCase(), 256, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: tex });
  });
}

/** Free per-vehicle geometry (materials are shared between vehicles and kept). */
export function disposeVehicle(g: THREE.Group) {
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  g.removeFromParent();
}
