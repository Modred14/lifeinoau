// lib3d/billboards3d.js
// The ten billboards on the map. Each shows its sold posters one after another, 15 seconds each, and every viewer sees the same poster at the same
// moment (the choice comes from the wall clock, not from when the page opened). Browser only.
// Each board is built in metres from the numbers in lib3d/billboardSite.js (the same ones that make its footings solid and keep it clear of the road) and scaled down to scene units.
import * as THREE from "three";
import { BILLBOARD } from "./mapExtras.js";
import { BB } from "./billboardSite.js";
import { SCENE_S } from "./roadsurface.js";

const CW = 1024, CH = Math.round((CW * BB.H) / BB.W);

/** Which entry of a rotation of `count` items is on screen at `nowMs`. Pure; `phaseSec` offsets one board from the next. */
export const currentIndex = (nowMs, count, phaseSec = 0, seconds = BILLBOARD.SECONDS) => (count <= 0 ? -1 : Math.floor((nowMs / 1000 + phaseSec) / seconds) % count);

function drawCard(g, lines, accent) {
  g.fillStyle = "#101826"; g.fillRect(0, 0, CW, CH); g.fillStyle = accent; g.fillRect(0, 0, CW, 14); g.fillRect(0, CH - 14, CW, 14);
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  lines.forEach(([txt, size, col, dy]) => { g.font = `800 ${size}px system-ui, sans-serif`; g.fillStyle = col; g.fillText(txt, CW / 2, CH / 2 + dy); });
}
function drawPoster(g, img, caption) {
  g.fillStyle = "#0b111c"; g.fillRect(0, 0, CW, CH);
  const k = Math.min(CW / img.width, CH / img.height), w = img.width * k, h = img.height * k;
  g.save(); g.globalAlpha = 0.28; const kc = Math.max(CW / img.width, CH / img.height); g.drawImage(img, (CW - img.width * kc) / 2, (CH - img.height * kc) / 2, img.width * kc, img.height * kc); g.restore();
  g.drawImage(img, (CW - w) / 2, (CH - h) / 2, w, h);
  if (caption) { g.fillStyle = "rgba(8,12,20,0.72)"; g.fillRect(0, CH - 52, CW, 52); g.fillStyle = "#fff"; g.font = "700 28px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(caption, CW / 2, CH - 26, CW - 40); }
}

/** The shared parts of every board, in metres, built once: geometry for the footing, post, braces, catwalk, frame, screen and lamps. Boxes are positioned by their centre. */
function structureGeometry() {
  const { W, H, POST_H, FRAME, THICK, POST_AT, POST, FOOT, FOOT_H, LIGHT } = BB, box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const postBase = FOOT_H - 0.05, postTop = POST_H + 0.4, midY = POST_H * 0.45, span = 2 * POST_AT, brace = Math.hypot(span, midY - (FOOT_H + 0.3));
  return {
    footing: box(FOOT, FOOT_H + 0.15, FOOT),                                   // concrete, sunk 15 cm into the ground
    post: box(POST, postTop - postBase, POST),                                  // runs up into the frame, so the screen is held, not floating
    tie: box(span, 0.25, 0.25), brace: box(brace, 0.16, 0.16),                  // a tie beam between the posts, and the two diagonals of the X under it
    catwalk: box(W, 0.12, 1.2), rail: box(W, 0.07, 0.07), stanchion: box(0.06, 0.9, 0.06),
    frame: box(W + 2 * FRAME, H + 2 * FRAME, THICK), screen: new THREE.PlaneGeometry(W, H),
    arm: box(0.08, 0.08, LIGHT), bulb: box(0.5, 0.1, 0.3),
    hit: box(W + 6, POST_H + H + 2, 8),                                         // invisible, generous: easy to tap from the overview (it is for picking only, never for collision)
    postBase, postTop, midY, braceAngle: Math.atan2(midY - (FOOT_H + 0.3), span),
  };
}

/**
 * entries: place objects with kind "billboard" ({ id, x, z, yaw, board }); x/z are scene units already.
 * Returns { group, meshes, setBoards(list), update(nowMs), height, dispose }.
 * setBoards takes [{ n, posters: [{ slot, url, caption }], free }] and redraws.
 */
export function buildBillboards(entries) {
  const { W, H, POST_H, FRAME, THICK, POST_AT, FOOT_H, LIGHT } = BB, S = SCENE_S, geo = structureGeometry();
  const group = new THREE.Group(), meshes = [], boards = new Map(), imgs = new Map(), concrete = new THREE.MeshStandardMaterial({ color: "#a2a29b", roughness: 0.95 }), steel = new THREE.MeshStandardMaterial({ color: "#59606b", roughness: 0.6, metalness: 0.5 }), frameM = new THREE.MeshStandardMaterial({ color: "#1b212c", roughness: 0.5, metalness: 0.4 }), lamp = new THREE.MeshBasicMaterial({ color: "#fff2c0", toneMapped: false }), hidden = new THREE.MeshBasicMaterial({ visible: false });
  const loadImg = (url) => { let e = imgs.get(url); if (!e) { e = { img: new Image(), ok: false }; e.img.crossOrigin = "anonymous"; e.img.onload = () => { e.ok = true; e.dirty?.(); }; e.img.onerror = () => { e.bad = true; }; e.img.src = url; imgs.set(url, e); } return e; };
  const part = (g, mat, x, y, z, parent, cast = true) => { const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = cast; parent.add(m); return m; };
  for (const L of entries) {
    // the board is drawn in metres and scaled to scene units; its local +z is the front face, so rotation.y = yaw makes it look along (sin yaw, cos yaw)
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z); g.rotation.y = L.yaw ?? 0; g.scale.setScalar(S); g.userData.placeId = L.id;
    const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const scr = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    for (const sx of [-1, 1]) {
      part(geo.footing, concrete, sx * POST_AT, (FOOT_H - 0.15) / 2, 0, g);
      part(geo.post, steel, sx * POST_AT, (geo.postBase + geo.postTop) / 2, 0, g);
    }
    part(geo.tie, steel, 0, geo.midY, 0, g);
    for (const sgn of [1, -1]) { const b = part(geo.brace, steel, 0, (geo.midY + FOOT_H + 0.3) / 2, 0, g); b.rotation.z = sgn * geo.braceAngle; }
    // a catwalk under the screen, with a rail on each side, hangs from the posts
    const walkY = POST_H - FRAME - 1.0; part(geo.catwalk, steel, 0, walkY, 0, g);
    for (const side of [1, -1]) { part(geo.rail, steel, 0, walkY + 0.9, side * 0.55, g, false); for (const u of [-W / 2 + 0.2, 0, W / 2 - 0.2]) part(geo.stanchion, steel, u, walkY + 0.45, side * 0.55, g, false); }
    part(geo.frame, frameM, 0, POST_H + H / 2, 0, g);
    for (const side of [1, -1]) { const s = new THREE.Mesh(geo.screen, scr); s.position.set(0, POST_H + H / 2, side * (THICK / 2 + 0.01)); if (side < 0) s.rotation.y = Math.PI; g.add(s); }
    // lamps on the top edge, over both faces, each on a short arm
    for (const side of [1, -1]) for (const lx of [-W * 0.3, 0, W * 0.3]) { part(geo.arm, steel, lx, POST_H + H + FRAME + 0.1, side * (THICK / 2 + LIGHT / 2), g, false); part(geo.bulb, lamp, lx, POST_H + H + FRAME + 0.05, side * (THICK / 2 + LIGHT), g, false); }
    const hit = new THREE.Mesh(geo.hit, hidden); hit.position.set(0, (POST_H + H + 2) / 2, 0); hit.userData.placeId = L.id; g.add(hit); meshes.push(hit);
    group.add(g); boards.set(L.id, { n: L.board, tex, scr, cv, g2: cv.getContext("2d"), data: { posters: [], free: BILLBOARD.SLOTS }, shown: null, phase: ((L.board ?? 0) * 1.7) % BILLBOARD.SECONDS });
  }
  const paint = (b, force) => { const { posters, free } = b.data, list = posters.length ? posters : [], extra = free > 0 ? 1 : 0, total = list.length + extra; let key, draw;
    const i = currentIndex(Date.now(), Math.max(total, 1), b.phase);
    if (i < list.length) { const p = list[i], e = loadImg(p.url); key = p.url; e.dirty = () => paint(b, true); if (!e.ok) { if (e.bad) draw = () => drawCard(b.g2, [["Poster unavailable", 54, "#fff", 0]], "#c0392b"); else { key = "load:" + p.url; draw = () => drawCard(b.g2, [["Loading…", 54, "#9fb0c8", 0]], "#3a465a"); } } else draw = () => drawPoster(b.g2, e.img, p.caption); }
    else { key = "free:" + free; draw = () => drawCard(b.g2, [["ADVERTISE HERE", 96, "#ffd24a", -70], [`${free} of ${BILLBOARD.SLOTS} poster spots free`, 46, "#ffffff", 20], [`From ₦${(BILLBOARD.SLOT_KOBO / 100).toLocaleString("en-NG")} each  ·  whole board ₦${(BILLBOARD.WHOLE_KOBO / 100).toLocaleString("en-NG")}`, 34, "#9fd0ff", 90]], "#ffd24a"); }
    if (force || b.shown !== key) { draw(); b.tex.needsUpdate = true; b.shown = key; } };
  const setBoards = (list) => { for (const q of list) { const id = "bb_" + q.n, b = boards.get(id); if (!b) continue; b.data = { posters: q.posters ?? [], free: q.free ?? BILLBOARD.SLOTS }; paint(b, true); } };
  for (const b of boards.values()) paint(b, true);
  let acc = 0;
  const update = (dt) => { acc += dt; if (acc < 0.5) return; acc = 0; for (const b of boards.values()) paint(b, false); };
  const dispose = () => { for (const b of boards.values()) { b.tex.dispose(); b.scr.dispose(); } for (const k of Object.keys(geo)) geo[k]?.dispose?.(); for (const m of [concrete, steel, frameM, lamp, hidden]) m.dispose(); };
  return { group, meshes, setBoards, update, height: (POST_H + H) * S, dispose };
}
