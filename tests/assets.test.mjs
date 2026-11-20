// tests/assets.test.mjs
// The asset caching system, end to end in plain Node: the manifest and its versions, the persistent store (quota, eviction, pruning), the loader (dedupe, saved copies, bad copies, priority,
// progress), shared 3D models (one download, one parse, never freed while held), preloading, the service worker's rules, the "after a deployment" scenario, and the guard that stops anyone
// loading an asset around the shared system. Not covered: a real browser's Cache Storage and real network timing (see docs/ASSETS.md, "Measuring").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let bad = 0;
const chk = (l, c) => { if (!c) bad++; console.log((c ? "OK  " : "FAIL") + " " + l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- a stand-in for the browser's Cache Storage ----------
function fakeCaches({ failPut = null } = {}) {
  const stores = new Map();
  const keyOf = (r) => new URL(typeof r === "string" ? r : r.url, "http://localhost").href;
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      match: async (r, opt) => { const k = keyOf(r); if (m.has(k)) return m.get(k).clone(); if (opt?.ignoreSearch) { const base = k.split("?")[0]; for (const [kk, v] of m) if (kk.split("?")[0] === base) return v.clone(); } return undefined; },
      put: async (r, res) => { if (failPut) { const e = failPut(); if (e) throw e; } m.set(keyOf(r), res); },
      delete: async (r) => m.delete(keyOf(r)),
      keys: async () => [...m.keys()].map((k) => new Request(k)),
    };
  };
  return { open, keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n), match: async (r, opt) => { for (const n of stores.keys()) { const hit = await (await open(n)).match(r, opt); if (hit) return hit; } return undefined; }, _stores: stores };
}
const buf = (n, byte = 1) => new Uint8Array(n).fill(byte).buffer;
const glb = (n = 64) => { const u = new Uint8Array(n); u.set([0x67, 0x6c, 0x54, 0x46]); return u.buffer; }; // starts with "glTF"
const json = (o) => new TextEncoder().encode(JSON.stringify(o)).buffer;

const { createManifest, assetUrl, hasAsset, cleanPath } = await import("../lib3d/assets/manifest.js");
const { buildManifest, manifestProblems } = await import("../scripts/assets-manifest.mjs");
const { createStore } = await import("../lib3d/assets/store.js");
const { createAssetLoader, validateBytes } = await import("../lib3d/assets/loader.js");
const { createPreloader, pickAhead } = await import("../lib3d/assets/preload.js");
const { findViolations } = await import("../scripts/check-assets.mjs");

// ---------- 1. manifest and versions ----------
{
  chk("the committed manifest matches the files in public/ (run `npm run assets:build` if this fails)", manifestProblems().length === 0);
  const m = buildManifest(), paths = Object.keys(m.assets);
  chk("every file under /models, /data and /audio is in the manifest, except the station list that is rewritten at every build", fs.readdirSync(path.join(ROOT, "public/models/avatars")).filter((f) => f.endsWith(".glb")).every((f) => m.assets[`/models/avatars/${f}`]) && !m.assets["/data/radio-stations.json"] && !!m.assets["/data/oau-campus.json"] && !!m.assets["/audio/jack-in-the-box.mp3"]);
  chk("the map data is the critical tier and the base bodies are the high tier", m.assets["/data/oau-campus.json"].tier === "critical" && m.assets["/data/oau-roadgraph.json"].tier === "critical" && m.assets["/models/avatars/base_male.glb"].tier === "high" && m.assets["/models/avatars/parts/hair/afro_f.glb"].tier === "background");
  chk("every asset URL carries its content hash", /^\/models\/avatars\/base_male\.glb\?v=[0-9a-f]{10}$/.test(assetUrl("/models/avatars/base_male.glb")) && hasAsset("/data/oau-campus.json"));
  chk("a path that is not in the manifest still loads (unversioned) and does not crash", assetUrl("/models/nope.glb") === "/models/nope.glb" && !hasAsset("/models/nope.glb"));
  chk("paths are normalised (queries, doubled slashes) and non-site URLs are refused", cleanPath("/models//a.glb?v=1#x") === "/models/a.glb" && cleanPath("data:text/plain,hi") === "");

  // a changed file gets a new version, unchanged files keep theirs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oau-pub-"));
  fs.mkdirSync(path.join(dir, "models/a"), { recursive: true });
  fs.writeFileSync(path.join(dir, "models/a/one.glb"), Buffer.from("glTF-one")); fs.writeFileSync(path.join(dir, "models/a/two.glb"), Buffer.from("glTF-two"));
  const v1 = buildManifest(dir);
  fs.writeFileSync(path.join(dir, "models/a/two.glb"), Buffer.from("glTF-two-changed")); fs.writeFileSync(path.join(dir, "models/a/new.glb"), Buffer.from("glTF-new"));
  const v2 = buildManifest(dir);
  chk("after an update only the changed file's version changes", v1.assets["/models/a/one.glb"].v === v2.assets["/models/a/one.glb"].v && v1.assets["/models/a/two.glb"].v !== v2.assets["/models/a/two.glb"].v && v1.version !== v2.version);
  chk("a NEW file dropped into a managed folder is versioned and tiered automatically (default: background)", v2.assets["/models/a/new.glb"]?.tier === "background" && /^[0-9a-f]{10}$/.test(v2.assets["/models/a/new.glb"].v));
}

