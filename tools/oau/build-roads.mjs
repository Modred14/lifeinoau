// tools/oau/build-roads.mjs: the whole road build, one command, any OS (npm run build:roads):
//   1. dump-merged.mjs     the active map + the game's extras  ->  a temp file
//   2. roadgraph.py        raster + skeleton                    ->  tools/oau/roadgraph.raw.json      (needs python with numpy, scipy, scikit-image, shapely)
//   3. refine-roads.mjs    straighten, classify, add the expressway and its ramps -> public/data/oau-roadgraph.json
//   4. attach-tails.mjs    join the expressway's two ends to campus roads and move piers off roads
// Which map is active is public/data/oau-campus.json (switch with: node tools/oau/use-map.mjs osm|legacy).
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url)), tmp = path.join(os.tmpdir(), "oau-merged.json");
const run = (cmd, args) => { console.log("\n> " + [cmd, ...args].join(" ")); const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" }); if (r.status !== 0) { console.error("step failed: " + cmd + " " + args[0]); process.exit(r.status || 1); } };
const py = [["python3", []], ["python", []], ["py", ["-3"]]].find(([c, a]) => spawnSync(c, [...a, "-c", "import numpy, scipy, skimage, shapely"], { stdio: "ignore" }).status === 0);
if (!py) { console.error("No python with numpy, scipy, scikit-image and shapely found. Install:  pip install numpy scipy scikit-image shapely"); process.exit(1); }
run(process.execPath, ["tools/oau/dump-merged.mjs", tmp]);
run(py[0], [...py[1], "tools/oau/roadgraph.py", tmp, "tools/oau/roadgraph.raw.json"]);
run(process.execPath, ["tools/oau/refine-roads.mjs"]);
run(process.execPath, ["tools/oau/attach-tails.mjs"]);
console.log("\nroad build done: public/data/oau-roadgraph.json");
