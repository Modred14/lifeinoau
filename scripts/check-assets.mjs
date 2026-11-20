// scripts/check-assets.mjs
// The guard that makes "every asset is cached" a rule the build enforces instead of a habit. It fails (exit 1) when game code loads an asset in a way that skips the shared system:
//   - a three.js loader (GLTFLoader, TextureLoader, FileLoader ...) or drei's useGLTF/useTexture used anywhere except lib3d/assets/
//   - fetch(), new Audio() or new Image() pointed straight at a managed folder (/models, /data, /textures, /maps, /audio)
//   - .src set straight to a managed folder
// Use lib3d/assets instead (loadJson, acquireGltf, acquireTexture, assetUrl): see docs/ASSETS.md. A file that truly must load something its own way is listed in ALLOWED with the reason, so it is a
// visible, reviewed decision and not an accident. Runs in `npm run build`, `npm run assets:check` and tests/assets.test.mjs.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ASSET_ROOTS } from "../assets.config.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["src", "components", "lib", "lib3d"];
const SKIP_DIRS = new Set(["node_modules", ".next"]);
const IMPLEMENTATION = "lib3d/assets/"; // the shared system itself is the one place allowed to touch loaders and the network

/** file -> why it may load assets directly. Keep this list short; every entry is a promise that the file's files are fresh or not cacheable. */
export const ALLOWED = {
  "lib/clubDj.js": "the DJ track list (public/audio/club/manifest.json) is dropped in by hand, may not exist, and is always revalidated; the tracks themselves are streamed by <audio>",
};

const roots = ASSET_ROOTS.join("|");
const LOADER_NAMES = "GLTFLoader|DRACOLoader|KTX2Loader|TextureLoader|ImageBitmapLoader|ImageLoader|CubeTextureLoader|FileLoader|AudioLoader|ObjectLoader|FBXLoader|OBJLoader|MTLLoader|RGBELoader|EXRLoader|ColladaLoader|STLLoader|PLYLoader|SVGLoader";
const RULES = [
  { id: "three-loader", re: new RegExp(`\\b(${LOADER_NAMES})\\b`), why: "use acquireGltf / acquireTexture / loadJson from lib3d/assets (shared, versioned, saved for the next visit)" },
  { id: "drei-loader", re: /\b(useGLTF|useTexture|useLoader|useFBX)\b/, why: "use the shared loaders in lib3d/assets" },
  { id: "direct-fetch", re: new RegExp(`\\bfetch\\(\\s*[\`"']/(${roots})/`), why: "use loadJson(path) / assetBytes(path) from lib3d/assets instead of fetching a managed file directly" },
  { id: "direct-media", re: new RegExp(`\\bnew (Audio|Image)\\(\\s*[\`"']/(${roots})/`), why: "wrap the path in assetUrl(path) so the file is versioned" },
  { id: "direct-src", re: new RegExp(`\\.src\\s*=\\s*[\`"']/(${roots})/`), why: "wrap the path in assetUrl(path) so the file is versioned" },
  { id: "direct-jsx-src", re: new RegExp(`\\bsrc=["']/(${roots})/`), why: "use src={assetUrl(path)} so the file is versioned" },
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) yield* walk(abs); else if (/\.(m?jsx?|tsx?)$/.test(name)) yield abs;
  }
}
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p) => p + " ".repeat(m.length - p.length));

/** [{ file, line, rule, text, why }] for every direct load that is not allowed. `root` is a repo root (tests point it at a temp folder). */
export function findViolations(root = ROOT, allowed = ALLOWED) {
  const out = [];
  for (const dir of SCAN) for (const abs of walk(path.join(root, dir))) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    if (rel.startsWith(IMPLEMENTATION) || rel in allowed) continue;
    const lines = stripComments(readFileSync(abs, "utf8")).split("\n");
    lines.forEach((text, i) => { for (const r of RULES) if (r.re.test(text)) out.push({ file: rel, line: i + 1, rule: r.id, text: text.trim().slice(0, 120), why: r.why }); });
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const bad = findViolations();
  if (bad.length) {
    console.error("Assets must be loaded through lib3d/assets (see docs/ASSETS.md). Found direct loads:\n");
    for (const v of bad) console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.text}\n      -> ${v.why}`);
    process.exit(1);
  }
  console.log("asset loading check: every asset goes through lib3d/assets");
}
