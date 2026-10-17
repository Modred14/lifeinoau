import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BodyType, StudentStyle } from "@campuslife/shared/avatar";
import { BOOT_SHAFTS } from "../game/footwear-shapes.ts";

export type FootwearPart = {
  geometry: THREE.BufferGeometry;
  role: string;
  color: number;
  binding: "foot" | "ankle";
};

export const FOOTWEAR_STYLES = ["sneakers", "hightops", "loafers", "sandals", "slides", "clogs", "ankleboots", "wellies"] as const;

type Section = [z: number, width: number, top: number];

function loft(sections: Section[], bottom: number, segments = 24, radial = 16) {
  const curve = new THREE.CatmullRomCurve3(sections.map(([z, width, top]) => new THREE.Vector3(width, top, z)), false, "centripetal");
  const positions: number[] = [], indices: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const section = curve.getPoint(i / segments);
    for (let j = 0; j <= radial; j++) {
      const angle = j / radial * Math.PI * 2;
      positions.push(Math.sin(angle) * Math.max(0.0002, section.x), bottom + (section.y - bottom) * (0.5 + Math.cos(angle) * 0.5), section.z);
    }
  }
  for (let i = 0; i < segments; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function shaft(rings: [y: number, width: number, depth: number][], centerZ: number, thickness = 0.004) {
  const positions: number[] = [], indices: number[] = [], segments = 20;
  for (const inner of [false, true]) for (const [y, width, depth] of rings) for (let j = 0; j <= segments; j++) {
    const angle = j / segments * Math.PI * 2;
    positions.push(Math.sin(angle) * (width - (inner ? thickness : 0)), y, centerZ + Math.cos(angle) * (depth - (inner ? thickness : 0)));
  }
  const layer = rings.length * (segments + 1);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < segments; j++) {
    const a = i * (segments + 1) + j, b = a + segments + 1;
    indices.push(a, a + 1, b, a + 1, b + 1, b, layer + a, layer + b, layer + a + 1, layer + a + 1, layer + b, layer + b + 1);
  }
  for (const ring of [0, rings.length - 1]) for (let j = 0; j < segments; j++) {
    const a = ring * (segments + 1) + j, b = a + layer;
    if (ring === 0) indices.push(a, b, a + 1, a + 1, b, b + 1);
    else indices.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function ribbon(z: number, depth: number, width: number, height: number, base: number, thickness = 0.005) {
  const positions: number[] = [], indices: number[] = [], segments = 24;
  for (const inner of [false, true]) for (const edge of [-1, 1]) for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI;
    positions.push(Math.cos(angle) * (width - (inner ? thickness : 0)), base + Math.sin(angle) * (height - (inner ? thickness : 0)), z + edge * depth / 2);
  }
  const row = segments + 1;
  for (let i = 0; i < segments; i++) {
    indices.push(i, i + row, i + 1, i + 1, i + row, i + row + 1);
    indices.push(i + row * 2, i + row * 2 + 1, i + row * 3, i + row * 2 + 1, i + row * 3 + 1, i + row * 3);
    for (const edge of [0, 1]) {
      const a = i + edge * row, b = a + row * 2;
      if (edge === 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  for (const i of [0, segments]) indices.push(i, i + row * 2, i + row, i + row, i + row * 2, i + row * 3);
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
  const geometry = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)).setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tube(points: THREE.Vector3[], radius: number, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, closed, "centripetal"), Math.max(8, points.length * 2), radius, 4, closed);
}

function ellipsoid(scale: [number, number, number], at: [number, number, number]) {
  return new THREE.SphereGeometry(1, 12, 8).scale(...scale).translate(...at);
}

export function createStudentFootwear(body: BodyType, style: StudentStyle, side: -1 | 1, centerX: number, centerZ = 0.053): FootwearPart[] {
  if (!FOOTWEAR_STYLES.includes(style as typeof FOOTWEAR_STYLES[number])) throw new Error(`Unknown footwear style: ${style}`);
  const parts: FootwearPart[] = [];
  const widthScale = body === "f" ? 0.84 : 1;
  const lengthScale = body === "f" ? 0.92 : 1;
  const depthOffset = centerZ - 0.053 * lengthScale;
  const add = (geometry: THREE.BufferGeometry, role = "primary", color = 0xf5f5f0, binding: FootwearPart["binding"] = "foot") => {
    geometry.deleteAttribute("uv");
    if (!geometry.getIndex()) geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i));
    geometry.scale(widthScale, 1, lengthScale);
    if (side < 0) {
      geometry.scale(-1, 1, 1);
      if (!geometry.getIndex()) geometry.setIndex(Array.from({ length: geometry.getAttribute("position").count }, (_, i) => i));
      const index = geometry.getIndex()!;
      for (let i = 0; i < index.count; i += 3) {
        const first = index.getX(i);
        index.setX(i, index.getX(i + 1)); index.setX(i + 1, first);
      }
    }
    geometry.translate(centerX, 0, depthOffset);
    parts.push({ geometry, role, color, binding });
  };
  const finish = () => {
    const grouped = new Map<string, FootwearPart[]>();
    for (const part of parts) {
      const key = `${part.role}:${part.color}`;
      grouped.set(key, [...grouped.get(key) ?? [], part]);
    }
    return [...grouped.values()].map((group) => {
      const geometry = mergeGeometries(group.map((part) => part.geometry));
      if (!geometry) throw new Error(`Could not assemble ${style} ${group[0].role}`);
      group.forEach((part) => part.geometry.dispose());
      return { ...group[0], geometry };
    });
  };
  const outline = new THREE.CatmullRomCurve3([
    [0, 0, 0.256], [-0.036, 0, 0.252], [-0.060, 0, 0.214], [-0.061, 0, 0.171], [-0.043, 0, 0.087],
    [-0.036, 0, 0.010], [-0.023, 0, -0.020], [0, 0, -0.026], [0.030, 0, -0.013], [0.041, 0, 0.044],
    [0.052, 0, 0.117], [0.064, 0, 0.179], [0.057, 0, 0.217], [0.033, 0, 0.247],
  ].map((point) => new THREE.Vector3(...point)), true, "centripetal");
  const shape = new THREE.Shape(outline.getPoints(40).map((point) => new THREE.Vector2(point.x, -point.z)));
  const sole = (height: number, y: number, role: string, color: number, scale = 1) => {
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.0025, bevelThickness: 0.002, curveSegments: 16 });
    geometry.rotateX(-Math.PI / 2).scale(scale, 1, scale).translate(0, y, 0);
    add(geometry, role, color);
  };
  const sports = style === "sneakers" || style === "hightops";
  const open = style === "slides" || style === "sandals";
  const boot = style === "ankleboots" || style === "wellies";
  const soleTop = sports ? 0.039 : boot ? 0.036 : 0.028;
  sole(0.010, 0.004, "outsole", 0x252a29);
  sole(soleTop - 0.015, 0.015, sports ? "midsole" : "primary_shade", sports ? 0xeae8df : 0xc1bbaa, sports ? 1 : 0.98);
  const ankleWidth = body === "f" ? 0.026 : 0.032;
  const ankleTop = body === "f" ? 0.185 : 0.205;
  add(shaft([[0.065, 0.029, 0.033], [0.099, 0.029, 0.030], [0.14, ankleWidth, 0.029], [ankleTop, ankleWidth, 0.029]], 0.053, 0.023), "skin", 0x82553a, "ankle");

  if (open) {
    sole(0.003, 0.029, "footbed", 0x514a42, 0.94);
    const foot = loft([
      [-0.012, 0.004, 0.069], [0.004, 0.030, 0.086], [0.047, 0.037, 0.104], [0.091, 0.043, 0.093],
      [0.135, 0.050, 0.076], [0.176, 0.055, 0.061], [0.208, 0.046, 0.053], [0.226, 0.014, 0.047], [0.23, 0.001, 0.044],
    ], 0.033);
    const toes = [-0.038, -0.012, 0.010, 0.029, 0.045].map((x, i) => ellipsoid(
      [0.014 - i * 0.0016, 0.010 - i * 0.0008, 0.025 - i * 0.0025],
      [x, 0.043, 0.229 - i * 0.005],
    ));
    toes.forEach((geometry) => geometry.deleteAttribute("uv"));
    const skin = mergeGeometries([foot, ...toes])!;
    [foot, ...toes].forEach((geometry) => geometry.dispose());
    add(skin, "skin", 0x82553a);
    const straps = style === "slides" ? [[0.141, 0.080, 0.060, 0.050]] : [[0.171, 0.030, 0.063, 0.035], [0.105, 0.029, 0.053, 0.058]];
    for (const [z, depth, width, height] of straps) {
      add(ribbon(z, depth, width, height, 0.035));
      for (const edge of [-1, 1]) add(tube(Array.from({ length: 13 }, (_, i) => {
        const angle = i / 12 * Math.PI;
        return new THREE.Vector3(Math.cos(angle) * (width + 0.001), 0.036 + Math.sin(angle) * (height + 0.001), z + edge * (depth / 2 - 0.004));
      }), 0.001), "stitch", 0xa49b89);
    }
    if (style === "sandals") {
      add(shaft([[0.113, 0.037, 0.039], [0.131, 0.037, 0.039]], 0.053), "primary", 0xf5f5f0, "ankle");
      for (const x of [-0.034, 0.034]) add(tube([new THREE.Vector3(x, 0.033, 0.013), new THREE.Vector3(x, 0.073, 0.024), new THREE.Vector3(x, 0.118, 0.029)], 0.007), "primary", 0xf5f5f0, "ankle");
      add(new THREE.TorusGeometry(0.009, 0.0018, 5, 12).rotateY(Math.PI / 2).translate(0.039, 0.123, 0.057), "buckle", 0xb8a980, "ankle");
    }
    return finish();
  }

  const clog = style === "clogs", loafer = style === "loafers";
  const sections: Section[] = [
    [-0.022, 0.001, 0.060], [-0.013, 0.032, clog ? 0.068 : 0.115], [0.025, 0.041, clog ? 0.099 : 0.145],
    [0.066, 0.044, clog ? 0.136 : loafer ? 0.128 : 0.146], [0.112, 0.051, clog ? 0.129 : 0.125],
    [0.166, 0.059, clog ? 0.118 : loafer ? 0.094 : 0.105], [0.211, 0.053, clog ? 0.102 : 0.087],
    [0.247, 0.021, 0.076], [0.254, 0.0003, 0.057],
  ];
  add(loft(sections, soleTop));
  const topAt = (z: number) => {
    const i = sections.findIndex((section) => section[0] >= z);
    const a = sections[Math.max(0, i - 1)], b = sections[Math.max(0, i)];
    return a[2] + (b[2] - a[2]) * THREE.MathUtils.clamp((z - a[0]) / Math.max(0.0001, b[0] - a[0]), 0, 1);
  };
  if (sports) {
    for (const sideX of [-1, 1]) add(tube([
      new THREE.Vector3(sideX * 0.043, 0.080, 0.028), new THREE.Vector3(sideX * 0.050, 0.082, 0.105), new THREE.Vector3(sideX * 0.057, 0.073, 0.176), new THREE.Vector3(sideX * 0.033, 0.062, 0.230),
    ], 0.002), "primary_shade", 0xc1bbaa);
    for (const z of [0.082, 0.102, 0.122, 0.142]) {
      for (const reverse of [-1, 1]) add(tube([
        new THREE.Vector3(-0.027, topAt(z) - 0.010, z), new THREE.Vector3(0, topAt(z + reverse * 0.004) + 0.003, z + reverse * 0.004), new THREE.Vector3(0.027, topAt(z + reverse * 0.008) - 0.010, z + reverse * 0.008),
      ], 0.0018), "lace", 0xeae7da);
    }
    add(shaft([[0.12, 0.042, 0.045], [0.15, 0.039, 0.042]], 0.049), "primary_shade", 0xc1bbaa, "ankle");
  }
  if (style === "hightops" || boot) {
    const rings = BOOT_SHAFTS[style], [top, width] = rings.at(-1)!;
    add(shaft(rings.map((ring) => [...ring]), 0.049), "primary", 0xf5f5f0, "ankle");
    add(shaft([[top - 0.010, width + 0.002, width * 1.08 + 0.002], [top + 0.003, width + 0.002, width * 1.08 + 0.002]], 0.049), "primary_shade", 0xc1bbaa, "ankle");
    if (style === "hightops") for (const y of [0.163, 0.187, 0.211]) add(tube([
      new THREE.Vector3(-0.022, y, 0.090), new THREE.Vector3(0, y + 0.005, 0.096), new THREE.Vector3(0.022, y, 0.090),
    ], 0.0018), "lace", 0xeae7da, "ankle");
    if (style === "ankleboots") add(tube([new THREE.Vector3(-0.044, 0.12, 0.043), new THREE.Vector3(-0.047, 0.205, 0.043), new THREE.Vector3(-0.048, top - 0.008, 0.043)], 0.0018), "zip", 0x8d897d, "ankle");
  } else if (loafer) {
    add(ribbon(0.128, 0.032, 0.054, 0.090, 0.035));
    add(shaft([[0.118, 0.039, 0.045], [0.135, 0.038, 0.045]], 0.047), "lining", 0x302c29, "ankle");
    add(tube(Array.from({ length: 17 }, (_, i) => {
      const angle = i / 16 * Math.PI;
      const z = 0.146 + Math.sin(angle) * 0.081;
      return new THREE.Vector3(Math.cos(angle) * 0.044, topAt(z) - Math.cos(angle) ** 2 * 0.022 + 0.002, z);
    }), 0.0012), "stitch", 0xb5a88d);
  } else if (clog) {
    for (const z of [0.140, 0.176]) for (const x of [-0.028, 0, 0.028]) add(ellipsoid([0.006, 0.0018, 0.007], [x, topAt(z) - (x / 0.057) ** 2 * 0.030 + 0.0008, z]), "vent", 0x30302b);
    add(shaft([[0.095, 0.043, 0.047], [0.108, 0.043, 0.047]], 0.029), "primary_shade", 0xc1bbaa, "ankle");
  }
  return finish();
}
