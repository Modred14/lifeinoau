import * as THREE from "three";
import { boxAt, mergeParts, yawOf } from "./kit";

export interface CrowdSeat {
  x: number;
  y: number;
  floor: number;
  face: number;
  seatH: number;
  spot: number;
}

export interface CrowdStander {
  x: number;
  y: number;
  floor: number;
  face: number;
}

export const CROWD_LIMIT = 260;
const STANDER_LIMIT = 40;
const CLOTHES = [0xc62828, 0x1565c0, 0x2e7d32, 0xf9a825, 0x6a1b9a, 0xeeeeee, 0x212121, 0xef6c00, 0x00838f, 0xad1457];
const SKIN = [0x5a3825, 0x6f4630, 0x8a5a3c, 0x4a2c1c, 0x7a4e36];
const BOB_HEIGHT = 0.05;
const BOB_EVERY = 0.1;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seatedBody = () => mergeParts([boxAt(0.36, 0.5, 0.2, 0, 0, -0.04), boxAt(0.34, 0.14, 0.42, 0, -0.08, 0.2), boxAt(0.3, 0.4, 0.12, 0, -0.45, 0.4)]);
const standingBody = () => mergeParts([boxAt(0.38, 0.6, 0.22, 0, 0.8, 0), boxAt(0.32, 0.8, 0.18, 0, 0, 0)]);

interface Pack {
  body: THREE.InstancedMesh;
  head: THREE.InstancedMesh;
}

export class Crowd {
  private seated: Pack;
  private standing: Pack;
  private order: number[];
  private phases: Float32Array;
  private shown: number[] = [];
  private key = "";
  private clock = 0;
  private sinceBob = 0;
  private lively = false;
  private matrix = new THREE.Matrix4();
  private disposables: { dispose(): void }[] = [];

  constructor(private group: THREE.Group, private seats: readonly CrowdSeat[], private standers: readonly CrowdStander[], seed: number) {
    const rand = mulberry(seed);
    this.order = seats.map((_, i) => i);
    for (let i = this.order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [this.order[i], this.order[j]] = [this.order[j], this.order[i]];
    }
    this.phases = Float32Array.from({ length: Math.max(seats.length, standers.length, 1) }, () => rand() * Math.PI * 2);
    this.seated = this.pack(seatedBody(), 0.52, Math.min(CROWD_LIMIT, seats.length), rand);
    this.standing = this.pack(standingBody(), 1.42, Math.min(STANDER_LIMIT, standers.length), rand);
  }

  private pack(bodyGeometry: THREE.BufferGeometry, headY: number, count: number, rand: () => number): Pack {
    const size = Math.max(1, count);
    const make = (geometry: THREE.BufferGeometry, palette: readonly number[]) => {
      const material = new THREE.MeshLambertMaterial({ color: 0xffffff });
      const mesh = new THREE.InstancedMesh(geometry, material, size);
      const tint = new THREE.Color();
      for (let i = 0; i < size; i++) {
        mesh.setMatrixAt(i, HIDDEN);
        mesh.setColorAt(i, tint.set(palette[Math.floor(rand() * palette.length)]));
      }
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(geometry, material, mesh);
      return mesh;
    };
    return { body: make(bodyGeometry, CLOTHES), head: make(boxAt(0.2, 0.22, 0.2, 0, headY, 0), SKIN) };
  }

  get size(): number {
    return this.shown.length;
  }

  set(share: number, taken: ReadonlySet<number>, standShare: number, lively: boolean) {
    const want = Math.min(CROWD_LIMIT, Math.round(this.seats.length * Math.max(0, Math.min(1, share))));
    const picked: number[] = [];
    for (const index of this.order) {
      if (picked.length >= want) break;
      if (!taken.has(this.seats[index].spot)) picked.push(index);
    }
    const stand = Math.min(STANDER_LIMIT, Math.round(this.standers.length * Math.max(0, Math.min(1, standShare))));
    const key = `${picked.length}:${stand}:${lively}:${picked.reduce((sum, i) => (sum * 31 + i) | 0, 7)}`;
    if (key === this.key) return;
    this.key = key;
    this.shown = picked;
    this.lively = lively;
    this.seated.body.count = this.seated.head.count = picked.length;
    this.standing.body.count = this.standing.head.count = stand;
    this.place(0);
  }

  private place(bob: number) {
    this.shown.forEach((index, slot) => {
      const s = this.seats[index];
      const lift = this.lively ? Math.max(0, Math.sin(bob * 2.2 + this.phases[index])) * BOB_HEIGHT : 0;
      this.matrix.makeRotationY(yawOf(s.face)).setPosition(s.x, s.floor + s.seatH + lift, s.y);
      this.seated.body.setMatrixAt(slot, this.matrix);
      this.seated.head.setMatrixAt(slot, this.matrix);
    });
    for (let i = 0; i < this.standing.body.count; i++) {
      const s = this.standers[i];
      const lift = Math.abs(Math.sin(bob * 3.1 + this.phases[i])) * BOB_HEIGHT * 2;
      this.matrix.makeRotationY(yawOf(s.face)).setPosition(s.x, s.floor + lift, s.y);
      this.standing.body.setMatrixAt(i, this.matrix);
      this.standing.head.setMatrixAt(i, this.matrix);
    }
    for (const pack of [this.seated, this.standing]) {
      pack.body.instanceMatrix.needsUpdate = true;
      pack.head.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt: number) {
    if (!this.lively && !this.standing.body.count) return;
    this.clock += dt;
    this.sinceBob += dt;
    if (this.sinceBob < BOB_EVERY) return;
    this.sinceBob = 0;
    this.place(this.clock);
  }

  dispose() {
    for (const pack of [this.seated, this.standing]) {
      pack.body.removeFromParent();
      pack.head.removeFromParent();
    }
    this.disposables.forEach((item) => item.dispose());
    this.disposables = [];
  }
}
