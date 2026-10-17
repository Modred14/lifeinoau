import * as THREE from "three";
import { SEATS, SPOTS, type Interior } from "@campuslife/shared/interiors";
import { toWorld, yawForVector } from "../coords";
import { mergeParts } from "./kit";

export interface VenueSession {
  key: string;
  lecturerIn: boolean;
}

export interface SeatHolder {
  state: { spot: number };
}

const MAX_CLASSMATES = 90;
const MIN_SHARE = 0.25;
const MAX_SHARE = 0.6;
const SHIRTS = [0xf4f1ea, 0x2f5d8a, 0x8a2f3b, 0x2f7d5b, 0xd9a441, 0x4a4a52, 0xb05a8c, 0x6fa8dc];
const TROUSERS = [0x1f2937, 0x3b3f4a, 0x24344d, 0x5a4632];
const SKINS = [0x8d5a3b, 0x6f4429, 0x5a3620, 0xa56a43];
const HAIR = 0x1b1512;
const HEAD_RADIUS = 0.105;
const HEAD_HEIGHT = 0.62;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const SPOT_HASH = 2654435761;
const NO_HOLDERS = 0;

function seededRandom(text: string): () => number {
  let s = 2166136261;
  for (let i = 0; i < text.length; i++) s = Math.imul(s ^ text.charCodeAt(i), 16777619);
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

function shirtGeometry(): THREE.BufferGeometry {
  return mergeParts([box(0.36, 0.46, 0.2, 0, 0.25, -0.02), box(0.08, 0.08, 0.3, -0.2, 0.3, 0.14), box(0.08, 0.08, 0.3, 0.2, 0.3, 0.14)]);
}

function legGeometry(): THREE.BufferGeometry {
  return mergeParts([box(0.32, 0.12, 0.4, 0, 0.06, 0.2), box(0.3, 0.42, 0.12, 0, -0.21, 0.4)]);
}

function headGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(HEAD_RADIUS, 8, 6).translate(0, HEAD_HEIGHT, 0);
}

function hairGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(HEAD_RADIUS * 1.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, HEAD_HEIGHT + 0.012, -0.012);
}

interface Crowd {
  group: THREE.Group;
  meshes: THREE.InstancedMesh[];
  seats: number[];
  matrices: THREE.Matrix4[];
  hidden: boolean[];
}

function seatsOf(it: Interior): number[] {
  const seats: number[] = [];
  for (let i = it.spotStart; i < it.spotEnd; i++) if (SPOTS[i].kind === "study" && SPOTS[i].seat) seats.push(i);
  return seats;
}

export function pickClassmateSeats(it: Interior, key: string): number[] {
  const rand = seededRandom(`${key}:${it.place}`);
  const seats = seatsOf(it);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  const share = MIN_SHARE + rand() * (MAX_SHARE - MIN_SHARE);
  return seats.slice(0, Math.min(MAX_CLASSMATES, Math.round(seats.length * share)));
}

function buildCrowd(it: Interior, key: string): Crowd {
  const seats = pickClassmateSeats(it, key);
  const rand = seededRandom(`look:${key}`);
  const group = new THREE.Group();
  const parts: [THREE.BufferGeometry, readonly number[]][] = [
    [shirtGeometry(), SHIRTS],
    [legGeometry(), TROUSERS],
    [headGeometry(), SKINS],
    [hairGeometry(), [HAIR]],
  ];
  const matrices = seats.map((index) => {
    const spot = SPOTS[index];
    const y = (spot.floor ?? 0) + SEATS[spot.seat ?? "chair"].h;
    const yaw = yawForVector(Math.cos(spot.face), Math.sin(spot.face));
    return new THREE.Matrix4().makeRotationY(yaw).setPosition(toWorld(spot.x), y, toWorld(spot.y));
  });
  const tint = new THREE.Color();
  const meshes = parts.map(([geometry, palette]) => {
    const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshLambertMaterial(), Math.max(1, seats.length));
    mesh.count = seats.length;
    matrices.forEach((matrix, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tint.set(palette[Math.floor(rand() * palette.length)]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    return mesh;
  });
  return { group, meshes, seats, matrices, hidden: seats.map(() => false) };
}

function disposeCrowd(crowd: Crowd) {
  crowd.group.removeFromParent();
  for (const mesh of crowd.meshes) {
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  }
}

export class ClassScene {
  private it?: Interior;
  private scene?: THREE.Scene;
  private crowd?: Crowd;
  private key = "";
  private holders = NO_HOLDERS;

  enter(it: Interior, scene: THREE.Scene) {
    this.leave();
    this.it = it;
    this.scene = scene;
  }

  leave() {
    if (this.crowd) disposeCrowd(this.crowd);
    this.crowd = undefined;
    this.it = undefined;
    this.scene = undefined;
    this.key = "";
    this.holders = NO_HOLDERS;
  }

  retake(players: Iterable<SeatHolder>) {
    const it = this.it;
    const crowd = this.crowd;
    if (!it || !crowd) return;
    let holders = NO_HOLDERS;
    for (const player of players) {
      const spot = player.state.spot - 1;
      if (spot >= it.spotStart && spot < it.spotEnd) holders = (holders + Math.imul(spot + 1, SPOT_HASH)) >>> 0;
    }
    if (holders === this.holders) return;
    this.holders = holders;
    const taken = new Set<number>();
    for (const player of players) taken.add(player.state.spot - 1);
    this.hideTaken(crowd, taken);
  }

  refresh(session: VenueSession | undefined, taken: Iterable<number>, lecturer?: THREE.Object3D) {
    const it = this.it;
    if (!it || !this.scene) return;
    if (lecturer && it.template.id === "lecture") lecturer.visible = session ? session.lecturerIn : true;
    const key = session?.key ?? "";
    if (key !== this.key) {
      if (this.crowd) disposeCrowd(this.crowd);
      this.crowd = key ? buildCrowd(it, key) : undefined;
      if (this.crowd) this.scene.add(this.crowd.group);
      this.key = key;
      this.holders = NO_HOLDERS;
    }
    if (this.crowd) this.hideTaken(this.crowd, new Set(taken));
  }

  private hideTaken(crowd: Crowd, taken: ReadonlySet<number>) {
    let changed = false;
    crowd.seats.forEach((seat, i) => {
      const hide = taken.has(seat);
      if (hide === crowd.hidden[i]) return;
      crowd.hidden[i] = hide;
      changed = true;
      for (const mesh of crowd.meshes) mesh.setMatrixAt(i, hide ? HIDDEN : crowd.matrices[i]);
    });
    if (changed) for (const mesh of crowd.meshes) mesh.instanceMatrix.needsUpdate = true;
  }
}
