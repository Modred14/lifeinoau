// tools/avaters/make_npc_lod.mjs
// Builds the lighter "crowd" copy of every avatar model (public/models/avatars/lod/...). NPCs use these so many realistic people fit on screen,
// while the player keeps the full-detail files. Same skeleton, same bone names, same material names, same UVs: only triangles and texture size shrink.
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions meshoptimizer sharp
//   node tools/avaters/make_npc_lod.mjs [maxTexture=1024]
import { NodeIO } from "@gltf-transform/core";
import { weld, simplify, textureCompress, prune, dedup } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";

const root = process.env.AVATAR_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/models/avatars"), out = path.join(root, "lod"), maxTex = +(process.argv[2] || 1024);
// Share of triangles kept. Skin and clothes keep half (silhouettes stay smooth), hair cards a bit less (they are many thin overlapping strips).
const RATIO = { base: 0.5, outfit: 0.5, hair: 0.45 };
await MeshoptSimplifier.ready;
const io = new NodeIO();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === "lod" || e.name === "anim" ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".glb") ? [path.join(d, e.name)] : []));
let before = 0, after = 0;
for (const f of walk(root)) {
  const rel = path.relative(root, f), kind = rel.startsWith("parts/hair") ? "hair" : rel.startsWith("parts/outfit") ? "outfit" : "base";
  const doc = await io.read(f);
  await doc.transform(
    weld({ tolerance: 0.0001 }),
    simplify({ simplifier: MeshoptSimplifier, ratio: RATIO[kind], error: 0.01, lockBorder: kind !== "hair" }),
    dedup(), prune(),
    textureCompress({ encoder: sharp, resize: [maxTex, maxTex] }),
  );
  const dest = path.join(out, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); await io.write(dest, doc);
  before += fs.statSync(f).size; after += fs.statSync(dest).size; console.log(rel.padEnd(34), (fs.statSync(f).size / 1e6).toFixed(2), "->", (fs.statSync(dest).size / 1e6).toFixed(2), "MB");
}
console.log(`total ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
