// tools/oau/dump-legacy-merged.mjs: the OLD map with the game's extras merged in (withExtras), as one JSON file: the input import_campus.py reads for the place list and the extras' footprints.
//   node tools/oau/dump-legacy-merged.mjs /tmp/legacy-merged.json
import fs from "node:fs";
import { withExtras } from "../../lib3d/mapExtras.js";
const src = new URL("../../public/data/oau-campus.legacy.json", import.meta.url), out = process.argv[2] || "/tmp/legacy-merged.json";
fs.writeFileSync(out, JSON.stringify(withExtras(JSON.parse(fs.readFileSync(src, "utf8")))));
console.log("wrote " + out);
