import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";
import { createStudentFootwear, FOOTWEAR_STYLES } from "./student-footwear.mts";
import { cropTrouserHem } from "../game/crop-trouser-hem.ts";

test("footwear has curved uppers, a connected ankle and matching left and right feet", () => {
  for (const body of ["m", "f"] as const) for (const style of FOOTWEAR_STYLES) {
    let triangles = 0;
    const boxes: THREE.Box3[] = [];
    for (const side of [-1, 1] as const) {
      const center = side * (body === "f" ? 0.084 : 0.124);
      const parts = createStudentFootwear(body, style, side, center);
      const bounds = new THREE.Box3();
      for (const part of parts) {
        const geometry = part.geometry;
        geometry.computeBoundingBox(); bounds.union(geometry.boundingBox!);
        triangles += geometry.index!.count / 3;
        assert.ok(Array.from(geometry.getAttribute("position").array).every(Number.isFinite));
        assert.ok(Array.from(geometry.getAttribute("normal").array).every(Number.isFinite));
        if (part.role === "skin") {
          assert.ok(geometry.boundingBox!.max.y >= (body === "f" ? 0.175 : 0.19), `${body} ${style} has no ankle joining the trouser hem`);
          assert.ok(geometry.boundingBox!.min.y <= 0.07, `${body} ${style} ankle stops above the foot`);
        }
        if (part.role === "primary") {
          const position = geometry.getAttribute("position"), normal = geometry.getAttribute("normal");
          const high = geometry.boundingBox!.max.y - 0.003;
          let upward = 0;
          for (let i = 0; i < position.count; i++) if (position.getY(i) >= high && normal.getY(i) > 0.04) upward++;
          assert.ok(upward > 0, `${body} ${style} upper is inside out`);
          assert.ok(new Set(Array.from(position.array).filter((_, i) => i % 3 === 0).map((x) => x.toFixed(5))).size > 12, `${style} has a rectangular upper`);
        }
        geometry.dispose();
      }
      assert.ok(bounds.min.y >= -0.0001, `${body} ${style} sole is below the floor`);
      bounds.translate(new THREE.Vector3(-center, 0, 0)); boxes.push(bounds);
    }
    assert.ok(triangles < 12000, `${body} ${style} uses ${triangles} triangles`);
    assert.ok(Math.abs(boxes[0].min.x + boxes[1].max.x) < 1e-6);
    assert.ok(Math.abs(boxes[0].max.x + boxes[1].min.x) < 1e-6);
    assert.ok(Math.abs(boxes[0].max.z - boxes[1].max.z) < 1e-6);
  }
});

test("a trouser cut follows the boot opening and blends skin weights at new vertices", () => {
  const source = new THREE.BufferGeometry()
    .setAttribute("position", new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 1, 0, 0.5, 0, 0], 3))
    .setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
    .setAttribute("skinIndex", new THREE.Uint16BufferAttribute([4, 0, 0, 0, 8, 0, 0, 0, 4, 0, 0, 0], 4))
    .setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4))
    .setIndex([0, 1, 2]);
  const before = Array.from(source.getAttribute("position").array);
  const cut = cropTrouserHem(source, new THREE.Matrix4(), 0.4);
  const positions = cut.getAttribute("position"), joints = cut.getAttribute("skinIndex"), weights = cut.getAttribute("skinWeight");
  let seam = 0;
  for (let i = 0; i < positions.count; i++) {
    assert.ok(positions.getY(i) >= 0.39999);
    assert.ok(Math.abs([0, 1, 2, 3].reduce((total, j) => total + weights.getComponent(i, j), 0) - 1) < 1e-6);
    if (positions.getY(i) < 0.401) {
      seam++;
      const influence = new Map([0, 1, 2, 3].map((j) => [joints.getComponent(i, j), weights.getComponent(i, j)]));
      assert.ok(Math.abs(influence.get(4)! - 0.6) < 1e-6);
      assert.ok(Math.abs(influence.get(8)! - 0.4) < 1e-6);
    }
  }
  assert.equal(seam, 2);
  assert.deepEqual(Array.from(source.getAttribute("position").array), before);
  cut.dispose(); source.dispose();
});
