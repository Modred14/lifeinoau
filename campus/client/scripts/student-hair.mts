import { Document } from "@gltf-transform/core";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BodyType, Hairstyle } from "@campuslife/shared/avatar";
import { FACE_OFFSET_Y, FACE_SCALE } from "../game/student-proportions.ts";

export type HairPart = { role: "hair" | "hair_shade" | "hair_fade" | "accessory"; geometry: THREE.BufferGeometry };

function cap(scale: [number, number, number], start = 0, end?: number, lift = 0, texture = 0) {
  const positions: number[] = [], indices: number[] = [], radial = 32, rows = 10;
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= radial; j++) {
    const phi = j / radial * Math.PI * 2, front = Math.cos(phi);
    const edge = front >= 0 ? 1.52 - front * 0.45 : 1.52 - front * 0.36;
    const theta = THREE.MathUtils.lerp(start, end ?? edge, i / rows);
    const noise = 1 + texture * Math.sin(phi * 11 + theta * 7) * Math.sin(theta * 17);
    positions.push(Math.sin(phi) * Math.sin(theta) * scale[0] * noise, Math.cos(theta) * scale[1] * noise + lift, Math.cos(phi) * Math.sin(theta) * scale[2] * noise);
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function blob(at: THREE.Vector3, scale: [number, number, number], variation = 0) {
  const geometry = new THREE.SphereGeometry(1, 10, 8), positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const noise = 1 + variation * Math.sin(positions.getX(i) * 13 + positions.getY(i) * 17 + positions.getZ(i) * 9);
    positions.setXYZ(i, positions.getX(i) * noise, positions.getY(i) * noise, positions.getZ(i) * noise);
  }
  geometry.scale(...scale).translate(at.x, at.y, at.z); geometry.computeVertexNormals();
  return geometry;
}

function bobShell() {
  const rows = 12, segments = 64, positions: number[] = [], indices: number[] = [];
  for (let row = 0; row <= rows; row++) for (let i = 0; i <= segments; i++) {
    const t = row / rows, y = 0.085 - t * 0.253, phi = 0.72 + i / segments * (Math.PI * 2 - 1.44);
    const width = 0.116 + Math.sin(t * Math.PI) * 0.014, depth = 0.105 + Math.sin(t * Math.PI) * 0.010;
    const noise = 1 + Math.sin(phi * 12 + y * 65) * 0.04 + Math.sin(phi * 23 - y * 80) * 0.015;
    positions.push(Math.sin(phi) * width * noise, y + Math.sin(phi * 10) * 0.007 * t, Math.cos(phi) * depth * noise);
  }
  for (let row = 0; row < rows; row++) for (let i = 0; i < segments; i++) {
    const a = row * (segments + 1) + i, b = a + segments + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function strand(points: THREE.Vector3[], radius: number, segments = 18, taper = 0.4) {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  const geometry = new THREE.TubeGeometry(curve, segments, radius, 5, false), positions = geometry.getAttribute("position");
  const center = new THREE.Vector3(), vertex = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, center);
    const size = 1 - taper * (i / segments) ** 2;
    for (let j = 0; j <= 5; j++) {
      const index = i * 6 + j;
      vertex.fromBufferAttribute(positions, index).sub(center).multiplyScalar(size).add(center);
      positions.setXYZ(index, vertex.x, vertex.y, vertex.z);
    }
  }
  geometry.deleteAttribute("uv"); geometry.computeVertexNormals();
  return geometry;
}

