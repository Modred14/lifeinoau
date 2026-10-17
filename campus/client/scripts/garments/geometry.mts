import * as THREE from "three";
import { normalizedInfluences, setGeometryInfluences, vertexInfluences, type Influence } from "./rigging.mts";
import { GarmentSurface, type SurfaceHit } from "./measurements.mts";

type Vertex = { point: THREE.Vector3; normal: THREE.Vector3; influences: Influence[] };

export function clipGarment(geometry: THREE.BufferGeometry, signedDistance: (point: THREE.Vector3) => number) {
  const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), index = geometry.index!;
  const points: number[] = [], normalValues: number[] = [], weights: Influence[][] = [];
  for (let i = 0; i < index.count; i += 3) {
    const polygon = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((vertex) => ({ point: new THREE.Vector3().fromBufferAttribute(positions, vertex), normal: new THREE.Vector3().fromBufferAttribute(normals, vertex), influences: vertexInfluences(geometry, vertex) }));
    const clipped: Vertex[] = [];
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j], b = polygon[(j + 1) % polygon.length], da = signedDistance(a.point), db = signedDistance(b.point);
      if (da >= 0) clipped.push(a);
      if ((da >= 0) === (db >= 0)) continue;
      const t = da / (da - db);
      clipped.push({ point: a.point.clone().lerp(b.point, t), normal: a.normal.clone().lerp(b.normal, t).normalize(), influences: normalizedInfluences([...a.influences.map(({ joint, weight }) => ({ joint, weight: weight * (1 - t) })), ...b.influences.map(({ joint, weight }) => ({ joint, weight: weight * t }))]) });
    }
    for (let j = 1; j < clipped.length - 1; j++) for (const vertex of [clipped[0], clipped[j], clipped[j + 1]]) {
      points.push(...vertex.point.toArray()); normalValues.push(...vertex.normal.toArray()); weights.push(vertex.influences);
    }
  }
  const result = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(points, 3)).setAttribute("normal", new THREE.Float32BufferAttribute(normalValues, 3)).setIndex(Array.from({ length: weights.length }, (_, i) => i));
  return setGeometryInfluences(result, weights);
}

export function fittedLoft(rings: readonly SurfaceHit[][], influences?: (point: THREE.Vector3, ring: number) => Influence[]) {
  const positions: number[] = [], weights: Influence[][] = [], indices: number[] = [];
  const row = rings[0].length;
  for (const [ring, points] of rings.entries()) for (const hit of points) {
    positions.push(...hit.point.toArray()); weights.push(influences ? influences(hit.point, ring) : hit.influences);
  }
  for (let ring = 0; ring < rings.length - 1; ring++) for (let i = 0; i < row - 1; i++) {
    const a = ring * row + i, b = a + row;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return setGeometryInfluences(geometry, weights);
}

export function torsoBinding(point: THREE.Vector3, names: readonly string[], waist: number, chest: number): Influence[] {
  const joints = ["Hips", "Abdomen", "Torso", "Chest"].map((name) => names.indexOf(name));
  const heights = [waist - 0.12, waist + 0.02, (waist + chest) / 2, chest];
  for (let i = 0; i < heights.length - 1; i++) if (point.y < heights[i + 1]) {
    const t = THREE.MathUtils.smoothstep(point.y, heights[i], heights[i + 1]);
    return normalizedInfluences([{ joint: joints[i], weight: 1 - t }, { joint: joints[i + 1], weight: t }]);
  }
  return [{ joint: joints.at(-1)!, weight: 1 }];
}

export function coverSleeve(surface: GarmentSurface, start: number, end: number, side: -1 | 1) {
  const rings: SurfaceHit[][] = [];
  for (let i = 0; i <= 12; i++) {
    const x = side * THREE.MathUtils.lerp(start, end, i / 12);
    const section = surface.section("x", x), bounds = new THREE.Box3().setFromPoints(section);
    if (bounds.isEmpty()) throw new Error(`Missing arm surface at ${x}`);
    const center = bounds.getCenter(new THREE.Vector3());
    rings.push(Array.from({ length: 25 }, (_, j) => {
      const angle = j / 24 * Math.PI * 2;
      const direction = new THREE.Vector3(0, Math.cos(angle), Math.sin(angle));
      const hit = surface.ray(center.clone().addScaledVector(direction, 0.3), direction.clone().negate()) ?? surface.closest(center.clone().addScaledVector(direction, 0.07));
      hit.point.x = x; hit.point.addScaledVector(direction, THREE.MathUtils.lerp(0.009, 0.005, i / 12));
      return hit;
    }));
  }
  const geometry = fittedLoft(rings);
  if (side > 0) {
    const index = geometry.index!;
    for (let i = 0; i < index.count; i += 3) { const a = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, a); }
    geometry.computeVertexNormals();
  }
  return geometry;
}

export function skinLegs(geometry: THREE.BufferGeometry, names: readonly string[]) {
  const result = geometry.clone(), positions = result.getAttribute("position");
  const source = geometry.getAttribute("position"), axis = new Map<number, THREE.Vector3>();
  const weights: Influence[][] = [];
  for (let i = 0; i < source.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(source, i), side = point.x < 0 ? "R" : "L";
    const upper = names.indexOf(`UpperLeg.${side}`), lower = names.indexOf(`LowerLeg.${side}`), influences = vertexInfluences(geometry, i);
    weights.push(normalizedInfluences(influences.map(({ joint, weight }) => ({ joint: names[joint]?.startsWith("Foot.") ? lower : joint, weight }))));
    const key = side === "L" ? 1 : -1;
    if (!axis.has(key)) {
      const points = Array.from({ length: source.count }, (_, j) => new THREE.Vector3().fromBufferAttribute(source, j)).filter((p) => Math.sign(p.x) === key && p.y < 0.22);
      axis.set(key, new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3()));
    }
    const center = axis.get(key)!;
    const yFactor = THREE.MathUtils.smoothstep(point.y, 0.18, 0.85), zCenter = THREE.MathUtils.lerp(center.z, 0.060, yFactor);
    const factor = THREE.MathUtils.lerp(0.78, 0.86, yFactor);
    point.x = center.x + (point.x - center.x) * factor;
    point.z = zCenter + (point.z - zCenter) * factor;
    positions.setXYZ(i, point.x, point.y, point.z);
    if (upper < 0 || lower < 0) throw new Error("Missing leg joints");
  }
  result.computeVertexNormals();
  return setGeometryInfluences(result, weights);
}
