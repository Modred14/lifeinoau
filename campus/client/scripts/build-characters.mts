/**
 * Character asset pipeline.
 *
 *   npm run models -w web
 *
 * Turns the CC0 Quaternius character models listed in @campuslife/shared/avatar
 * into small, game-ready files in public/models/chars/:
 *
 *   {body}-{outfit}.glb  meshes only (no animations, smooth normals), parts renamed to slots
 *                        head / top / bottom / shoes, materials tagged with a
 *                        recolour role ("top:primary", "head:hair", ...)
 *   {body}-anims.glb     skeleton + the few animation clips the game uses
 *
 * Everything is quantized and meshopt-compressed (decoded in the browser by
 * three's MeshoptDecoder). Source files are cached in web/.cache/models.
 */
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Document, NodeIO, type Animation, type Material, type Node } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt, prune, resample, weld } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import * as THREE from "three";
import { ANIMATIONS, ANIMATION_SOURCE, OUTFITS, type BodyType, type Slot, type OutfitDef } from "@campuslife/shared/avatar";
import { smoothCharacterNormals } from "./smooth-character-normals.mts";
import { buildStudentClothes } from "./student-clothes.mts";
import { buildStudentHair } from "./student-hair.mts";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(webRoot, ".cache/models");
const outDir = path.join(webRoot, "public/models/chars");
const assetVersions: Record<string, string> = {};

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

/** Source mesh-name suffix -> slot. */
function slotFor(meshName: string): Slot | "backpack" | null {
  const n = meshName.toLowerCase();
  if (n === "backpack") return "backpack";
  if (/_head$/.test(n)) return "head";
  if (/_body$/.test(n)) return "top";
  if (/_(legs|pants)$/.test(n)) return "bottom";
  if (/_feet$/.test(n)) return "shoes";
  return null; // weapons etc. are dropped
}

/** Fixed roles by material name; clothing gets ranked into primary/secondary. */
function fixedRole(materialName: string): string | null {
  const n = materialName.toLowerCase();
  if (n === "skin") return "skin";
  if (n.startsWith("skin")) return "skin_shade";
  if (n.startsWith("hair") || n.includes("eyebrow") || n.includes("moustache")) return "hair";
  if (n === "eye") return "eye";
  return null;
}

function headRole(body: BodyType, id: string, materialName: string): string {
  const n = materialName.toLowerCase();
  if (n === "earrings" || n === "black" && body === "f" && id === "street") return "accessory";
  if (body === "m" && id === "street" && (n === "red" || n === "red_dark")) return n === "red_dark" ? "hair_shade" : "hair";
  if (body === "f" && id === "casual" && n === "hair_blond") return "hair";
  if (body === "f" && id === "street" && n === "pink") return "hair";
  if (body === "f" && id === "owambe" && n === "red") return "hair";
  if (body === "m" && n === "hair") return "hair";
  return "face";
}

