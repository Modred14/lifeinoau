// lib3d/lectureWorld.js
// The two places of the cutscenes: the forecourt of a lecture theatre (daytime, a road behind the fighters) and the Floor O compound (dusk).
// Same coordinates for both: x to the right, z towards the camera, y up. The fighters stand on z = 0, the road runs along x at z = -5.1.
import * as THREE from "three";
import { mat } from "./toonFigure.js";

export const ROAD_Z = -5.1; // the middle of the road: the van drives here
const sky = (top, mid, bot) => {
  const c = document.createElement("canvas"); c.width = 4; c.height = 256; const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, top); gr.addColorStop(0.55, mid); gr.addColorStop(1, bot); g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
};
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); } return t;
}
const sign = (text, sub, bg, fg, w = 1024, h = 256) => canvasTex(w, h, (g) => {
  g.fillStyle = bg; g.fillRect(0, 0, w, h); g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; let fs = sub ? h * 0.46 : h * 0.55; g.font = `900 ${fs}px system-ui, sans-serif`; const mw = g.measureText(text).width; if (mw > w * 0.88) { fs *= (w * 0.88) / mw; g.font = `900 ${fs}px system-ui, sans-serif`; } g.fillText(text, w / 2, sub ? h * 0.42 : h / 2 + 4);
  if (sub) { g.font = `700 ${h * 0.17}px system-ui, sans-serif`; g.fillText(sub, w / 2, h * 0.8); }
});

