import * as THREE from "three";

export interface Part {
  geo: THREE.BufferGeometry;
  color: number;
  at?: [number, number, number];
  scale?: [number, number, number];
  rot?: [number, number, number];
  shade?: number;
}

const m4 = new THREE.Matrix4();
const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();
const scl = new THREE.Vector3();
const euler = new THREE.Euler();
const tint = new THREE.Color();

export function mergeParts(parts: readonly Part[], doubleSided = false): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  for (const part of parts) {
    const flat = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    pos.set(...(part.at ?? [0, 0, 0]));
    euler.set(...(part.rot ?? [0, 0, 0]));
    quat.setFromEuler(euler);
    scl.set(...(part.scale ?? [1, 1, 1]));
    flat.applyMatrix4(m4.compose(pos, quat, scl));
    const p = flat.getAttribute("position");
    tint.setHex(part.color);
    const shade = part.shade ?? 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.count; i++) {
      lo = Math.min(lo, p.getY(i));
      hi = Math.max(hi, p.getY(i));
    }
    const push = (i: number) => {
      positions.push(p.getX(i), p.getY(i), p.getZ(i));
      const k = 1 - shade * (1 - (p.getY(i) - lo) / (hi - lo || 1));
      colors.push(tint.r * k, tint.g * k, tint.b * k);
    };
    for (let i = 0; i < p.count; i += 3) {
      push(i);
      push(i + 1);
      push(i + 2);
      if (doubleSided) {
        push(i);
        push(i + 2);
        push(i + 1);
      }
    }
    if (flat !== part.geo) flat.dispose();
    part.geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  out.computeVertexNormals();
  return out;
}

export function blade(width: number, height: number, lean: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([-width / 2, 0, 0, width / 2, 0, 0, lean, height, 0], 3));
  return g;
}

export function strip(points: readonly [number, number, number][], width: number): THREE.BufferGeometry {
  const v: number[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay, az] = points[i];
    const [bx, by, bz] = points[i + 1];
    const wa = (width * (points.length - 1 - i)) / (points.length - 1) / 2;
    const wb = (width * (points.length - 2 - i)) / (points.length - 1) / 2;
    v.push(ax - wa, ay, az, ax + wa, ay, az, bx + wb, by, bz, ax - wa, ay, az, bx + wb, by, bz, bx - wb, by, bz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  return g;
}
