import * as THREE from "three";
import { GarmentSurface } from "./measurements.mts";
import { setGeometryInfluences, type Influence } from "./rigging.mts";

export function surfacePatch(surface: GarmentSurface, x: number, y: number, width: number, height: number, offset = 0.002, taper = 0, options: { sewingClearance?: number } = {}) {
  const positions: number[] = [], indices: number[] = [], weights: Influence[][] = [];
  const rows = Math.max(2, Math.ceil(height / 0.005)), columns = Math.max(2, Math.ceil(width / 0.005));
  const clearance = offset + (options.sewingClearance ?? 0.003);
  for (let row = 0; row <= rows; row++) for (let column = 0; column <= columns; column++) {
    const v = row / rows, u = column / columns;
    const edge = 1 - taper * Math.max(0, (0.2 - v) / 0.2);
    const hit = surface.front(x + (u - 0.5) * width * edge, y + (v - 0.5) * height, clearance + Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.0008);
    positions.push(...hit.point.toArray()); weights.push(hit.influences);
  }
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const a = row * (columns + 1) + column, b = a + columns + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return setGeometryInfluences(geometry, weights);
}

export function surfacePolygon(surface: GarmentSurface, outline: readonly (readonly [number, number])[], offset = 0.003) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const flat = new THREE.ShapeGeometry(shape, 8), original = flat.getAttribute("position"), index = flat.index!;
  const positions: number[] = [], weights: Influence[][] = [], indices: number[] = [];
  for (let triangle = 0; triangle < index.count; triangle += 3) {
    const vertices = [0, 1, 2].map((i) => new THREE.Vector2(original.getX(index.getX(triangle + i)), original.getY(index.getX(triangle + i))));
    const row = 6, start = weights.length;
    for (let i = 0; i <= row; i++) for (let j = 0; j <= row - i; j++) {
      const point = vertices[0].clone().multiplyScalar(1 - (i + j) / row).addScaledVector(vertices[1], i / row).addScaledVector(vertices[2], j / row);
      const hit = surface.front(point.x, point.y, offset);
      positions.push(...hit.point.toArray()); weights.push(hit.influences);
    }
    const offsetAt = (i: number, j: number) => start + i * (row + 1) - i * (i - 1) / 2 + j;
    for (let i = 0; i < row; i++) for (let j = 0; j < row - i; j++) {
      indices.push(offsetAt(i, j), offsetAt(i + 1, j), offsetAt(i, j + 1));
      if (j < row - i - 1) indices.push(offsetAt(i + 1, j), offsetAt(i + 1, j + 1), offsetAt(i, j + 1));
    }
  }
  flat.dispose();
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return setGeometryInfluences(geometry, weights);
}

export function surfaceSeam(surface: GarmentSurface, points: readonly (readonly [number, number])[], radius = 0.0009, offset = 0.002) {
  const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => surface.front(x, y, offset + radius).point), false, "centripetal");
  const geometry = new THREE.TubeGeometry(curve, Math.max(16, points.length * 6), radius, 4, false);
  geometry.deleteAttribute("uv");
  const positions = geometry.getAttribute("position"), weights: Influence[][] = [];
  for (let i = 0; i < positions.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(positions, i), hit = surface.closest(point);
    if (hit.distance > offset + radius * 1.8) {
      point.sub(hit.point).normalize().multiplyScalar(offset + radius * 1.8).add(hit.point);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    weights.push(hit.influences);
  }
  geometry.computeVertexNormals();
  return setGeometryInfluences(geometry, weights);
}

export function garmentButton(surface: GarmentSurface, x: number, y: number, radius = 0.0028) {
  const hit = surface.front(x, y, 0.003);
  const geometry = new THREE.CylinderGeometry(radius, radius, 0.0017, 10).rotateX(Math.PI / 2);
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);
  geometry.applyQuaternion(rotation).translate(...hit.point.toArray()).deleteAttribute("uv");
  return setGeometryInfluences(geometry, Array.from({ length: geometry.getAttribute("position").count }, () => hit.influences));
}
