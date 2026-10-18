// lib3d/interiors/scene.js
// lib3d/interiors/scene.js
// Draws a compiled interior (see compile.js) with three.js, lets the player walk through it, and puts people in it. Browser only.
// Everything static (walls, floors, furniture) is merged into a handful of meshes per floor, so a whole faculty building is about 20 draw calls.
// createInteriorScene() returns { dispose, ... }; dispose() frees every geometry, material, texture, avatar, listener and the renderer.
import * as THREE from "three";
import { createStage } from "../stage.js";
import { createAvatar } from "../avatar/loadAvatar.js";
import { createNpc, npcSpec, hashSeed, lecturerSpec } from "../avatar/npc.js";
import { incidentFrame } from "./lectureEncounter.js";
import { ITEMS, dimsOf } from "./items.js";
import { movePlayer, rayClip, EXIT_DEPTH, DOOR_H } from "./compile.js";

// ------------------------------------------------------------------------------------------------ textures

const canvasTex = (w, h, draw, repeat = true) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
};
const speckle = (g, w, h, n, a) => { for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? "0,0,0" : "255,255,255"},${Math.random() * a})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2); } };
const SURFACE_TEX = {
  tile: () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#e6e9ec"; g.fillRect(0, 0, w, h); g.strokeStyle = "#b9c0c7"; g.lineWidth = 3; for (let i = 0; i <= 2; i++) { g.beginPath(); g.moveTo(i * w / 2, 0); g.lineTo(i * w / 2, h); g.moveTo(0, i * h / 2); g.lineTo(w, i * h / 2); g.stroke(); } speckle(g, w, h, 60, 0.06); }),
  marble: () => canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#eeebe4"; g.fillRect(0, 0, w, h); g.strokeStyle = "rgba(120,120,130,0.22)"; for (let i = 0; i < 14; i++) { g.lineWidth = 0.5 + Math.random() * 1.2; g.beginPath(); let x = Math.random() * w, y = 0; g.moveTo(x, y); while (y < h) { x += (Math.random() - 0.5) * 30; y += 20 + Math.random() * 20; g.lineTo(x, y); } g.stroke(); } g.strokeStyle = "#cfcac0"; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }),
  wood: () => canvasTex(256, 256, (g, w, h) => { const n = 6; for (let i = 0; i < n; i++) { const l = 52 + Math.random() * 10; g.fillStyle = `hsl(28,${42 + Math.random() * 10}%,${l}%)`; g.fillRect(0, i * h / n, w, h / n); g.fillStyle = "rgba(60,30,10,0.35)"; g.fillRect(0, i * h / n, w, 2); g.fillRect(((i * 97) % w), i * h / n, 2, h / n); } speckle(g, w, h, 160, 0.08); }),
  noise: () => canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#c8c8c8"; g.fillRect(0, 0, w, h); speckle(g, w, h, 900, 0.22); }),
  books: () => canvasTex(128, 64, (g, w, h) => { g.fillStyle = "#3a2a1e"; g.fillRect(0, 0, w, h); const cols = ["#b8473b", "#3f6fb5", "#d9a441", "#3f8f55", "#7a4aa0", "#c9c0a8", "#2f4f6f", "#a85a2f"]; for (let r = 0; r < 4; r++) { let x = 0; while (x < w) { const bw = 4 + Math.random() * 6, bh = h / 4 - 3 - Math.random() * 6; g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(x, r * h / 4 + (h / 4 - bh - 1), bw - 1, bh); x += bw; } g.fillStyle = "#2a1c12"; g.fillRect(0, (r + 1) * h / 4 - 1, w, 2); } }, false),
};
SURFACE_TEX.books2 = SURFACE_TEX.books;
const SURF = { tile: ["tile", "#ffffff"], marble: ["marble", "#ffffff"], wood: ["wood", "#ffffff"], carpet: ["noise", "#6f7f9c"], concrete: ["noise", "#b4b3ad"], dark: ["noise", "#34373f"], rubber: ["noise", "#3c5f78"], soil: ["noise", "#6b4a32"], grass: ["noise", "#5a9a52"] };

// ------------------------------------------------------------------------------------------------ geometry batches

