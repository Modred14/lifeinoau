// tests/model-cache.test.mjs
// The shared model cache (lib3d/assetCache.js, modelCache.js), the idle preloader (lib3d/preload.js) and what they do to the vehicles (lib3d/vehicles.js):
//   the cache hands out shared geometry, never evicts what is in use, frees what is not when over budget, and survives double release and failing builds;
//   the preloader runs the most important job first, asks for nothing twice and holds back when memory is tight;
//   two vehicles of one model share vertex data but NOTHING that can change: doors, lamps, wheels, steering, position, dispose.
import assert from "node:assert/strict";
import { createAssetCache, geometryBytes } from "../lib3d/assetCache.js";
import { createPreloader } from "../lib3d/preload.js";
import { modelCache } from "../lib3d/modelCache.js";
import { makeVehicle, makeBus, makeKeke, makeCar, rollWheels, vehicleWarmSteps, carBodyGeometry, trafficWheelGeometry } from "../lib3d/vehicles.js";
import { CAR_SPECS } from "../lib3d/vehicleSpecs.js";

let n = 0; const ok = (name, c) => { assert.ok(c, name); n++; };
const freed = []; const mk = (k, bytes = 100) => ({ k, bytes, dispose: (v) => freed.push(v.k) });
const val = (k) => ({ k });

// ---------------- assetCache
{
  const c = createAssetCache({ budgetBytes: 250 }); let builds = 0;
  const a1 = c.acquire("a", () => (builds++, val("a")), mk("a")), a2 = c.acquire("a", () => (builds++, val("a")), mk("a"));
  ok("a second request for the same key reuses the first build", builds === 1 && a1.value === a2.value && c.stats().hits === 1 && c.refs("a") === 2);
  a1.release(); a1.release();
  ok("releasing twice only counts once", c.refs("a") === 1);
  a2.release(); ok("a released entry stays cached (warm)", c.has("a") && c.refs("a") === 0);

  // over budget: unheld entries go (lowest priority first, then oldest); held ones never
  let t = 0; const d = createAssetCache({ budgetBytes: 1000, now: () => ++t }); freed.length = 0; const o = (pr) => ({ bytes: 100, priority: pr, dispose: (v) => freed.push(v.k) });
  const held = d.acquire("held", () => val("held"), o(0));
  d.acquire("older-important", () => val("older-important"), o(2)).release();
  d.acquire("newer-minor", () => val("newer-minor"), o(0)).release();
  d.acquire("c", () => val("c"), o(1)).release();
  d.setBudget(250);   // 400 bytes held in the cache: two idle entries must go
  ok("over budget the entries of lowest priority go first, even though a more important one is older", freed.join() === "newer-minor,c" && d.has("older-important"));
  ok("an entry in use is never evicted, even over budget", d.has("held") && !freed.includes("held"));
  d.acquire("huge", () => val("huge"), { bytes: 900, dispose: (v) => freed.push(v.k) });
  ok("the cache can sit above its budget, but only because of what is held", d.has("held") && d.has("huge") && d.stats().bytes > 250 && d.stats().held === 2);
  held.release(); d.trim(); ok("released entries become evictable again", !d.has("held") && d.has("huge"));
  const e0 = createAssetCache({ budgetBytes: 1000, now: () => ++t }); for (const k of ["lru1", "lru2", "lru3"]) e0.acquire(k, () => val(k), o(1)).release(); e0.acquire("lru1", () => val("lru1"), o(1)).release(); // lru1 is used again: now the freshest
  e0.setBudget(150); ok("equal priority: the least recently used go first, the one just used last", e0.keys().join() === "lru1");

  // a failing build caches nothing
  const e = createAssetCache({ budgetBytes: 1e6 }); let tries = 0;
  assert.throws(() => e.acquire("bad", () => { tries++; throw new Error("boom"); })); e.acquire("bad", () => (tries++, val("bad"))).release();
  ok("a failed build is not remembered: asking again tries again", tries === 2 && e.has("bad"));
  // dispose that throws must not escape
  const f = createAssetCache({ budgetBytes: 10 }); f.acquire("x", () => val("x"), { bytes: 50, dispose() { throw new Error("no"); } }).release();
  ok("a throwing dispose never reaches the caller", !f.has("x"));
  // async: concurrent builds share one
  const g = createAssetCache({ budgetBytes: 1e6 }); let ab = 0; const slow = () => new Promise((r) => setTimeout(() => r(val("s")), 5));
  const [h1, h2] = await Promise.all([g.acquireAsync("s", () => (ab++, slow())), g.acquireAsync("s", () => (ab++, slow()))]);
  ok("two simultaneous async requests share one build", ab === 1 && h1.value === h2.value && g.refs("s") === 2 && g.stats().dedupedBuilds === 1);
  await g.acquireAsync("fail", async () => { throw new Error("net"); }).then(() => ok("unreachable", false), () => ok("an async failure rejects", true));
  const h3 = await g.acquireAsync("fail", async () => val("fine")); ok("and is retried afterwards", h3.value.k === "fine");
  // geometryBytes
  ok("geometryBytes counts attribute and index data", geometryBytes({ attributes: { position: { array: new Float32Array(9) } }, index: { array: new Uint16Array(3) } }) === 42);
  // budget shrink
  const s = createAssetCache({ budgetBytes: 1000 }); for (const k of "abcd") s.acquire(k, () => val(k), { bytes: 100 }).release(); s.setBudget(150); ok("shrinking the budget evicts idle entries", s.stats().bytes <= 150);
}

