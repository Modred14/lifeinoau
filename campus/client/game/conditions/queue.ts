import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONDITION_SITES, clinicOpen, tapsDry, type ConditionSite, type GameTime } from "@campuslife/shared";
import { toWorld } from "../coords";
import { siteYaw } from "./props";

const SHIRTS = [0xf4f1ea, 0x2f5d8a, 0x8a2f3b, 0x2f7d5b, 0xd9a441, 0xb05a8c, 0x6fa8dc, 0xe07b39];
const BUCKETS = [0x2f6fb5, 0xd94f3d, 0x2f8f6b, 0xf2b134, 0x6b6f76];
const TROUSERS = 0x24303f;
const SKIN = 0x7a4a2d;
const HAIR = 0x1b1512;
const WHITE = 0xffffff;
const BUCKET_SIDE = 0.34;
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

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

function personGeometry(): THREE.BufferGeometry {
  const parts = [
    tinted(box(0.36, 0.5, 0.2, 0, 1.12, 0), WHITE),
    tinted(box(0.08, 0.5, 0.1, -0.23, 1.08, 0), WHITE),
    tinted(box(0.08, 0.5, 0.1, 0.23, 1.08, 0), WHITE),
    tinted(box(0.14, 0.86, 0.16, -0.09, 0.43, 0), TROUSERS),
    tinted(box(0.14, 0.86, 0.16, 0.09, 0.43, 0), TROUSERS),
    tinted(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 1.52, 0), SKIN),
    tinted(new THREE.SphereGeometry(0.117, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 1.535, -0.01), HAIR),
  ];
  const merged = mergeGeometries(parts);
  parts.forEach((part) => part.dispose());
  return merged ?? new THREE.BufferGeometry();
}

interface Slot {
  site: ConditionSite;
  order: number;
  person: THREE.Matrix4;
  bucket: THREE.Matrix4;
}

function hash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function queueLength(site: ConditionSite, t: GameTime): number {
  if (!site.queue.length) return 0;
  if (site.kind === "standpipe") return tapsDry(site.place, t) ? 1 + Math.floor(hash(site.id, t.dayIndex) * site.queue.length) : 0;
  if (site.kind === "clinic") return clinicOpen(t) ? Math.floor(hash(site.id, Math.floor(t.total / 90)) * (site.queue.length + 1)) : 0;
  return 0;
}

export interface SiteQueues {
  group: THREE.Group;
  update(t: GameTime): void;
  dispose(): void;
}

export function buildSiteQueues(): SiteQueues {
  const group = new THREE.Group();
  const slots: Slot[] = [];
  for (const site of CONDITION_SITES) {
    const yaw = siteYaw(site) + Math.PI;
    site.queue.forEach((q, order) => {
      const person = new THREE.Matrix4().makeRotationY(yaw).setPosition(toWorld(q.x), 0, toWorld(q.y));
      const side = new THREE.Vector3(BUCKET_SIDE, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const bucket = new THREE.Matrix4().setPosition(toWorld(q.x) + side.x, 0.16, toWorld(q.y) + side.z);
      slots.push({ site, order, person, bucket });
    });
  }
  const count = Math.max(1, slots.length);
  const people = new THREE.InstancedMesh(personGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), count);
  const buckets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.13, 0.3, 10), new THREE.MeshLambertMaterial(), count);
  const tint = new THREE.Color();
  slots.forEach((slot, i) => {
    people.setColorAt(i, tint.set(SHIRTS[Math.floor(hash(i, 3) * SHIRTS.length)]));
    buckets.setColorAt(i, tint.set(BUCKETS[Math.floor(hash(i, 5) * BUCKETS.length)]));
    people.setMatrixAt(i, HIDDEN);
    buckets.setMatrixAt(i, HIDDEN);
  });
  for (const mesh of [people, buckets]) {
    mesh.count = slots.length;
    mesh.frustumCulled = false;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  let key = "";
  return {
    group,
    update(t) {
      const lengths = CONDITION_SITES.map((site) => queueLength(site, t));
      const next = lengths.join(",");
      if (next === key) return;
      key = next;
      slots.forEach((slot, i) => {
        const shown = slot.order < lengths[slot.site.id];
        people.setMatrixAt(i, shown ? slot.person : HIDDEN);
        buckets.setMatrixAt(i, shown && slot.site.kind === "standpipe" ? slot.bucket : HIDDEN);
      });
      people.instanceMatrix.needsUpdate = true;
      buckets.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      group.removeFromParent();
      for (const mesh of [people, buckets]) {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.dispose();
      }
    },
  };
}
