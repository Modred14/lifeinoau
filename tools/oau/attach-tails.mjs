// tools/oau/attach-tails.mjs
// Joins the expressway's two ends to the campus roads (lib3d/highway.js attachTails, geometry in lib3d/highwaytails.js) in the BAKED road graph, public/data/oau-roadgraph.json.
// It also moves any pier that stands in a road to the nearest clear place along the deck.
// It edits the committed file in place and leaves every ground road (and every id) as it was; a graph that already has its tails is left alone.
//   node tools/oau/attach-tails.mjs            (writes the file)      --check  prints the report only      --out=path  writes the result somewhere else
import fs from "node:fs";
import { attachTails, relocatePiers } from "../../lib3d/highway.js";
import { withExtras } from "../../lib3d/mapExtras.js";
import { buildServices } from "../../lib3d/worldsvc.js";
const root = new URL("../../", import.meta.url), file = new URL("public/data/oau-roadgraph.json", root), g = JSON.parse(fs.readFileSync(file, "utf8"));
if (g.expressway?.descents) { console.log("the expressway already has its tails: nothing to do"); process.exit(0); }
const out = attachTails(g); out.version = (g.version ?? 1) + 1;
// then every pier that stands on a road is moved to the nearest place along the deck where it does not (judged on the real built graph)
const data = withExtras(JSON.parse(fs.readFileSync(new URL("public/data/oau-campus.json", root), "utf8"))), svc = buildServices(data, out), rel = relocatePiers(out, svc.graph);
console.log("piers moved off roads:", rel.moved.length, JSON.stringify(rel.moved), "| removed (neighbours span it):", JSON.stringify(rel.removed), "| could not be moved:", JSON.stringify(rel.stuck));
console.log(JSON.stringify(out.expressway.summary, null, 1));
const to = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (to) { fs.writeFileSync(to, JSON.stringify(out) + "\n"); console.log("wrote " + to); }
else if (!process.argv.includes("--check")) { fs.writeFileSync(file, JSON.stringify(out) + "\n"); console.log("wrote public/data/oau-roadgraph.json"); }
