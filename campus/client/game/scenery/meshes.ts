import * as THREE from "three";
import { blade, mergeParts, strip, type Part } from "./kit";
import type { ScatterKind } from "./plan";
import { BED_SIZE } from "./planting";

const GREEN = { deep: 0x2f6a2c, mid: 0x3f8236, bright: 0x56983f, olive: 0x5f8a3a, palm: 0x4d8b3a, palmDark: 0x3a7030 };
const BARK = { tree: 0x6a4a30, palm: 0x7d6549 };
const STONE = { grey: 0x8d877c, warm: 0x9a7a5e, dark: 0x6f6a62 };
const TUFT = 0xffffff;

const blob = (r: number, detail = 0) => new THREE.IcosahedronGeometry(r, detail);

function tree(): THREE.BufferGeometry {
  const parts: Part[] = [
    { geo: new THREE.CylinderGeometry(0.15, 0.26, 2.9, 6, 1, true), color: BARK.tree, at: [0, 1.45, 0], shade: 0.25 },
    { geo: new THREE.CylinderGeometry(0.07, 0.12, 1.5, 5, 1, true), color: BARK.tree, at: [0.55, 2.9, 0.1], rot: [0, 0, -0.7] },
    { geo: new THREE.CylinderGeometry(0.07, 0.12, 1.4, 5, 1, true), color: BARK.tree, at: [-0.45, 3, -0.2], rot: [0.3, 0, 0.65] },
    { geo: blob(2.1, 1), color: GREEN.mid, at: [0, 4.5, 0], scale: [1.15, 0.78, 1.1], shade: 0.38 },
    { geo: blob(1.5, 1), color: GREEN.bright, at: [1.5, 4, 0.5], scale: [1, 0.8, 1], shade: 0.35 },
    { geo: blob(1.45, 1), color: GREEN.deep, at: [-1.4, 4.1, -0.6], scale: [1, 0.8, 1], shade: 0.35 },
    { geo: blob(1.3, 0), color: GREEN.bright, at: [0.2, 5.5, -0.5], scale: [1, 0.75, 1], shade: 0.3 },
  ];
  return mergeParts(parts);
}