class Batch {
  constructor() { this.p = []; this.n = []; this.c = []; this.u = []; this.i = []; }
  /** One quad: four corners (x,y,z each), the outward normal, a colour, uvs. The winding is fixed up to match the normal. */
  quad(q, nrm, col, uv) {
    const b = this.p.length / 3, [a, bb, cc] = q, ux = bb[0] - a[0], uy = bb[1] - a[1], uz = bb[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    const dot = (uy * vz - uz * vy) * nrm[0] + (uz * vx - ux * vz) * nrm[1] + (ux * vy - uy * vx) * nrm[2];
    for (let k = 0; k < 4; k++) { this.p.push(q[k][0], q[k][1], q[k][2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.c.push(col.r, col.g, col.b); this.u.push(uv ? uv[k][0] : k === 1 || k === 2 ? 1 : 0, uv ? uv[k][1] : k >= 2 ? 1 : 0); }
    this.i.push(...(dot >= 0 ? [b, b + 1, b + 2, b, b + 2, b + 3] : [b, b + 2, b + 1, b, b + 3, b + 2]));
  }
  geometry() {
    if (!this.i.length) return null; const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i.length > 65000 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1)); g.computeBoundingSphere(); return g;
  }
}

const rot = (T, lx, lz) => { const c = Math.cos(T.ry), s = Math.sin(T.ry); return [T.x + lx * c + lz * s, T.z - lx * s + lz * c]; };
const rotN = (T, nx, nz) => { const c = Math.cos(T.ry), s = Math.sin(T.ry); return [nx * c + nz * s, -nx * s + nz * c]; };

const MAX_DRAWN = 8;
const NPC_ROLE = { staff: "staff", clerk: "staff", lecturer: "staff", pharmacist: "staff", doctor: "staff", nurse: "staff", teller: "staff", pastor: "staff", bartender: "staff", technician: "officer", guard: "officer", bouncer: "officer", officer: "officer", celebrant: "celebrant", dancer: "celebrant", patron: "celebrant" };

/**
 * @param container  element to draw into
 * @param c          compiled interior (buildInterior(place))
 * @param opts       { look, gender, input: {jx,jy,run}, view: "follow"|"overhead", onExit(), onHub(hub), onNear(hub|null), onRoom(name), onReady() }
 */
export async function createInteriorScene(container, c, opts = {}) {
  const dark = !!c.plan.style?.dark, stage = createStage(container, { shadows: false, fov: 55, far: 300, maxDpr: 1.5, exposure: dark ? 1.15 : 1.0 }), { scene, camera, renderer } = stage;
  stage.setManual(true); stage.controls.enabled = false;
  scene.background = new THREE.Color(dark ? "#05060a" : "#a9cdea");
  const toDispose = [], texs = new Map(), mats = new Map(), batches = new Map(), anims = [], texts = [];
  let alive = true, view = opts.view ?? "follow", pose = null, route = null; // route: an automatic walk to a ring { pts, i, done(ok) }; pose: avatar clips to try while standing still (an activity is running)
  const own = (o) => { toDispose.push(o); return o; };
  const tex = (name) => { if (!texs.has(name)) texs.set(name, own(SURFACE_TEX[name]())); return texs.get(name); };
  const material = (key) => {
    if (mats.has(key)) return mats.get(key); let m;
    if (key === "glow") m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    else if (key.startsWith("op:")) m = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: +key.slice(3), roughness: 0.2, depthWrite: false });
    else if (key.startsWith("surf:")) m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex(SURF[key.slice(5)]?.[0] ?? "noise"), roughness: key === "surf:marble" ? 0.35 : 0.9, metalness: 0.02 });
    else if (key.startsWith("tex:")) m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex(key.slice(4) === "tile" ? "tile" : key.slice(4)), roughness: 0.9 });
    else m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.04 });
    mats.set(key, own(m)); return m;
  };
  const batch = (f, key) => { const k = f + "|" + key; if (!batches.has(k)) batches.set(k, { f, key, b: new Batch() }); return batches.get(k).b; };
  const colorOf = (() => { const cache = new Map(); return (hex) => { const k = hex ?? "#ffffff"; if (!cache.has(k)) { let col; try { col = new THREE.Color(k); } catch { col = new THREE.Color("#ff00ff"); } cache.set(k, col); } return cache.get(k); }; })();
  const shadeC = new THREE.Color("#8a86b8"), shade = (col) => (dark ? col.clone().lerp(shadeC, 0.2) : col); // night-club walls are nearly black on paper; lift them so the room can be read
  const keyOf = (color, o = {}) => (o.glow ? "glow" : o.op != null && o.op < 1 ? "op:" + o.op : typeof color === "string" && color.startsWith("tex:") ? color : "std");

  // ---- primitives (world space, axis-aligned frames rotated by T.ry) ----
  function box(f, key, T, color, x, y, z, w, h, d, o = {}) {
    const bt = batch(f, key), col = key.startsWith("tex:") ? colorOf("#ffffff") : key === "glow" ? colorOf(color) : shade(colorOf(color)), y0 = T.y + y, y1 = y0 + h, hw = w / 2, hd = d / 2, P = (lx, lz) => rot(T, x + lx, z + lz);
    const [a, b, c2, e] = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)], nz = rotN(T, 0, 1), nx = rotN(T, 1, 0), uv4 = [[0, 0], [1, 0], [1, 1], [0, 1]];
    bt.quad([[a[0], y1, a[1]], [b[0], y1, b[1]], [c2[0], y1, c2[1]], [e[0], y1, e[1]]], [0, 1, 0], col);
    if (y > 0.3 || o.under) bt.quad([[a[0], y0, a[1]], [b[0], y0, b[1]], [c2[0], y0, c2[1]], [e[0], y0, e[1]]], [0, -1, 0], col);
    const side = (p, q2, n) => bt.quad([[p[0], y0, p[1]], [q2[0], y0, q2[1]], [q2[0], y1, q2[1]], [p[0], y1, p[1]]], [n[0], 0, n[1]], col, uv4);
    side(e, c2, nz); side(b, a, [-nz[0], -nz[1]]); side(c2, b, nx); side(a, e, [-nx[0], -nx[1]]);
  }
  function cyl(f, key, T, color, x, y, z, r, h, o = {}) {
    const bt = batch(f, key), col = key === "glow" ? colorOf(color) : shade(colorOf(color)), N = 10, [cx, cz] = rot(T, x, z), y0 = T.y + y, y1 = y0 + h;
    for (let k = 0; k < N; k++) { const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2, p0 = [cx + Math.cos(a0) * r, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, cz + Math.sin(a1) * r];
      bt.quad([[p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]]], [Math.cos(am), 0, Math.sin(am)], col);
      bt.quad([[cx, y1, cz], [p0[0], y1, p0[1]], [p1[0], y1, p1[1]], [p1[0], y1, p1[1]]], [0, 1, 0], col); }
    void o;
  }
  const textTexture = (str, o, aspect) => {
    const k = `${str}|${o.bg}|${o.fg}|${o.font}|${aspect.toFixed(2)}`; if (texs.has(k)) return texs.get(k);
    const W = 512, H = Math.max(48, Math.min(512, Math.round(W / aspect))), t = own(canvasTex(W, H, (g) => {
      if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, W, H); } let weight = "700", fam = "system-ui, sans-serif", size = H * 0.62; const m = /^(\S+)\s+(\d+)px\s+(.*)$/.exec(o.font ?? ""); if (m) { weight = m[1]; fam = m[3]; }
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = o.fg ?? "#ffffff"; g.font = `${weight} ${size}px ${fam}`; const mw = g.measureText(str).width; if (mw > W * 0.92) { size *= (W * 0.92) / mw; g.font = `${weight} ${size}px ${fam}`; } g.fillText(str, W / 2, H / 2 + size * 0.04); }, false));
    texs.set(k, t); return t;
  };
  function text(f, T, str, x, y, z, w, h, o = {}) {
    if (!str) return; const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), own(new THREE.MeshBasicMaterial({ map: textTexture(String(str), o, w / h), transparent: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    own(m.geometry); const [wx, wz] = rot(T, x, z); m.position.set(wx, T.y + y, wz); m.rotation.y = T.ry + (o.ry ?? 0); texts.push({ f, m });
  }
  // the batch interface handed to the furniture drawing functions
  const makeB = (f, T, it) => ({
    box: (color, x, y, z, w, h, d, o = {}) => box(f, keyOf(color, o), T, color, x, y, z, w, h, d, o),
    cyl: (color, x, y, z, r, h, o = {}) => cyl(f, keyOf(color, o), T, color, x, y, z, r, h, o),
    text: (str, x, y, z, w, h, o = {}) => text(f, T, str, x, y, z, w, h, o),
    at: (x, z, ry, fn) => { const [wx, wz] = rot(T, x, z); fn(makeB(f, { x: wx, z: wz, ry: T.ry + ry, y: T.y }, it)); },
    anim: (name, data = {}) => { const [wx, wz] = rot(T, data.x ?? 0, data.z ?? 0); anims.push({ name, data, x: wx, z: wz, y: T.y, ry: T.ry, f }); },
  });
  const W0 = new THREE.Group(); scene.add(W0);
  const fl = (r) => c.floorY[r] ?? 0;

  // ---- the building shell ----
  for (const s of c.solids) box(s.floor, "std", { x: 0, z: 0, ry: 0, y: 0 }, s.color, s.x, s.y0, s.z, s.w, s.y1 - s.y0, s.d, { under: s.kind === "lintel" });
  for (const f of c.floorsOut) { const [tn, tint] = SURF[f.surface] ?? SURF.tile, bt = batch(f.floor, "surf:" + (SURF[f.surface] ? f.surface : "tile")), col = shade(colorOf(f.color ?? tint)), y = f.y + 0.002;
    bt.quad([[f.x0, y, f.z0], [f.x1, y, f.z0], [f.x1, y, f.z1], [f.x0, y, f.z1]], [0, 1, 0], col, [[f.x0 / 2, f.z0 / 2], [f.x1 / 2, f.z0 / 2], [f.x1 / 2, f.z1 / 2], [f.x0 / 2, f.z1 / 2]]); void tn; }
  const lamps = [];
  for (const k of c.ceilings) { const bt = batch(k.floor, "ceil"), col = shade(colorOf(k.color)); bt.quad([[k.x0, k.y, k.z0], [k.x0, k.y, k.z1], [k.x1, k.y, k.z1], [k.x1, k.y, k.z0]], [0, -1, 0], col);
    if (k.lit && !dark) { const nx = Math.max(1, Math.round((k.x1 - k.x0) / 3.6)), nz = Math.max(1, Math.round((k.z1 - k.z0) / 3.6)); for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const x = k.x0 + ((i + 0.5) / nx) * (k.x1 - k.x0), z = k.z0 + ((j + 0.5) / nz) * (k.z1 - k.z0); lamps.push([k.floor, x, k.y, z]); } } }
  for (const [f, x, y, z] of lamps) box(f, "glow", { x: 0, z: 0, ry: 0, y: 0 }, "#fff6dc", x, y - 0.04, z, 0.9, 0.04, 0.3, { under: true });
  const T0 = { x: 0, z: 0, ry: 0, y: 0 };
  for (const w of c.windows) { const nrm = w.axis === "x" ? [w.inward[0], w.inward[1]] : [w.inward[0], w.inward[1]]; for (const side of [1, -1]) { const off = side > 0 ? 0.115 : -0.135, px = w.x + nrm[0] * off, pz = w.z + nrm[1] * off, ww = w.axis === "x" ? w.w : 0.03, dd = w.axis === "x" ? 0.03 : w.w;
      box(w.floor, "glow", T0, "#8cc4e8", px, w.y, pz, ww, w.h, dd); box(w.floor, "std", T0, "#f4f1ea", px + nrm[0] * 0.01 * side, w.y + w.h / 2 - 0.02, pz + nrm[1] * 0.01 * side, w.axis === "x" ? w.w + 0.08 : 0.04, 0.04, w.axis === "x" ? 0.04 : w.w + 0.08); } }
  for (const fr of c.frames) { const wood = "#6b4a32", t = 0.1, ax = fr.axis === "x"; for (const sd of [-1, 1]) box(fr.floor, "std", T0, wood, fr.x + (ax ? sd * (fr.w / 2 + 0.03) : 0), fl(fr.floor), fr.z + (ax ? 0 : sd * (fr.w / 2 + 0.03)), ax ? 0.07 : 0.16, DOOR_H, ax ? 0.16 : 0.07);
    box(fr.floor, "std", T0, wood, fr.x, fl(fr.floor) + DOOR_H - 0.07, fr.z, ax ? fr.w + 0.14 : 0.16, 0.07, ax ? 0.16 : fr.w + 0.14); void t; }
  // stairs: a flight of steps whose average height follows the walkable ramp
  for (const s of c.stairs) { const n = 14, run = s.len / n, wide = s.dx ? s.z1 - s.z0 : s.x1 - s.x0; for (let i = 0; i < n; i++) { const h = s.y1 * (i + 0.5) / n, u = (i + 0.5) * run, cx = s.dx ? (s.dx > 0 ? s.x0 + u : s.x1 - u) : (s.x0 + s.x1) / 2, cz = s.dz ? (s.dz > 0 ? s.z0 + u : s.z1 - u) : (s.z0 + s.z1) / 2;
      box(0, "std", T0, i % 2 ? "#c9c2b2" : "#d6cfc0", cx, 0, cz, s.dx ? run : wide, h, s.dx ? wide : run); } }
  // items
  for (const it of c.items) { const spec = ITEMS[it.type]; if (!spec) continue; const f = it.floor ?? 0, T = { x: it.x, z: it.z, ry: it.ry ?? 0, y: fl(f) + (it.lift ?? 0) }; try { spec.draw(makeB(f, T, it), it, dimsOf(it)); } catch (e) { console.warn("interior item failed", it.type, e); } }
  // the porch, the name above the door, the exit sign inside
  let canopy = null;
  if (c.porch) { const p = c.porch, R = p.rect, T = { x: 0, z: 0, ry: 0, y: 0 }, bt = batch(0, "surf:concrete");
    bt.quad([[R.x0, 0.012, R.z0], [R.x1, 0.012, R.z0], [R.x1, 0.012, R.z1], [R.x0, 0.012, R.z1]], [0, 1, 0], colorOf("#cfcac0"), [[R.x0 / 2, R.z0 / 2], [R.x1 / 2, R.z0 / 2], [R.x1 / 2, R.z1 / 2], [R.x0 / 2, R.z1 / 2]]);
    for (const q of p.fence) { box(0, "std", T, "#8d99a8", (q.x0 + q.x1) / 2, 0, (q.z0 + q.z1) / 2, q.x1 - q.x0, 0.95, q.z1 - q.z0); }
    const outYaw = Math.atan2(p.out[0], p.out[1]), ex = p.axis === "x" ? p.pos : p.line, ez = p.axis === "x" ? p.line : p.pos;
    text(0, { x: 0, z: 0, ry: 0, y: 0 }, c.plan.title ?? "", ex + p.out[0] * 0.17, DOOR_H + 0.55, ez + p.out[1] * 0.17, Math.min(5.5, p.w + 2.6), 0.55, { bg: "#1d3b2f", fg: "#f4efe0", ry: outYaw });
    text(0, { x: 0, z: 0, ry: 0, y: 0 }, "EXIT", ex - p.out[0] * 0.16, DOOR_H - 0.28, ez - p.out[1] * 0.16, 0.7, 0.22, { bg: "#1f8a4c", fg: "#ffffff", ry: outYaw + Math.PI });
    canopy = { f: 0, key: "canopy" }; const cb = batch(0, "canopy"), g = 0.3, cy = p.canopy; for (const [x, z] of [[R.x0, R.z0], [R.x1, R.z0], [R.x1, R.z1], [R.x0, R.z1]]) void x, z;
    box(0, "canopy", T, "#e8e2d2", (R.x0 + R.x1) / 2, cy, (R.z0 + R.z1) / 2, R.x1 - R.x0 + g, 0.16, R.z1 - R.z0 + g, { under: true }); void cb;
    const far = p.axis === "x" ? [[R.x0, p.out[1] > 0 ? R.z1 : R.z0], [R.x1, p.out[1] > 0 ? R.z1 : R.z0]] : [[p.out[0] > 0 ? R.x1 : R.x0, R.z0], [p.out[0] > 0 ? R.x1 : R.x0, R.z1]];
    for (const [x, z] of far) box(0, "std", T, "#e8e2d2", x, 0, z, 0.22, cy, 0.22); }
  // the ground outside
  { const b = c.bounds, m = 70, bt = batch(0, "surf:grass"); bt.quad([[b.x0 - m, -0.03, b.z0 - m], [b.x1 + m, -0.03, b.z0 - m], [b.x1 + m, -0.03, b.z1 + m], [b.x0 - m, -0.03, b.z1 + m]], [0, 1, 0], colorOf("#6aa85a"), [[(b.x0 - m) / 3, (b.z0 - m) / 3], [(b.x1 + m) / 3, (b.z0 - m) / 3], [(b.x1 + m) / 3, (b.z1 + m) / 3], [(b.x0 - m) / 3, (b.z1 + m) / 3]]); }

  // ---- turn the batches into meshes, one group per floor ----
  const groups = Array.from({ length: c.floors }, () => { const g = new THREE.Group(); W0.add(g); return g; }), ceilMeshes = Array.from({ length: c.floors }, () => []), canopyMeshes = [];
  for (const { f, key, b } of batches.values()) { const g = b.geometry(); if (!g) continue; own(g); const m = new THREE.Mesh(g, material(key === "ceil" || key === "canopy" ? "std" : key)); groups[f].add(m); if (key === "ceil") ceilMeshes[f].push(m); if (key === "canopy") canopyMeshes.push(m); }
  for (const t of texts) groups[t.f].add(t.m);

  // ---- lights ----
  if (dark) scene.add(new THREE.AmbientLight("#8a84c0", 1.1));
  const hemi = new THREE.HemisphereLight(dark ? "#a79ee0" : "#ffffff", dark ? "#3a3556" : "#b9ab90", dark ? 2.3 : 1.55); scene.add(hemi);
  if (!dark) { const sun = new THREE.DirectionalLight("#fff3dc", 0.55); sun.position.set(30, 60, 20); scene.add(sun); }
  const flicker = [], spots = [], tiles = [], balls = [];
  for (const a of anims) {
    const y = fl(a.f) + (a.data.y ?? 3.2);
    if (a.name === "spot") { const h = Math.max(1, y - fl(a.f)), cone = new THREE.Mesh(own(new THREE.ConeGeometry(0.9, h, 16, 1, true).translate(0, -h / 2, 0)), own(new THREE.MeshBasicMaterial({ color: a.data.c ?? "#38e8ff", transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))); cone.position.set(a.x, y, a.z); scene.add(cone); const L = spots.length < 5 ? new THREE.PointLight(a.data.c ?? "#38e8ff", 14, 12, 1.6) : null; if (L) { L.position.set(a.x, y - 0.6, a.z); scene.add(L); } spots.push({ cone, L, ph: Math.random() * 6.28, base: new THREE.Color(a.data.c ?? "#38e8ff"), f: a.f }); }
    else if (a.name === "ball") { const m = new THREE.Mesh(own(new THREE.IcosahedronGeometry(0.34, 1)), own(new THREE.MeshStandardMaterial({ color: "#d4dde6", metalness: 1, roughness: 0.12, flatShading: true, emissive: "#303848" }))); m.position.set(a.x, y - 0.1, a.z); scene.add(m); balls.push({ m, f: a.f }); }
    else if (a.name === "tile") tiles.push(a);
  }
  let tileMesh = null; const tileDummy = new THREE.Object3D(), tileCol = new THREE.Color();
  if (tiles.length) { tileMesh = new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 0.02, 1)), own(new THREE.MeshBasicMaterial({ toneMapped: false })), tiles.length); tiles.forEach((a, i) => { tileDummy.position.set(a.x, fl(a.f) + 0.04, a.z); tileDummy.rotation.y = a.ry; tileDummy.scale.set(a.data.s, 1, a.data.s); tileDummy.updateMatrix(); tileMesh.setMatrixAt(i, tileDummy.matrix); tileMesh.setColorAt(i, tileCol.set("#222")); }); scene.add(tileMesh); }
  void flicker;

  // ---- hubs: gold rings on the floor with a floating label ----
  const hubObjs = c.hubs.map((h) => { const ring = new THREE.Mesh(own(new THREE.RingGeometry(0.42, 0.58, 28).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ color: h.tint ?? "#ffd24a", transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide }))); ring.position.set(h.x, fl(h.floor ?? 0) + 0.03, h.z); scene.add(ring);
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: textTexture(h.label, { bg: "rgba(13,19,33,0.82)", fg: h.tint ? "#b9ffe9" : "#ffe9a6" }, 4.2), transparent: true, toneMapped: false, depthWrite: false }))); sp.scale.set(2.1, 0.5, 1); sp.position.set(h.x, fl(h.floor ?? 0) + 2.15, h.z); scene.add(sp); return { h, ring, sp, f: h.floor ?? 0 }; });

  // ---- the player ----
  const input = opts.input ?? { jx: 0, jy: 0, run: false }, keys = new Set(), P = { x: c.spawn.x, z: c.spawn.z, y: 0, fl: 0, yaw: c.spawn.yaw ?? 0, moving: 0, run: false };
  let locked = false, shownFloor = 0, camYaw = P.yaw, camPitch = 0.4, camDist = 3.4, near = null, lastRoom = null, exited = false, cur = null, vp = null;
  const player = new THREE.Group(); scene.add(player);
  let avatar = null; createAvatar(opts.look ?? null, opts.gender ?? "M").then((av) => { if (!alive) { av.dispose(); return; } avatar = av; player.add(av.root); }).catch(() => {
    if (!alive) return; const m = new THREE.Mesh(own(new THREE.CapsuleGeometry(0.25, 1.1, 4, 8).translate(0, 0.8, 0)), own(new THREE.MeshStandardMaterial({ color: "#2f62c4" }))); player.add(m); });
  const onKey = (e, down) => { if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName ?? "")) return; const k = e.key.toLowerCase(); if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", "q", "e"].includes(k)) { down ? keys.add(k) : keys.delete(k); e.preventDefault?.(); }
    if (down && (k === "f" || k === "enter" || k === " ")) { activate(); e.preventDefault?.(); } if (down && k === "v") api.toggleView(); };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false); window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
  // drag to turn the camera, wheel to zoom
  const el = renderer.domElement; let drag = null;
  const pd = (e) => { drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); }, pm = (e) => { if (!drag || drag.id !== e.pointerId) return; camYaw -= (e.clientX - drag.x) * 0.006; camPitch = Math.max(0.12, Math.min(1.25, camPitch + (e.clientY - drag.y) * 0.004)); drag.x = e.clientX; drag.y = e.clientY; }, pu = (e) => { if (drag?.id === e.pointerId) drag = null; };
  const wh = (e) => { camDist = Math.max(1.6, Math.min(10, camDist * (1 + Math.sign(e.deltaY) * 0.08))); };
  el.addEventListener("pointerdown", pd); el.addEventListener("pointermove", pm); el.addEventListener("pointerup", pu); el.addEventListener("pointercancel", pu); el.addEventListener("wheel", wh, { passive: true });

  function activate() { if (near && !locked) opts.onHub?.(near.h); }
  const setClip = (av, name, o) => { if (!av || !av.has?.(name)) return false; return av.play(name, o); };

  // ---- people ----
  const people = [], spec = c.npcs, lecturers = (opts.lecturers ?? []).filter((l) => spec[l.npcIndex]); let loadIdx = 0;
  const startNpc = async (n, i) => {
    const role = NPC_ROLE[n.role] ?? "student", seed = `${c.id}:${i}`;
    const lec = lecturers.find((l) => l.npcIndex === i); // a lecturer of the player's: the same person as in the fight, with their name above them
    try { const av = await createNpc(lec ? lecturerSpec(lec.name, lec.difficulty) : npcSpec(seed, { role, gender: hashSeed(seed) & 1 ? "F" : "M" })); if (!alive) { av.dispose(); return; }
      if (lec) { const tag = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: textTexture(lec.name, { bg: "rgba(13,19,33,0.82)", fg: "#ffe9a6" }, 4.6), transparent: true, toneMapped: false, depthWrite: false }))); tag.scale.set(1.9, 0.41, 1); tag.position.set(0, (av.height ?? 1.75) + 0.45, 0); av.root.add(tag); }
      const p = { i, av, n, x: n.x, z: n.z, yaw: n.yaw ?? 0, f: n.floor ?? 0, path: null, pi: 0, wait: Math.random() * 3, clip: null, mode: n.mode, ph: Math.random() * 6.28, h: hashSeed(seed) >>> 0 }; people.push(p); scene.add(av.root); place(p);
      const pick = n.mode === "sit" ? "sit" : n.mode === "dance" ? "cheer" : ["idle", "idle", "talk", "phone", "lookAround"][p.h % 5]; if (!setClip(av, pick, { fade: 0 })) setClip(av, "idle", { fade: 0 }); p.clip = pick; if (n.mode === "dance") av.setSpeed?.(0.9 + (p.h % 5) * 0.1);
    } catch { /* this person just does not appear */ }
  };
  // each of the player's lecturers who stands in this building gets a ring to walk up to them (the server decides if the confrontation is allowed)
  for (const l of lecturers) { const n = spec[l.npcIndex], fx = Math.sin(n.yaw ?? 0), fz = Math.cos(n.yaw ?? 0), h = { x: n.x + fx * 1.4, z: n.z + fz * 1.4, label: `Confront ${l.name}`, action: "lecture", code: l.code, floor: n.floor ?? 0, lecturer: l };
    const ring = new THREE.Mesh(own(new THREE.RingGeometry(0.42, 0.58, 28).rotateX(-Math.PI / 2)), own(new THREE.MeshBasicMaterial({ color: "#ff6a4a", transparent: true, opacity: 0.9, toneMapped: false, side: THREE.DoubleSide }))); ring.position.set(h.x, fl(h.floor) + 0.03, h.z); scene.add(ring);
    const sp = new THREE.Sprite(own(new THREE.SpriteMaterial({ map: textTexture(h.label, { bg: "rgba(60,16,12,0.86)", fg: "#ffd6cc" }, 4.8), transparent: true, toneMapped: false, depthWrite: false }))); sp.scale.set(2.4, 0.5, 1); sp.position.set(h.x, fl(h.floor) + 2.15, h.z); scene.add(sp); hubObjs.push({ h, ring, sp, f: h.floor }); }

  const place = (p) => { p.av.root.position.set(p.x, fl(p.f) + 0.02, p.z); p.av.root.rotation.y = p.yaw; };
  (async () => { const worker = async () => { while (alive && loadIdx < spec.length) { const i = loadIdx++; await startNpc(spec[i], i); } }; await Promise.all([worker(), worker(), worker()]); })();
  const stepNpc = (p, t, dt) => {
    if (p.mode === "wander") {
      if (p.path) { const [tx, tz] = p.path[p.pi], dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = 0.95 * dt;
        if (Math.hypot(P.x - p.x, P.z - p.z) < 0.7 && p.f === P.fl && Math.hypot(P.x - (p.x + dx / (d || 1) * 0.5), P.z - (p.z + dz / (d || 1) * 0.5)) < 0.7) { if (p.clip !== "idle") { setClip(p.av, "idle", { fade: 0.2 }); p.clip = "idle"; } return; }
        if (d <= step) { p.x = tx; p.z = tz; p.pi++; if (p.pi >= p.path.length) { p.path = null; p.wait = 1 + Math.random() * 4; } } else { p.x += (dx / d) * step; p.z += (dz / d) * step; let dh = Math.atan2(dx, dz) - p.yaw; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; p.yaw += dh * Math.min(1, dt * 8); }
        if (p.clip !== "walk") { setClip(p.av, "walk", { fade: 0.25 }); p.clip = "walk"; } p.av.setSpeed?.(0.95); }
      else { if (p.clip !== "idle") { setClip(p.av, "idle", { fade: 0.25 }); p.clip = "idle"; } p.av.setSpeed?.(1); p.wait -= dt;
        if (p.wait <= 0) { const list = c.spots.get(p.n.room) ?? [], tgt = list.length ? list[(Math.random() * list.length) | 0] : null; if (tgt) { const path = c.nav[p.f].path(p.x, p.z, tgt[0], tgt[1]); if (path && path.length > 1) { p.path = path; p.pi = 1; } else p.wait = 2; } else p.wait = 5; } }
    } else if (p.mode === "dance") p.av.root.position.y = fl(p.f) + 0.02 + Math.abs(Math.sin(t * 5 + p.ph)) * 0.03;
  };

  // ---- the N-QRS response ----
  // The picture of an incident comes from lectureEncounter.js (a pure function of server time since the fight was settled); this only draws it.
  let inc = null, incSeq = 0;
  const OFFICER_LOD = { shadowAt: 0, halfAt: 8, hideAt: 40 }, nearestPath = (a, b) => { const pth = c.nav?.[0]?.path?.(a[0], a[1], b[0], b[1]); return pth && pth.length > 1 ? pth : [a, b]; };
  const stopIncident = () => { if (!inc) return; const k = inc; inc = null; for (const cop of k.cops) if (cop.av) { scene.remove(cop.av.root); cop.av.dispose?.(); } const lp = people.find((q) => q.i === k.npcIndex); if (lp) { lp.av.root.rotation.order = "XYZ"; lp.av.root.rotation.set(0, lp.yaw, 0); place(lp); } if (k.outcome !== "ARRESTED") locked = false; opts.onFade?.(0); };
  /** Plays the response for a settled fight: { id, outcome, settledAt (server ms), clock: () => server ms now, npcIndex }. Safe to call again for the same id (a reconnect). */
  function playIncident(o) {
    if (inc?.id === o.id) return true; stopIncident(); if (o.outcome === "LOST" || !spec[o.npcIndex]) return false;
    const n = spec[o.npcIndex], fx = Math.sin(n.yaw ?? 0), fz = Math.cos(n.yaw ?? 0), stand = [n.x + fx * 1.1, n.z + fz * 1.1], spot = [n.x + fx * 2.5, n.z + fz * 2.5], inside = [c.spawn.x, c.spawn.z];
    const door = c.porch ? [c.porch.axis === "x" ? c.porch.pos : c.porch.line, c.porch.axis === "x" ? c.porch.line : c.porch.pos] : inside, far = c.porch ? [door[0] + c.porch.out[0] * 16, door[1] + c.porch.out[1] * 16] : inside;
    if (route) { route.done(false); route = null; } pose = null; P.x = spot[0]; P.z = spot[1]; P.fl = 0; P.y = fl(0); // you were standing in front of the lecturer when it happened
    const from = o.outcome === "ARRESTED" ? spot : stand, inbound = [far, door, ...nearestPath(inside, stand)], outbound = [from, ...nearestPath(from, inside).slice(1), door, far];
    const id = ++incSeq; inc = { id: o.id, seq: id, outcome: o.outcome, npcIndex: o.npcIndex, clock: o.clock, settledAt: o.settledAt, inbound, doorAt: Math.hypot(door[0] - far[0], door[1] - far[1]), outbound, lecturerAt: [n.x, n.z], playerAt: spot, cops: [{}, {}], ended: false, fade: 0 };
    if (o.outcome === "ARRESTED") locked = true; input.jx = input.jy = 0;
    [["a", "M"], ["b", "F"]].forEach(async ([k, g], i) => { try { const av = await createNpc(npcSpec("dsa:" + k, { gender: g, role: "officer" })); if (!alive || !inc || inc.seq !== id) { av.dispose(); return; } av.root.visible = false; scene.add(av.root); inc.cops[i].av = av; } catch { /* that officer does not appear */ } });
    return true;
  }
  const stepIncident = (t, dt) => {
    if (!inc) return; const k = inc, f = incidentFrame({ outcome: k.outcome, elapsedMs: k.clock() - k.settledAt, inbound: k.inbound, doorAt: k.doorAt, outbound: k.outbound, lecturerAt: k.lecturerAt, playerAt: k.playerAt });
    f.officers.forEach((o, i) => { const cop = k.cops[i]; if (!cop?.av) return; const r = cop.av.root; r.visible = o.visible; if (!o.visible) return; r.position.set(o.x, fl(0) + 0.02, o.z); r.rotation.y = o.yaw;
      const want = o.walking ? "walk" : "idle"; if (cop.clip !== want && setClip(cop.av, want, { fade: 0.2 })) cop.clip = want; cop.av.tick(t, dt, Math.hypot(o.x - camera.position.x, o.z - camera.position.z), OFFICER_LOD); });
    const lp = people.find((q) => q.i === k.npcIndex); if (lp) { const r = lp.av.root; if (f.lecturer === "down") { r.rotation.order = "YXZ"; r.rotation.set(-Math.PI / 2, lp.yaw, 0); r.position.set(lp.x, fl(lp.f) + 0.16, lp.z); } else if (r.rotation.x !== 0) { r.rotation.order = "XYZ"; r.rotation.set(0, lp.yaw, 0); place(lp); } }
    if (f.player) { P.x = f.player.x; P.z = f.player.z; P.yaw = f.player.yaw; P.moving = f.player.walking ? 0.5 : 0; P.run = false; }
    if (Math.abs(f.fade - k.fade) > 0.04 || (f.fade === 0 && k.fade !== 0)) { k.fade = f.fade; opts.onFade?.(f.fade); }
    if (f.done && !k.ended) { k.ended = true; opts.onIncidentEnd?.({ id: k.id, outcome: k.outcome }); if (k.outcome !== "ARRESTED") stopIncident(); }
  };

  // ---- the frame ----
  const v3 = new THREE.Vector3(), look = new THREE.Vector3(), camPos = new THREE.Vector3(); let camInit = false;
  const setVis = () => { for (let f = 0; f < c.floors; f++) { groups[f].visible = f <= P.fl; for (const m of ceilMeshes[f]) m.visible = !(view === "overhead" && f >= P.fl); } for (const m of canopyMeshes) m.visible = view !== "overhead"; };
  stage.onFrame((t, dt) => {
    // movement
    let mx = (input.jx ?? 0), mz = (input.jy ?? 0); if (keys.has("a") || keys.has("arrowleft")) mx -= 1; if (keys.has("d") || keys.has("arrowright")) mx += 1; if (keys.has("w") || keys.has("arrowup")) mz += 1; if (keys.has("s") || keys.has("arrowdown")) mz -= 1;
    if (keys.has("q")) camYaw += dt * 1.8; if (keys.has("e")) camYaw -= dt * 1.8;
    const mag = Math.min(1, Math.hypot(mx, mz)); P.run = !!input.run || keys.has("shift");
    if (mag > 0.05 && !exited && !locked) {
      if (route) { route.done(false); route = null; } // taking the controls ends an automatic walk
      const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx, dx = (fx * mz + rx * mx) / Math.hypot(mx, mz), dz = (fz * mz + rz * mx) / Math.hypot(mx, mz), sp = (P.run ? 3.7 : 1.9) * mag, total = sp * dt, steps = Math.max(1, Math.ceil(total / 0.08));
      for (let s = 0; s < steps; s++) movePlayer(c, P, (dx * total) / steps, (dz * total) / steps);
      let dh = Math.atan2(dx, dz) - P.yaw; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; P.yaw += dh * Math.min(1, dt * 12); P.moving = mag;
    } else if (route && !exited && !locked) { // walking to a ring by itself, the way a player would
      const [tx, tz] = route.pts[route.i], dx = tx - P.x, dz = tz - P.z, d = Math.hypot(dx, dz), step = 1.9 * dt;
      if (d < 0.12) { route.i++; if (route.i >= route.pts.length) { const r = route; route = null; P.moving = 0; r.done(true); } }
      else { const k = Math.min(step, d) / d, n = Math.max(1, Math.ceil(Math.min(step, d) / 0.08)); for (let q = 0; q < n; q++) movePlayer(c, P, (dx * k) / n, (dz * k) / n);
        let dh = Math.atan2(dx, dz) - P.yaw; dh = ((dh + Math.PI * 3) % (Math.PI * 2)) - Math.PI; P.yaw += dh * Math.min(1, dt * 12); P.moving = 0.5; P.run = false; }
    } else P.moving = 0;
    stepIncident(t, dt);
    if (P.fl !== shownFloor) { shownFloor = P.fl; setVis(); }
    player.position.set(P.x, P.y + 0.02, P.z); player.rotation.y = P.yaw;
    if (avatar) { const want = P.moving > 0.05 ? (P.run ? "run" : "walk") : pose ? (pose.find((n) => avatar.has?.(n)) ?? "idle") : "idle"; if (want !== cur && avatar.has?.(want) && avatar.play(want, { fade: 0.25 })) cur = want; if (pose && P.moving <= 0.05) avatar.setSpeed?.(1); else if (want !== "idle") avatar.setSpeed?.(Math.max(0.6, Math.min(1.6, P.moving * (P.run ? 1 : 1.05)))); avatar.update(t, dt); }
    // room name, hubs, exit
    const room = c.roomAt(P.x, P.z, P.fl); if ((room?.name ?? null) !== lastRoom) { lastRoom = room?.name ?? null; opts.onRoom?.(lastRoom); }
    let best = null, bd = 1.7; for (const h of hubObjs) { if (h.f !== P.fl) continue; const d = Math.hypot(h.h.x - P.x, h.h.z - P.z); if (d < bd) { bd = d; best = h; } } if (best !== near) { near = best; opts.onNear?.(near ? near.h : null); }
    for (const h of hubObjs) { const on = h.f <= P.fl && Math.hypot(h.h.x - P.x, h.h.z - P.z) < 9 && h.f === P.fl; h.ring.visible = on; h.sp.visible = on; h.ring.material.opacity = h === near ? 1 : 0.55 + Math.sin(t * 3) * 0.2; h.ring.scale.setScalar(h === near ? 1.12 : 1); }
    if (!exited && P.fl === 0 && c.porch && c.outsideDepth(P.x, P.z) > EXIT_DEPTH) { exited = true; opts.onExit?.(); }
    // people
    // each person moves; only the closest eight on this floor are drawn (a skinned person is tens of thousands of triangles)
    camera.getWorldPosition(v3); const draw = [];
    for (const p of people) { stepNpc(p, t, dt); if (p.f !== P.fl) { p.av.root.visible = false; continue; } if (p.mode === "wander") place(p); draw.push([Math.hypot(p.x - v3.x, p.z - v3.z), p]); }
    draw.sort((q, w) => q[0] - w[0]); draw.forEach(([d, p], i) => { if (i < MAX_DRAWN && d < 18) p.av.tick(t, dt, d, { shadowAt: 0, halfAt: 8, hideAt: 18 }); else p.av.root.visible = false; });
    // club lights
    for (const s of spots) { const on = s.f === P.fl; s.cone.visible = on; if (s.L) s.L.visible = on; s.cone.rotation.z = Math.sin(t * 0.9 + s.ph) * 0.5; s.cone.rotation.x = Math.cos(t * 0.7 + s.ph) * 0.5; if (s.L) { s.L.intensity = 10 + Math.sin(t * 6 + s.ph) * 5; s.L.color.setHSL((0.55 + Math.sin(t * 0.3 + s.ph) * 0.25 + 1) % 1, 0.9, 0.6); } }
    for (const b of balls) { b.m.rotation.y = t * 0.8; b.m.visible = b.f === P.fl; }
    if (tileMesh && Math.floor(t * 6) !== tileMesh.userData.k) { tileMesh.userData.k = Math.floor(t * 6); tiles.forEach((a, i) => { tileCol.setHSL(((a.data.i * 0.11 + a.data.j * 0.07 + tileMesh.userData.k * 0.13) % 1 + 1) % 1, 0.85, 0.2 + ((a.data.i + a.data.j + tileMesh.userData.k) % 3) * 0.12); tileMesh.setColorAt(i, tileCol); }); tileMesh.instanceColor.needsUpdate = true; }
    // camera
    const ty = P.y + 1.35, fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    if (view === "overhead") { const dist = Math.max(camDist * 3.8, 12), pit = Math.min(1.4, 1.15 + (camPitch - 0.4) * 0.5), h = dist * Math.sin(pit), r = dist * Math.cos(pit); camPos.set(P.x - fx * r, P.y + h, P.z - fz * r); look.set(P.x, P.y + 0.6, P.z); if (avatar) player.visible = true; }
    else { const h = camDist * Math.cos(camPitch), v = camDist * Math.sin(camPitch); let k = Math.min(1, rayClip(c.wallsByFloor[P.fl], P.x, P.z, P.x - fx * h, P.z - fz * h, 0.22)) * 0.94;
      if (c.porch && P.fl === 0) { const o0 = c.outsideDepth(P.x, P.z), o1 = c.outsideDepth(P.x - fx * h, P.z - fz * h); if (o0 < -0.25 && o1 > -0.25) k = Math.min(k, Math.max(0.05, (-0.25 - o0) / (o1 - o0))); } // the camera stays inside while you are inside
      const room2 = room ?? null, ceil = room2 ? fl(P.fl) + room2.h - 0.2 : fl(P.fl) + 3.2;
      camPos.set(P.x - fx * h * k, Math.min(ty + v * Math.max(k, 0.35), ceil), P.z - fz * h * k); look.set(P.x + fx * 0.5, ty - 0.1 - (1 - k) * 0.2, P.z + fz * 0.5); player.visible = camDist * k > 0.85; }
    if (!camInit) { camera.position.copy(camPos); camInit = true; } else camera.position.lerp(camPos, Math.min(1, dt * 14)); camera.lookAt(look); camera.fov = view === "overhead" ? 45 : 62; camera.updateProjectionMatrix(); void vp;
  });
  setVis();
  const api = {
    stage, setYaw(y) { camYaw = y; }, teleport(x, z, floor = 0) { P.x = x; P.z = z; P.fl = floor; P.y = c.floorY[floor] ?? 0; }, get view() { return view; }, get state() { return { x: P.x, z: P.z, y: P.y, floor: P.fl, yaw: P.yaw, people: people.length, exited }; }, setView(v) { view = v; setVis(); }, toggleView() { view = view === "follow" ? "overhead" : "follow"; setVis(); return view; }, use: activate, playIncident, stopIncident, get incident() { return inc ? { id: inc.id, outcome: inc.outcome } : null }, setPose(list) { pose = list?.length ? list : null; },
    /** Walk to a point on the current floor by the shortest clear path. Resolves true on arrival, false if it could not or you took the controls. */
    walkTo(x, z) { return new Promise((resolve) => { if (route) route.done(false); const nv = c.navPlayer[P.fl], path = nv.path(P.x, P.z, x, z); if (!path || path.length < 1) { resolve(false); return; } route = { pts: [...path.slice(1), [x, z]], i: 0, done: resolve }; }); },
    dispose() { alive = false; stopIncident(); if (route) { route.done(false); route = null; } window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); el.removeEventListener("pointerdown", pd); el.removeEventListener("pointermove", pm); el.removeEventListener("pointerup", pu); el.removeEventListener("pointercancel", pu); el.removeEventListener("wheel", wh);
      for (const p of people) { scene.remove(p.av.root); p.av.dispose?.(); } people.length = 0; if (avatar) { player.remove(avatar.root); avatar.dispose?.(); avatar = null; }
      for (const o of toDispose) o.dispose?.(); toDispose.length = 0; for (const s of spots) s.L?.dispose?.(); scene.clear(); stage.dispose(); },
  };
  opts.onReady?.(); return api;
}