// ---------- 2. the persistent store ----------
{
  const caches = fakeCaches(), store = createStore({ cacheStorage: caches, budget: 1000 });
  chk("a saved file comes back byte for byte", (await store.put("/models/a.glb?v=1", glb(100), { tier: "high" })) === true && (await store.get("/models/a.glb?v=1")).byteLength === 100 && new Uint8Array(await store.get("/models/a.glb?v=1"))[0] === 0x67);
  chk("a file that was never saved is a miss, not an error", (await store.get("/models/zzz.glb?v=1")) === null);
  // budget: lower tier and older go first; the critical file survives
  const s2 = createStore({ cacheStorage: fakeCaches(), budget: 1000, now: (() => { let t = 0; return () => ++t; })() });
  await s2.put("/data/crit.json?v=1", buf(400), { tier: "critical" }); await s2.put("/models/bg1.glb?v=1", buf(300), { tier: "background" }); await s2.put("/models/bg2.glb?v=1", buf(300), { tier: "background" });
  await s2.put("/models/hi.glb?v=1", buf(300), { tier: "high" });
  const u = await s2.usage();
  chk("over budget, background files are evicted first, oldest first, and the critical file stays", u.bytes <= 1000 && (await s2.get("/data/crit.json?v=1")) && !(await s2.get("/models/bg1.glb?v=1")) && (await s2.get("/models/hi.glb?v=1")) && s2.stats().evictions >= 1);
  chk("a file bigger than the whole budget is refused without throwing", (await s2.put("/models/huge.glb?v=1", buf(5000), { tier: "high" })) === false);
  // a full disk
  const full = createStore({ cacheStorage: fakeCaches({ failPut: () => Object.assign(new Error("full"), { name: "QuotaExceededError" }) }), budget: 1e6 });
  chk("a full disk (QuotaExceededError) only means 'not saved': no throw, the game goes on", (await full.put("/models/a.glb?v=1", glb(50))) === false && (await full.get("/models/a.glb?v=1")) === null);
  // no Cache Storage at all (old browser, private mode)
  const none = createStore({ cacheStorage: undefined });
  chk("a browser without Cache Storage: get gives null, put gives false, nothing throws", (await none.get("/x?v=1")) === null && (await none.put("/x?v=1", buf(4))) === false && (await none.prune(new Set())) === 0);
  const broken = createStore({ cacheStorage: { open: async () => { throw new Error("blocked"); } } });
  chk("a browser that refuses to open the cache behaves the same", (await broken.get("/x?v=1")) === null && (await broken.put("/x?v=1", buf(4))) === false);
  // pruning
  const s3 = createStore({ cacheStorage: fakeCaches(), budget: 1e6 });
  await s3.put("/models/a.glb?v=old", glb(10)); await s3.put("/models/a.glb?v=new", glb(10)); await s3.put("/models/gone.glb?v=1", glb(10));
  const removed = await s3.prune(new Set(["/models/a.glb?v=new"]));
  chk("prune removes old versions and removed files and keeps the current ones", removed === 2 && !(await s3.get("/models/a.glb?v=old")) && !!(await s3.get("/models/a.glb?v=new")) && !(await s3.get("/models/gone.glb?v=1")));
}