async function fetchSource(uuid: string): Promise<Uint8Array> {
  const file = path.join(cacheDir, `${uuid}.glb`);
  try {
    await stat(file);
  } catch {
    const url = `https://static.poly.pizza/${uuid}.glb`;
    console.log("  downloading", url);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed ${res.status} ${url}`);
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  }
  return new Uint8Array(await readFile(file));
}

/** Animation.dispose() leaves samplers (and their keyframe accessors) alive; remove them too. */
function disposeAnimation(anim: Animation) {
  anim.listChannels().forEach((c) => c.dispose());
  anim.listSamplers().forEach((s) => s.dispose());
  anim.dispose();
}

async function compressAndWrite(doc: Document, name: string) {
  const bindReferences = doc.getRoot().listNodes().filter((node) => node.getMesh() && node.getSkin()).map((node) => ({
    node,
    world: new THREE.Matrix4().fromArray(node.getWorldMatrix()),
    inverse: new THREE.Matrix4().fromArray(node.getSkin()!.getInverseBindMatrices()!.getElement(0, [])).invert(),
  }));
  await doc.transform(prune({ keepAttributes: false }), meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  for (const { node, world, inverse } of bindReferences) {
    const compressed = new THREE.Matrix4().fromArray(node.getSkin()!.getInverseBindMatrices()!.getElement(0, []));
    const restTransform = world.multiply(inverse).multiply(compressed).toArray();
    for (const primitive of node.getMesh()!.listPrimitives()) {
      const material = primitive.getMaterial()!;
      material.setExtras({ ...material.getExtras(), restTransform });
    }
  }
  const bytes = await io.writeBinary(doc);
  await writeFile(path.join(outDir, name), bytes);
  assetVersions[name] = createHash("sha256").update(bytes).digest("hex").slice(0, 12);
  console.log(`  ${name.padEnd(24)} ${(bytes.byteLength / 1024).toFixed(0).padStart(4)} KB`);
  return bytes.byteLength;
}

/** Outfit file: meshes only, slot-named parts, role-named materials. */
async function buildOutfit(body: BodyType, outfit: OutfitDef) {
  const doc = await io.readBinary(await fetchSource(outfit.source));
  const root = doc.getRoot();
  root.listAnimations().forEach(disposeAnimation);

  const meshNodes: Node[] = root.listNodes().filter((n) => n.getMesh());
  for (const node of meshNodes) {
    const mesh = node.getMesh()!;
    const slot = slotFor(mesh.getName());
    if (!slot) {
      node.dispose();
      continue;
    }
    const partSlot: Slot = slot === "backpack" ? "top" : slot;
    node.setName(slot === "backpack" ? "top_backpack" : slot);
    mesh.setName(node.getName());

    // Rank this part's clothing materials by triangle count.
    const prims = mesh.listPrimitives();
    const clothing = prims
      .filter((p) => !fixedRole(p.getMaterial()?.getName() ?? ""))
      .sort((a, b) => (b.getIndices()?.getCount() ?? 0) - (a.getIndices()?.getCount() ?? 0));

    for (const prim of prims) {
      const src = prim.getMaterial();
      if (!src) continue;
      const fixed = fixedRole(src.getName());
      const sourceId = OUTFITS[body].find((item) => !item.style && item.source === outfit.source)?.id ?? outfit.id;
      let role = slot === "head" ? headRole(body, sourceId, src.getName()) : fixed;
      if (!role) {
        const rank = clothing.indexOf(prim);
        // Backpack never follows the shirt colour.
        role = slot === "backpack" ? "fixed" : rank === 0 ? "primary" : rank === 1 ? "secondary" : "fixed";
      }
      const skin = role === "skin" || role === "skin_shade";
      const angle = skin ? 100 : partSlot === "shoes" ? 40 : role === "hair" || role === "hair_shade" ? 45 : 70;
      smoothCharacterNormals(prim, angle * Math.PI / 180);
      // Clone per part so recolouring shoes can't recolour the shirt via a shared material.
      const mat: Material = src.clone().setName(`${partSlot}:${role}`);
      mat.setMetallicFactor(0).setRoughnessFactor(skin ? 0.72 : partSlot === "shoes" ? 0.62 : 0.9);
      prim.setMaterial(mat);
    }
  }
  if (outfit.style) buildStudentClothes(doc, body, outfit.style, outfit.slots!);
  if (outfit.hairstyle) buildStudentHair(doc, body, outfit.hairstyle);
  await doc.transform(weld());
  return compressAndWrite(doc, `${body}-${outfit.id}.glb`);
}

/** Animation file: skeleton + selected clips, no meshes. */
async function buildAnimations(body: BodyType, uuid: string) {
  const doc = await io.readBinary(await fetchSource(uuid));
  const root = doc.getRoot();
  const keep = new Set<string>(ANIMATIONS);
  for (const anim of root.listAnimations()) {
    const name = anim.getName().split("|").pop() ?? "";
    if (keep.has(name)) anim.setName(name);
    else disposeAnimation(anim);
  }
  for (const node of root.listNodes()) if (node.getMesh()) node.dispose();
  root.listSkins().forEach((s) => s.dispose());
  await doc.transform(resample({ tolerance: 1e-4 }));
  return compressAndWrite(doc, `${body}-anims.glb`);
}

await mkdir(outDir, { recursive: true });
let total = 0;
for (const body of ["m", "f"] as const) {
  console.log(`Body ${body}:`);
  total += await buildAnimations(body, ANIMATION_SOURCE[body]);
  for (const o of OUTFITS[body]) total += await buildOutfit(body, o);
}

await writeFile(
  path.join(outDir, "CREDITS.txt"),
  [
    "Character models: Quaternius (https://quaternius.com), via poly.pizza.",
    "\"Ultimate Modular Men Pack\" and \"Ultimate Modular Women Pack\".",
    "License: CC0 1.0 Universal (public domain). Attribution not required, but appreciated.",
    "Processed by web/scripts/build-characters.mts (parts split, animations trimmed, meshopt-compressed).",
    "",
  ].join("\n"),
);
await writeFile(path.join(webRoot, "game/character-assets.ts"), `export const CHARACTER_ASSET_VERSIONS = ${JSON.stringify(assetVersions, null, 2)} as const;\n`);
console.log(`Total: ${(total / 1024).toFixed(0)} KB`);
