// tests/open-spaces.test.mjs
// The open-air places are walkable social spaces: sensible crowd size and placement, nobody inside a bench or tree, nobody on the doorstep, stable names.
import assert from "node:assert/strict";
import { OPEN_SPACES, isOpenSpace, buildOpenInterior } from "../lib3d/interiors/openSpaces.js";
import { hasInterior, classify } from "../lib3d/interiors/registry.js";
import { studentName, greetLine, chatLine } from "../lib/socialTalk.js";
import { dimsOf } from "../lib3d/interiors/items.js";

for (const id of Object.keys(OPEN_SPACES)) {
  assert.ok(isOpenSpace(id)); assert.equal(hasInterior(id, "hall"), false, id + " must stay a non-building"); assert.equal(classify(id, "hall").mode, "outdoor");
  const c = buildOpenInterior({ id, name: id, kind: "hall" }); assert.ok(c, id); assert.equal(c.plan.family, "open");
  const S = OPEN_SPACES[id], area = S.w * S.d, n = c.npcs.length;
  assert.ok(n >= 8 && n <= 28, `${id}: ${n} people is not a sensible crowd`); assert.ok(n / area < 0.025, id + " is too dense");
  const modes = new Set(c.npcs.map((p) => p.mode)); for (const m of ["sit", "talk", "wander"]) assert.ok(modes.has(m), id + " has no " + m);
  for (const p of c.npcs) {
    assert.equal(p.social, true); assert.ok(p.x > 0.5 && p.x < S.w - 0.5 && p.z > 0.5 && p.z < S.d - 0.5, id + ": someone outside the fence");
    assert.ok(Math.hypot(p.x - S.w / 2, p.z - S.d) > 3, id + ": someone on the doorstep");
    if (p.mode !== "sit") for (const it of c.items) { const d = dimsOf(it); assert.ok(Math.hypot(p.x - it.x, p.z - it.z) > Math.min(d.w, d.d) / 2 - 0.05, `${id}: someone inside a ${it.type}`); }
  }
  for (const g of new Set(c.npcs.filter((p) => p.mode === "talk").map((p) => p.group))) assert.ok(c.npcs.filter((p) => p.group === g).length >= 2, id + ": a group of one");
  assert.ok(c.items.some((i) => i.type === "bench") && c.items.some((i) => i.type === "tree"));
  assert.deepEqual(buildOpenInterior({ id, name: id, kind: "hall" }).npcs.map((p) => [p.x, p.z]), c.npcs.map((p) => [p.x, p.z]), id + " must be reproducible");
}
assert.equal(isOpenSpace("library"), false); assert.equal(buildOpenInterior({ id: "library" }), null);
assert.equal(studentName("a:1"), studentName("a:1")); assert.notEqual(greetLine("x", 0), greetLine("x", 1)); assert.ok(chatLine("x").length > 5);
console.log("OK  open spaces: " + Object.keys(OPEN_SPACES).length + " places");

// the server accepts a position in an open space with the same checks as in a building, and the place has no activity rings
import { interiorOf } from "../lib/activityService.js";
for (const id of Object.keys(OPEN_SPACES)) { const o = interiorOf(id); assert.ok(o && o.compiled && o.hubs.length === 0, id + ": no server-side space"); assert.ok(o.compiled.spawn && o.compiled.navPlayer[0].snap(o.compiled.spawn.x, o.compiled.spawn.z), id + ": spawn not walkable"); }
assert.equal(interiorOf("gate"), null);
console.log("OK  open spaces on the server");