// ---------- 3. the loader ----------
const mkManifest = (assets) => createManifest({ version: "t", assets: Object.fromEntries(Object.entries(assets).map(([p, a]) => [p, { v: a.v ?? "aaaaaaaaaa", bytes: 1, tier: a.tier ?? "background" }])) });
const serve = (files, log) => async (url, init) => {
  const u = new URL(url, "http://localhost"); log.push(u.pathname + u.search);
  const f = files[u.pathname];
  if (f === undefined) return new Response("nf", { status: 404, headers: { "content-type": "text/plain" } });
  if (f instanceof Response) return f.clone();
  return new Response(f, { status: 200, headers: { "content-length": String(f.byteLength) } });
};
{
  const man = mkManifest({ "/models/a.glb": {}, "/models/b.glb": {}, "/data/x.json": { tier: "critical" } });
  const log = [], files = { "/models/a.glb": glb(1000), "/models/b.glb": glb(500), "/data/x.json": json({ hello: 1 }) };
  const store = createStore({ cacheStorage: fakeCaches(), budget: 1e6, isCurrent: () => true });
  const L = createAssetLoader({ manifest: man, store, fetchImpl: serve(files, log) });
  const [a1, a2, a3] = await Promise.all([L.bytes("/models/a.glb"), L.bytes("/models/a.glb"), L.bytes("/models/a.glb")]);
  chk("three components asking for one model at once cause ONE download", log.length === 1 && a1.byteLength === 1000 && a2 === a1 && a3 === a1 && L.stats().joined === 2);
  chk("the download asked for the versioned URL", log[0] === "/models/a.glb?v=aaaaaaaaaa");
  await sleep(10);
  // a second page load: new loader, same store
  const log2 = [], L2 = createAssetLoader({ manifest: man, store, fetchImpl: serve(files, log2) });
  const again = await L2.bytes("/models/a.glb");
  chk("a later visit is served from the saved copy: zero network requests", log2.length === 0 && again.byteLength === 1000 && L2.stats().persistentHits === 1 && L2.stats().networkFetches === 0);
  chk("JSON loads and parses through the same path", (await L2.json("/data/x.json")).hello === 1 || (await L2.json("/data/x.json")).hello === 1);
  // bad saved copy: an HTML page where the model should be
  const badStore = createStore({ cacheStorage: fakeCaches(), budget: 1e6 });
  await badStore.put("/models/a.glb?v=aaaaaaaaaa", new TextEncoder().encode("<html>oops</html>").buffer);
  const log3 = [], L3 = createAssetLoader({ manifest: man, store: badStore, fetchImpl: serve(files, log3) });
  const fixed = await L3.bytes("/models/a.glb");
  await sleep(15);
  chk("a corrupt saved copy is discarded and the file is downloaded instead", fixed.byteLength === 1000 && log3.length === 1 && L3.stats().invalidCached === 1 && new Uint8Array(await badStore.get("/models/a.glb?v=aaaaaaaaaa"))[0] === 0x67);
  // network problems
  const log4 = []; let n = 0;
  const flaky = async (u) => { log4.push(u); if (++n === 1) throw new TypeError("dropped"); return new Response(glb(20), { status: 200 }); };
  const L4 = createAssetLoader({ manifest: man, store: null, fetchImpl: flaky, retryDelayMs: 1 });
  chk("a connection that drops once is retried automatically", (await L4.bytes("/models/b.glb")).byteLength === 20 && log4.length === 2);
  const L5 = createAssetLoader({ manifest: man, store: null, fetchImpl: serve({}, []), retryDelayMs: 1 });
  let err; try { await L5.bytes("/models/a.glb"); } catch (e) { err = e; }
  chk("a missing file (404) fails at once with its status and is not retried", err?.status === 404 && L5.stats().errors === 1);
  let again2; const calls = []; const L6 = createAssetLoader({ manifest: man, store: null, fetchImpl: async (u) => { calls.push(u); return calls.length === 1 ? new Response("x", { status: 404, headers: { "content-type": "text/html" } }) : new Response(glb(9), { status: 200 }); } });
  try { await L6.bytes("/models/a.glb"); } catch { /* first attempt fails */ }
  again2 = await L6.bytes("/models/a.glb");
  chk("a failure is not remembered: asking again really tries again", again2.byteLength === 9 && calls.length === 2);
  const L7 = createAssetLoader({ manifest: man, store: null, fetchImpl: async () => new Response(new TextEncoder().encode("<!doctype html>"), { status: 200, headers: { "content-type": "text/html" } }) });
  let e7; try { await L7.bytes("/models/a.glb"); } catch (e) { e7 = e; }
  chk("a web page where a model should be (a host's 404 page with status 200) is rejected", !!e7);
  chk("a game still works when the store cannot save (full disk)", await (async () => { const L = createAssetLoader({ manifest: man, store: createStore({ cacheStorage: fakeCaches({ failPut: () => Object.assign(new Error("q"), { name: "QuotaExceededError" }) }) }), fetchImpl: serve(files, []) }); return (await L.bytes("/models/a.glb")).byteLength === 1000; })());
  // priority and parallel limit
  const order = [], gates = {}, hold = (p) => new Promise((r) => { gates[p] = r; });
  const L8 = createAssetLoader({ manifest: mkManifest({ "/models/1.glb": {}, "/models/2.glb": {}, "/models/3.glb": {}, "/models/4.glb": {} }), store: null, concurrency: 1, fetchImpl: async (u) => { const p = new URL(u, "http://x").pathname; order.push(p); await hold(p); return new Response(glb(8), { status: 200 }); } });
  const ps = [L8.bytes("/models/1.glb", { priority: 3 }), L8.bytes("/models/2.glb", { priority: 3 }), L8.bytes("/models/3.glb", { priority: 1 }), L8.bytes("/models/4.glb", { priority: 3 })];
  const opener = setInterval(() => Object.values(gates).forEach((open) => open()), 3); await Promise.all(ps); clearInterval(opener); // opens each download's gate as it starts
  chk("with one slot, the high-priority file jumps the queue (1, then 3, then the rest)", order[0] === "/models/1.glb" && order[1] === "/models/3.glb");
  // urgent work is never stuck behind the limit
  const order2 = [], L9 = createAssetLoader({ manifest: mkManifest({ "/models/1.glb": {}, "/data/c.json": { tier: "critical" } }), store: null, concurrency: 1, fetchImpl: async (u) => { order2.push(new URL(u, "http://x").pathname); await sleep(30); return new Response(u.includes("json") ? json({ a: 1 }) : glb(8), { status: 200 }); } });
  const p1 = L9.bytes("/models/1.glb", { priority: 3 }), p2 = L9.bytes("/data/c.json", { priority: 0 });
  await sleep(5); chk("priority 0 starts at once even when the parallel limit is used up", order2.length === 2); await Promise.all([p1, p2]);
  // progress
  const evs = [], L10 = createAssetLoader({ manifest: man, store: null, fetchImpl: serve(files, []) }); L10.onProgress((p) => evs.push(p));
  await L10.bytes("/models/a.glb");
  chk("progress reports bytes loaded and files completed", evs.length > 0 && L10.progress().completed === 1 && L10.progress().loadedBytes === 1000);
  chk("validation knows what a model, a JSON file and an empty file look like", validateBytes("a.glb", glb(8)) && !validateBytes("a.glb", buf(8)) && validateBytes("a.json", json({})) && !validateBytes("a.json", new TextEncoder().encode("<html>").buffer) && !validateBytes("a.png", buf(0)));
}

