// tests/landmarks.test.mjs
// Every landmark must have the shape the map panel relies on. A missing argument in a L(...) call in lib3d/landmarks.js shifts the rest left
// (e.g. conf ends up in `actions`), and the panel then crashes on `L.actions.map` when the place is clicked (it was the Senate Building).
import assert from "node:assert/strict";
import { LANDMARKS } from "../lib3d/landmarks.js";
const ids = new Set();
for (const l of LANDMARKS) {
  assert.ok(!ids.has(l.id), `${l.id}: unique id`); ids.add(l.id);
  assert.ok(Array.isArray(l.actions), `${l.id}: actions is an array`);
  for (const a of l.actions) assert.ok(a && typeof a.href === "string" && typeof a.label === "string", `${l.id}: each action has a label and href`);
  assert.ok(["schematic", "relative", "name", "osm"].includes(l.conf), `${l.id}: conf is a known string (got ${JSON.stringify(l.conf)})`);
  assert.ok(Array.isArray(l.osm) && l.osm.every((s) => typeof s === "string"), `${l.id}: osm is an array of names`);
  assert.equal(typeof l.blurb, "string", `${l.id}: blurb`);
}
assert.ok(ids.has("senate"));
console.log("landmarks: ok", LANDMARKS.length);
