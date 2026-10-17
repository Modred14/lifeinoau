import type { Primitive } from "@gltf-transform/core";

export function smoothCharacterNormals(primitive: Primitive, creaseAngle: number) {
  const positions = primitive.getAttribute("POSITION");
  const normals = primitive.getAttribute("NORMAL");
  if (!positions || !normals) throw new Error("Character primitive is missing positions or normals");

  const points = positions.getArray()!;
  const original = normals.getArray()!;
  const result = new Float32Array(original);
  const indices = primitive.getIndices()?.getArray();
  const vertices = new Set(indices ?? Array.from({ length: positions.getCount() }, (_, i) => i));
  const groups = new Map<string, Set<string>>();
  const vectors = new Map<string, number[]>();
  const positionKeys = new Map<number, string>();

  for (const vertex of vertices) {
    const offset = vertex * 3;
    const positionKey = Array.from(points.slice(offset, offset + 3)).join(",");
    const normal = Array.from(original.slice(offset, offset + 3));
    const normalKey = normal.join(",");
    const group = groups.get(positionKey) ?? new Set<string>();
    group.add(normalKey);
    groups.set(positionKey, group);
    vectors.set(normalKey, normal);
    positionKeys.set(vertex, positionKey);
  }

  const threshold = Math.cos(creaseAngle);
  for (const vertex of vertices) {
    const offset = vertex * 3;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const normalKey of groups.get(positionKeys.get(vertex)!)!) {
      const [nx, ny, nz] = vectors.get(normalKey)!;
      const dot = original[offset] * nx + original[offset + 1] * ny + original[offset + 2] * nz;
      if (dot < threshold) continue;
      x += nx;
      y += ny;
      z += nz;
    }
    const length = Math.hypot(x, y, z);
    if (length > 0) result.set([x / length, y / length, z / length], offset);
  }

  primitive.setAttribute("NORMAL", normals.clone().setArray(result));
}