// ---------- 4. after a deployment: only what changed is downloaded again ----------
{
  const store = createStore({ cacheStorage: fakeCaches(), budget: 1e6 });
  const files = { "/models/car.glb": glb(300), "/models/house.glb": glb(300), "/data/map.json": json({ m: 1 }) };
  const visit = async (versions, fileMap) => {
    const log = [], man = mkManifest({ "/models/car.glb": { v: versions.car }, "/models/house.glb": { v: versions.house }, "/data/map.json": { v: versions.map, tier: "critical" } });
    const isCur = man.currentUrls(); const s = createStore({ cacheStorage: store._c ?? undefined });
    const L = createAssetLoader({ manifest: man, store, fetchImpl: serve(fileMap, log) });
    await store.prune(man.currentUrls()); await Promise.all(["/models/car.glb", "/models/house.glb", "/data/map.json"].map((p) => L.bytes(p))); await sleep(10);
    return { log, stats: L.stats() };
  };
  const a = await visit({ car: "c1", house: "h1", map: "m1" }, files);
  const b = await visit({ car: "c1", house: "h1", map: "m1" }, files);
  const refreshed = { ...files, "/models/house.glb": glb(400) };
  const c = await visit({ car: "c1", house: "h2", map: "m1" }, refreshed); // the house model changed in a deployment
  const d = await visit({ car: "c1", house: "h2", map: "m1" }, refreshed);
  chk("first visit downloads everything once", a.log.length === 3);
  chk("second visit (reload) downloads nothing", b.log.length === 0 && b.stats.persistentHits === 3);
  chk("after a deployment that changed one model, exactly that model is downloaded again", c.log.length === 1 && c.log[0] === "/models/house.glb?v=h2" && c.stats.persistentHits === 2);
  chk("the visit after that is fully cached again, and the old house version was removed from storage", d.log.length === 0 && !(await store.get("/models/house.glb?v=h1")) && (await store.get("/models/house.glb?v=h2")).byteLength === 400);
}

