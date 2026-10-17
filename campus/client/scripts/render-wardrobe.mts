import { mkdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import * as THREE from "three";
import type { GLTFLoader as Loader } from "three/addons/loaders/GLTFLoader.js";
import { DEFAULT_LOOK, SLOTS, STUDENT_OUTFITS, applyStudentOutfit, decodeLook, encodeLook, slotOptions, type Slot } from "@campuslife/shared/avatar";
import { Character } from "../game/characters.ts";

const require = createRequire(import.meta.url);
const { GLTFLoader } = require("three/addons/loaders/GLTFLoader.js") as { GLTFLoader: typeof Loader };
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(webRoot, "public/wardrobe/parts");
await mkdir(directory, { recursive: true });
GLTFLoader.prototype.loadAsync = async function (url: string) {
  const pathname = new URL(url, "http://localhost").pathname.replace(/^\/campus\//, "/");
  const bytes = await readFile(path.join(webRoot, "public", pathname));
  return this.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
};

function visible(node: THREE.Object3D) {
  for (let current: THREE.Object3D | null = node; current; current = current.parent) if (!current.visible) return false;
  return true;
}

export async function render(character: Character, slot?: Slot, width = 220, height = 220, view?: { angle?: number; elevation?: number; crop?: THREE.Box3 }) {
  character.root.updateMatrixWorld(true);
  const meshes: THREE.Mesh[] = [];
  character.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !visible(mesh)) return;
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    if (slot && !material.name.startsWith(`${slot}:`)) {
      if (slot !== "head") return;
      let parent: THREE.Object3D | null = mesh;
      while (parent && parent.name !== "student-face") parent = parent.parent;
      if (!parent) return;
    }
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.update();
    meshes.push(mesh);
  });
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  for (const mesh of meshes) for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) box.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
  if (view?.crop) box.copy(view.crop);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const span = Math.max(size.y, size.x * height / width) * 1.2;
  const camera = new THREE.OrthographicCamera(-span * width / height / 2, span * width / height / 2, span / 2, -span / 2, 0.1, 20);
  const angle = view?.angle ?? Math.atan2(1.3, 5);
  camera.position.copy(center).add(new THREE.Vector3(Math.sin(angle) * 5, view?.elevation ?? (slot === "shoes" ? 1.5 : 0.23), Math.cos(angle) * 5));
  camera.lookAt(center); camera.updateMatrixWorld();
  const pixels = new Uint8Array(width * height * 4), depths = new Float32Array(width * height).fill(Infinity);
  const light = new THREE.Vector3(-0.4, 0.8, 1).normalize();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const screen = (point: THREE.Vector3) => { point.project(camera); point.x = (point.x + 1) * width / 2; point.y = (1 - point.y) * height / 2; };
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  for (const mesh of meshes) {
    const geometry = mesh.geometry, index = geometry.getIndex(), count = index?.count ?? geometry.getAttribute("position").count;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const vertices: THREE.Vector3[] = [], brightness: number[] = [];
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const skinned = mesh as THREE.SkinnedMesh;
    const normalAttribute = geometry.getAttribute("normal"), skinIndex = geometry.getAttribute("skinIndex"), skinWeight = geometry.getAttribute("skinWeight");
    const bindNormal = skinned.isSkinnedMesh ? new THREE.Matrix3().setFromMatrix4(skinned.bindMatrix) : undefined;
    const inverseBindNormal = skinned.isSkinnedMesh ? new THREE.Matrix3().setFromMatrix4(skinned.bindMatrixInverse) : undefined;
    const boneNormal = new THREE.Matrix3(), boneMatrix = new THREE.Matrix4(), normal = new THREE.Vector3(), sourceNormal = new THREE.Vector3(), weighted = new THREE.Vector3();
    for (let i = 0; i < geometry.getAttribute("position").count; i++) {
      vertices.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      normal.fromBufferAttribute(normalAttribute, i);
      if (bindNormal && inverseBindNormal) {
        sourceNormal.copy(normal).applyMatrix3(bindNormal); normal.set(0, 0, 0);
        for (let j = 0; j < 4; j++) {
          const weight = skinWeight.getComponent(i, j);
          if (weight === 0) continue;
          boneMatrix.fromArray(skinned.skeleton.boneMatrices!, skinIndex.getComponent(i, j) * 16);
          boneNormal.setFromMatrix4(boneMatrix);
          normal.addScaledVector(weighted.copy(sourceNormal).applyMatrix3(boneNormal), weight);
        }
        normal.applyMatrix3(inverseBindNormal);
      }
      normal.applyMatrix3(normalMatrix).normalize();
      brightness.push(0.60 + Math.max(0, normal.dot(light)) * 0.50);
    }
    for (let i = 0; i < count; i += 3) {
      const materialIndex = geometry.groups.find((group) => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0;
      const material = mats[materialIndex] as THREE.MeshStandardMaterial;
      const ia = index?.getX(i) ?? i, ib = index?.getX(i + 1) ?? i + 1, ic = index?.getX(i + 2) ?? i + 2;
      a.copy(vertices[ia]); b.copy(vertices[ib]); c.copy(vertices[ic]);
      const color = material.color.clone().convertLinearToSRGB();
      screen(a); screen(b); screen(c);
      const area = cross(b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y);
      if (Math.abs(area) < 0.001) continue;
      if (material.side !== THREE.DoubleSide && area > 0) continue;
      const left = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x))), right = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
      const top = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y))), bottom = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const wa = cross(b.x - x - 0.5, b.y - y - 0.5, c.x - x - 0.5, c.y - y - 0.5) / area;
        const wb = cross(c.x - x - 0.5, c.y - y - 0.5, a.x - x - 0.5, a.y - y - 0.5) / area;
        const wc = 1 - wa - wb;
        if (Math.min(wa, wb, wc) < -0.001) continue;
        const depth = wa * a.z + wb * b.z + wc * c.z, target = y * width + x;
        if (depth >= depths[target]) continue;
        depths[target] = depth;
        const shade = wa * brightness[ia] + wb * brightness[ib] + wc * brightness[ic];
        pixels[target * 4] = Math.min(255, Math.round(color.r * shade * 255));
        pixels[target * 4 + 1] = Math.min(255, Math.round(color.g * shade * 255));
        pixels[target * 4 + 2] = Math.min(255, Math.round(color.b * shade * 255));
        pixels[target * 4 + 3] = 255;
      }
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 4 } }).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const contact: { input: Buffer; top: number; left: number }[] = [];
for (const [bodyIndex, body] of (["m", "f"] as const).entries()) {
  const base = decodeLook(encodeLook({ ...DEFAULT_LOOK, body, skin: 3, top: "casual", bottom: "casual", shoes: "sneakers", topColor: 0, bottomColor: 3 }));
  const character = new Character(encodeLook(base));
  await character.whenReady(); character.update(0.5, 0);
  await sharp(await render(character, undefined, 180, 280)).toFile(path.join(directory, `${body}-body.webp`));
  for (const slot of SLOTS) for (const option of slotOptions(body, slot)) {
    character.setLook(encodeLook({ ...base, [slot]: option.id, topColor: slot === "top" ? 6 : base.topColor }));
    await character.whenReady(); character.update(0.5, 0);
    await sharp(await render(character, slot)).toFile(path.join(directory, `${body}-${slot}-${option.id}.webp`));
  }
  for (const [i, outfit] of STUDENT_OUTFITS.entries()) {
    character.setLook(encodeLook(applyStudentOutfit(base, outfit.id)));
    await character.whenReady(); character.update(0.5, 0);
    await sharp(await render(character, undefined, 240, 360)).toFile(path.join(directory, `${body}-outfit-${outfit.id}.webp`));
    contact.push({ input: await render(character, undefined, 180, 280), left: (i % 6) * 180, top: (bodyIndex * 2 + Math.floor(i / 6)) * 280 });
  }
  character.dispose();
  console.log(`Saved ${body} body and garment thumbnails`);
}
const verificationDir = path.join(webRoot, "../.local/verification");
await mkdir(verificationDir, { recursive: true });
await sharp({ create: { width: 1080, height: 1120, channels: 4, background: "#344d33" } }).composite(contact).png().toFile(path.join(verificationDir, "wardrobe-models.png"));
}
