// tests/club-fx.test.mjs: the nightclub 3D effects (lib3d/interiors/clubFx.js) run headless in Node: no GPU, just the scene graph and the update loop.
import * as THREE from "three";
import { createClubFx, makeBottle } from "../lib3d/interiors/clubFx.js";
import { DRINKS, SPRAY_AMOUNTS, fxLevel } from "../lib/clubs.js";
const scene = new THREE.Scene(), hemi = new THREE.HemisphereLight("#a79ee0", "#3a3556", 2.3), amb = new THREE.AmbientLight("#8a84c0", 1.1); scene.add(hemi, amb);
const fakeWaiter = () => Promise.resolve({ root: new THREE.Group(), play: () => true, has: () => true, tick() {}, dispose() {} });
const fx = createClubFx({ scene, bounds: { x0: -6, x1: 6, z0: -5, z1: 5 }, lights: { hemi, ambient: amb }, walkable: () => true,
  pathFn: (a, b, c, d) => [[a, b], [(a + c) / 2, (b + d) / 2], [c, d]], posOf: (n) => (n === "Ada" ? { x: 1, z: 1, floor: 0 } : n === "Tunde" ? { x: -2, z: 1, floor: 0 } : null), barSpot: { x: 5, z: 4 }, makeWaiter: fakeWaiter });
let ok = true; const chk = (l, c) => { if (!c) ok = false; console.log((c ? "OK  " : "FAIL") + " " + l); };
// every drink makes its own bottle: different shapes/colours, disposable
const sigs = new Set(DRINKS.map((d) => { const b = makeBottle(d); const s = b.group.children[0].geometry.attributes.position.count + d.body + d.shape; b.dispose(); return s; }));
chk(`7 drinks make ${sigs.size} distinct bottle designs`, sigs.size >= 6);
// spray: ten thousand vs ten million
const peak = {};
for (const amt of [10_000, 10_000_000]) {
  const L = fxLevel(amt); fx.play({ id: "1", level: L, actor: "Ada", data: { parts: ["spray", "banner"], sec: L === 1 ? 3 : 9, amount: amt, floor: 0 }, x: 1, z: 1 });
  let m = 0; for (let t = 0; t < 12; t += 1 / 60) { fx.update(t, 1 / 60); m = Math.max(m, fx.stats().notes); } peak[amt] = m;
}
chk(`₦10,000 spray peaks at ${peak[10_000]} notes, ₦10,000,000 at ${peak[10_000_000]} (more is a bigger flex)`, peak[10_000_000] > peak[10_000] * 6 && peak[10_000] > 5);
for (let t = 12; t < 22; t += 1 / 60) fx.update(t, 1 / 60);
chk("notes are all gone a few seconds after the spray", fx.stats().notes === 0);
// bottle: the biggest bottle, for a friend, with a reserved table
fx.setTables([{ id: "9", actor: "Ada", x: 1, z: 1, data: { table: "billionaire", floor: 0 }, until: Date.now() + 1e6 }]);
chk("a reserved table appears", fx.stats().tables === 1);
fx.play({ id: "2", level: 5, actor: "Ada", to: "Tunde", x: 1, z: 1, data: { drink: "louis_xiii", style: "crown", table: "billionaire", floor: 0, parts: ["bottle", "banner", "spotlight", "sparkle", "confetti", "sweep"] } });
await new Promise((r) => setTimeout(r, 20)); // the waiter loads asynchronously, as in the real scene
let seen = { spots: 0, sparks: 0, conf: 0, shows: 0, phases: new Set() };
for (let t = 0; t < 12; t += 1 / 60) { fx.update(t, 1 / 60); const s = fx.stats(); seen.spots = Math.max(seen.spots, s.spots); seen.sparks = Math.max(seen.sparks, s.sparks); seen.conf = Math.max(seen.conf, s.confetti); seen.shows = Math.max(seen.shows, s.shows); }
chk(`Louis XIII show ran: bottle on table, ${seen.spots} spotlight(s), ${seen.sparks} sparks, ${seen.conf} confetti`, seen.shows === 1 && seen.spots >= 1 && seen.sparks > 10 && seen.conf > 100);
// moods change the lights and put them back
const base = hemi.intensity; fx.setMood({ data: { mood: "djset", host: "Ada" } }); for (let t = 0; t < 2; t += 1 / 60) fx.update(t, 1 / 60);
chk("a mood changes the club lights", Math.abs(hemi.intensity - base) > 1e-6 || hemi.color.getHexString() !== new THREE.Color("#a79ee0").getHexString());
const beamsDuring = fx.stats().beams; fx.setMood(null); chk("the lights are restored and the mood beams removed when it ends", Math.abs(hemi.intensity - base) < 1e-9 && hemi.color.getHexString() === new THREE.Color("#a79ee0").getHexString() && fx.stats().beams < beamsDuring);
fx.setTables([]); chk("an ended table is removed", fx.stats().tables === 0);
for (let t = 0; t < 70; t += 1 / 30) fx.update(t, 1 / 30);
chk("everything is cleaned up after the show", fx.stats().shows === 0 && fx.stats().spots === 0);
fx.dispose(); chk("dispose leaves nothing in the scene", scene.children.length === 2);
process.exit(ok ? 0 : 1);
