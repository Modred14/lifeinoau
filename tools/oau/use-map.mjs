// tools/oau/use-map.mjs: switch the campus map the game uses. One command, either way:
//   node tools/oau/use-map.mjs osm        the OpenStreetMap map (default for new work)
//   node tools/oau/use-map.mjs legacy     the original traced map: the way back
//   node tools/oau/use-map.mjs --status   which map is active
//   node tools/oau/use-map.mjs --save     store the active files as the active map's own copy (npm run build:roads does this when it finishes)
// Each map keeps its own copy of the three files that belong to it in tools/oau/maps/<map>/ (outside public/, so the game never ships the map that is not in use); the ACTIVE copy is the plain name the game and
// the tools read:  public/data/oau-campus.json, public/data/oau-roadgraph.json, tools/oau/roadgraph.raw.json
// and lib3d/mapLayout.js (LAYOUT) picks the expressway's waypoints, interchanges, tails and the billboard sites. Before switching, whatever is active is saved back to its own map's copy, so a
// rebuilt road graph is never lost. After switching, rebuild nothing: the stored files are already consistent with each other. Restart the dev server (and clear the browser's cache) to see it.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url)), p = (f) => root + f;
const FILES = ["public/data/oau-campus.json", "public/data/oau-roadgraph.json", "tools/oau/roadgraph.raw.json"];   // the active copies
const stored = (map, f) => "tools/oau/maps/" + map + "/" + f.split("/").pop();   // each map keeps its own copy here: outside public/, so the game never ships or caches the copy of the map that is not in use
const layoutFile = p("lib3d/mapLayout.js"), re = /export const LAYOUT = "(\w+)";(\s*\/\/ MAP-LAYOUT-SWITCH)/;
const current = () => fs.readFileSync(layoutFile, "utf8").match(re)[1];
const want = process.argv[2];
if (want === "--status" || !want) { console.log("active map: " + current()); process.exit(0); }
if (want === "--save") { const m = current(); for (const f of FILES) if (fs.existsSync(p(f))) fs.copyFileSync(p(f), p(stored(m, f))); console.log("saved the active files as the " + m + " map's copy"); process.exit(0); }
if (!["osm", "legacy"].includes(want)) { console.error("usage: node tools/oau/use-map.mjs osm|legacy|--status|--save"); process.exit(1); }
const cur = current();
if (cur !== want) for (const f of FILES) {             // 1. switching: save the active files into the current map's own copy first (keeps a rebuilt graph). Choosing the map that is already active reloads its stored copy instead.
  if (fs.existsSync(p(f))) fs.copyFileSync(p(f), p(stored(cur, f)));
}
const missing = FILES.filter((f) => !fs.existsSync(p(stored(want, f)))).map((f) => stored(want, f));
if (missing.length) { console.error("cannot switch to " + want + ": missing " + missing.join(", ")); process.exit(1); }
for (const f of FILES) fs.copyFileSync(p(stored(want, f)), p(f));   // 2. activate the wanted map's files
fs.writeFileSync(layoutFile, fs.readFileSync(layoutFile, "utf8").replace(re, `export const LAYOUT = "${want}";$2`));   // 3. its layout
console.log("active map is now: " + want + (cur === want ? " (it already was: its files were reloaded from the stored copy)" : ""));
