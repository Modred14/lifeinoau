import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import * as THREE from "three";
import { slotOptions } from "@campuslife/shared/avatar";
import { createStudentHair } from "./student-hair.mts";

test("student hairstyles have distinct silhouettes, outward normals and a bounded size", () => {
  for (const body of ["m", "f"] as const) {
    const designs = new Set<string>();
    for (const option of slotOptions(body, "head").filter((option) => option.hairstyle)) {
      const parts = createStudentHair(body, option.hairstyle!), box = new THREE.Box3();
      const hash = createHash("sha256");
      let triangles = 0, upward = 0;
      for (const { geometry } of parts) {
        const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
        assert.ok(Array.from(positions.array).every(Number.isFinite));
        assert.ok(Array.from(normals.array).every(Number.isFinite));
        geometry.computeBoundingBox(); box.union(geometry.boundingBox!);
        for (let i = 0; i < positions.count; i++) if (positions.getY(i) > 0.14 && normals.getY(i) > 0.7) upward++;
        hash.update(new Uint8Array(positions.array.buffer, positions.array.byteOffset, positions.array.byteLength));
        triangles += geometry.index!.count / 3;
        assert.ok(positions.count < 65536);
        geometry.dispose();
      }
      assert.ok(upward > 0, `${body} ${option.id} crown is inside out`);
      assert.ok(triangles < 12000, `${body} ${option.id} uses ${triangles} triangles`);
      assert.ok(box.min.y > -0.28 && box.max.y < 0.27);
      assert.ok(box.getSize(new THREE.Vector3()).x < 0.34);
      designs.add(hash.digest("hex"));
    }
    assert.equal(designs.size, 6);
  }
});
