import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeIO } from "@gltf-transform/core";
import * as THREE from "three";
import type { StudentStyle } from "@campuslife/shared/avatar";
import { createStudentGarments } from "./garments/designs.mts";
import { clipGarment } from "./garments/geometry.mts";
import { GarmentSurface, readGarmentGeometry } from "./garments/measurements.mts";
import { setGeometryInfluences } from "./garments/rigging.mts";

test("surface transfer interpolates normalized bone weights and clipped seam vertices", () => {
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)).setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  setGeometryInfluences(geometry, [[{ joint: 0, weight: 1 }], [{ joint: 1, weight: 1 }], [{ joint: 2, weight: 1 }]]);
  const hit = new GarmentSurface(geometry).front(0.25, 0.25);
  assert.deepEqual(hit.influences, [{ joint: 0, weight: 0.5 }, { joint: 1, weight: 0.25 }, { joint: 2, weight: 0.25 }]);
  const clipped = clipGarment(geometry, (point) => point.y - 0.2), positions = clipped.getAttribute("position"), weights = clipped.getAttribute("skinWeight");
  assert.ok(Array.from({ length: positions.count }, (_, i) => positions.getY(i)).every((y) => y >= 0.2 - 1e-6));
  assert.ok(Array.from({ length: weights.count }, (_, i) => [weights.getX(i), weights.getY(i), weights.getZ(i), weights.getW(i)].filter((weight) => weight > 0).length).some((count) => count === 2));
  geometry.dispose(); clipped.dispose();
});

test("student clothing follows source anatomy with sewn details and normalized compatible rigs", async () => {
  const styles: StudentStyle[] = ["nursing", "medical", "lab", "agric", "sports", "formal", "native", "dress"];
  for (const [body, id] of [["m", "90a9e2d4-053f-42f1-99a2-8f5e1180ea7f"], ["f", "ba7a1955-ea51-4cb9-a561-188bdef0a6c7"]] as const) {
    const doc = await new NodeIO().read(new URL(`../fixtures/source-models/${id}.glb`, import.meta.url).pathname);
    const topNode = doc.getRoot().listNodes().find((node) => /_body$/i.test(node.getMesh()?.getName() ?? ""))!;
    const bottomNode = doc.getRoot().listNodes().find((node) => /_legs$/i.test(node.getMesh()?.getName() ?? ""))!;
    const primitives = topNode.getMesh()!.listPrimitives();
    const top = readGarmentGeometry(topNode, primitives.filter((primitive) => !primitive.getMaterial()!.getName().startsWith("Skin")));
    const arms = readGarmentGeometry(topNode, primitives.filter((primitive) => primitive.getMaterial()!.getName().startsWith("Skin")));
    const bottom = readGarmentGeometry(bottomNode, bottomNode.getMesh()!.listPrimitives());
    const joints = topNode.getSkin()!.listJoints().map((joint) => joint.getName());
    for (const style of styles.filter((style) => body === "f" || style !== "dress")) {
      const pieces = createStudentGarments(body, style, { top, arms, bottom, joints });
      const shells = new Map(["top", "bottom"].map((slot) => [slot, pieces.filter((piece) => piece.slot === slot && piece.garmentPart === "shell").map((piece) => new GarmentSurface(piece.geometry))]));
      let triangles = 0;
      for (const piece of pieces) {
        const positions = piece.geometry.getAttribute("position"), normals = piece.geometry.getAttribute("normal"), weights = piece.geometry.getAttribute("skinWeight"), indices = piece.geometry.getAttribute("skinIndex");
        triangles += piece.geometry.index!.count / 3;
        assert.ok(Array.from(positions.array).every(Number.isFinite), `${body} ${style} ${piece.garmentPart} has invalid vertices`);
        assert.ok(Array.from(normals.array).every(Number.isFinite));
        assert.ok(positions.count < 65536);
        for (let i = 0; i < weights.count; i++) {
          const total = weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
          assert.ok(Math.abs(total - 1) < 1e-5, `${body} ${style} non-normalized weights ${total}`);
          if (piece.garmentPart === "skin") continue;
          for (let channel = 0; channel < 4; channel++) if (weights.getComponent(i, channel) > 0.02) assert.ok(!/^(Index|Middle|Ring|Pinky|Thumb|Foot)/.test(joints[indices.getComponent(i, channel)]));
        }
        if (piece.garmentPart !== "shell" && piece.garmentPart !== "skin") for (let i = 0; i < positions.count; i += 3) {
          const point = new THREE.Vector3().fromBufferAttribute(positions, i);
          const distance = Math.min(...shells.get(piece.slot)!.map((shell) => shell.closest(point).distance));
          assert.ok(distance < 0.012, `${body} ${style} ${piece.garmentPart} floats ${distance.toFixed(4)} metres from fabric`);
        }
        if (style === "agric" && piece.slot === "top" && piece.role === "fixed" && piece.garmentPart === "trim") {
          const shell = shells.get("top")![0], index = piece.geometry.index!;
          for (let i = 0; i < index.count; i += 3) {
            const center = new THREE.Vector3();
            for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, index.getX(i + j)));
            center.multiplyScalar(1 / 3);
            const fabric = shell.front(center.x, center.y);
            assert.ok(center.z >= fabric.point.z - 0.0002, `${body} agric bib cuts through its shirt at ${center.toArray()}`);
          }
        }
        if (["hem", "skirt"].includes(piece.garmentRegion) && piece.garmentPart === "shell") {
          piece.geometry.computeBoundingBox();
          const center = piece.geometry.boundingBox!.getCenter(new THREE.Vector3());
          const front = Array.from({ length: positions.count }, (_, i) => i).filter((i) => positions.getZ(i) > center.z + 0.045);
          assert.ok(front.length > 0 && front.every((i) => normals.getZ(i) > 0), `${body} ${style} fabric faces inward`);
          assert.ok(piece.geometry.boundingBox!.getSize(new THREE.Vector3()).x < 0.52, `${body} ${style} bloated hem`);
        }
      }
      assert.ok(triangles < 16000, `${body} ${style} uses ${triangles} clothing triangles`);
      if (style === "sports") {
        const shorts = pieces.find((piece) => piece.slot === "bottom" && piece.garmentPart === "shell")!;
        shorts.geometry.computeBoundingBox();
        assert.ok(shorts.geometry.boundingBox!.min.y >= (body === "f" ? 0.77 : 0.72) - 1e-6);
        assert.ok(pieces.some((piece) => piece.slot === "bottom" && piece.garmentPart === "skin"));
      }
      pieces.forEach((piece) => piece.geometry.dispose());
    }
    top.dispose(); arms.dispose(); bottom.dispose();
  }
});
