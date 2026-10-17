import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

type Vertex = { values: Record<string, number[]>; height: number };

export function cropTrouserHem(source: THREE.BufferGeometry, rest: THREE.Matrix4, height: number, keep: "above" | "below" = "above") {
  const names = Object.keys(source.attributes);
  const output = Object.fromEntries(names.map((name) => [name, [] as number[]]));
  const vertices: Vertex[] = [];
  const point = new THREE.Vector3();
  for (let i = 0; i < source.getAttribute("position").count; i++) {
    const values = Object.fromEntries(names.map((name) => {
      const attribute = source.getAttribute(name);
      return [name, Array.from({ length: attribute.itemSize }, (_, j) => attribute.getComponent(i, j))];
    }));
    vertices.push({ values, height: point.fromArray(values.position).applyMatrix4(rest).y });
  }
  const between = (a: Vertex, b: Vertex): Vertex => {
    const t = (height - a.height) / (b.height - a.height);
    const values = Object.fromEntries(names.map((name) => [name, a.values[name].map((value, i) => THREE.MathUtils.lerp(value, b.values[name][i], t))]));
    const weights = new Map<number, number>();
    for (const [vertex, amount] of [[a, 1 - t], [b, t]] as const) for (let i = 0; i < 4; i++) {
      const joint = vertex.values.skinIndex[i];
      weights.set(joint, (weights.get(joint) ?? 0) + vertex.values.skinWeight[i] * amount);
    }
    const ranked = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = ranked.reduce((sum, [, weight]) => sum + weight, 0);
    values.skinIndex = Array.from({ length: 4 }, (_, i) => ranked[i]?.[0] ?? 0);
    values.skinWeight = Array.from({ length: 4 }, (_, i) => (ranked[i]?.[1] ?? 0) / total);
    return { values, height };
  };
  const geometry = new THREE.BufferGeometry();
  const inside = (vertex: Vertex) => keep === "above" ? vertex.height >= height : vertex.height <= height;
  const indices = source.getIndex(), count = indices?.count ?? vertices.length;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map((j) => vertices[indices?.getX(i + j) ?? i + j]);
    const polygon: Vertex[] = [];
    let previous = triangle.at(-1)!;
    for (const current of triangle) {
      if (inside(previous) !== inside(current)) polygon.push(between(previous, current));
      if (inside(current)) polygon.push(current);
      previous = current;
    }
    const start = output.position.length / 3;
    for (let j = 1; j < polygon.length - 1; j++) for (const vertex of [polygon[0], polygon[j], polygon[j + 1]]) for (const name of names) output[name].push(...vertex.values[name]);
    const length = output.position.length / 3 - start;
    if (length > 0 && source.groups.length > 0) geometry.addGroup(start, length, source.groups.find((group) => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0);
  }
  for (const name of names) geometry.setAttribute(name, name === "skinIndex"
    ? new THREE.Uint16BufferAttribute(output[name], source.getAttribute(name).itemSize)
    : new THREE.Float32BufferAttribute(output[name], source.getAttribute(name).itemSize));
  const welded = mergeVertices(geometry, 1e-5);
  welded.userData = structuredClone(source.userData);
  geometry.dispose();
  return welded;
}
