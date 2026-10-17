import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface KitStats {
  triangles: number;
  drawCalls: number;
}

interface Bucket {
  material: () => THREE.Material;
  geometries: THREE.BufferGeometry[];
}

interface Batch {
  geometry: THREE.BufferGeometry;
  material: () => THREE.Material;
  matrices: THREE.Matrix4[];
  colors?: number[];
}

export type LambertExtra = THREE.MeshLambertMaterialParameters;

export class Kit {
  private buckets = new Map<string, Bucket>();
  private batches = new Map<string, Batch>();
  private loose: THREE.Object3D[] = [];
  private disposables: { dispose(): void }[] = [];

  track<T extends { dispose(): void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  add(key: string, material: () => THREE.Material, geometry: THREE.BufferGeometry) {
    let bucket = this.buckets.get(key);
    if (!bucket) this.buckets.set(key, (bucket = { material, geometries: [] }));
    bucket.geometries.push(geometry.index ? geometry.toNonIndexed() : geometry);
  }

  solid(color: number, geometry: THREE.BufferGeometry, extra?: LambertExtra) {
    if (extra) return this.add(`${color}${JSON.stringify(extra)}`, () => new THREE.MeshLambertMaterial({ color, ...extra }), geometry);
    const flat = geometry.index ? geometry.toNonIndexed() : geometry;
    const count = flat.getAttribute("position").count;
    const tint = new THREE.Color(color);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3);
    flat.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.add("plain", () => new THREE.MeshLambertMaterial({ vertexColors: true }), flat);
  }

  box(color: number, w: number, h: number, d: number, x: number, y0: number, z: number, yaw = 0, extra?: LambertExtra) {
    this.solid(color, boxAt(w, h, d, x, y0, z, yaw), extra);
  }

  instance(key: string, make: () => { geometry: THREE.BufferGeometry; material: () => THREE.Material }, matrix: THREE.Matrix4, color?: number) {
    let batch = this.batches.get(key);
    if (!batch) {
      const made = make();
      this.batches.set(key, (batch = { geometry: made.geometry, material: made.material, matrices: [], colors: color === undefined ? undefined : [] }));
    }
    batch.matrices.push(matrix);
    if (color !== undefined) batch.colors?.push(color);
  }

  object(object: THREE.Object3D) {
    this.loose.push(object);
  }

  build(group: THREE.Group, shadows: boolean): KitStats {
    const stats: KitStats = { triangles: 0, drawCalls: 0 };
    const count = (geometry: THREE.BufferGeometry, copies = 1) => {
      stats.triangles += ((geometry.index?.count ?? geometry.getAttribute("position").count) / 3) * copies;
      stats.drawCalls++;
    };
    for (const bucket of this.buckets.values()) {
      const merged = this.track(mergeGeometries(bucket.geometries)!);
      bucket.geometries.forEach((geometry) => geometry.dispose());
      const mesh = new THREE.Mesh(merged, this.track(bucket.material()));
      mesh.castShadow = mesh.receiveShadow = shadows;
      group.add(mesh);
      count(merged);
    }
    const tint = new THREE.Color();
    for (const batch of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(this.track(batch.geometry), this.track(batch.material()), batch.matrices.length);
      batch.matrices.forEach((matrix, i) => mesh.setMatrixAt(i, matrix));
      batch.colors?.forEach((color, i) => mesh.setColorAt(i, tint.set(color)));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = mesh.receiveShadow = shadows;
      mesh.frustumCulled = false;
      group.add(mesh);
      this.track(mesh);
      count(batch.geometry, batch.matrices.length);
    }
    for (const object of this.loose) {
      group.add(object);
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (mesh.isMesh) count(mesh.geometry);
      });
    }
    this.buckets.clear();
    this.batches.clear();
    return stats;
  }

  dispose() {
    this.disposables.forEach((item) => item.dispose());
    this.disposables = [];
  }
}

export function boxAt(w: number, h: number, d: number, x: number, y0: number, z: number, yaw = 0): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(0, h / 2, 0);
  if (yaw) geometry.rotateY(yaw);
  geometry.translate(x, y0, z);
  return geometry;
}

export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((part) => (part.index ? part.toNonIndexed() : part));
  const merged = mergeGeometries(flat)!;
  flat.forEach((part) => part.dispose());
  return merged;
}

export const yawOf = (face = 0) => Math.atan2(Math.cos(face), Math.sin(face));

export function placed(x: number, y: number, z: number, yaw = 0): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(yaw).setPosition(x, y, z);
}