// ---------------- preloader
{
  const slots = []; const schedule = (fn) => { slots.push(fn); return () => {}; }; const order = []; let press = 0;
  const q = createPreloader({ schedule, pressure: () => press, essential: 1, highPressure: 0.8 });
  q.enqueue({ key: "map", priority: 2, run: () => order.push("map") }); q.enqueue({ key: "own", priority: 1, run: () => order.push("own") }); q.enqueue({ key: "now", priority: 0, run: () => order.push("now") });
  ok("a duplicate key is queued once", q.enqueue({ key: "now", priority: 0, run: () => order.push("dup") }) === false && q.stats().queued === 3);
  const drain = (budget = 50) => { while (slots.length) slots.shift()(budget); };
  drain(); ok("jobs run most important first, one per idle slot", order.join() === "now,own,map");
  ok("a finished key is not queued again", q.enqueue({ key: "now", priority: 0, run: () => order.push("again") }) === false); q.forget("now"); ok("unless forgotten (the cache evicted it)", q.enqueue({ key: "now", priority: 0, run: () => order.push("again") }) === true); drain();
  press = 0.95; q.enqueue({ key: "bg", priority: 2, run: () => order.push("bg") }); q.enqueue({ key: "must", priority: 1, run: () => order.push("must") }); drain();
  ok("under memory pressure background work is skipped but essential work runs", !order.includes("bg") && order.includes("must") && q.stats().skipped === 1);
  const q2 = createPreloader({ schedule, maxQueue: 3 }); for (let i = 0; i < 6; i++) q2.enqueue({ key: "k" + i, priority: i, run() {} }); ok("the queue is capped: least important jobs are dropped", q2.stats().queued === 3);
  const errs = []; const q3 = createPreloader({ schedule, onJob: (j) => j.error && errs.push(j.key) }); q3.enqueue({ key: "bad", priority: 0, run() { throw new Error("x"); } }); q3.enqueue({ key: "good", priority: 1, run() { errs.push("good-ran"); } }); while (slots.length) slots.shift()(50);
  ok("a failing job does not stop the queue", errs.join() === "bad,good-ran");
  const q4 = createPreloader({ schedule }); const ran = []; q4.enqueue({ key: "a", priority: 1, run: () => ran.push("a") }); q4.enqueue({ key: "b", priority: 0, run: () => ran.push("b") }); q4.flush(); ok("flush runs everything now, in order", ran.join() === "b,a" && q4.stats().queued === 0);
}

