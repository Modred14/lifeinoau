// tools/oau/refine-roads.mjs
// Bakes the road network the game loads: the generator's raw centrelines (tools/oau/roadgraph.raw.json, from roadgraph.py) are straightened, pruned and classified
// (lib3d/roadrefine.js), then the expressway and its ramps are added (lib3d/highway.js), and the result is written to public/data/oau-roadgraph.json.
//   node tools/oau/refine-roads.mjs            (writes the file)      --check  prints the report only      --out=path  writes the result somewhere else
import fs from "node:fs";
import { withExtras } from "../../lib3d/mapExtras.js";
import { buildWorldCollision } from "../../lib3d/collide.js";
import { refineRoadNetwork } from "../../lib3d/roadrefine.js";

const root = new URL("../../", import.meta.url), read = (p) => JSON.parse(fs.readFileSync(new URL(p, root), "utf8"));
const data = withExtras(read("public/data/oau-campus.json")), rawIn = read("tools/oau/roadgraph.raw.json"), world = buildWorldCollision(data);
const { raw, report } = refineRoadNetwork(rawIn, data, { sdf: (x, z) => world.sdf(x, z, 12) });
let out = raw;
try { const hw = await import("../../lib3d/highway.js"); out = hw.addExpressway(raw, data, { sdf: (x, z) => world.sdf(x, z, 12) }); report.expressway = out.expressway?.summary; } catch (e) { if (e.code !== "ERR_MODULE_NOT_FOUND") throw e; }
out._file = "public/data/oau-roadgraph.json"; out.version = (rawIn.version ?? 1) + 1; out.inputHash = rawIn.inputHash; out.params = { ...rawIn.params, refine: true };
console.log(JSON.stringify(report, null, 1));
const to = process.argv.find((a) => a.startsWith("--out="))?.slice(6);   // --out=path writes somewhere else (for inspection)
if (to) { fs.writeFileSync(to, JSON.stringify(out) + "\n"); console.log("wrote " + to); }
else if (!process.argv.includes("--check")) { fs.writeFileSync(new URL("public/data/oau-roadgraph.json", root), JSON.stringify(out) + "\n"); console.log("wrote public/data/oau-roadgraph.json"); }