// ---------- 5. shared 3D models (real files) ----------
{
  globalThis.self ??= globalThis;
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
  globalThis.ProgressEvent ??= class ProgressEvent extends Event { constructor(t, i = {}) { super(t); Object.assign(this, i); } };
  const Req = globalThis.Request; globalThis.Request = class extends Req { constructor(u, i) { super(typeof u === "string" && u.startsWith("/") ? "http://localhost" + u : u, i); } };
  const realFetch = globalThis.fetch;
  const log = [];
  globalThis.fetch = async (input) => { const u = String(input?.url ?? input); const p = new URL(u, "http://localhost").pathname; if (!p.startsWith("/models/")) return realFetch(input); log.push(p); return new Response(fs.readFileSync(path.join(ROOT, "public", p)), { status: 200 }); };
  const { resetAssets, acquireGltf, assetStats } = await import("../lib3d/assets/index.js");
  const { resourcesOf } = await import("../lib3d/assets/gltf.js");
  resetAssets({ store: null });
  const P = "/models/avatars/base_male.glb";
  const [h1, h2] = await Promise.all([acquireGltf(P), acquireGltf(P)]);
  chk("two requests for one real model download it once and share one parsed copy", log.length === 1 && h1.value === h2.value && h1.value.scene.children.length > 0);
  const st = (await assetStats()).models;
  chk("the model was parsed once", st.builds === 1 && st.entries === 1 && st.held === 1);
  const hold = (await assetStats()).models.bytes;
  chk("the cache knows how big the model is (so it can stay within its budget)", hold > 10_000);
  h1.release(); h1.release(); // releasing twice is harmless
  chk("one holder letting go does not free the model for the other", (await assetStats()).models.held === 1);
  // shared geometry survives while anyone holds it
  const res = resourcesOf(h2.value.scene); let disposed = 0; for (const g of res.geometries) g.addEventListener("dispose", () => disposed++);
  const h3 = await acquireGltf(P); chk("a later request is a cache hit (no second download)", log.length === 1 && h3.value === h2.value);
  h2.release(); h3.release();
  chk("when every holder has let go the model stays warm for the next one", (await assetStats()).models.held === 0 && (await assetStats()).models.entries === 1);
  // eviction under a tiny budget frees the GPU copies, and never a held model
  const { createModelService } = await import("../lib3d/assets/gltf.js"); const { createAssetLoader: mk } = await import("../lib3d/assets/loader.js"); const { manifest } = await import("../lib3d/assets/manifest.js");
  const svc = createModelService({ assets: mk({ manifest, store: null }), budgetBytes: 1000 });
  const a = await svc.acquireGltf("/models/avatars/base_male.glb"), b = await svc.acquireGltf("/models/avatars/base_female.glb");
  chk("a held model is never evicted, even far over budget", svc.cache.has(`gltf:/models/avatars/base_male.glb:${manifest.info("/models/avatars/base_male.glb").v}`) && svc.stats().entries === 2);
  const ra = resourcesOf(a.value.scene); let freed = 0; for (const g of ra.geometries) g.addEventListener("dispose", () => freed++);
  a.release(); chk("once released and over budget, the model is evicted and its geometry freed", freed > 0 && svc.stats().entries === 1);
  chk("the other model, still held, is untouched", b.value.scene.children.length > 0 && svc.stats().held === 1);
  b.release();
  const bad = await svc.acquireGltf("/models/avatars/does-not-exist.glb").then(() => null, (e) => e);
  chk("a model that is not installed fails with a clear error and caches nothing", !!bad && svc.stats().entries <= 1);
  globalThis.fetch = realFetch; globalThis.Request = Req;
}