// ---------------- vehicles: shared geometry, independent everything else
const geoOf = (v, name) => { let g = null; v.root.traverse((o) => { if (o.isMesh && o.name === name && !g) g = o.geometry; }); return g; };
{
  const a = makeVehicle("camry-2014", "#c0392b"), b = makeVehicle("camry-2014", "#c0392b");
  ok("two cars of one model and paint share their body geometry", geoOf(a, "paint") === geoOf(b, "paint"));
  ok("they do not share meshes, groups or materials that change", a.root !== b.root && a.doors.left.pivot !== b.doors.left.pivot && a.lamps.tail !== b.lamps.tail && a.wheels[0] !== b.wheels[0]);
  a.setDoor(1, 1); ok("opening one car's door leaves the other's shut", a.doors.left.k === 1 && b.doors.left.k === 0 && b.doors.left.pivot.rotation.y === 0 && !b.doors.left.hole.visible && a.doors.left.hole.visible);
  a.setBrake(true); a.setHeadlights(true); ok("braking one car does not light the other's lamps", b.lamps.tail.emissiveIntensity === 0.28 && b.lamps.head.emissiveIntensity === 0.18);
  rollWheels(a, 5, 0.5); ok("steering and rolling one car leave the other's wheels alone", b.wheels.every((w) => w.rotation.x === 0) && b.front.every((p) => p.rotation.y === 0) && a.front[0].rotation.y !== 0);
  a.root.position.set(5, 0, 5); a.root.rotation.y = 1; ok("position and heading are per car", b.root.position.x === 0 && b.root.rotation.y === 0);
  const sharedGeo = geoOf(a, "paint"); a.dispose();
  ok("disposing one car keeps the cache entry for the other", modelCache.refs("car:camry-2014:body:#c0392b") === 1 && geoOf(b, "paint") === sharedGeo && sharedGeo.attributes.position.count > 0);
  const c3 = makeVehicle("camry-2014", "#c0392b"); ok("a car made after another was disposed still gets the same geometry", geoOf(c3, "paint") === sharedGeo);
  b.dispose(); c3.dispose(); ok("when the last car is gone the geometry stays warm and evictable", modelCache.has("car:camry-2014:body:#c0392b") && modelCache.refs("car:camry-2014:body:#c0392b") === 0);
  const d = makeVehicle("camry-2014", "#2c5aa0"); ok("a different paint gets its own body but shares wheels", geoOf(d, "paint") !== sharedGeo && modelCache.refs("car:camry-2014:wheels") === 1); d.dispose(); d.dispose();
  ok("disposing a vehicle twice is harmless", modelCache.refs("car:camry-2014:wheels") === 0);
}
{
  const k1 = makeKeke(), k2 = makeKeke(), b1 = makeBus(), b2 = makeBus();
  ok("kekes share geometry, not state", geoOf(k1, "paint") === geoOf(k2, "paint") && k1.lamps.tail !== k2.lamps.tail && k1.root !== k2.root);
  k1.setBrake(true); rollWheels(k1, 2, 0.3); ok("braking or steering one keke leaves the other alone", k2.lamps.tail.emissiveIntensity === 0.28 && k2.front[0].rotation.y === 0);
  ok("buses share geometry but each has its own scaled shell and sliding door", geoOf(b1, "paint") === geoOf(b2, "paint") && b1.root.userData.shell !== b2.root.userData.shell);
  b1.setDoor(-1, 1); ok("opening one bus's sliding door does not open the other's", b2.doors.right.k === 0 && b2.doors.right.pivot.position.z !== b1.doors.right.pivot.position.z);
  [k1, k2, b1, b2].forEach((v) => v.dispose());
  const fam = makeCar("#1c1d21"); ok("the family car is still the default", fam.id === "" && fam.wheels.length === 4); fam.dispose();
  { const u = makeVehicle("nope", "#fff"), fam2 = makeCar("#fff"); ok("an unknown model id falls back to the family car", u.wheels.length === 4 && u.length === fam2.length && geoOf(u, "paint") === geoOf(fam2, "paint")); u.dispose(); fam2.dispose(); }
}
{
  ok("traffic shapes are shared, not rebuilt each time", carBodyGeometry("#ffffff", false) === carBodyGeometry("#ffffff", false) && trafficWheelGeometry() === trafficWheelGeometry());
  const before = modelCache.stats().builds, steps = vehicleWarmSteps("accord-2014", "#222222"); steps.forEach((s) => s.run());
  const afterWarm = modelCache.stats().builds; const v = makeVehicle("accord-2014", "#222222"); v.dispose();
  ok("warm-up steps build the model, and the vehicle made after it builds nothing", afterWarm > before && modelCache.stats().builds === afterWarm);
  const w2 = modelCache.stats().builds; vehicleWarmSteps("accord-2014", "#222222").forEach((s) => s.run()); ok("warming something already cached is free", modelCache.stats().builds === w2);
  ok("every model can be warmed", Object.keys(CAR_SPECS).concat(["bus", "keke", ""]).every((id) => { try { vehicleWarmSteps(id, "#123456").forEach((s) => s.run()); return true; } catch { return false; } }));
}
{
  // memory: a tiny budget, many models; nothing in use is lost, and the cache comes back under budget once cars are released
  modelCache.setBudget(1.5 * 1048576);
  const live = Object.keys(CAR_SPECS).slice(0, 3).map((id) => makeVehicle(id, "#333")); const sizes = live.map((v) => v.root.children.length);
  for (const id of Object.keys(CAR_SPECS)) makeVehicle(id, "#777").dispose();
  ok("cars in use are intact after heavy eviction around them", live.every((v, i) => v.root.children.length === sizes[i] && geoOf(v, "paint").attributes.position.count > 0));
  live.forEach((v) => v.dispose()); modelCache.trim();
  ok("with nothing in use the cache is back within its budget", modelCache.stats().bytes <= 1.5 * 1048576 && modelCache.stats().evictions > 0);
  const again = makeVehicle(Object.keys(CAR_SPECS)[0], "#333"); ok("an evicted model simply rebuilds on demand", geoOf(again, "paint").attributes.position.count > 0); again.dispose();
}
console.log(`model-cache: ${n} checks passed`);
