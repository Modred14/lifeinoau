// scripts/copy-draco.mjs
// Copies three.js's Draco decoder into public/draco/r<three revision>/gltf/ so compressed (Draco) .glb models can be decoded from our own site, with the cache rules in next.config.mjs.
// The folder name carries three's revision, so the files under one URL never change and can be cached for a year. Runs before `build` and `dev`; the copy is git-ignored.
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = path.join(ROOT, "node_modules/three/package.json");
if (!existsSync(pkg)) { console.log("copy-draco: three is not installed, skipped"); process.exit(0); }
const revision = /^0\.(\d+)/.exec(JSON.parse(readFileSync(pkg, "utf8")).version)?.[1];
const from = path.join(ROOT, "node_modules/three/examples/jsm/libs/draco/gltf"), to = path.join(ROOT, "public/draco", `r${revision}`, "gltf");
if (!revision || !existsSync(from)) { console.log("copy-draco: no Draco decoder found in three, skipped"); process.exit(0); }
mkdirSync(to, { recursive: true }); cpSync(from, to, { recursive: true });
console.log(`copy-draco: decoder for three r${revision} -> public/draco/r${revision}/gltf/`);
