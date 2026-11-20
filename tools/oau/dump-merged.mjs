// tools/oau/dump-merged.mjs
// Writes the input tools/oau/roadgraph.py reads: the campus map with the game's extra buildings merged in (withExtras), its road polygons and its water.
//   node tools/oau/dump-merged.mjs /tmp/oau-merged.json [path/to/campus.json]     (default map: public/data/oau-campus.json, or tools/oau/maps/legacy/oau-campus.json when OAU_MAP=legacy)
// RECREATED: the original of this file was missing from the repository (npm run build:roads called it). It is checked by reproducing the committed tools/oau/roadgraph.raw.json from the old map.
import fs from "node:fs";
import crypto from "node:crypto";
import { withExtras } from "../../lib3d/mapExtras.js";
import { mapFile } from "./mapfile.mjs";

const out = process.argv[2] || "oau-merged.json", src = process.argv[3] || mapFile();
const d = withExtras(JSON.parse(fs.readFileSync(src, "utf8")));
const merged = { bounds: d.bounds, buildings: d.buildings.map((b) => ({ id: b.id, pts: b.pts })), roads: d.roads, water: (d.areas && d.areas.water) || [] };
merged.inputHash = crypto.createHash("sha1").update(JSON.stringify(merged)).digest("hex");
fs.writeFileSync(out, JSON.stringify(merged));
console.log("wrote " + out + " (" + merged.buildings.length + " buildings, " + merged.roads.length + " roads, " + merged.water.length + " water) from " + src);
