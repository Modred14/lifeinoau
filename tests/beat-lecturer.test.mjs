// tests/beat-lecturer.test.mjs: Beat Lecturer (the lecturer fight, reached from the ring in the lecture room).
// What can be proved without a browser: the fight's moves all have an animation, the rig really moves a real character's arm for a punch, the server's
// "are you there" rule, and that the room wiring (label, one-at-a-time lock, input freeze, duel facing, cleanup) is in place.
import assert from "node:assert/strict";
import fs from "node:fs";
import { MOVES } from "../lib/fightSim.js";
import { isAtVenue, AT_VENUE_MS } from "../lib/lectureVenues.js";

const read = (f) => fs.readFileSync(new URL("../" + f, import.meta.url), "utf8");
const scene = read("lib3d/interiors/scene.js"), room = read("components/BuildingInside.js"), lecScene = read("lib3d/lectureScene.js"), css = read("components/travel.css");

// ---- every move the brawl can make has an animation ----
const animBlock = lecScene.slice(lecScene.indexOf("const MOVE_ANIM = {"), lecScene.indexOf("const HURT"));
for (const m of Object.keys(MOVES)) assert.ok(new RegExp(`\\n  ${m}: \\{ pose:`).test(animBlock), `no animation for the move "${m}"`);

// ---- the server's rule for "you are in the building" (nothing the browser says counts) ----
{
  const now = Date.now(), v = { placeId: "eng", roomId: "r1" }, c = (o) => ({ placeId: "eng", placeAt: new Date(now - 1000), ...o });
  assert.equal(isAtVenue(c(), v, now), true);
  assert.equal(isAtVenue(c({ placeId: "library" }), v, now), false, "another building");
  assert.equal(isAtVenue(c({ placeAt: new Date(now - AT_VENUE_MS - 1000) }), v, now), false, "not seen there lately");
  assert.equal(isAtVenue(c({ placeAt: null }), v, now), false);
  assert.equal(isAtVenue(c({ placeAt: new Date(now + 3_600_000) }), v, now), false, "a time from the future");
  assert.equal(isAtVenue(c(), null, now), false, "no venue");
}

// ---- the room: label, lock, frozen input, facing, cleanup ----
assert.ok(scene.includes('label: "Beat Lecturer"'), "the ring is labelled Beat Lecturer");
assert.ok(!scene.includes("lecture_other") && !room.includes("NOT_YOURS"), "no lecturer is refused for being 'not yours': the server decides who can be fought (any lecturer in a lecture room)");
assert.ok(/startDuel\(i\)/.test(scene) && /endDuel\(\)/.test(scene), "the scene can square the two up and let them go");
assert.ok(/p\.duel\)/.test(scene) && /duelSelf/.test(scene), "both characters face each other while it runs");
assert.ok(/if \(busyRef\.current \|\| fight \|\| incident\) return/.test(room), "a second tap while one is running is ignored");
assert.ok(/finally \{\s*if \(!started\) release\(\)/.test(room), "the lock is always released if the fight never opens");
assert.ok(/closeFight = \(\) => \{ setFight\(null\); release\(\)/.test(room) && /const settled = \(res\) => \{ setFight\(null\); release\(\)/.test(room), "closing or settling the fight releases the room");
assert.ok(/setSuspended\?\.\(true\)/.test(room), "the room stops listening to keys while the fight runs (S, D and L are dodge and block)");
assert.ok(room.includes('/api/lecture", { action: "approach"') && !room.includes("api/beat"), "it still goes through the existing /api/lecture and /api/fight");
assert.ok(/\.bi3-use\.lec/.test(css) && /\.why/.test(css), "styled for the pill and for the reason line");

// ---- a punch really moves a real character's arm ----
{
  globalThis.self = globalThis;
  globalThis.document = { createElementNS: () => { const l = {}; return { style: {}, addEventListener(e, f) { l[e] = f; }, removeEventListener() {}, set src(v) { setTimeout(() => l.load?.({})); }, width: 1, height: 1 }; } };
  globalThis.URL.createObjectURL = () => "blob:x"; globalThis.URL.revokeObjectURL = () => {};
  const THREE = await import("three"), { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  const { makeAvatarFigure } = await import("../lib3d/avatar/figureRig.js"), { pose } = await import("../lib3d/toonFigure.js");
  const buf = fs.readFileSync(new URL("../public/models/avatars/base_male.glb", import.meta.url)), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const gltf = await new Promise((res, rej) => new GLTFLoader().parse(ab, "", res, rej));
  const fig = makeAvatarFigure({ root: gltf.scene, height: 1.7, dispose() {} });
  let hand; gltf.scene.traverse((o) => { if (o.isBone && /RightHand$/.test(o.name)) hand = o; });
  const at = () => { fig.root.updateMatrixWorld(true); return hand.getWorldPosition(new THREE.Vector3()); };
  const GUARD = pose({ hipsY: -0.05, lean: 0.12, twist: 0.18, headX: 0.08, aRs: 0.95, aRe: 1.5, aLs: 0.75, aLe: 1.75, lRh: 0.3, lRk: 0.35, lLh: -0.2, lLk: 0.1 });
  fig.apply(GUARD, 1); const g = at().clone();
  fig.apply({ ...GUARD, aRs: 1.55, aRe: 0.05, twist: 0.55, lean: 0.28 }, 1); const p = at().clone();
  assert.ok(g.distanceTo(p) > 0.15, `the punch pose should move the fist (moved ${g.distanceTo(p).toFixed(3)} m)`);
  assert.ok(p.x > g.x, "the fist goes forward (toward the opponent)");
}
console.log("beat lecturer tests passed");
