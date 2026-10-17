import * as THREE from "three";
import { SEATS, SPOTS, type Interior } from "@campuslife/shared/interiors";
import { toWorld, yawForVector } from "../coords";
import { mergeParts } from "./kit";

const SHIRTS = [0xf4f1ea, 0x2f5d8a, 0x8a2f3b, 0x2f7d5b, 0xd9a441, 0x4a4a52, 0xb05a8c, 0x6fa8dc];
const TROUSERS = 0x24303f;
const SKIN = 0x7a4a2d;
const HAIR = 0x1b1512;
const PAPER = 0xf4efe0;
const HEAD_RADIUS = 0.105;
const HEAD_HEIGHT = 0.58;
const HEAD_FORWARD = 0.06;
const WHITE = 0xffffff;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function seededRandom(text: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < text.length; i++) s = Math.imul(s ^ text.charCodeAt(i), 16777619);
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function tinted(geometry: THREE.BufferGeometry, color: number): THREE.BufferGeometry {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const count = flat.getAttribute("position").count;
  const tint = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3);
  flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return flat;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

function readerGeometry(): THREE.BufferGeometry {
  return mergeParts([
    tinted(box(0.36, 0.44, 0.2, 0, 0.24, 0), WHITE),
    tinted(box(0.08, 0.08, 0.3, -0.2, 0.26, 0.16), WHITE),
    tinted(box(0.08, 0.08, 0.3, 0.2, 0.26, 0.16), WHITE),
    tinted(box(0.32, 0.12, 0.4, 0, 0.06, 0.2), TROUSERS),
    tinted(box(0.3, 0.42, 0.12, 0, -0.21, 0.4), TROUSERS),
    tinted(new THREE.SphereGeometry(HEAD_RADIUS, 8, 6).translate(0, HEAD_HEIGHT, HEAD_FORWARD), SKIN),
    tinted(new THREE.SphereGeometry(HEAD_RADIUS * 1.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, HEAD_HEIGHT + 0.012, HEAD_FORWARD - 0.012), HAIR),
    tinted(box(0.3, 0.02, 0.22, 0, 0.2, 0.36), PAPER),
  ]);
}

export function pickReaderSeats(it: Interior, key: string, count: number): number[] {
  const seats: number[] = [];
  for (let i = it.spotStart; i < it.spotEnd; i++) if (SPOTS[i].kind === "study" && SPOTS[i].seat) seats.push(i);
  const rand = seededRandom(`${key}:${it.place}`);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  return seats.slice(0, Math.max(0, Math.min(count, seats.length)));
}

export class NightReaders {
  private scene?: THREE.Scene;
  private it?: Interior;
  private mesh?: THREE.InstancedMesh;
  private seats: number[] = [];
  private matrices: THREE.Matrix4[] = [];
  private hidden: boolean[] = [];
  private key = "";

  enter(it: Interior, scene: THREE.Scene) {
    this.leave();
    this.it = it;
    this.scene = scene;
  }

  leave() {
    this.clear();
    this.it = undefined;
    this.scene = undefined;
  }

  refresh(key: string, count: number, taken: Iterable<number>) {
    if (!this.it || !this.scene) return;
    const want = count > 0 ? key : "";
    if (want !== this.key) {
      this.clear();
      this.key = want;
      if (want) this.build(this.it, this.scene, want, count);
    }
    if (!this.mesh) return;
    const busy = new Set(taken);
    let changed = false;
    this.seats.forEach((seat, i) => {
      const hide = busy.has(seat);
      if (hide === this.hidden[i]) return;
      this.hidden[i] = hide;
      changed = true;
      this.mesh?.setMatrixAt(i, hide ? HIDDEN : this.matrices[i]);
    });
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  private build(it: Interior, scene: THREE.Scene, key: string, count: number) {
    this.seats = pickReaderSeats(it, key, count);
    if (!this.seats.length) return;
    const rand = seededRandom(`look:${key}`);
    const mesh = new THREE.InstancedMesh(readerGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), this.seats.length);
    const tint = new THREE.Color();
    this.matrices = this.seats.map((index, i) => {
      const spot = SPOTS[index];
      const y = (spot.floor ?? 0) + SEATS[spot.seat ?? "chair"].h;
      const matrix = new THREE.Matrix4().makeRotationY(yawForVector(Math.cos(spot.face), Math.sin(spot.face))).setPosition(toWorld(spot.x), y, toWorld(spot.y));
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tint.set(SHIRTS[Math.floor(rand() * SHIRTS.length)]));
      return matrix;
    });
    this.hidden = this.seats.map(() => false);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    scene.add(mesh);
    this.mesh = mesh;
  }

  private clear() {
    if (this.mesh) {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh.dispose();
    }
    this.mesh = undefined;
    this.seats = [];
    this.matrices = [];
    this.hidden = [];
    this.key = "";
  }
}