export function createStudentHair(body: BodyType, style: Hairstyle): HairPart[] {
  const grouped = new Map<HairPart["role"], THREE.BufferGeometry[]>();
  const add = (geometry: THREE.BufferGeometry, role: HairPart["role"] = "hair") => {
    geometry.deleteAttribute("uv");
    grouped.set(role, [...grouped.get(role) ?? [], geometry]);
  };
  const width = body === "f" ? 0.109 : 0.113;
  const scalp = (fade = false) => add(cap([width, 0.151, 0.102], 0, undefined, 0.002), fade ? "hair_fade" : "hair");
  const braid = (points: THREE.Vector3[], radius = 0.008, turns = 9) => {
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const frames = curve.computeFrenetFrames(24, false);
    for (const phase of [0, Math.PI]) {
      const helix = Array.from({ length: 25 }, (_, i) => {
        const t = i / 24, angle = t * Math.PI * 2 * turns + phase, offset = radius * 0.48 * (1 - t * 0.35);
        return curve.getPointAt(t).addScaledVector(frames.normals[i], Math.cos(angle) * offset).addScaledVector(frames.binormals[i], Math.sin(angle) * offset);
      });
      add(strand(helix, radius * 0.52, 20, 0.45), phase === 0 ? "hair" : "hair_shade");
    }
  };
  const combed = () => {
    for (let i = -4; i <= 4; i++) {
      const x = i * 0.018, k = Math.sqrt(1 - (x / width) ** 2);
      add(strand(Array.from({ length: 9 }, (_, j) => {
        const angle = 1.02 - j / 8 * 2.45;
        return new THREE.Vector3(x * (1 - j / 8 * 0.85), Math.cos(angle) * 0.154 * k + 0.003, Math.sin(angle) * 0.104 * k);
      }), 0.0012, 16, 0), "hair_shade");
    }
  };

  if (style === "buzz" || style === "fade") {
    add(cap([width, 0.15, 0.101], 1.12, undefined, 0.001), "hair_fade");
    add(cap([width + (style === "fade" ? 0.007 : 0), style === "fade" ? 0.169 : 0.153, 0.105], 0, 1.17, 0.003, style === "fade" ? 0.035 : 0.012));
  } else if (style === "afro" || style === "curls" && body === "m") {
    scalp();
    const afro = style === "afro", radii: [number, number, number] = afro ? [0.139, 0.181, 0.132] : [0.119, 0.160, 0.112];
    add(cap(radii, 0, undefined, 0.025, 0.035));
    for (let row = 0; row < 5; row++) {
      const count = row === 0 ? 6 : 10 + row * 2;
      for (let i = 0; i < count; i++) {
        const phi = i / count * Math.PI * 2 + row * 0.39;
        const edge = Math.cos(phi) >= 0 ? 1.48 - Math.cos(phi) * 0.38 : 1.48 - Math.cos(phi) * 0.36;
        const theta = 0.17 + row / 4 * (edge - 0.28);
        const radius = (afro ? 0.0125 : 0.010) * (1 + Math.sin(i * 2.1 + row) * 0.13);
        const center = new THREE.Vector3(Math.sin(phi) * Math.sin(theta) * radii[0], Math.cos(theta) * radii[1] + 0.025, Math.cos(phi) * Math.sin(theta) * radii[2]);
        add(blob(center, [radius, radius * 0.9, radius], 0.07));
      }
    }
  } else if (style === "curls") {
    scalp();
    add(cap([0.125, 0.165, 0.114], 0, undefined, 0.012, 0.035));
    add(bobShell());
    for (let i = 0; i < 20; i++) {
      const phi = 0.70 + i / 19 * (Math.PI * 2 - 1.40);
      const curl = Array.from({ length: 17 }, (_, j) => {
        const t = j / 16, angle = phi + Math.sin(t * Math.PI * 5 + i * 0.5) * 0.075;
        const width = 0.121 + Math.sin(t * Math.PI) * 0.015, depth = 0.111 + Math.sin(t * Math.PI) * 0.010;
        return new THREE.Vector3(Math.sin(angle) * width, 0.095 - t * 0.262 + Math.sin(phi * 10) * 0.007 * t, Math.cos(angle) * depth);
      });
      add(strand(curl, 0.0055, 20, 0.3));
      add(strand(curl.map((point) => point.clone().add(new THREE.Vector3(Math.sin(phi) * 0.005, 0, Math.cos(phi) * 0.005))), 0.0012, 20, 0.3), "hair_shade");
    }
  } else if (style === "cornrows") {
    scalp(true);
    for (const x of [-0.082, -0.056, -0.028, 0, 0.028, 0.056, 0.082]) {
      const k = Math.sqrt(1 - (x / width) ** 2);
      braid(Array.from({ length: 11 }, (_, i) => {
        const angle = 1.07 - i / 10 * 2.84;
        return new THREE.Vector3(x, Math.cos(angle) * 0.155 * k + 0.004, Math.sin(angle) * 0.106 * k);
      }), 0.007, 8);
    }
  } else if (style === "locs" || style === "braids") {
    scalp(style === "braids");
    const count = style === "braids" ? 24 : 22, long = body === "f";
    for (let i = 0; i < count; i++) {
      const phi = i / count * Math.PI * 2 + 0.08, front = Math.cos(phi) > 0.55;
      const rootAngle = 0.32 + (i % 3) * 0.14;
      const tipY = front ? 0.055 + (i % 3) * 0.007 : (long ? -0.192 : -0.070) + Math.sin(i * 1.9) * 0.017;
      const points = [
        new THREE.Vector3(Math.sin(phi) * Math.sin(rootAngle) * width, Math.cos(rootAngle) * 0.151 + 0.007, Math.cos(phi) * Math.sin(rootAngle) * 0.102),
        new THREE.Vector3(Math.sin(phi) * width * 0.82, 0.095, Math.cos(phi) * 0.101),
        new THREE.Vector3(Math.sin(phi) * width * 1.13, 0.020, Math.cos(phi) * 0.116),
        new THREE.Vector3(Math.sin(phi) * width * 1.20 + Math.sin(i * 2.7) * 0.008, tipY, Math.cos(phi) * 0.127),
      ];
      if (front) points.splice(2, 1);
      if (style === "braids") braid(points, 0.007, 8);
      else {
        add(strand(points, 0.009 + (i % 3) * 0.001, 18, 0.4));
        add(strand(points.map((point) => point.clone().add(new THREE.Vector3(0.002, 0.001, 0.007))), 0.001, 18, 0.5), "hair_shade");
      }
    }
  } else if (style === "ponytail" || style === "bun") {
    scalp(); combed();
    if (style === "bun") {
      add(blob(new THREE.Vector3(0, 0.177, -0.014), [0.054, 0.043, 0.054], 0.015));
      const spiral = Array.from({ length: 49 }, (_, i) => {
        const t = i / 48, angle = t * Math.PI * 8, radius = 0.047 * (1 - t * 0.87);
        return new THREE.Vector3(Math.cos(angle) * radius, 0.185 + t * 0.032, -0.014 + Math.sin(angle) * radius);
      });
      add(strand(spiral, 0.0035, 48, 0), "hair_shade");
    } else {
      const points = [new THREE.Vector3(0, 0.060, -0.105), new THREE.Vector3(0, 0.035, -0.150), new THREE.Vector3(0.017, -0.082, -0.172), new THREE.Vector3(0.035, -0.199, -0.152)];
      add(strand(points, 0.032, 28, 0.82));
      for (const side of [-1, 1]) for (const offset of [0.007, 0.018]) add(strand(points.map((point) => point.clone().add(new THREE.Vector3(side * offset, 0, -0.021))), 0.0013, 28, 0.8), "hair_shade");
      add(new THREE.TorusGeometry(0.026, 0.003, 5, 16).rotateX(0.7).translate(0, 0.048, -0.123), "accessory");
    }
  }
  return [...grouped].map(([role, geometries]) => {
    const geometry = mergeGeometries(geometries);
    if (!geometry) throw new Error(`Could not assemble ${body} ${style}`);
    geometries.forEach((part) => part.dispose());
    return { role, geometry };
  });
}

