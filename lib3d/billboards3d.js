// lib3d/billboards3d.js
// The ten billboards on the map. Each shows its sold posters one after another, 15 seconds each, and every viewer sees the same poster at the same
// moment (the choice comes from the wall clock, not from when the page opened). Browser only.
import * as THREE from "three";
import { BILLBOARD } from "./mapExtras.js";

const SW = 3.6, SH = 1.95, POST_H = 2.4; // screen size and post height, scene units (1 unit = 10 m; deliberately oversized so it reads from the overview)
const CW = 1024, CH = Math.round((CW * SH) / SW);

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

/**
 * entries: place objects with kind "billboard" ({ id, x, z, yaw, board }); x/z are scene units already.
 * Returns { group, meshes, setBoards(list), update(nowMs), height, dispose }.
 * setBoards takes [{ n, posters: [{ slot, url, caption }], free }] and redraws.
 */
export function buildBillboards(entries) {
  const group = new THREE.Group(), meshes = [], boards = new Map(), imgs = new Map(), steel = new THREE.MeshStandardMaterial({ color: "#59606b", roughness: 0.6, metalness: 0.5 }), frameM = new THREE.MeshStandardMaterial({ color: "#1b212c", roughness: 0.5, metalness: 0.4 }), lamp = new THREE.MeshBasicMaterial({ color: "#fff2c0", toneMapped: false });
  const loadImg = (url) => { let e = imgs.get(url); if (!e) { e = { img: new Image(), ok: false }; e.img.crossOrigin = "anonymous"; e.img.onload = () => { e.ok = true; e.dirty?.(); }; e.img.onerror = () => { e.bad = true; }; e.img.src = url; imgs.set(url, e); } return e; };
  for (const L of entries) {
    const g = new THREE.Group(); g.position.set(L.x, 0, L.z); g.rotation.y = L.yaw ?? 0.7; g.userData.placeId = L.id;
    const cv = document.createElement("canvas"); cv.width = CW; cv.height = CH; const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const scr = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    for (const sx of [-1, 1]) { const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, POST_H, 0.16), steel); post.position.set(sx * 1.0, POST_H / 2, 0); post.castShadow = true; g.add(post); }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.22, SH + 0.22, 0.14), frameM); frame.position.set(0, POST_H + SH / 2 - 0.1, 0); frame.castShadow = true; g.add(frame);
    for (const side of [1, -1]) { const s = new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), scr); s.position.set(0, POST_H + SH / 2 - 0.1, side * 0.075); if (side < 0) s.rotation.y = Math.PI; g.add(s); }
    for (const lx of [-0.9, 0, 0.9]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), steel), bulb = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.1), lamp); arm.position.set(lx, POST_H + SH + 0.14, 0.15); bulb.position.set(lx, POST_H + SH + 0.14, 0.32); g.add(arm, bulb); }
    // an invisible, generous box makes the whole board easy to tap
    const hit = new THREE.Mesh(new THREE.BoxGeometry(SW + 0.4, POST_H + SH + 0.3, 0.6), new THREE.MeshBasicMaterial({ visible: false })); hit.position.set(0, (POST_H + SH + 0.3) / 2, 0); hit.userData.placeId = L.id; g.add(hit); meshes.push(hit);
    group.add(g); boards.set(L.id, { n: L.board, tex, cv, g2: cv.getContext("2d"), data: { posters: [], free: BILLBOARD.SLOTS }, shown: null, phase: ((L.board ?? 0) * 1.7) % BILLBOARD.SECONDS });
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
  const dispose = () => { for (const b of boards.values()) b.tex.dispose(); };
  return { group, meshes, setBoards, update, height: POST_H + SH, dispose };
}