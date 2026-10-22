// lib/avatarSnapshot.js
// A head-and-shoulders picture of a player's real 3D character, drawn once with the game's own avatar system (lib3d/avatar/loadAvatar.js)
// and then remembered: in memory for this visit, and in the browser's IndexedDB for the next ones. Browser only.
//
// The picture is keyed by lookKey(look, gender) (+ SNAP_VERSION), i.e. by exactly what is drawn. A new look has a new key, so it is drawn again by itself;
// two players with the same look share one picture; an old picture is never shown for a changed look. Bump SNAP_VERSION when the framing or lighting changes.
import { cleanLook } from "./look.js";

export const SNAP_VERSION = 1;
export const SNAP_PX = 192; // drawn size; shown at 24-100 css px on 1x-3x screens
const MEM_MAX = 160, DB_MAX = 400, IDLE_MS = 12_000;

// ---- memory + in-flight ----
const mem = new Map(), flight = new Map(), failedAt = new Map();
const FAIL_RETRY_MS = 30_000; // a picture that could not be drawn is tried again later, not on every render

const remember = (k, url) => { mem.delete(k); mem.set(k, url); while (mem.size > MEM_MAX) mem.delete(mem.keys().next().value); };
export const keyOf = (lookKey) => `v${SNAP_VERSION}:${lookKey}`;

/** The picture if it is already in memory (synchronous, so a list repaints without a flash), else null. */
export const peekSnapshot = (lookKey) => { const k = keyOf(lookKey), u = mem.get(k); if (u) { mem.delete(k); mem.set(k, u); } return u ?? null; };

// ---- IndexedDB (all optional: private mode or a full disk just means the picture is drawn again next visit) ----
let dbp = null;
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      if (typeof indexedDB === "undefined") return res(null);
      const rq = indexedDB.open("oau-avatars", 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore("snaps", { keyPath: "k" });
      rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const tx = (db, mode, fn) => new Promise((res) => { try { const t = db.transaction("snaps", mode), s = t.objectStore("snaps"), r = fn(s); t.oncomplete = () => res(r?.result ?? true); t.onerror = t.onabort = () => res(null); } catch { res(null); } });
async function dbGet(k) { const db = await idb(); if (!db) return null; const r = await tx(db, "readonly", (s) => s.get(k)); return r && typeof r === "object" && typeof r.url === "string" ? r.url : null; }
async function dbPut(k, url) {
  const db = await idb(); if (!db) return;
  await tx(db, "readwrite", (s) => s.put({ k, url, at: Date.now() }));
  if (Math.random() < 0.1) prune(db); // now and then, keep the store small: drop the oldest pictures (old versions first)
}
async function prune(db) {
  const all = await tx(db, "readonly", (s) => s.getAll()); if (!Array.isArray(all) || all.length <= DB_MAX) return;
  const cur = `v${SNAP_VERSION}:`, drop = all.sort((a, b) => (a.k.startsWith(cur) - b.k.startsWith(cur)) || a.at - b.at).slice(0, all.length - Math.floor(DB_MAX * 0.8));
  await tx(db, "readwrite", (s) => { drop.forEach((r) => s.delete(r.k)); return null; });
}

// ---- the renderer: one small offscreen WebGL context, made on demand and let go when idle (phones have few contexts and the game needs its own) ----
let gl = null, idleTimer = null, chain = Promise.resolve();

async function boot() {
  const [THREE, { addCharacterLights }] = await Promise.all([import("three"), import("../lib3d/character.js")]);
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SNAP_PX;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setPixelRatio(1); renderer.setSize(SNAP_PX, SNAP_PX, false); renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(22, 1, 0.05, 20);
  const key = addCharacterLights(scene); key.castShadow = false;
  const state = { THREE, renderer, scene, camera, lost: false };
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); state.lost = true; });
  return state;
}
async function getGl() {
  if (gl && !gl.lost) return gl;
  if (gl) release();
  gl = await boot(); return gl;
}
function release() { clearTimeout(idleTimer); idleTimer = null; const g = gl; gl = null; if (!g) return; try { g.renderer.dispose(); g.renderer.forceContextLoss?.(); } catch { /* already gone */ } }
const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(release, IDLE_MS); };
const frame = () => new Promise((r) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

/** Frame the head and shoulders, whatever the character's height or build: the window is a fixed share of their standing height. */
export function framing(height) {
  const h = Math.max(1.2, Math.min(2.4, Number(height) || 1.76));
  const top = h * 1.015, bottom = h * 0.64, mid = (top + bottom) / 2, fov = 22, dist = (top - bottom) / 2 / Math.tan((fov / 2) * Math.PI / 180);
  return { mid, dist, fov };
}

async function draw(look, gender) {
  const g = await getGl(), { THREE, renderer, scene, camera } = g;
  const { createAvatar } = await import("../lib3d/avatar/loadAvatar.js");
  const av = await createAvatar(look, gender); // the same body, hair, clothes and colours as in the world
  try {
    if (av.has?.("idle")) av.play("idle", { fade: 0 });
    for (let i = 0; i < 4; i++) av.update(i * 0.05, 0.05); // let the standing pose settle
    scene.add(av.root);
    const f = framing(av.height), yaw = 0.16; // a touch turned, like the preview in Settings, reads as a person rather than an ID photo
    camera.fov = f.fov; camera.updateProjectionMatrix();
    camera.position.set(Math.sin(yaw) * f.dist, f.mid + 0.03, Math.cos(yaw) * f.dist); camera.lookAt(0, f.mid, 0);
    renderer.render(scene, camera); await frame(); renderer.render(scene, camera); // second pass: textures that finished decoding during the first
    if (g.lost || renderer.getContext().isContextLost?.()) throw new Error("graphics context lost");
    const canvas = renderer.domElement;
    let url = canvas.toDataURL("image/webp", 0.88); if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/png"); // Safari cannot encode webp
    if (url.length < 400) throw new Error("empty picture"); // a blank canvas encodes to a tiny string
    return url;
  } finally { scene.remove(av.root); av.dispose(); }
}

/** Draw `look` / `gender` into a picture (data URL), one at a time. Resolves to null when it cannot be drawn (no WebGL, model failure): the caller shows its fallback. */
function render(look, gender) {
  const run = chain.then(async () => { try { return await draw(look, gender); } catch (e) { console.warn("avatar snapshot failed", e); if (gl?.lost) release(); return null; } finally { touchIdle(); } });
  chain = run.then(() => {}, () => {});
  return run;
}

/** The profile picture for this look: memory, then IndexedDB, then drawn now. Same look -> same single piece of work. Never throws; null means "could not be made". */
export function getSnapshot(lookKey, look, gender) {
  const k = keyOf(lookKey), hit = mem.get(k); if (hit) return Promise.resolve(hit);
  if (flight.has(k)) return flight.get(k);
  if (failedAt.has(k) && Date.now() - failedAt.get(k) < FAIL_RETRY_MS) return Promise.resolve(null);
  const p = (async () => {
    const saved = await dbGet(k); if (saved) { remember(k, saved); return saved; }
    const url = await render(cleanLook(look, gender), gender === "F" ? "F" : "M");
    if (url) { remember(k, url); failedAt.delete(k); dbPut(k, url); } else failedAt.set(k, Date.now());
    return url;
  })().finally(() => flight.delete(k));
  flight.set(k, p); return p;
}

/** Forget every stored picture (a debugging aid and what a version bump does implicitly). */
export async function clearSnapshots() { mem.clear(); failedAt.clear(); const db = await idb(); if (db) await tx(db, "readwrite", (s) => s.clear()); }