// ---------- 6. preloading ----------
{
  const man = mkManifest({ "/data/map.json": { tier: "critical" }, "/models/body.glb": { tier: "high" }, "/models/far.glb": {}, "/models/near.glb": {}, "/models/ahead.glb": {} });
  const calls = []; const fake = { bytes: async (p, o) => { calls.push([p, o.priority]); return buf(1); } };
  const q = []; const P = createPreloader({ assets: fake, manifest: man, schedule: (fn) => q.push(fn), constrained: () => false });
  const r = P.preloadEssentials(); q.splice(0).forEach((f) => f()); await sleep(5);
  chk("essentials: the critical file is requested at priority 0 at once, the high tier after it", r.critical === 1 && r.high === 1 && calls[0][0] === "/data/map.json" && calls[0][1] === 0);
  const items = [{ path: "/models/near.glb", x: 10, z: 0 }, { path: "/models/ahead.glb", x: 0, z: 150 }, { path: "/models/far.glb", x: 900, z: 900 }];
  const here = pickAhead(items, { x: 0, z: 0, dx: 0, dz: 1 }, { reach: 60, lookAhead: 100 }).map((i) => i.path);
  chk("spatial: what is near and what is ahead is picked, what is far away is not", here.includes("/models/near.glb") && here.includes("/models/ahead.glb") && !here.includes("/models/far.glb"));
  chk("spatial: the same spot heading the other way no longer picks what is behind", !pickAhead(items, { x: 0, z: 0, dx: 0, dz: -1 }, { reach: 60, lookAhead: 100 }).some((i) => i.path === "/models/ahead.glb"));
  P.registerSpatial(items); calls.length = 0; P.update({ x: 0, z: 0, dx: 0, dz: 1 }, { reach: 60, lookAhead: 100 }); q.splice(0).forEach((f) => f()); await sleep(5);
  chk("the player's position drives what is fetched (only the nearby files)", calls.map((c) => c[0]).sort().join() === "/models/ahead.glb,/models/near.glb");
  calls.length = 0; P.update({ x: 0, z: 0, dx: 0, dz: 1 }, { reach: 60, lookAhead: 100 }); q.splice(0).forEach((f) => f()); await sleep(5);
  chk("asking again for what is already queued or fetched costs nothing", calls.length === 0);
  const saver = createPreloader({ assets: fake, manifest: man, schedule: (fn) => fn(), constrained: () => true }); calls.length = 0;
  const rs = saver.preloadEssentials(); await sleep(5);
  chk("a player on data saver still gets the critical file, but no optional downloads", rs.critical === 1 && rs.high === 0 && saver.preload(["/models/far.glb"]) === 0);
}