export function buildWorld(scene) {
  const geos = [], texs = [];
  const mesh = (parent, geo, m, x = 0, y = 0, z = 0, shadow = true) => { geos.push(geo); const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = shadow; me.receiveShadow = true; parent.add(me); return me; };
  const box = (p, w, h, l, x, y, z, m) => mesh(p, new THREE.BoxGeometry(w, h, l), m, x, y, z);
  const plane = (p, w, d, x, y, z, m) => { const me = mesh(p, new THREE.PlaneGeometry(w, d), m, x, y, z, false); me.rotation.x = -Math.PI / 2; return me; };
  const tex = (t) => { texs.push(t); return t; };
  const tree = (p, x, z, s = 1) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); p.add(g); mesh(g, new THREE.CylinderGeometry(0.2, 0.28, 2.2, 8), mat("#6b4a2e"), 0, 1.1, 0); mesh(g, new THREE.IcosahedronGeometry(1.6, 1), mat("#2f7a45", { flatShading: true }), 0, 3.2, 0); mesh(g, new THREE.IcosahedronGeometry(1.1, 1), mat("#3b8a4f", { flatShading: true }), 0.7, 4.1, 0.3); };

  // ================= the lecture theatre forecourt (day) =================
  const day = new THREE.Group(); scene.add(day);
  plane(day, 400, 400, 0, 0, 0, mat("#67a257", { roughness: 1 }));
  plane(day, 24, 7.4, 0, 0.02, 0.8, new THREE.MeshStandardMaterial({ map: tex(canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#d3ccbd"; g.fillRect(0, 0, w, h); g.strokeStyle = "#b9b2a2"; g.lineWidth = 3; g.strokeRect(0, 0, w, h); }, [10, 3]), ), roughness: 0.95 }));
  box(day, 400, 0.16, 0.28, 0, 0.08, -2.8, mat("#c9c3b6"));
  plane(day, 400, 4.7, 0, 0.012, ROAD_Z, new THREE.MeshStandardMaterial({ map: tex(canvasTex(512, 64, (g, w, h) => { g.fillStyle = "#34373d"; g.fillRect(0, 0, w, h); g.fillStyle = "#e9e4d4"; g.fillRect(0, h / 2 - 2, w * 0.45, 4); g.fillStyle = "#4a4e55"; for (let i = 0; i < 200; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }, [50, 1])), roughness: 0.9 }));
  box(day, 400, 0.16, 0.28, 0, 0.08, -7.55, mat("#c9c3b6"));
  // the building
  const facade = tex(canvasTex(1024, 256, (g, w, h) => { g.fillStyle = "#e4dccb"; g.fillRect(0, 0, w, h); for (let r = 0; r < 2; r++) for (let i = 0; i < 14; i++) { g.fillStyle = "#3d5a73"; g.fillRect(24 + i * 72, 28 + r * 110, 44, 72); g.fillStyle = "#9cc3de"; g.fillRect(28 + i * 72, 32 + r * 110, 36, 30); } g.fillStyle = "rgba(0,0,0,0.08)"; for (let i = 0; i < 14; i++) g.fillRect(14 + i * 72, 0, 4, h); }));
  const side = mat("#d8cfbb");
  const bld = mesh(day, new THREE.BoxGeometry(34, 9, 8), [side, side, side, side, new THREE.MeshStandardMaterial({ map: facade, roughness: 0.9 }), side], 0, 4.5, -17);
  bld.receiveShadow = true;
  box(day, 36, 0.6, 9, 0, 9.3, -17, mat("#8a3b2e"));
  box(day, 4, 3.2, 0.3, 0, 1.6, -12.9, mat("#20252c")); box(day, 7, 0.3, 1.6, 0, 0.15, -12.3, mat("#bdb6a6")); box(day, 7.4, 0.35, 1.2, 0, 3.4, -12.45, mat("#a8a090"));
  const board = mesh(day, new THREE.PlaneGeometry(7, 1.5), new THREE.MeshBasicMaterial({ map: tex(sign("LECTURE THEATRE", null, "#17402c", "#f4efe0")) }), 0, 5.2, -12.95, false);
  plane(day, 4, 5.3, 0, 0.018, -10.1, mat("#cfc8b8"));
  for (const x of [-26, 27]) box(day, 14, 6, 7, x, 3, -15, side);
  for (const [x, z, s] of [[-12, -9.8, 1.1], [-7.5, -10.2, 1], [-3.8, -9.6, 0.9], [4.6, -10, 1], [8.5, -9.5, 1.15], [13, -10.3, 1], [-16, -9.9, 1.2], [18, -9.7, 1.1], [-10.5, 3.9, 1.1], [11, 4.3, 1.2]]) tree(day, x, z, s);
  for (const x of [-9, -3, 3, 9]) { box(day, 0.1, 4.2, 0.1, x, 2.1, -3.2, mat("#3c4048")); const b = mesh(day, new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshBasicMaterial({ color: "#fff3c4" }), x, 4.3, -3.2, false); b.userData.lamp = 1; }
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a8a55, 1.05), sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.position.set(-9, 15, 11); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 14, bottom: -14, near: 1, far: 50 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  day.add(hemi, sun, sun.target);
  const siren = new THREE.PointLight(0xff2030, 0, 40, 1.4); siren.position.set(0, 3.5, -3.5); day.add(siren);

  // ================= Floor O (dusk) =================
  const fo = new THREE.Group(); fo.visible = false; scene.add(fo);
  plane(fo, 400, 400, 0, 0, 0, mat("#3f4247", { roughness: 1 }));
  plane(fo, 7, 80, 0, 0.012, 38, new THREE.MeshStandardMaterial({ map: tex(canvasTex(64, 256, (g, w, h) => { g.fillStyle = "#2d2f34"; g.fillRect(0, 0, w, h); g.fillStyle = "#cfc9b6"; g.fillRect(w / 2 - 2, 20, 4, 90); }, [1, 20])), roughness: 0.9 }));
  plane(fo, 26, 14, 0, 0.012, -11, mat("#5a5e65", { roughness: 0.95 }));
  const wallM = mat("#7c828c"), wire = mat("#20232a", { metalness: 0.6 });
  const wall = (w, x, z, ry = 0) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; fo.add(g); box(g, w, 3.2, 0.4, 0, 1.6, 0, wallM); box(g, w, 0.08, 0.5, 0, 3.26, 0, wire); for (let i = 0; i < Math.floor(w / 0.6); i++) box(g, 0.05, 0.5, 0.05, -w / 2 + 0.3 + i * 0.6, 3.55, 0, wire); };
  wall(9.4, -7.3, -4.4); wall(9.4, 7.3, -4.4); wall(20, -12, -14.4, Math.PI / 2); wall(20, 12, -14.4, Math.PI / 2);
  for (const x of [-2.7, 2.7]) { box(fo, 0.5, 3.6, 0.5, x, 1.8, -4.4, mat("#555b64")); }
  const bars = tex(canvasTex(128, 128, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = "#1b1e24"; for (let i = 0; i < 9; i++) g.fillRect(i * 14 + 2, 0, 6, h); g.fillRect(0, 6, w, 8); g.fillRect(0, h - 14, w, 8); }, [2, 1]));
  const gateM = new THREE.MeshStandardMaterial({ map: bars, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6 }), gL = new THREE.Group(), gR = new THREE.Group(); fo.add(gL, gR);
  mesh(gL, new THREE.PlaneGeometry(2.6, 2.8), gateM, -1.3, 1.4, -4.4, false); mesh(gR, new THREE.PlaneGeometry(2.6, 2.8), gateM, 1.3, 1.4, -4.4, false);
  const bf = tex(canvasTex(1024, 256, (g, w, h) => { g.fillStyle = "#98a3b2"; g.fillRect(0, 0, w, h); for (let r = 0; r < 2; r++) for (let i = 0; i < 12; i++) { g.fillStyle = "#222a35"; g.fillRect(30 + i * 82, 30 + r * 110, 34, 56); g.fillStyle = "#fff"; g.fillStyle = "#4a5565"; for (let b = 0; b < 3; b++) g.fillRect(34 + b * 11 + i * 82, 30 + r * 110, 3, 56); } }));
  const bm = mat("#98a3b2"), fb = mesh(fo, new THREE.BoxGeometry(24, 7, 9), [bm, bm, bm, bm, new THREE.MeshStandardMaterial({ map: bf, roughness: 0.9 }), bm], 0, 3.5, -19.5); fb.receiveShadow = true;
  box(fo, 25, 0.9, 10, 0, 7.45, -19.5, mat("#b8322f"));
  mesh(fo, new THREE.PlaneGeometry(9, 2.4), new THREE.MeshBasicMaterial({ map: tex(sign("FLOOR O", "DSA CUSTODY", "#b8322f", "#fff6ec", 1024, 272)) }), 0, 5.4, -14.95, false);
  box(fo, 3.2, 3, 0.3, 0, 1.5, -15.0, mat("#1c2027")); box(fo, 3.6, 0.2, 1.1, 0, 3.15, -14.6, mat("#555b64"));
  const door = new THREE.Group(); door.position.set(-1.6, 0, -14.8); fo.add(door); mesh(door, new THREE.BoxGeometry(3.2, 2.9, 0.12), mat("#3b424d", { metalness: 0.4 }), 1.6, 1.45, 0);
  const beacon = mesh(fo, new THREE.SphereGeometry(0.45, 14, 10), new THREE.MeshBasicMaterial({ color: "#ff3b30" }), 0, 8.4, -17, false), beaconL = new THREE.PointLight(0xff3b30, 60, 30, 1.5); beaconL.position.set(0, 8.6, -16.5); fo.add(beaconL);
  const lampOver = new THREE.PointLight(0xffd9a0, 90, 22, 1.6); lampOver.position.set(0, 3.6, -13.6); fo.add(lampOver);
  for (const x of [-9, 9]) { box(fo, 0.2, 8, 0.2, x, 4, -8, mat("#3c4048")); mesh(fo, new THREE.SphereGeometry(0.35, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffe9b8" }), x, 8.2, -8, false); const l = new THREE.PointLight(0xffe0b0, 70, 26, 1.5); l.position.set(x, 7.8, -7.4); fo.add(l); }
  for (const x of [-4.4, 4.4]) { box(fo, 0.15, 4.8, 0.15, x, 2.4, 5, mat("#3c4048")); const l = new THREE.PointLight(0xffe0b0, 40, 20, 1.6); l.position.set(x, 4.8, 5); fo.add(l); mesh(fo, new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: "#ffe9b8" }), x, 4.9, 5, false); }
  const duskHemi = new THREE.HemisphereLight(0x8f86c9, 0x2a2430, 0.75); fo.add(duskHemi);
  const moon = new THREE.DirectionalLight(0xb7a8ff, 0.9); moon.position.set(8, 14, 12); fo.add(moon);

  const skyDay = tex(sky("#7cc0ee", "#b9e0f5", "#e8f4ea")), skyDusk = tex(sky("#241c3d", "#7a3d63", "#e8905a"));
  let mode = "";
  function setMode(m) {
    if (m === mode) return; mode = m; day.visible = m === "campus"; fo.visible = m === "floor0";
    scene.background = m === "campus" ? skyDay : skyDusk; scene.fog = m === "campus" ? new THREE.Fog(0xcfe6f2, 45, 150) : new THREE.Fog(0x3a2f4d, 28, 110);
  }
  setMode("campus");
  return {
    setMode,
    /** The patrol lights spilling on the building: colour 0 turns it off. */
    siren(color) { siren.color.setHex(color || 0xff2030); siren.intensity = color ? 14 : 0; },
    gate(k) { gL.position.x = -k * 2.5; gR.position.x = k * 2.5; },
    door(k) { door.rotation.y = -k * 1.6; },
    update(t) { const b = 0.5 + 0.5 * Math.sin(t * 4); beaconL.intensity = 20 + 60 * b; beacon.scale.setScalar(0.9 + 0.2 * b); },
    dispose() { geos.forEach((g) => g.dispose()); texs.forEach((x) => x.dispose()); scene.remove(day, fo); },
  };
}
