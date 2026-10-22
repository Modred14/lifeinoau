// lib/avatarSnapshot.js
// A head-and-shoulders picture of a player's real 3D character, drawn once with the game's own avatar system (lib3d/avatar/loadAvatar.js)
// and then remembered: in memory for this visit, and in the browser's IndexedDB for the next ones. Browser only.
//
// The picture is keyed by lookKey(look, gender) (+ SNAP_VERSION), i.e. by exactly what is drawn. A new look has a new key, so it is drawn again by itself;
// two players with the same look share one picture; an old picture is never shown for a changed look. Bump SNAP_VERSION when the framing or lighting changes.
import { cleanLook } from "./look.js";

export const SNAP_VERSION = 2; // 2: square studio portrait framed from the measured head (v1 pictures were cut off at the top and drawn too low)
export const SNAP_PX = 256; // drawn size (square); shown at 24-100 css px on 1x-3x screens, always cropped to a circle by the page
export const SNAP_BG = 0xeef0f5; // a plain light studio backdrop, so every picture looks the same on any screen colour
// Where the head sits in the square picture (share of its height from the top): the top of the hair, and the chin. The circle crop keeps all of it.
export const HEAD_TOP = 0.1, HAIR_TOP = 0.035, CHIN_AT = 0.7, MAX_HAIR_W = 0.8, FOV = 20; // HEAD_TOP: the skull; HAIR_TOP: the very top of tall hair (afro, bun, headwrap) may rise closer to the edge
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
  const THREE = await import("three");
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = SNAP_PX;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "low-power" });
  renderer.setPixelRatio(1); renderer.setSize(SNAP_PX, SNAP_PX, false); renderer.setClearColor(SNAP_BG, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3; renderer.shadowMap.enabled = false;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 20);
  scene.background = new THREE.Color(SNAP_BG);
  // Soft, even studio light from the front (like the photo): no coloured rim light, no hard shadows under the brow or chin.
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc8c2, 1.25));
  const key = new THREE.DirectionalLight(0xfff4e6, 2.1); key.position.set(0.9, 1.9, 3.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0xf2f4ff, 1.1); fill.position.set(-1.6, 0.6, 3); scene.add(fill);
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

/** Camera placement for a head: `m` = { top (top of hair), chin, cx, cz, hairW } in metres. The picture is square; the top of the hair lands at HEAD_TOP and the chin at CHIN_AT
 *  of its height, so the face is large and centred, the shoulders fill the bottom and a circular crop never cuts the head. A very wide hairstyle zooms out just enough to fit. */
export function framing(m, fov = FOV) {
  const skullTop = Math.min(m.top, m.skullTop ?? m.top), span = Math.max(0.05, skullTop - m.chin);
  const size = Math.max(span / (CHIN_AT - HEAD_TOP), Math.max(0.05, m.top - m.chin) / (CHIN_AT - HAIR_TOP), (m.hairW || 0) / MAX_HAIR_W); // the height (metres) the picture covers at the face
  const cy = m.chin + (CHIN_AT - 0.5) * size; // the chin sits at CHIN_AT of the picture's height
  const dist = size / 2 / Math.tan((fov / 2) * Math.PI / 180);
  return { cx: m.cx ?? 0, cy, size, dist, fov, z: (m.cz ?? 0) + dist };
}

/** Measures the drawn character itself (not a guessed height): top of the hair, chin, width of the hair and the face's centre, from its real vertices. */
export function measureHead(THREE, av) {
  const root = av.root, v = new THREE.Vector3(); root.updateMatrixWorld(true);
  const bone = (n) => av.bone?.(n) ?? null, bp = (b) => (b ? new THREE.Vector3().setFromMatrixPosition(b.matrixWorld) : null);
  const head = bp(bone("Head")), neck = bp(bone("Neck"));
  const each = (fn) => root.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const n = o.geometry.attributes.position.count, step = n > 12000 ? 2 : 1, mats = [].concat(o.material ?? []).map((x) => x?.name ?? "").join(" ");
    if (o.isSkinnedMesh) o.skeleton?.update?.();
    for (let i = 0; i < n; i += step) { if (o.isSkinnedMesh) o.getVertexPosition(i, v); else v.fromBufferAttribute(o.geometry.attributes.position, i); v.applyMatrix4(o.matrixWorld); fn(v, o, mats); }
  });
  if (head && neck) { // the authored model: skull from the skin, eyes from the eye meshes, hair from everything above the neck
    let skinTop = -Infinity, eyeSum = 0, eyeN = 0;
    each((p, o, mats) => { if (/skin/i.test(mats) && p.y > neck.y) skinTop = Math.max(skinTop, p.y); else if (/^eye/i.test(o.name) || /^eye$/i.test(mats)) { eyeSum += p.y; eyeN++; } });
    if (Number.isFinite(skinTop) && eyeN) {
      const eyeY = eyeSum / eyeN, chin = Math.max(neck.y + 0.02, 2 * eyeY - skinTop); // eyes sit halfway between the chin and the top of the skull
      let top = skinTop, minX = Infinity, maxX = -Infinity;
      each((p) => { if (p.y > chin) { top = Math.max(top, p.y); if (p.y > chin + 0.04) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); } } }); // hair, headwrap or cap included; collars sit below the chin
      return { top, skullTop: skinTop, chin, cx: head.x, cz: head.z + 0.06, hairW: Math.max(0, maxX - minX), ok: true };
    }
  }
  // the built-in character (no skeleton): a head is about an eighth of a person's height
  const box = new THREE.Box3().setFromObject(root), h = av.height || box.max.y, top = box.max.y;
  return { top, chin: top - 0.135 * h, cx: (box.min.x + box.max.x) / 2, cz: 0.05, hairW: 0, ok: false };
}

async function draw(look, gender) {
  const g = await getGl(), { THREE, renderer, scene, camera } = g;
  const { createAvatar } = await import("../lib3d/avatar/loadAvatar.js");
  const av = await createAvatar(look, gender); // the same body, hair, clothes and colours as in the world
  try {
    if (av.has?.("idle")) av.play("idle", { fade: 0 });
    av.setExpression?.("neutral");
    for (let i = 0; i < 4; i++) av.update(i * 0.05, 0.05); // let the standing pose settle
    scene.add(av.root);
    const f = framing(measureHead(THREE, av)); // straight on, like a passport photo: the same view for everyone
    camera.fov = f.fov; camera.aspect = 1; camera.updateProjectionMatrix();
    camera.position.set(f.cx, f.cy, f.z); camera.lookAt(f.cx, f.cy, 0);
    renderer.render(scene, camera); await frame(); renderer.render(scene, camera); // second pass: textures that finished decoding during the first
    if (g.lost || renderer.getContext().isContextLost?.()) throw new Error("graphics context lost");
    const canvas = renderer.domElement;
    let url = canvas.toDataURL("image/webp", 0.9); if (!url.startsWith("data:image/webp")) url = canvas.toDataURL("image/png"); // Safari cannot encode webp
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
