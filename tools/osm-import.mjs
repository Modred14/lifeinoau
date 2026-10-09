// tools/osm-import.mjs
// Usage: node tools/osm-import.mjs <overpass-export.json> [public/oau-osm.json] [--bbox south,west,north,east] [--max-buildings 6000]
// Turns a real OpenStreetMap export of OAU into public/oau-osm.json. The map then draws OAU's real roads, building outlines and names.
import fs from "node:fs";
import { fromOverpass, matchLandmarks } from "../lib3d/osm.js";
import { LANDMARKS } from "../lib3d/landmarks.js";

const args = process.argv.slice(2), flag = (n) => { const i = args.indexOf(n); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bbox = flag("--bbox")?.split(",").map(Number), maxBuildings = Number(flag("--max-buildings") ?? 6000);
const [input, output = "public/oau-osm.json"] = args;
if (!input) { console.error("Usage: node tools/osm-import.mjs <overpass-export.json> [public/oau-osm.json] [--bbox s,w,n,e] [--max-buildings N]"); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(input, "utf8"));
if (raw._note) console.warn("WARNING:", raw._note);
const data = fromOverpass(raw, { bbox, maxBuildings });
const m = matchLandmarks(data, LANDMARKS);
data.synthetic = !!raw._note; // never let test data pass as real
fs.writeFileSync(output, JSON.stringify(data));
console.log(`Wrote ${output} (${Math.round(fs.statSync(output).size / 1024)} KB)`);
console.log(`  roads ${data.roads.length}, buildings ${data.buildings.length} (${data.stats.buildingsCulled} culled), trees ${data.trees.length}, named features ${data.named.length}`);
console.log(`  game places found in the real data: ${m.found.length} of ${LANDMARKS.length}`);
if (m.missing.length) console.log(`  not found (will be hidden in real-data mode): ${m.missing.join(", ")}`);
if (data.stats.skippedRelations) console.log(`  note: ${data.stats.skippedRelations} relations skipped (multipolygon buildings are not drawn yet)`);
