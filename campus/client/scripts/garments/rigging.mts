import * as THREE from "three";

export type Influence = { joint: number; weight: number };

export function normalizedInfluences(values: readonly Influence[]): Influence[] {
  const totals = new Map<number, number>();
  for (const { joint, weight } of values) if (Number.isFinite(weight) && weight > 0) totals.set(joint, (totals.get(joint) ?? 0) + weight);
  const strongest = [...totals].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = strongest.reduce((sum, [, weight]) => sum + weight, 0);
  return strongest.map(([joint, weight]) => ({ joint, weight: weight / total }));
}

export function vertexInfluences(geometry: THREE.BufferGeometry, index: number): Influence[] {
  const joints = geometry.getAttribute("skinIndex"), weights = geometry.getAttribute("skinWeight");
  return Array.from({ length: 4 }, (_, channel) => ({ joint: joints.getComponent(index, channel), weight: weights.getComponent(index, channel) }));
}

export function blendInfluences(geometry: THREE.BufferGeometry, indices: readonly number[], factors: readonly number[]): Influence[] {
  return normalizedInfluences(indices.flatMap((index, i) => vertexInfluences(geometry, index).map(({ joint, weight }) => ({ joint, weight: weight * factors[i] }))));
}

export function setGeometryInfluences(geometry: THREE.BufferGeometry, values: readonly Influence[][]) {
  const joints = new Uint16Array(values.length * 4), weights = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) for (const [channel, influence] of normalizedInfluences(values[i]).entries()) {
    joints[i * 4 + channel] = influence.joint;
    weights[i * 4 + channel] = influence.weight;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}