// ---------- 7. the service worker ----------
{
  const code = fs.readFileSync(path.join(ROOT, "public/sw.js"), "utf8");
  const caches = fakeCaches(), handlers = {}, net = { log: [], online: true, files: {}, html: new Set() };
  const self = { location: { origin: "https://lifeinoau.com" }, addEventListener: (t, f) => { handlers[t] = f; }, skipWaiting() {}, clients: { claim: async () => {}, matchAll: async () => [] }, registration: {} };
  const fetchSw = async (input) => {
    const req = typeof input === "string" ? new Request(new URL(input, "https://lifeinoau.com")) : input, u = new URL(req.url); // the worker asks for "/asset-manifest.json" relative to its own origin
    net.log.push(req.method + " " + u.pathname + u.search);
    if (!net.online) throw new TypeError("offline");
    if (u.pathname === "/asset-manifest.json") return new Response(JSON.stringify(net.manifest ?? { assets: {} }), { status: 200 });
    if (net.html.has(u.pathname)) return new Response("<html>", { status: 200, headers: { "content-type": "text/html" } });
    const body = net.files[u.pathname]; if (body === undefined) return new Response("nf", { status: 404 });
    const res = new Response(body, { status: 200 }); Object.defineProperty(res, "type", { value: "basic" }); return res;
  };
  vm.runInNewContext(code, { self, caches, fetch: fetchSw, URL, Request, Response, Promise, console, setTimeout, Set, Object, Array, JSON, Math, Date });
  const ask = async (url, { method = "GET", headers = {}, mode = "no-cors" } = {}) => {
    const request = new Request(url, { method, headers }); Object.defineProperty(request, "mode", { value: mode });
    let answer; const waits = [];
    handlers.fetch({ request, respondWith: (p) => { answer = Promise.resolve(p); }, waitUntil: (p) => waits.push(p) });
    const res = answer ? await answer : null; await Promise.all(waits); return res;
  };
  net.files["/models/a.glb"] = glb(30); net.files["/data/c.json"] = json({ x: 1 });
  const first = await ask("https://lifeinoau.com/models/a.glb?v=h1");
  const callsAfterFirst = net.log.length;
  const second = await ask("https://lifeinoau.com/models/a.glb?v=h1");
  chk("a versioned asset is fetched once, then served from the cache without touching the network", first && second && net.log.length === callsAfterFirst && (await second.arrayBuffer()).byteLength === 30);
  chk("the same file with a NEW version is a different cache entry (fetched again)", await (async () => { const n0 = net.log.length; await ask("https://lifeinoau.com/models/a.glb?v=h2"); return net.log.length === n0 + 1; })());
  chk("an API request is left alone (never intercepted, never cached)", (await ask("https://lifeinoau.com/api/bank/balance")) === null && (await ask("https://lifeinoau.com/api/state?v=1")) === null);
  chk("a POST, a cross-site request and a byte-range request are left alone", (await ask("https://lifeinoau.com/models/a.glb?v=h1", { method: "POST" })) === null && (await ask("https://cdn.example.com/models/a.glb?v=h1")) === null && (await ask("https://lifeinoau.com/models/a.glb?v=h1", { headers: { range: "bytes=0-9" } })) === null);
  chk("audio is left to the browser (media elements use byte ranges)", (await ask("https://lifeinoau.com/audio/jack-in-the-box.mp3?v=1")) === null);
  net.html.add("/models/pretend.glb"); net.files["/models/pretend.glb"] = "x";
  await ask("https://lifeinoau.com/models/pretend.glb?v=z"); const ck = await (await caches.open("oau-assets-v1")).match("https://lifeinoau.com/models/pretend.glb?v=z");
  chk("a web page standing in for a model is never saved", !ck);
  const unv = await ask("https://lifeinoau.com/data/c.json"); net.online = false;
  const off = await ask("https://lifeinoau.com/data/c.json").catch(() => "failed");
  chk("an UNversioned asset is never served from the cache while online (it could be stale)", unv && net.log.filter((l) => l === "GET /data/c.json").length >= 1);
  net.online = true;
  // pruning on activate
  net.manifest = { assets: { "/models/a.glb": { v: "h2" } } };
  let done; handlers.activate({ waitUntil: (p) => { done = p; } }); await done;
  const cache = await caches.open("oau-assets-v1"), keys = (await cache.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  chk("a new deployment's activation removes saved assets that are no longer current and keeps the current ones", keys.includes("/models/a.glb?v=h2") && !keys.includes("/models/a.glb?v=h1"));
  net.online = false; net.manifest = null;
  chk("with no network, pruning removes nothing (and does not fail)", await (async () => { let d; handlers.message({ data: { type: "PRUNE_ASSETS" }, waitUntil: (p) => { d = p; } }); await d; return (await cache.keys()).length === keys.length; })());
  chk("the asset cache outlives the app-shell cache version (a deployment does not empty it)", (await caches.keys()).includes("oau-assets-v1"));
}

// ---------- 8. the guard: nobody can load an asset around the shared system ----------
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "oau-src-"));
  const put = (f, s) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), s); };
  put("lib3d/tree.js", 'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";\nconst l = new GLTFLoader();');
  put("components/Sky.js", 'const t = new THREE.TextureLoader().load("/textures/sky.png");');
  put("lib3d/town.js", 'export const load = () => fetch("/models/town.glb");\nexport const music = new Audio("/audio/theme.mp3");\nconst i = new Image(); i.src = "/textures/a.png";');
  put("components/Pic.js", 'export default () => <img src="/textures/logo.png" />;');
  put("lib3d/ok.js", 'import { acquireGltf, assetUrl } from "./assets/index.js";\n// a comment mentioning GLTFLoader and fetch("/models/x.glb") is fine\nexport const m = () => acquireGltf("/models/ok.glb");\nexport const a = new Audio(assetUrl("/audio/ok.mp3"));');
  put("lib3d/assets/impl.js", 'import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";\nfetch("/models/x.glb");');
  put("lib/allowed.js", 'fetch("/audio/club/manifest.json");');
  const v = findViolations(dir, { "lib/allowed.js": "reason" }), files = new Set(v.map((x) => x.file));
  chk("a direct GLTFLoader, TextureLoader, fetch, new Audio, .src and <img src> of a managed folder are each reported", ["lib3d/tree.js", "components/Sky.js", "lib3d/town.js", "components/Pic.js"].every((f) => files.has(f)) && v.filter((x) => x.file === "lib3d/town.js").length === 3);
  chk("code that goes through lib3d/assets, comments, the implementation itself and listed exceptions pass", !files.has("lib3d/ok.js") && !files.has("lib3d/assets/impl.js") && !files.has("lib/allowed.js"));
  const real = findViolations();
  chk("the real game code has no direct asset loading" + (real.length ? ": " + real.map((x) => `${x.file}:${x.line}`).join(", ") : ""), real.length === 0);
}

console.log(bad ? `\n${bad} check(s) failed` : "\nAll asset caching checks passed");
process.exit(bad ? 1 : 0);