export function buildStudentHair(doc: Document, body: BodyType, style: Hairstyle) {
  const root = doc.getRoot(), buffer = root.listBuffers()[0];
  const node = root.listNodes().find((node) => node.getName() === "head" && node.getMesh())!;
  const skin = node.getSkin()!, bone = skin.listJoints().findIndex((joint) => joint.getName() === "Head");
  if (bone < 0) throw new Error(`Missing Head joint for ${body} ${style}`);
  const inverse = new THREE.Matrix4().fromArray(skin.getInverseBindMatrices()!.getElement(bone, [])).invert();
  const local = new THREE.Matrix4().makeScale(FACE_SCALE, FACE_SCALE, FACE_SCALE).setPosition(0, FACE_OFFSET_Y, 0);
  const transform = inverse.multiply(local);
  for (const primitive of node.getMesh()!.listPrimitives()) node.getMesh()!.removePrimitive(primitive);
  for (const part of createStudentHair(body, style)) {
    const geometry = part.geometry.applyMatrix4(transform), positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
    const joints = new Uint16Array(positions.count * 4), weights = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) { joints[i * 4] = bone; weights[i * 4] = 1; }
    const color = new THREE.Color(part.role === "accessory" ? 0xb4a68b : 0x171410);
    const material = doc.createMaterial(`head:${part.role}`).setBaseColorFactor([color.r, color.g, color.b, 1]).setMetallicFactor(0).setRoughnessFactor(0.86);
    const primitive = doc.createPrimitive().setMaterial(material)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(positions.array)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(normals.array)).setBuffer(buffer))
      .setAttribute("JOINTS_0", doc.createAccessor().setType("VEC4").setArray(joints).setBuffer(buffer))
      .setAttribute("WEIGHTS_0", doc.createAccessor().setType("VEC4").setArray(weights).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint16Array(geometry.index!.array)).setBuffer(buffer));
    node.getMesh()!.addPrimitive(primitive); geometry.dispose();
  }
  for (const other of root.listNodes()) if (other !== node && other.getMesh()) other.dispose();
}
