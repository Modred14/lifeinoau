// lib/adminPlaces.js
// Place ids on the map ("h_awo", "floor0") as the names players know, read from the same campus data file the game uses.
import fs from "node:fs";
import path from "node:path";
import { withExtras } from "../lib3d/mapExtras.js";

let names;
export function placeName(id) {
  if (!id) return "At home";
  if (!names) {
    names = new Map([["floor0", "Floor O (N-QRS Custody)"]]);
    try { for (const p of withExtras(JSON.parse(fs.readFileSync(path.join(process.cwd(), "public", "data", "oau-campus.json"), "utf8"))).places) names.set(p.id, p.name); } catch { /* names stay empty: the id is shown instead */ }
  }
  return names.get(id) ?? id;
}