function palm(): THREE.BufferGeometry {
  const trunk: Part[] = [];
  const rings = 5;
  for (let i = 0; i < rings; i++) {
    const y0 = (i * 6.2) / rings;
    trunk.push({ geo: new THREE.CylinderGeometry(0.15 - i * 0.012, 0.2 - i * 0.014, 6.2 / rings + 0.04, 6, 1, true), color: BARK.palm, at: [Math.sin(i * 0.5) * 0.08, y0 + 3.1 / rings, 0], shade: 0.3 });
  }
  const solid = mergeParts([...trunk, { geo: blob(0.42, 0), color: GREEN.palmDark, at: [0, 6.3, 0] }]);
  const fronds: Part[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const droop = i % 2 ? 1 : 0.55;
    fronds.push({
      geo: strip([[0, 0, 0], [0, 0.55, 1.1], [0, 0.5 - droop * 0.5, 2.2], [0, -droop * 1.5, 3.1]], 0.95),
      color: i % 3 ? GREEN.palm : GREEN.palmDark,
      at: [0, 6.35, 0],
      rot: [0, (i / n) * Math.PI * 2, 0],
      shade: 0.25,
    });
  }
  const leaves = mergeParts(fronds, true);
  const out = new THREE.BufferGeometry();
  for (const name of ["position", "color", "normal"]) {
    const a = solid.getAttribute(name);
    const b = leaves.getAttribute(name);
    const data = new Float32Array(a.array.length + b.array.length);
    data.set(a.array, 0);
    data.set(b.array, a.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  solid.dispose();
  leaves.dispose();
  return out;
}

function bush(): THREE.BufferGeometry {
  return mergeParts([
    { geo: blob(0.78), color: GREEN.mid, at: [0, 0.48, 0], scale: [1.15, 0.8, 1], shade: 0.42 },
    { geo: blob(0.55), color: GREEN.olive, at: [0.62, 0.36, 0.25], scale: [1, 0.8, 1], shade: 0.4 },
    { geo: blob(0.5), color: GREEN.deep, at: [-0.5, 0.34, -0.38], scale: [1, 0.85, 1.1], shade: 0.4 },
  ]);
}

function rock(): THREE.BufferGeometry {
  return mergeParts([
    { geo: new THREE.DodecahedronGeometry(0.62, 0), color: STONE.grey, at: [0, 0.3, 0], scale: [1.25, 0.72, 1], rot: [0.3, 0.5, 0.1], shade: 0.3 },
    { geo: new THREE.DodecahedronGeometry(0.36, 0), color: STONE.warm, at: [0.66, 0.16, 0.3], scale: [1, 0.7, 1.2], rot: [0.9, 0.2, 0.4], shade: 0.25 },
    { geo: new THREE.DodecahedronGeometry(0.24, 0), color: STONE.dark, at: [-0.5, 0.1, -0.45], scale: [1.2, 0.7, 1], rot: [0.2, 1.1, 0.6] },
  ]);
}

function tuft(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const blades = 6;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    parts.push({ geo: blade(0.16, 0.34 + (i % 3) * 0.1, 0.07), color: TUFT, at: [Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1], rot: [0.25, a, 0], shade: 0.45 });
  }
  return mergeParts(parts, true);
}

function flower(): THREE.BufferGeometry {
  const parts: Part[] = [];
  const blooms = [
    { x: -0.18, z: 0, height: 0.54, color: 0xf3b93f },
    { x: 0.17, z: 0.08, height: 0.67, color: 0xed7197 },
    { x: 0, z: -0.17, height: 0.76, color: 0xffeed4 },
  ];
  for (const bloom of blooms) {
    parts.push({ geo: new THREE.CylinderGeometry(0.018, 0.022, bloom.height, 4, 1, true), color: GREEN.mid, at: [bloom.x, 0.07 + bloom.height / 2, bloom.z] });
    for (const side of [-1, 1]) parts.push({ geo: blade(0.13, 0.26, side * 0.16), color: GREEN.bright, at: [bloom.x, bloom.height * 0.5, bloom.z], rot: [0.5, side * 0.9, side * 0.65] });
    for (let p = 0; p < 5; p++) {
      const angle = p * Math.PI * 2 / 5;
      parts.push({ geo: new THREE.SphereGeometry(0.13, 5, 2), color: bloom.color, at: [bloom.x + Math.cos(angle) * 0.13, bloom.height + 0.07, bloom.z + Math.sin(angle) * 0.13], scale: [1, 0.35, 1], shade: 0.12 });
    }
    parts.push({ geo: blob(0.075), color: 0xbe7930, at: [bloom.x, bloom.height + 0.105, bloom.z], scale: [1, 0.45, 1] });
  }
  return mergeParts(parts);
}

function bed(): THREE.BufferGeometry {
  const rim = new THREE.Shape();
  rim.absellipse(0, 0, BED_SIZE.radiusX, BED_SIZE.radiusZ, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, BED_SIZE.radiusX - 0.2, BED_SIZE.radiusZ - 0.2, 0, Math.PI * 2, true, 0);
  rim.holes.push(hole);
  return mergeParts([
    { geo: new THREE.ExtrudeGeometry(rim, { depth: 0.14, bevelEnabled: false, curveSegments: 12 }), color: 0xc8b99c, rot: [-Math.PI / 2, 0, 0], shade: 0.15 },
    { geo: new THREE.CylinderGeometry(1, 1, 0.06, 24), color: 0x72513a, at: [0, 0.04, 0], scale: [BED_SIZE.radiusX - 0.18, 1, BED_SIZE.radiusZ - 0.18] },
  ]);
}

export function scatterGeometry(kind: ScatterKind): THREE.BufferGeometry {
  if (kind === "tree") return tree();
  if (kind === "palm") return palm();
  if (kind === "bush" || kind === "scrub") return bush();
  if (kind === "rock") return rock();
  if (kind === "flower") return flower();
  if (kind === "bed") return bed();
  return tuft();
}
