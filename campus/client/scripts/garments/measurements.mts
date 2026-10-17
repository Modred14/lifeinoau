import type { Node, Primitive } from "@gltf-transform/core";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { blendInfluences, type Influence } from "./rigging.mts";

export type SurfaceHit = { point: THREE.Vector3; normal: THREE.Vector3; influences: Influence[]; distance: number };

export function readGarmentGeometry(node: Node, primitives: readonly Primitive[]) {
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  const geometries = primitives.map((primitive) => {
    const geometry = new THREE.BufferGeometry();
    for (const [attribute, name] of [["POSITION", "position"], ["NORMAL", "normal"], ["JOINTS_0", "skinIndex"], ["WEIGHTS_0", "skinWeight"]] as const) {
      const source = primitive.getAttribute(attribute)!;
      const data = source.getArray()!;
      geometry.setAttribute(name, name === "skinIndex" ? new THREE.Uint16BufferAttribute(data, 4) : new THREE.Float32BufferAttribute(data, attribute === "POSITION" || attribute === "NORMAL" ? 3 : 4));
    }
    const index = primitive.getIndices();
    geometry.setIndex(index ? Array.from(index.getArray()!) : Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i));
    geometry.applyMatrix4(world);
    return geometry;
  });
  const combined = mergeGeometries(geometries);
  geometries.forEach((geometry) => geometry.dispose());
  if (!combined) throw new Error(`Missing garment surface on ${node.getName()}`);
  return combined;
}

export class GarmentSurface {
  readonly triangles: { indices: number[]; triangle: THREE.Triangle }[];
  readonly bounds: THREE.Box3;

  constructor(readonly geometry: THREE.BufferGeometry) {
    const positions = geometry.getAttribute("position"), index = geometry.getIndex()!;
    this.triangles = [];
    for (let i = 0; i < index.count; i += 3) {
      const indices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const points = indices.map((vertex) => new THREE.Vector3().fromBufferAttribute(positions, vertex));
      this.triangles.push({ indices, triangle: new THREE.Triangle(...points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]) });
    }
    geometry.computeBoundingBox(); this.bounds = geometry.boundingBox!.clone();
  }

  private result(indices: number[], triangle: THREE.Triangle, point: THREE.Vector3, distance: number): SurfaceHit {
    const barycentric = (triangle.getBarycoord(point, new THREE.Vector3()) ?? new THREE.Vector3(1, 0, 0)).toArray();
    const normals = this.geometry.getAttribute("normal"), normal = new THREE.Vector3();
    for (let i = 0; i < 3; i++) normal.addScaledVector(new THREE.Vector3().fromBufferAttribute(normals, indices[i]), barycentric[i]);
    return { point: point.clone(), normal: normal.normalize(), influences: blendInfluences(this.geometry, indices, barycentric), distance };
  }

  closest(point: THREE.Vector3): SurfaceHit {
    let distance = Infinity, result: SurfaceHit | undefined;
    const projected = new THREE.Vector3();
    for (const { indices, triangle } of this.triangles) {
      triangle.closestPointToPoint(point, projected);
      const squared = point.distanceToSquared(projected);
      if (squared < distance) { distance = squared; result = this.result(indices, triangle, projected, Math.sqrt(squared)); }
    }
    if (!result) throw new Error("Garment has no surface triangles");
    return result;
  }

  ray(origin: THREE.Vector3, direction: THREE.Vector3): SurfaceHit | undefined {
    const ray = new THREE.Ray(origin, direction), hit = new THREE.Vector3();
    let distance = Infinity, result: SurfaceHit | undefined;
    for (const { indices, triangle } of this.triangles) {
      if (!ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit)) continue;
      const squared = origin.distanceToSquared(hit);
      if (squared < distance) { distance = squared; result = this.result(indices, triangle, hit, Math.sqrt(squared)); }
    }
    return result;
  }

  front(x: number, y: number, offset = 0): SurfaceHit {
    const result = this.ray(new THREE.Vector3(x, y, 1), new THREE.Vector3(0, 0, -1)) ?? this.closest(new THREE.Vector3(x, y, this.bounds.max.z));
    if (result.normal.z < 0) result.normal.negate();
    result.point.addScaledVector(result.normal, offset);
    return result;
  }

  section(axis: "x" | "y", value: number): THREE.Vector3[] {
    const points: THREE.Vector3[] = [];
    for (const { triangle } of this.triangles) {
      const vertices = [triangle.a, triangle.b, triangle.c];
      for (let i = 0; i < 3; i++) {
        const a = vertices[i], b = vertices[(i + 1) % 3];
        if ((a[axis] - value) * (b[axis] - value) > 0 || Math.abs(a[axis] - b[axis]) < 1e-8) continue;
        points.push(a.clone().lerp(b, (value - a[axis]) / (b[axis] - a[axis])));
      }
    }
    return points;
  }

  ring(y: number, count = 32, ease = 0): SurfaceHit[] {
    const section = this.section("y", y).filter((point) => Math.abs(point.x) < 0.24);
    const bounds = new THREE.Box3().setFromPoints(section);
    const center = bounds.isEmpty() ? this.bounds.getCenter(new THREE.Vector3()) : bounds.getCenter(new THREE.Vector3());
    center.x = 0; center.y = y;
    return Array.from({ length: count + 1 }, (_, i) => {
      const angle = i / count * Math.PI * 2, direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
      const result = this.ray(center.clone().addScaledVector(direction, 0.5), direction.clone().negate()) ?? this.closest(center.clone().addScaledVector(direction, 0.12));
      result.point.y = y;
      result.point.addScaledVector(direction, ease);
      return result;
    });
  }
}
