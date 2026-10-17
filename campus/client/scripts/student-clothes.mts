import { Document, type Node } from "@gltf-transform/core";
import * as THREE from "three";
import type { BodyType, Slot, StudentStyle } from "@campuslife/shared/avatar";
import { createStudentFootwear } from "./student-footwear.mts";
import { createStudentGarments, type GarmentPiece } from "./garments/designs.mts";
import { readGarmentGeometry } from "./garments/measurements.mts";
import { setGeometryInfluences } from "./garments/rigging.mts";

export function buildStudentClothes(doc: Document, body: BodyType, style: StudentStyle, slots: readonly Slot[]) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0], parts = new Map<Slot, Node>();
  for (const node of root.listNodes()) if (node.getMesh() && ["head", "top", "bottom", "shoes"].includes(node.getName())) parts.set(node.getName() as Slot, node);
  const topNode = parts.get("top")!, bottomNode = parts.get("bottom")!;
  const topPrimitives = topNode.getMesh()!.listPrimitives();
  const top = readGarmentGeometry(topNode, topPrimitives.filter((primitive) => !primitive.getMaterial()!.getName().split(":")[1].startsWith("skin")));
  const arms = readGarmentGeometry(topNode, topPrimitives.filter((primitive) => primitive.getMaterial()!.getName().split(":")[1].startsWith("skin")));
  const bottom = readGarmentGeometry(bottomNode, bottomNode.getMesh()!.listPrimitives());
  const joints = topNode.getSkin()!.listJoints().map((joint) => joint.getName());
  const add = (piece: Pick<GarmentPiece, "slot" | "geometry" | "role" | "color"> & Partial<Pick<GarmentPiece, "garmentPart" | "garmentRegion">>) => {
    const { slot, geometry, role, color } = piece, node = parts.get(slot)!;
    geometry.applyMatrix4(new THREE.Matrix4().fromArray(node.getWorldMatrix()).invert());
    const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), c = new THREE.Color(color);
    const metal = role === "buckle" || role === "zip";
    const material = doc.createMaterial(`${slot}:${role}`).setBaseColorFactor([c.r, c.g, c.b, 1]).setMetallicFactor(metal ? 0.65 : 0).setRoughnessFactor(metal ? 0.35 : role === "skin" ? 0.72 : slot === "shoes" ? 0.76 : 0.9);
    const primitive = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions.array)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(normals.array)).setBuffer(buffer))
      .setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(new Uint16Array(geometry.getAttribute("skinIndex").array)).setBuffer(buffer))
      .setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(new Float32Array(geometry.getAttribute("skinWeight").array)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geometry.index!.array)).setBuffer(buffer))
      .setMaterial(material);
    if (piece.garmentPart) {
      const extras = { garmentPart: piece.garmentPart, garmentRegion: piece.garmentRegion, attachmentTolerance: 0.012, ...(piece.garmentPart === "shell" && piece.garmentRegion === "hem" ? { garmentCoverage: "closed" } : {}) };
      primitive.setExtras(extras); material.setExtras(extras);
      if (piece.garmentPart === "shell" || piece.garmentPart === "pocket" || piece.garmentPart === "collar") material.setDoubleSided(true);
    }
    node.getMesh()!.addPrimitive(primitive); geometry.dispose();
  };
  if (slots.includes("top") || slots.includes("bottom")) {
    const pieces = createStudentGarments(body, style, { top, arms, bottom, joints });
    for (const slot of ["top", "bottom"] as const) if (slots.includes(slot)) {
      const mesh = parts.get(slot)!.getMesh()!;
      for (const primitive of mesh.listPrimitives()) mesh.removePrimitive(primitive);
    }
    for (const piece of pieces) if (slots.includes(piece.slot)) add(piece); else piece.geometry.dispose();
  }
  if (slots.includes("shoes")) {
    const mesh = parts.get("shoes")!.getMesh()!;
    for (const primitive of mesh.listPrimitives()) mesh.removePrimitive(primitive);
    bottom.computeBoundingBox();
    const positions = bottom.getAttribute("position"), minHeight = bottom.boundingBox!.min.y;
    for (const side of [-1, 1] as const) {
      const cuff = new THREE.Box3();
      for (let i = 0; i < positions.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, i);
        if (point.x * side > 0 && point.y <= minHeight + 0.018) cuff.expandByPoint(point);
      }
      const center = cuff.getCenter(new THREE.Vector3()), names = parts.get("shoes")!.getSkin()!.listJoints().map((joint) => joint.getName());
      const foot = names.indexOf(`Foot.${side > 0 ? "L" : "R"}`), leg = names.indexOf(`LowerLeg.${side > 0 ? "L" : "R"}`);
      for (const part of createStudentFootwear(body, style, side, center.x, center.z)) {
        const points = part.geometry.getAttribute("position");
        setGeometryInfluences(part.geometry, Array.from({ length: points.count }, (_, i) => {
          const height = points.getY(i), depth = points.getZ(i);
          const legWeight = THREE.MathUtils.smoothstep(height, 0.065, 0.155) * (1 - THREE.MathUtils.smoothstep(depth, 0.085, 0.16) * (1 - THREE.MathUtils.smoothstep(height, 0.13, 0.18)));
          return [{ joint: foot, weight: 1 - legWeight }, { joint: leg, weight: legWeight }];
        }));
        add({ slot: "shoes", ...part });
      }
    }
  }
  top.dispose(); arms.dispose(); bottom.dispose();
  for (const [slot, node] of parts) if (!slots.includes(slot)) node.dispose();
}
