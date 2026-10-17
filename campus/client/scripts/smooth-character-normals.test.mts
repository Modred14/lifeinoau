import assert from "node:assert/strict";
import { test } from "node:test";
import { Document } from "@gltf-transform/core";
import { smoothCharacterNormals } from "./smooth-character-normals.mts";

function fixture(secondNormal: number[], indices?: number[]) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const positions = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 0, 0, 0, 1, 0, 0])).setBuffer(buffer);
  const normals = doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 1, 0, ...secondNormal, 1, 0, 0])).setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", positions).setAttribute("NORMAL", normals);
  if (indices) primitive.setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer));
  return { doc, primitive, positions, normals };
}

test("skin normals blend neighbouring facets and stay normalized", () => {
  const { primitive, positions, normals } = fixture([0, Math.SQRT1_2, Math.SQRT1_2]);
  smoothCharacterNormals(primitive, 100 * Math.PI / 180);
  const result = primitive.getAttribute("NORMAL")!.getArray()!;
  assert.ok(Math.abs(result[1] - Math.cos(Math.PI / 8)) < 1e-6);
  assert.ok(Math.abs(result[2] - Math.sin(Math.PI / 8)) < 1e-6);
  assert.deepEqual(Array.from(result.slice(0, 3)), Array.from(result.slice(3, 6)));
  assert.deepEqual(Array.from(result.slice(6)), [1, 0, 0]);
  assert.equal(primitive.getAttribute("POSITION"), positions);
  assert.equal(normals.getArray()![1], 1);
  assert.ok(Math.abs(Math.hypot(...Array.from(result.slice(0, 3))) - 1) < 1e-6);
});

test("sharp shoe edges keep separate normals", () => {
  const { primitive, normals } = fixture([1, 0, 0]);
  smoothCharacterNormals(primitive, 40 * Math.PI / 180);
  assert.deepEqual(Array.from(primitive.getAttribute("NORMAL")!.getArray()!), Array.from(normals.getArray()!));
});

test("unused vertices and shared accessors do not smooth another material", () => {
  const { doc, primitive, normals } = fixture([0, Math.SQRT1_2, Math.SQRT1_2], [0, 2, 2]);
  const neighbour = doc.createPrimitive().setAttribute("NORMAL", normals);
  smoothCharacterNormals(primitive, 100 * Math.PI / 180);
  assert.equal(neighbour.getAttribute("NORMAL"), normals);
  assert.notEqual(primitive.getAttribute("NORMAL"), normals);
  assert.deepEqual(Array.from(primitive.getAttribute("NORMAL")!.getArray()!), Array.from(normals.getArray()!));
});
