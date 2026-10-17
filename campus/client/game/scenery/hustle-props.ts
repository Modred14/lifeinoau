import * as THREE from "three";
import { BUSINESS_CENTRES, HOSTEL_PITCHES, PLACES, PX_PER_METER } from "@campuslife/shared";
import type { StallKit } from "./stalls";

const M = PX_PER_METER;
export const HUSTLE_PROPS_GROUP = "hustle-props";

const TRAY = {
  wood: 0x9a7048,
  leg: 0x6e4d30,
  tray: 0xd8d2c4,
  cards: [0xf2b134, 0xd94f3d, 0x2f8f6b, 0x3d6fd9],
  top: 0.74,
  width: 0.9,
  depth: 0.55,
};
const SIGN = {
  text: "BUSINESS CENTRE",
  sub: "Typing · Printing · Photocopy",
  board: 0x1f3b73,
  face: "#f4f1e6",
  ink: "#1f3b73",
  accent: "#c8322a",
  width: 2.4,
  height: 0.62,
  y: 2.62,
  z: 0.78,
  pixels: [512, 132] as const,
};

function signTexture(): THREE.CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const [w, h] = SIGN.pixels;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  ctx.fillStyle = SIGN.face;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = SIGN.accent;
  ctx.fillRect(0, h - 12, w, 12);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = SIGN.ink;
  ctx.font = "800 54px sans-serif";
  ctx.fillText(SIGN.text, w / 2, h * 0.36, w - 24);
  ctx.font = "600 26px sans-serif";
  ctx.fillText(SIGN.sub, w / 2, h * 0.72, w - 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function buildHustleProps(kit: StallKit): THREE.Group {
  const group = new THREE.Group();
  group.name = HUSTLE_PROPS_GROUP;
  const box = kit.track(new THREE.BoxGeometry(1, 1, 1));
  const plane = kit.track(new THREE.PlaneGeometry(1, 1));
  const mats = new Map<number, THREE.MeshLambertMaterial>();
  const mat = (color: number) => {
    let m = mats.get(color);
    if (!m) mats.set(color, (m = kit.track(new THREE.MeshLambertMaterial({ color }))));
    return m;
  };
  const add = (g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, size: [number, number, number], at: [number, number, number], cast = false) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.scale.set(...size);
    mesh.position.set(...at);
    mesh.castShadow = kit.shadows && cast;
    g.add(mesh);
    return mesh;
  };

  for (const pitch of HOSTEL_PITCHES) {
    const g = new THREE.Group();
    const door = PLACES[pitch.place].door;
    add(g, box, mat(TRAY.wood), [TRAY.width, 0.05, TRAY.depth], [0, TRAY.top, 0], true);
    for (const sx of [-1, 1]) add(g, box, mat(TRAY.leg), [0.05, TRAY.top, TRAY.depth - 0.1], [sx * (TRAY.width / 2 - 0.06), TRAY.top / 2, 0]);
    add(g, box, mat(TRAY.tray), [TRAY.width - 0.16, 0.03, TRAY.depth - 0.14], [0, TRAY.top + 0.04, 0]);
    TRAY.cards.forEach((color, k) => add(g, box, mat(color), [0.13, 0.03 + (k % 2) * 0.02, 0.2], [-0.27 + k * 0.18, TRAY.top + 0.075, 0]));
    g.position.set(pitch.at.x / M, 0, pitch.at.y / M);
    g.rotation.y = Math.atan2(door.x - pitch.at.x, door.y - pitch.at.y);
    group.add(g);
  }

  const texture = signTexture();
  if (texture) kit.track(texture);
  const face = kit.track(new THREE.MeshBasicMaterial(texture ? { map: texture } : { color: SIGN.face }));
  for (const stall of BUSINESS_CENTRES) {
    const g = new THREE.Group();
    add(g, box, mat(SIGN.board), [SIGN.width + 0.1, SIGN.height + 0.1, 0.06], [0, SIGN.y, SIGN.z], true);
    add(g, plane, face, [SIGN.width, SIGN.height, 1], [0, SIGN.y, SIGN.z + 0.035]);
    g.position.set(stall.x / M, 0, stall.y / M);
    g.rotation.y = Math.atan2(Math.cos(stall.face), Math.sin(stall.face));
    group.add(g);
  }
  return group;
}
