import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { CONDITION_SITES, type ConditionSite } from "@campuslife/shared";
import { toWorld } from "../coords";
import { disposeLabel, makeLabel } from "../labels";

const COLOR = {
  concrete: 0xa9a59b,
  pipe: 0x6f777d,
  tap: 0xc9a227,
  bucket: 0x2f6fb5,
  wet: 0x6f8f9f,
  pole: 0x8a9096,
  canopy: 0xf4f1ea,
  cross: 0x1f8a4c,
  table: 0x9a7048,
  chair: 0x2f6fb5,
  bench: 0x6e4d30,
  kiosk: 0x2f8f6b,
  kioskTrim: 0xf4f1ea,
  shelf: 0xd9a441,
};
const LABEL_DISTANCE = 55;
const LABEL_HEIGHT = 3.3;
const LABELLED: Record<ConditionSite["kind"], string> = { standpipe: "", clinic: "Campus clinic", chemist: "Chemist" };

type Part = [color: number, w: number, h: number, d: number, x: number, y: number, z: number];

const STANDPIPE: readonly Part[] = [
  [COLOR.concrete, 1.3, 0.1, 1.3, 0, 0.05, 0],
  [COLOR.wet, 0.7, 0.02, 0.7, 0, 0.11, 0.25],
  [COLOR.pipe, 0.09, 1.15, 0.09, 0, 0.6, -0.2],
  [COLOR.pipe, 0.09, 0.09, 0.42, 0, 1.13, -0.02],
  [COLOR.tap, 0.12, 0.14, 0.12, 0, 1.03, 0.16],
  [COLOR.bucket, 0.34, 0.3, 0.34, 0, 0.26, 0.2],
];

const CLINIC: readonly Part[] = [
  [COLOR.pole, 0.07, 2.5, 0.07, -1.6, 1.25, -1.4],
  [COLOR.pole, 0.07, 2.5, 0.07, 1.6, 1.25, -1.4],
  [COLOR.pole, 0.07, 2.5, 0.07, -1.6, 1.25, 1.4],
  [COLOR.pole, 0.07, 2.5, 0.07, 1.6, 1.25, 1.4],
  [COLOR.canopy, 3.6, 0.1, 3.2, 0, 2.55, 0],
  [COLOR.cross, 3.62, 0.3, 0.06, 0, 2.38, 1.6],
  [COLOR.cross, 0.9, 0.12, 0.3, 0, 2.62, 0],
  [COLOR.cross, 0.3, 0.12, 0.9, 0, 2.62, 0],
  [COLOR.table, 1.6, 0.06, 0.7, 0, 0.74, 0.1],
  [COLOR.table, 0.06, 0.72, 0.06, -0.72, 0.36, 0.1],
  [COLOR.table, 0.06, 0.72, 0.06, 0.72, 0.36, 0.1],
  [COLOR.canopy, 0.3, 0.22, 0.2, 0.45, 0.88, 0.1],
  [COLOR.chair, 0.42, 0.06, 0.42, 0, 0.44, -0.75],
  [COLOR.chair, 0.42, 0.5, 0.06, 0, 0.7, -0.96],
  [COLOR.bench, 0.4, 0.06, 2.2, -1.25, 0.44, 0],
  [COLOR.bench, 0.36, 0.42, 0.08, -1.25, 0.21, -0.9],
  [COLOR.bench, 0.36, 0.42, 0.08, -1.25, 0.21, 0.9],
];

const CHEMIST: readonly Part[] = [
  [COLOR.kiosk, 2.2, 1.0, 0.5, 0, 0.5, 0.3],
  [COLOR.kioskTrim, 2.3, 0.08, 0.6, 0, 1.04, 0.3],
  [COLOR.kiosk, 0.1, 2.2, 1.4, -1.05, 1.1, -0.2],
  [COLOR.kiosk, 0.1, 2.2, 1.4, 1.05, 1.1, -0.2],
  [COLOR.kiosk, 2.2, 2.2, 0.1, 0, 1.1, -0.85],
  [COLOR.kioskTrim, 2.5, 0.1, 1.9, 0, 2.25, -0.1],
  [COLOR.cross, 2.3, 0.4, 0.06, 0, 2.5, 0.8],
  [COLOR.shelf, 1.9, 0.05, 0.3, 0, 1.5, -0.7],
  [COLOR.kioskTrim, 0.2, 0.26, 0.16, -0.6, 1.66, -0.7],
  [COLOR.cross, 0.2, 0.22, 0.16, -0.2, 1.64, -0.7],
  [COLOR.shelf, 0.2, 0.3, 0.16, 0.3, 1.68, -0.7],
];

const PARTS: Record<ConditionSite["kind"], readonly Part[]> = { standpipe: STANDPIPE, clinic: CLINIC, chemist: CHEMIST };

export const siteYaw = (site: ConditionSite) => Math.atan2(Math.cos(site.face), Math.sin(site.face));

function partGeometry([color, w, h, d, x, y, z]: Part): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  geometry.translate(x, y, z);
  const count = geometry.getAttribute("position").count;
  const tint = new THREE.Color(color);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([tint.r, tint.g, tint.b], i * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export interface SiteProps {
  group: THREE.Group;
  update(focus: THREE.Vector3): void;
  dispose(): void;
}

export function buildSiteProps(shadows: boolean): SiteProps {
  const group = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const labels: { sprite: THREE.Sprite; at: THREE.Vector3 }[] = [];
  const turn = new THREE.Matrix4();
  for (const site of CONDITION_SITES) {
    turn.makeRotationY(siteYaw(site)).setPosition(toWorld(site.x), 0, toWorld(site.y));
    for (const part of PARTS[site.kind]) parts.push(partGeometry(part).applyMatrix4(turn));
    const text = LABELLED[site.kind];
    if (!text) continue;
    const sprite = makeLabel(text, { screenHeight: 0.022, background: "rgba(22,128,61,0.92)" });
    sprite.position.set(toWorld(site.x), LABEL_HEIGHT, toWorld(site.y));
    sprite.visible = false;
    group.add(sprite);
    labels.push({ sprite, at: sprite.position });
  }
  const geometry = parts.length ? mergeGeometries(parts) : null;
  parts.forEach((part) => part.dispose());
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (geometry) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }
  return {
    group,
    update(focus) {
      for (const label of labels) label.sprite.visible = Math.hypot(label.at.x - focus.x, label.at.z - focus.z) < LABEL_DISTANCE;
    },
    dispose() {
      group.removeFromParent();
      geometry?.dispose();
      material.dispose();
      labels.forEach((label) => disposeLabel(label.sprite));
    },
  };
}
