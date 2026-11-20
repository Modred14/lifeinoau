// tools/measure-assets.mjs
// Measures what the asset system does across visits, with the REAL files and manifest of this repo and a simulated network (a fake server that counts requests and bytes) and a fake Cache Storage.
// It proves the behaviour (what is requested, what is saved, what is reused); the transfer times are ESTIMATES from the stated bandwidth, not browser measurements. For real timings use DevTools
// (see docs/ASSETS.md, "Measuring"). Usage: node tools/measure-assets.mjs [--mbps 4] [--rtt 150]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAssetLoader } from "../lib3d/assets/loader.js";
import { createStore } from "../lib3d/assets/store.js";
import { createManifest, manifest as realManifest } from "../lib3d/assets/manifest.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const MBPS = arg("--mbps", 4), RTT = arg("--rtt", 150), CONC = 4;

function fakeCaches() {
  const stores = new Map(), keyOf = (r) => new URL(typeof r === "string" ? r : r.url, "http://localhost").href;
  return { open: async (n) => { if (!stores.has(n)) stores.set(n, new Map()); const m = stores.get(n); return { match: async (r) => m.get(keyOf(r))?.clone(), put: async (r, res) => { m.set(keyOf(r), res); }, delete: async (r) => m.delete(keyOf(r)), keys: async () => [...m.keys()].map((k) => new Request(k)) }; } };
}

const mb = (n) => (n / 1048576).toFixed(2) + " MB", secs = (bytes, reqs) => (bytes * 8 / (MBPS * 1e6) + RTT / 1000 * Math.ceil(reqs / CONC)).toFixed(1) + " s";
/** One page load: the paths the game needs at start, in the order the game asks for them. */
async function visit(label, { man, store, files, needed }) {
  const log = []; let bytes = 0;
  const fetchImpl = async (url) => { const p = new URL(url, "http://x").pathname; log.push(p); const f = files(p); if (!f) return new Response("nf", { status: 404 }); bytes += f.length; return new Response(f, { status: 200, headers: { "content-length": String(f.length) } }); };
  const L = createAssetLoader({ manifest: man, store, fetchImpl, concurrency: CONC });
  await store.prune(man.currentUrls());
  await Promise.all(needed.map((p, i) => L.bytes(p, { priority: i < 2 ? 0 : 1 })));
  await new Promise((r) => setTimeout(r, 30)); // let the saves finish
  const s = L.stats();
  return { label, requests: log.length, network: mb(bytes), fromSavedCopy: s.persistentHits, hitRate: (s.cacheHitRate * 100).toFixed(0) + "%", estTime: secs(bytes, log.length), usage: mb((await store.usage()).bytes) };
}

const publicFile = (p) => { const f = path.join(ROOT, "public", p); return fs.existsSync(f) ? fs.readFileSync(f) : null; };
const AV = "/models/avatars";
// what the game asks for at start: the map, the road graph, both base bodies, the player's hair and outfit, and the looks of five characters in view
const needed = ["/data/oau-campus.json", "/data/oau-roadgraph.json", `${AV}/base_female.glb`, `${AV}/base_male.glb`, `${AV}/parts/hair/afro_f.glb`, `${AV}/parts/outfit/casual_f.glb`,
  `${AV}/parts/hair/braids_m.glb`, `${AV}/parts/outfit/office_m.glb`, `${AV}/parts/hair/long_f.glb`, `${AV}/parts/outfit/campus_f.glb`, `${AV}/parts/hair/classic_m.glb`, `${AV}/parts/outfit/sitework_m.glb`, `${AV}/parts/hair/lowcut_f.glb`, `${AV}/parts/outfit/owambe_f.glb`].filter((p) => realManifest.has(p));
const store = createStore({ cacheStorage: fakeCaches(), budget: 400 * 1048576, isCurrent: () => true });
const rows = [];
rows.push(await visit("1. first visit", { man: realManifest, store, files: publicFile, needed }));
rows.push(await visit("2. reload / second visit", { man: realManifest, store, files: publicFile, needed }));
rows.push(await visit("3. new visit later the same day", { man: realManifest, store, files: publicFile, needed }));
// a deployment that changes ONE avatar file
const changed = `${AV}/parts/outfit/office_m.glb`, base = realManifest.info(changed);
const data = { version: "next", assets: Object.fromEntries(realManifest.paths().map((p) => [p, { ...realManifest.info(p), ...(p === changed ? { v: "deadbeef00" } : {}) }])) };
const man2 = createManifest(data), newBytes = Buffer.concat([publicFile(changed), Buffer.from("x")]);
rows.push(await visit("4. after a deployment that changed 1 model", { man: man2, store, files: (p) => (p === changed ? newBytes : publicFile(p)), needed }));
rows.push(await visit("5. visit after that", { man: man2, store, files: (p) => (p === changed ? newBytes : publicFile(p)), needed }));
console.log(`Simulated network: ${MBPS} Mbps, ${RTT} ms round trip, ${CONC} parallel downloads. Files needed at start: ${needed.length} (${mb(needed.reduce((s, p) => s + realManifest.info(p).bytes, 0))}).\n`);
console.table(rows);
