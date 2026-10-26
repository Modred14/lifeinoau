// lib3d/furnitureModels.js
// Every piece of furniture, built from simple low-poly shapes (no model files). One cell is about 0.9 m.
// Each builder returns a THREE.Group centred on its footprint, standing on y = 0, front facing +z.
// Materials are created per piece so one item can glow when selected without lighting up all the others.
import * as THREE from "three";
import { ITEMS } from "../lib/furniture.js";

const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function mat(color, o = {}) { return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0, ...o }); }
function box(g, [w, h, d], [x, y, z], color, o) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === "object" && color.isMaterial ? color : mat(color, o));
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function cyl(g, [rt, rb, h], [x, y, z], color, o, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof color === "object" && color.isMaterial ? color : mat(color, o));
  m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
}
function ball(g, r, [x, y, z], color, o, scale = [1, 1, 1]) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), mat(color, o)); m.position.set(x, y, z); m.scale.set(...scale); m.castShadow = true; g.add(m); return m;
}
const glow = (color, k = 1.4) => mat(color, { emissive: color, emissiveIntensity: k, roughness: 0.4 });

const canvasTex = (w, h, draw, repeat) => { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); } return t; };
const cache = {};
const once = (k, f) => (cache[k] ??= f());
export const screenTex = (kind) => once("scr" + kind, () => canvasTex(256, 144, (g, w, h) => {
  if (kind === "game") { g.fillStyle = "#12203f"; g.fillRect(0, 0, w, h); g.fillStyle = "#2fbf71"; g.fillRect(0, h * 0.72, w, h * 0.28); g.fillStyle = "#6ab7ff"; g.fillRect(0, 0, w, h * 0.5); g.fillStyle = "#ffd36b"; g.beginPath(); g.arc(w * 0.78, h * 0.25, 18, 0, 7); g.fill(); g.fillStyle = "#e0463c"; g.fillRect(w * 0.3, h * 0.55, 22, 30); g.fillStyle = "#fff"; g.font = "700 15px sans-serif"; g.fillText("PLAYER 1  00450", 12, 20); }
  else if (kind === "pc") { g.fillStyle = "#1b1140"; g.fillRect(0, 0, w, h); const r = rng(7); for (let i = 0; i < 6; i++) { g.fillStyle = ["#7c4dff", "#00e5ff", "#ff4081", "#69f0ae"][i % 4]; g.fillRect(14 + r() * 40, 14 + i * 20, 40 + r() * 140, 9); } }
  else { g.fillStyle = "#101a30"; g.fillRect(0, 0, w, h); g.fillStyle = "#e8a23a"; g.fillRect(0, 0, w, 26); g.fillStyle = "#fff"; g.font = "700 16px sans-serif"; g.fillText("LIVE  ·  OAU vs UNILAG", 10, 18); g.fillStyle = "#2fbf71"; g.fillRect(0, h * 0.35, w, h * 0.65); g.strokeStyle = "#ffffff88"; g.lineWidth = 2; g.strokeRect(14, h * 0.45, w - 28, h * 0.45); g.beginPath(); g.moveTo(w / 2, h * 0.45); g.lineTo(w / 2, h * 0.9); g.stroke(); }
}));
export const rugTex = () => once("rug", () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = "#b8452f"; g.fillRect(0, 0, w, h);
  const ring = (i, c) => { g.fillStyle = c; g.fillRect(i, i, w - 2 * i, h - 2 * i); };
  ring(14, "#f0d9a8"); ring(26, "#1f6f6a"); ring(40, "#e8a23a"); ring(52, "#b8452f");
  g.fillStyle = "#f0d9a8"; g.translate(w / 2, h / 2); for (let i = 0; i < 2; i++) { g.rotate(Math.PI / 4); g.fillRect(-46, -46, 92, 92); g.fillStyle = i ? "#1f6f6a" : "#e8a23a"; g.fillRect(-32, -32, 64, 64); }
}));
export const posterTex = (n) => once("poster" + n, () => canvasTex(128, 160, (g, w, h) => {
  const pal = [["#ff7a59", "#ffd166", "#06d6a0"], ["#6c5ce7", "#00cec9", "#fdcb6e"], ["#e84393", "#fab1a0", "#55efc4"], ["#0984e3", "#74b9ff", "#ffeaa7"]][n % 4];
  g.fillStyle = pal[2]; g.fillRect(0, 0, w, h); g.fillStyle = pal[0]; g.beginPath(); g.arc(w * 0.35, h * 0.4, 38, 0, 7); g.fill(); g.fillStyle = pal[1]; g.fillRect(w * 0.45, h * 0.35, 56, 70); g.fillStyle = "#ffffffcc"; g.fillRect(14, h - 28, w - 28, 8);
}));

const WOOD = "#b07a4a", WOOD_L = "#d2a46f", WOOD_D = "#6e4a2c", WHITE = "#f1efe9", DARK = "#252a36", STEEL = "#aeb7c4";

function catalogPiece(g, key) {
  const def = ITEMS[key], wood = ["#8b5e3c", "#b18359", "#69462f"][key.length % 3], metal = ["#b7c1c6", "#c8a65d", "#303845"][key.charCodeAt(0) % 3];
  const accent = ["#4f9d84", "#d98c60", "#7399bf", "#b66d82", "#7c6ba4"][key.charCodeAt(key.length - 1) % 5];
  const top = (w = 0.84, d = 0.65, y = 0.72, color = wood) => box(g, [w, 0.07, d], [0, y, 0], color);
  const legs = (w = 0.68, d = 0.48, h = 0.68, color = wood) => { for (const x of [-1, 1]) for (const z of [-1, 1]) box(g, [0.055, h, 0.055], [x * w / 2, 0, z * d / 2], color); };
  const appliance = (w, h, d, color = "#e5e8e9") => { box(g, [w, h, d], [0, 0, 0], color, { metalness: 0.18, roughness: 0.38 }); box(g, [w * 0.82, h * 0.55, 0.018], [0, h * 0.15, d / 2 + 0.012], "#252a32", { roughness: 0.2 }); box(g, [0.035, h * 0.3, 0.035], [w * 0.34, h * 0.18, d / 2 + 0.04], metal); };
  const pointLight = (color, intensity, distance, position) => { const l = new THREE.PointLight(color, intensity, distance, 2); l.position.set(...position); g.add(l); };
  if (["kitchen_island", "quartz_counter"].includes(key)) { box(g, [1.72, 0.78, 0.76], [0, 0, 0], key === "quartz_counter" ? "#e8e5dd" : wood); top(1.82, 0.84, 0.8, key === "quartz_counter" ? "#d7d3ca" : "#eee7da"); box(g, [0.35, 0.03, 0.24], [0.47, 0.85, -0.06], "#8ea5aa", { metalness: 0.75 }); }
  else if (["bar_stool", "racing_chair"].includes(key)) { cyl(g, [0.28, 0.31, 0.12], [0, 0.62, 0], accent); cyl(g, [0.04, 0.05, 0.62], [0, 0, 0], metal); cyl(g, [0.24, 0.28, 0.05], [0, 0.12, 0], metal); if (key === "racing_chair") { box(g, [0.62, 0.72, 0.14], [0, 0.77, -0.24], accent); box(g, [0.18, 0.08, 0.12], [0, 1.05, -0.15], metal); } else for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; box(g, [0.045, 0.55, 0.045], [Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2], metal); } }
  else if (["pantry_cabinet", "bathroom_vanity", "display_cabinet", "shoe_rack", "coat_stand", "storage_boxes", "washing_machine", "ironing_board", "laundry_basket"].includes(key)) {
    if (key === "washing_machine") { appliance(0.78, 1.15, 0.68); cyl(g, [0.27, 0.27, 0.035], [0, 0.48, 0.36], "#88a7b1", { transparent: true, opacity: 0.8, metalness: 0.6 }, 32); }
    else if (key === "ironing_board") { const b = box(g, [0.48, 0.06, 1.02], [0, 0.8, 0], WHITE); b.rotation.z = -0.04; for (const x of [-0.18, 0.18]) { const leg = box(g, [0.035, 0.8, 0.035], [x, 0, 0], metal); leg.rotation.z = x * 0.2; } box(g, [0.2, 0.18, 0.36], [0, 0.89, 0.12], "#252a32"); }
    else if (key === "coat_stand") { cyl(g, [0.22, 0.25, 0.06], [0, 0, 0], wood); cyl(g, [0.035, 0.045, 1.6], [0, 0.05, 0], wood); for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5; const h = box(g, [0.04, 0.38, 0.04], [Math.cos(a) * 0.12, 1.35, Math.sin(a) * 0.12], metal); h.rotation.z = Math.sin(a) * 0.75; } }
    else if (key === "storage_boxes") for (let i = 0; i < 3; i++) { box(g, [0.72 - i * 0.08, 0.28, 0.58 - i * 0.06], [0, i * 0.3, 0], ["#b7a58c", "#788a7d", "#c3a87c"][i]); box(g, [0.2, 0.025, 0.02], [0, i * 0.3 + 0.14, 0.3], metal); }
    else if (key === "laundry_basket") { cyl(g, [0.3, 0.36, 0.72], [0, 0, 0], "#ae8a62", {}, 12); cyl(g, [0.3, 0.3, 0.04], [0, 0.72, 0], "#d3bd9a", {}, 12); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, strip = box(g, [0.025, 0.67, 0.025], [Math.cos(a) * 0.28, 0.03, Math.sin(a) * 0.28], "#806347"); strip.rotation.y = -a; } }
    else if (key === "shoe_rack") { for (let y = 0; y < 3; y++) { box(g, [0.82, 0.05, 0.34], [0, 0.18 + y * 0.42, 0], wood); for (let i = 0; i < 2; i++) { const shoe = box(g, [0.28, 0.12, 0.14], [-0.2 + i * 0.4, 0.22 + y * 0.42, 0.1], ["#322b29", "#ae6546"][i]); shoe.rotation.y = -0.15; } } legs(0.72, 0.28, 1.35); }
    else { box(g, [0.86, key === "display_cabinet" ? 1.85 : 1.55, 0.55], [0, 0.08, 0], key === "bathroom_vanity" ? "#eee9df" : wood); for (const y of key === "display_cabinet" ? [0.15, 0.65, 1.2, 1.8] : [0.45, 0.95]) box(g, [0.78, 0.035, 0.5], [0, y, 0.02], key === "display_cabinet" ? "#9dcbd2" : metal, { transparent: key === "display_cabinet", opacity: 0.5 }); if (key === "bathroom_vanity") { cyl(g, [0.31, 0.35, 0.12], [0, 1.7, 0], WHITE); cyl(g, [0.025, 0.025, 0.25], [0.15, 1.73, -0.22], metal); } }
  }
  else if (["french_fridge", "microwave_solo", "built_in_oven", "electric_kettle", "blender", "dish_rack"].includes(key)) {
    if (key === "french_fridge") { appliance(0.94, 1.86, 0.72); box(g, [0.02, 1.65, 0.015], [0, 0.08, 0.38], metal); box(g, [0.08, 0.35, 0.03], [0.16, 0.82, 0.4], "#627c88"); }
    else if (key === "microwave_solo" || key === "built_in_oven") { appliance(0.78, 0.58, 0.58, "#cbd1d5"); box(g, [0.68, 0.4, 0.02], [0, 0.08, 0.31], "#253139"); cyl(g, [0.04, 0.04, 0.035], [0.31, 0.3, 0.34], metal); }
    else if (key === "electric_kettle") { cyl(g, [0.23, 0.26, 0.48], [0, 0, 0], "#e8e4dc"); cyl(g, [0.19, 0.22, 0.035], [0, 0.48, 0], metal); const h = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.025, 8, 24, Math.PI), mat(DARK)); h.rotation.x = Math.PI / 2; h.position.set(0, 0.44, -0.02); g.add(h); }
    else if (key === "blender") { box(g, [0.4, 0.15, 0.38], [0, 0, 0], WHITE); const jug = cyl(g, [0.17, 0.22, 0.55], [0, 0.15, 0], "#a9cbd0", { transparent: true, opacity: 0.62, roughness: 0.1 }); jug.material.side = THREE.DoubleSide; cyl(g, [0.21, 0.035, 0.04], [0, 0.7, 0], DARK); }
    else { box(g, [0.82, 0.08, 0.42], [0, 0.55, 0], metal); for (let i = 0; i < 4; i++) box(g, [0.04, 0.36, 0.04], [-0.35 + i * 0.23, 0.62, 0], metal); for (let i = 0; i < 3; i++) box(g, [0.12, 0.24, 0.025], [-0.25 + i * 0.25, 0.67, 0], WHITE); }
  }
  else if (["bathtub", "shower_enclosure", "towel_rail", "soap_set", "toilet_roll_holder", "bath_mirror"].includes(key)) {
    if (key === "bathtub") { box(g, [1.72, 0.55, 0.84], [0, 0.08, 0], WHITE, { roughness: 0.25 }); box(g, [1.48, 0.05, 0.62], [0, 0.57, 0], "#9ed3df", { transparent: true, opacity: 0.7 }); for (const x of [-0.68, 0.68]) box(g, [0.08, 0.18, 0.75], [x, 0, 0], metal); }
    else if (key === "shower_enclosure") { box(g, [0.95, 0.05, 0.9], [0, 0.02, 0], "#c8d1d5"); for (const x of [-0.45, 0.45]) box(g, [0.035, 1.75, 0.035], [x, 0.07, -0.42], metal); box(g, [0.9, 1.7, 0.025], [0, 0.08, -0.42], "#a4d3e2", { transparent: true, opacity: 0.35 }); }
    else if (key === "bath_mirror") { cyl(g, [0.48, 0.48, 0.06], [0, 1.05, 0], glow("#e7f5f2", 0.7), {}, 40); cyl(g, [0.4, 0.4, 0.025], [0, 1.05, 0.04], "#99bcc6", { metalness: 0.75, roughness: 0.12 }, 40); }
    else if (key === "towel_rail") { for (const x of [-0.3, 0.3]) box(g, [0.04, 0.8, 0.04], [x, 0.2, 0], metal); for (const y of [0.35, 0.65, 0.95]) box(g, [0.65, 0.035, 0.04], [0, y, 0], metal); box(g, [0.54, 0.32, 0.03], [0, 0.55, 0.06], WHITE); }
    else if (key === "soap_set") { for (let i = 0; i < 3; i++) { cyl(g, [0.1, 0.13, 0.25 + i * 0.06], [-0.25 + i * 0.25, 0, 0], ["#d8c8ad", "#9bb2a2", "#d5dce2"][i]); cyl(g, [0.025, 0.025, 0.06], [-0.25 + i * 0.25, 0.25 + i * 0.06, 0], metal); } }
    else { cyl(g, [0.22, 0.22, 0.05], [0, 0.05, 0], metal); cyl(g, [0.035, 0.035, 0.72], [0, 0.08, 0], metal); cyl(g, [0.15, 0.15, 0.035], [0, 0.74, 0], WHITE); }
  }
  else if (["pendant_cluster", "led_strip", "recessed_spotlight", "wall_sconce", "table_lamp", "neon_sign", "smart_ambient_light"].includes(key)) {
    if (key === "pendant_cluster") { box(g, [0.74, 0.05, 0.2], [0, 1.72, 0], metal); for (const x of [-0.25, 0, 0.25]) { cyl(g, [0.018, 0.018, 0.52], [x, 1.2, 0], metal); cyl(g, [0.13, 0.17, 0.25], [x, 0.94, 0], glow("#f3d89d", 1.3)); pointLight("#ffd991", 0.55, 3.2, [x, 0.8, 0]); } }
    else if (key === "led_strip") { box(g, [0.82, 0.04, 0.82], [0, 0.03, 0], DARK); for (let i = 0; i < 4; i++) { const c = ["#28d7e5", "#7556ef", "#ea5598", "#52df8e"][i], strip = box(g, [0.76, 0.035, 0.045], [0, 0.1 + i * 0.12, 0], glow(c, 1.7)); strip.rotation.y = i * 0.35; if (i % 2 === 0) pointLight(c, 0.45, 2.4, [0, 0.45 + i * 0.12, 0]); } }
    else if (key === "recessed_spotlight") for (let i = 0; i < 3; i++) { const x = i * 0.3 - 0.3; box(g, [0.24, 0.06, 0.24], [x, 1.5, 0], metal); cyl(g, [0.09, 0.1, 0.18], [x, 1.3, 0], glow("#fff0b8", 1.5)); pointLight("#fff0cf", 0.35, 2.6, [x, 1.1, 0]); }
    else if (key === "wall_sconce") { box(g, [0.78, 1.5, 0.06], [0, 0.05, -0.06], wood); for (const x of [-0.22, 0.22]) { box(g, [0.05, 0.56, 0.05], [x, 0.25, 0], metal); cyl(g, [0.14, 0.07, 0.28], [x, 0.67, 0], glow("#ffe9ba", 1.2)); pointLight("#ffdf9e", 0.45, 2.8, [x, 0.72, 0.15]); } }
    else if (key === "table_lamp") { cyl(g, [0.2, 0.24, 0.08], [0, 0, 0], wood); cyl(g, [0.05, 0.06, 0.48], [0, 0.08, 0], metal); cyl(g, [0.21, 0.12, 0.35], [0, 0.56, 0], glow("#f1dfbd", 0.9)); pointLight("#ffdda1", 0.5, 2.6, [0, 0.7, 0]); }
    else if (key === "neon_sign") { box(g, [0.9, 1.25, 0.08], [0, 0.15, -0.08], DARK); for (let i = 0; i < 3; i++) { const c = ["#ec5da8", "#4edee2", "#f5c34f"][i], line = box(g, [0.58 - i * 0.11, 0.035, 0.025], [0, 0.88 - i * 0.28, 0], glow(c, 2)); line.rotation.z = i === 1 ? -0.12 : 0.12; if (i === 1) pointLight(c, 0.6, 3, [0, 0.55, 0.18]); } }
    else { cyl(g, [0.25, 0.34, 0.08], [0, 0, 0], metal); cyl(g, [0.1, 0.13, 1.75], [0, 0.08, 0], glow("#8a62ff", 1.7)); for (let i = 0; i < 4; i++) box(g, [0.12, 0.04, 0.12], [0, 0.3 + i * 0.38, 0], glow(["#47d8ff", "#ad6eff", "#ff63a7", "#66e4a4"][i], 1.5)); pointLight("#a584ff", 0.8, 3.5, [0, 1.1, 0]); }
  }
  else if (["round_dining_set", "balcony_set", "garden_bench", "hammock", "garden_fountain", "planter_trio", "garden_lights"].includes(key)) {
    if (key === "round_dining_set" || key === "balcony_set") { cyl(g, [key === "round_dining_set" ? 0.52 : 0.38, key === "round_dining_set" ? 0.52 : 0.38, 0.08], [0, 0.72, 0], wood, {}, 28); cyl(g, [0.09, 0.13, 0.68], [0, 0.03, 0], wood); for (const a of [0, Math.PI]) { const x = Math.cos(a) * 0.72; box(g, [0.44, 0.08, 0.42], [x, 0.42, 0], accent); box(g, [0.44, 0.48, 0.06], [x, 0.48, -0.18], wood); } }
    else if (key === "garden_bench") { box(g, [1.55, 0.11, 0.52], [0, 0.52, 0], wood); for (let y = 0; y < 4; y++) box(g, [1.55, 0.08, 0.08], [0, 0.7 + y * 0.23, -0.22], wood); for (const x of [-0.65, 0.65]) { box(g, [0.08, 0.54, 0.08], [x, 0, 0], wood); box(g, [0.08, 1.4, 0.08], [x, 0.5, -0.22], wood); } }
    else if (key === "hammock") { for (const x of [-0.78, 0.78]) { const p = box(g, [0.08, 1.52, 0.08], [x, 0, 0], wood); p.rotation.z = x * 0.16; } const cloth = box(g, [1.4, 0.06, 0.5], [0, 0.55, 0], accent); cloth.rotation.z = 0.1; }
    else if (key === "garden_fountain") { cyl(g, [0.55, 0.65, 0.2], [0, 0, 0], "#b9b4a6"); cyl(g, [0.27, 0.32, 0.65], [0, 0.2, 0], "#d4cfc1"); cyl(g, [0.42, 0.22, 0.11], [0, 0.83, 0], "#b7b3a8"); cyl(g, [0.035, 0.035, 0.4], [0, 0.94, 0], "#72c4d1", { transparent: true, opacity: 0.65 }); }
    else if (key === "planter_trio") for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.33; cyl(g, [0.14, 0.22, 0.32 + (i % 2) * 0.12], [x, 0, 0], ["#b96743", "#d0aa7d", "#73806a"][i]); for (let j = 0; j < 4; j++) { const leaf = box(g, [0.05, 0.35 + (j % 2) * 0.1, 0.04], [x + (j - 1.5) * 0.04, 0.4, (j % 2) * 0.06], "#4a9867"); leaf.rotation.z = (j - 1.5) * 0.2; } }
    else { for (let i = 0; i < 3; i++) { const x = (i - 1) * 0.4; cyl(g, [0.09, 0.12, 0.42], [x, 0, 0], metal); cyl(g, [0.15, 0.07, 0.16], [x, 0.42, 0], glow("#ffe2a4", 1.4)); } }
  }
  else if (["gaming_station", "ultrawide_monitor", "soundbar", "projector", "record_player"].includes(key)) {
    if (key === "gaming_station" || key === "ultrawide_monitor") { deskTop(g, key === "gaming_station" ? "#242632" : wood); const screen = box(g, [key === "gaming_station" ? 0.86 : 1.44, 0.72, 0.06], [0, 1.0, -0.25], DARK); box(g, [key === "gaming_station" ? 0.78 : 1.34, 0.62, 0.012], [0, 1.01, -0.215], key === "gaming_station" ? glow("#7457cf", 0.9) : "#6394ab"); box(g, [0.08, 0.3, 0.08], [0, 0.8, -0.24], metal); if (key === "gaming_station") { box(g, [0.26, 0.65, 0.42], [0.72, 0.02, -0.1], DARK); box(g, [0.1, 0.5, 0.34], [0.67, 0.08, -0.1], glow("#53d7da", 1.1)); seat(g, accent, 0.7); } }
    else if (key === "soundbar") { box(g, [0.94, 0.14, 0.16], [0, 0.18, 0], DARK); for (let x = -0.35; x <= 0.36; x += 0.18) cyl(g, [0.04, 0.04, 0.02], [x, 0.18, 0.09], metal).rotation.x = Math.PI / 2; box(g, [0.34, 0.42, 0.3], [0, 0, -0.2], DARK); }
    else if (key === "projector") { box(g, [0.72, 0.28, 0.52], [0, 0.1, 0], WHITE); cyl(g, [0.12, 0.12, 0.04], [0, 0.22, 0.27], "#82c6df", { metalness: 0.6 }, 28); box(g, [0.08, 1.3, 0.05], [-0.4, 0, -0.2], metal); box(g, [0.9, 1.15, 0.035], [0, 0.07, -0.25], "#eee9dc"); }
    else { box(g, [0.86, 0.1, 0.62], [0, 0.42, 0], wood); cyl(g, [0.26, 0.26, 0.05], [0, 0.48, 0], DARK); box(g, [0.04, 0.18, 0.04], [0.3, 0.55, 0], metal); }
  }
  else if (["acoustic_wall", "photo_collage", "floating_shelf", "decorative_mirror", "wallpaper_roll", "fluted_wall_panel", "terrazzo_finish", "herringbone_floor", "marble_floor"].includes(key)) {
    if (key === "floating_shelf") { for (let y = 0.42; y < 1.5; y += 0.44) { box(g, [0.86, 0.06, 0.22], [0, y, 0], wood); for (let i = 0; i < 3; i++) box(g, [0.11, 0.24 + (i % 2) * 0.05, 0.1], [-0.25 + i * 0.25, y + 0.08, 0], ["#d8bc82", "#598470", "#7997ad"][i]); } }
    else if (key === "photo_collage") { for (let i = 0; i < 5; i++) { const x = (i % 3 - 1) * 0.31, y = 0.44 + Math.floor(i / 3) * 0.55; box(g, [0.29, 0.42, 0.04], [x, y, 0], wood); box(g, [0.23, 0.34, 0.018], [x, y, 0.03], ["#d98c60", "#6a94a4", "#c9aa6c", "#8a739c", "#598470"][i]); } }
    else if (key === "decorative_mirror") { for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6, ray = box(g, [0.06, 0.32, 0.035], [Math.sin(a) * 0.4, 1.0 + Math.cos(a) * 0.4, 0], "#c6a35e"); ray.rotation.z = -a; } cyl(g, [0.3, 0.3, 0.05], [0, 1, 0.03], "#a9c9cf", { metalness: 0.8, roughness: 0.12 }, 32); }
    else { box(g, [0.9, 1.55, 0.08], [0, 0.05, 0], key === "marble_floor" ? "#e9e5dc" : key === "herringbone_floor" ? wood : key === "terrazzo_finish" ? "#cfcbbd" : key === "acoustic_wall" ? "#282d35" : "#b7ab91"); if (key === "fluted_wall_panel" || key === "acoustic_wall") for (let x = -0.4; x <= 0.4; x += 0.12) box(g, [0.035, 1.5, 0.08], [x, 0.05, 0.08], key === "acoustic_wall" ? "#725a44" : "#63452f"); if (key === "marble_floor") for (let i = 0; i < 4; i++) { const vein = box(g, [0.7, 0.01, 0.018], [(i - 1.5) * 0.08, 0.2 + i * 0.3, 0.08], "#929895"); vein.rotation.z = 0.24; } if (key === "wallpaper_roll") for (let i = 0; i < 7; i++) { const leaf = box(g, [0.12, 0.27, 0.025], [-0.35 + (i % 3) * 0.32, 0.3 + Math.floor(i / 3) * 0.45, 0.07], "#4b8b67"); leaf.rotation.z = i % 2 ? -0.4 : 0.4; } if (key === "herringbone_floor") for (let i = 0; i < 6; i++) { const plank = box(g, [0.31, 0.03, 0.12], [-0.3 + (i % 3) * 0.3, 0.85, -0.3 + Math.floor(i / 3) * 0.2], wood); plank.rotation.y = i % 2 ? Math.PI / 2 : 0; } if (key === "terrazzo_finish") for (let i = 0; i < 20; i++) ball(g, 0.035, [Math.sin(i * 3) * 0.4, 0.15 + (i % 6) * 0.22, 0.09], ["#719587", "#bb896e", "#e8e1d4"][i % 3]); }
  }
  else if (["aquarium", "sculpture", "indoor_waterfall", "book_stack", "decorative_tray", "fruit_bowl"].includes(key)) {
    if (key === "aquarium") { box(g, [0.94, 1.0, 0.52], [0, 0, 0], wood); box(g, [0.9, 0.7, 0.46], [0, 1.02, 0], "#74b8c6", { transparent: true, opacity: 0.38, metalness: 0.25 }); for (let i = 0; i < 5; i++) { const fish = ball(g, 0.075, [Math.sin(i * 5) * 0.33, 0.72 + (i % 3) * 0.17, 0.25], ["#f5b344", "#ed7892", "#6fc6d5"][i % 3]); fish.scale.set(1.4, 0.7, 0.45); } box(g, [0.88, 0.05, 0.44], [0, 1.4, 0], glow("#a9efff", 0.8)); }
    else if (key === "sculpture") { const s = new THREE.Mesh(new THREE.TorusKnotGeometry(0.25, 0.09, 96, 12), mat("#a87c43", { metalness: 0.78, roughness: 0.22 })); s.position.y = 0.85; g.add(s); box(g, [0.58, 0.2, 0.48], [0, 0.1, 0], "#b4a894"); }
    else if (key === "indoor_waterfall") { box(g, [0.82, 1.65, 0.26], [0, 0.05, -0.12], "#454a4d"); for (let i = 0; i < 8; i++) box(g, [0.72, 0.025, 0.08], [0, 0.2 + i * 0.18, 0.05], "#555d60"); box(g, [0.9, 0.18, 0.42], [0, 0.02, 0.12], "#4e5960"); for (let i = 0; i < 5; i++) box(g, [0.03, 0.62, 0.025], [-0.24 + i * 0.12, 0.72, 0.02], glow("#69c8da", 0.8)); }
    else if (key === "fruit_bowl") { cyl(g, [0.36, 0.25, 0.16], [0, 0.1, 0], "#d7aa5d"); for (let i = 0; i < 5; i++) ball(g, 0.12, [Math.sin(i * 4) * 0.19, 0.29 + (i % 2) * 0.06, Math.cos(i * 4) * 0.15], ["#e25942", "#e8b83e", "#6eaa62"][i % 3]); }
    else if (key === "book_stack") for (let i = 0; i < 4; i++) { const b = box(g, [0.62 - (i % 2) * 0.08, 0.12, 0.46], [0, i * 0.14, 0], ["#567d72", "#c79460", "#7c7390", "#d9d0ba"][i]); b.rotation.y = i % 2 ? 0.1 : -0.08; }
    else { box(g, [0.8, 0.07, 0.52], [0, 0.12, 0], "#bd9d5d"); cyl(g, [0.14, 0.14, 0.07], [-0.18, 0.18, 0], "#f0dfb4"); cyl(g, [0.11, 0.11, 0.05], [0.2, 0.18, 0.05], "#70947e"); }
  }
  else if (key === "decorative_tray") { box(g, [0.82, 0.06, 0.56], [0, 0.06, 0], "#c29a55", { metalness: 0.68 }); for (const x of [-0.38, 0.38]) box(g, [0.04, 0.07, 0.56], [x, 0.1, 0], "#d3b878", { metalness: 0.65 }); for (const x of [-0.2, 0.18]) cyl(g, [0.09, 0.11, 0.18], [x, 0.12, 0], x < 0 ? "#eee1ca" : "#6c9879"); }
  else { top(); legs(); }
  g.userData.finish = def?.finish ?? null;
}


/** A rattan patio chair (also used round the patio tables): at (x, z), turned `yaw`, with a cushion of the given colour. */
function patioChair(g, x, z, yaw, frame, cushion) {
  const c = new THREE.Group(); c.position.set(x, 0, z); c.rotation.y = yaw; g.add(c);
  box(c, [0.6, 0.07, 0.6], [0, 0.4, 0], frame); box(c, [0.6, 0.5, 0.07], [0, 0.45, -0.27], frame).rotation.x = -0.1; for (const [lx, lz] of [[-0.26, -0.26], [0.26, -0.26], [-0.26, 0.26], [0.26, 0.26]]) box(c, [0.05, 0.4, 0.05], [lx, 0, lz], frame);
  for (const lx of [-0.3, 0.3]) box(c, [0.05, 0.22, 0.5], [lx, 0.5, 0], frame); box(c, [0.5, 0.1, 0.5], [0, 0.47, 0.02], cushion); box(c, [0.46, 0.34, 0.08], [0, 0.55, -0.22], cushion).rotation.x = -0.1;
}
/** A round parasol: a cone canopy of alternating colours (colours null: a plain cream canopy), centred over (x, z=0) at height y. */
function parasol(g, x, y, r, colors) {
  if (!colors) return;
  const [a, b] = colors, base = new THREE.Mesh(new THREE.CylinderGeometry(0.03, r, 0.4, 16), mat(a, { side: THREE.DoubleSide })); base.position.set(x, y + 0.2, 0); base.castShadow = true; g.add(base);
  for (let i = 0; i < 8; i += 2) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.031, r + 0.01, 0.405, 4, 1, false, (i * Math.PI) / 4, Math.PI / 4), mat(b, { side: THREE.DoubleSide })); w.position.set(x, y + 0.2, 0); g.add(w); }
  ball(g, 0.05, [x, y + 0.42, 0], "#c9a45a");
}

function bed(g, wide, sheet) {
  const W = wide ? 1.92 : 0.92, D = 1.92;
  box(g, [W, 0.3, D], [0, 0, 0], WOOD_D);
  box(g, [W - 0.06, 0.22, D - 0.1], [0, 0.3, 0.02], WHITE);
  box(g, [W - 0.04, 0.1, D * 0.58], [0, 0.5, D * 0.2], sheet);
  box(g, [W, 0.78, 0.07], [0, 0, -D / 2 + 0.035], WOOD_D);
  for (const px of wide ? [-0.45, 0.45] : [0]) box(g, [0.62, 0.13, 0.34], [px, 0.52, -D / 2 + 0.42], "#ffffff", { roughness: 0.9 });
}
function seat(g, color, w = 0.85, arms = true) {
  box(g, [w, 0.34, 0.84], [0, 0.06, 0], color); box(g, [w, 0.62, 0.22], [0, 0.34, -0.31], color);
  box(g, [w - (arms ? 0.36 : 0.1), 0.14, 0.62], [0, 0.4, 0.08], color, { roughness: 0.95 });
  if (arms) for (const s of [-1, 1]) box(g, [0.14, 0.42, 0.78], [s * (w / 2 - 0.07), 0.06, 0.02], color);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, [0.07, 0.07, 0.07], [sx * (w / 2 - 0.08), 0, sz * 0.34], WOOD_D);
}
function tvOn(g, tex, w = 1.45) {
  box(g, [1.9, 0.5, 0.62], [0, 0, 0], WOOD_D); box(g, [1.84, 0.04, 0.56], [0, 0.5, 0], WOOD);
  const frame = box(g, [w + 0.1, 0.86, 0.07], [0, 0.56, -0.05], "#0e1118");
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.76), new THREE.MeshStandardMaterial({ map: tex, emissive: "#ffffff", emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.4 }));
  frame.add(scr); scr.position.set(0, 0, 0.037);
}
function deskTop(g, top = WOOD_L) {
  box(g, [1.9, 0.07, 0.86], [0, 0.78, 0], top);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, [0.07, 0.78, 0.07], [sx * 0.88, 0, sz * 0.38], WOOD_D);
}

function centreTable(g, top, base, glass = false) {
  const topMat = glass ? mat("#bde7ef", { transparent: true, opacity: 0.58, metalness: 0.18, roughness: 0.12 }) : top;
  box(g, [1.68, 0.09, 0.68], [0, 0.48, 0], topMat);
  for (const [x, z] of [[-0.68, -0.24], [0.68, -0.24], [-0.68, 0.24], [0.68, 0.24]]) box(g, [0.07, 0.48, 0.07], [x, 0, z], base);
  if (!glass) box(g, [1.42, 0.05, 0.48], [0, 0.2, 0], WOOD_D);
}

function mediaStand(g, width = 1.72, color = WOOD) {
  box(g, [width, 0.46, 0.48], [0, 0, 0], color);
  box(g, [width + 0.04, 0.06, 0.52], [0, 0.46, 0], WOOD_L);
  for (const x of [-width * 0.29, width * 0.29]) box(g, [0.025, 0.34, 0.01], [x, 0.06, 0.245], WOOD_D);
  for (const x of [-width * 0.42, width * 0.42]) box(g, [0.08, 0.08, 0.08], [x, 0, 0], DARK);
}

function framedDisplay(g, colors = ["#e07c55", "#f2c46f", "#23877a"]) {
  // The existing placement grid is floor-based, so framed art uses a stable little easel rather than clipping into a wall.
  for (const x of [-0.28, 0.28]) { const leg = box(g, [0.035, 1.18, 0.035], [x, 0, -0.12], WOOD_D); leg.rotation.x = -0.12; }
  box(g, [0.72, 0.82, 0.06], [0, 0.64, 0], WOOD_D);
  box(g, [0.62, 0.72, 0.025], [0, 0.68, 0.045], WHITE);
  box(g, [0.54, 0.64, 0.018], [0, 0.69, 0.062], colors[0]);
  ball(g, 0.2, [-0.1, 0.78, 0.09], colors[1], {}, [0.8, 1, 0.06]);
  box(g, [0.3, 0.22, 0.018], [0.14, 0.52, 0.09], colors[2]);
}

function floorLamp(g, shade = "#fff0c4", metal = STEEL) {
  cyl(g, [0.24, 0.27, 0.06], [0, 0, 0], metal, { metalness: 0.65, roughness: 0.28 });
  cyl(g, [0.025, 0.035, 1.48], [0, 0.05, 0], metal, { metalness: 0.65, roughness: 0.28 });
  cyl(g, [0.2, 0.05, 0.3], [0, 1.47, 0], shade, { emissive: shade, emissiveIntensity: 0.8, roughness: 0.5 });
}

function vase(g, color, flowers = false) {
  cyl(g, [0.16, 0.28, 0.42], [0, 0, 0], color, { roughness: 0.3 });
  cyl(g, [0.09, 0.16, 0.11], [0, 0.4, 0], color, { roughness: 0.3 });
  if (flowers) {
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 0.4, x = Math.cos(a) * 0.1, z = Math.sin(a) * 0.1;
      cyl(g, [0.012, 0.018, 0.42], [x, 0.5, z], "#3a8b56");
      ball(g, 0.075, [x, 0.96 + (i % 2) * 0.06, z], ["#e65f72", "#f4bf42", "#a56fd1"][i % 3]);
    }
  }
}

function premiumSofa(g, color, width = 2.5) {
  box(g, [width, 0.3, 1.18], [0, 0.22, 0], color);
  box(g, [width, 0.76, 0.2], [0, 0.45, -0.48], color);
  for (const x of [-width / 2 + 0.12, width / 2 - 0.12]) box(g, [0.2, 0.52, 1.0], [x, 0.22, -0.02], color);
  for (const x of [-width * 0.27, 0, width * 0.27]) {
    box(g, [width * 0.24, 0.14, 0.84], [x, 0.39, 0.08], WHITE, { roughness: 0.95 });
    box(g, [width * 0.2, 0.32, 0.12], [x, 0.57, -0.35], WHITE, { roughness: 0.95 });
  }
  for (const x of [-width * 0.4, width * 0.4]) for (const z of [-0.42, 0.42]) box(g, [0.08, 0.12, 0.08], [x, 0, z], WOOD_D);
}

const BUILD = {
  // school-hostel bunk: bare iron frame, thin worn mattresses, a ladder. Nothing stylish.
  iron_bunk: (g) => {
    const IRON = "#4b5058", RUST = "#7a5a46", D = 1.92, W = 0.92;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { box(g, [0.06, 1.85, 0.06], [sx * (W / 2 - 0.03), 0, sz * (D / 2 - 0.03)], IRON, { metalness: 0.4 }); }
    for (const y of [0.3, 1.1]) {
      box(g, [W - 0.02, 0.04, D - 0.02], [0, y, 0], IRON, { metalness: 0.4 });                              // iron deck
      box(g, [W - 0.12, 0.11, D - 0.16], [0, y + 0.04, 0.02], y < 1 ? "#8b8f98" : "#7d746b", { roughness: 1 }); // thin mattress, faded
      box(g, [0.5, 0.07, 0.3], [0, y + 0.15, -D / 2 + 0.3], "#c9c4b6", { roughness: 1 });                      // flat pillow
      for (const s of [-1, 1]) box(g, [0.035, 0.1, D - 0.1], [s * (W / 2 - 0.03), y + 0.02, 0], IRON);         // side rails
    }
    box(g, [W, 0.3, 0.04], [0, 1.55, -D / 2 + 0.03], IRON); box(g, [W, 0.3, 0.04], [0, 1.55, D / 2 - 0.03], IRON);  // top end rails
    for (let i = 0; i < 4; i++) box(g, [0.04, 0.04, 0.3], [W / 2 + 0.01, 0.25 + i * 0.28, D / 2 - 0.35], RUST);       // ladder rungs on the side
    for (const s of [-1, 1]) box(g, [0.03, 1.1, 0.03], [W / 2 + 0.01 + 0, 0.1, D / 2 - 0.2 + s * 0.17], RUST);
  },
  // the room's own toilet, basin and shower corner
  ensuite: (g) => {
    box(g, [1.88, 0.03, 0.86], [0, 0, 0], "#c9d3d9", { roughness: 0.5 });                                                  // tiled floor
    box(g, [0.4, 0.22, 0.5], [-0.55, 0.03, 0.02], WHITE, { roughness: 0.3 }); box(g, [0.36, 0.06, 0.4], [-0.55, 0.25, 0.04], "#eef2f4", { roughness: 0.3 }); // toilet base and seat
    box(g, [0.38, 0.4, 0.16], [-0.55, 0.25, -0.3], WHITE, { roughness: 0.3 });                                            // cistern
    cyl(g, [0.04, 0.06, 0.7], [0.1, 0.03, -0.3], WHITE); box(g, [0.42, 0.1, 0.34], [0.1, 0.73, -0.22], WHITE, { roughness: 0.3 }); cyl(g, [0.015, 0.015, 0.14], [0.1, 0.83, -0.34], STEEL); // pedestal basin and tap
    box(g, [0.62, 0.05, 0.62], [0.62, 0.03, 0.12], "#aab6bf", { roughness: 0.4 });                                          // shower tray
    box(g, [0.03, 1.9, 0.03], [0.93, 0.05, 0.4], STEEL); box(g, [0.03, 0.03, 0.62], [0.93, 1.95, 0.1], STEEL); box(g, [0.02, 1.7, 0.6], [0.93, 0.2, 0.1], "#7fb7d8", { transparent: true, opacity: 0.55 }); // curtain
    cyl(g, [0.05, 0.05, 0.02], [0.62, 1.9, -0.18], STEEL);
  },
  // the separate toilet: a toilet and a pedestal basin on a tiled strip
  toilet: (g) => {
    box(g, [1.88, 0.03, 0.86], [0, 0, 0], "#c9d3d9", { roughness: 0.5 });                                                  // tiled floor
    box(g, [0.4, 0.22, 0.5], [-0.4, 0.03, 0.02], WHITE, { roughness: 0.3 }); box(g, [0.36, 0.06, 0.4], [-0.4, 0.25, 0.04], "#eef2f4", { roughness: 0.3 }); // toilet base and seat
    box(g, [0.38, 0.4, 0.16], [-0.4, 0.25, -0.3], WHITE, { roughness: 0.3 });                                             // cistern
    cyl(g, [0.04, 0.06, 0.7], [0.4, 0.03, -0.3], WHITE); box(g, [0.42, 0.1, 0.34], [0.4, 0.73, -0.22], WHITE, { roughness: 0.3 }); cyl(g, [0.015, 0.015, 0.14], [0.4, 0.83, -0.34], STEEL); // pedestal basin and tap
  },
  single_bed: (g) => bed(g, false, "#5b6bd6"),
  double_bed: (g) => bed(g, true, "#c2455a"),
  luxury_bed: (g) => {
    bed(g, true, "#385b50");
    box(g, [1.98, 1.05, 0.13], [0, 0.28, -0.95], "#d5b77e", { metalness: 0.12 });
    box(g, [1.82, 0.82, 0.1], [0, 0.38, -0.86], "#355b4b");
  },
  wardrobe: (g) => {
    box(g, [1.9, 2.15, 0.84], [0, 0, 0], WOOD_L); box(g, [1.94, 0.07, 0.88], [0, 2.15, 0], WOOD); box(g, [0.03, 2.0, 0.02], [0, 0.07, 0.43], WOOD_D);
    for (const s of [-1, 1]) { box(g, [0.04, 0.34, 0.05], [s * 0.1, 0.95, 0.45], "#2b2f3a"); box(g, [0.78, 1.8, 0.015], [s * 0.46, 0.17, 0.425], WOOD, { roughness: 0.6 }); }
  },
  nightstand: (g) => {
    box(g, [0.62, 0.55, 0.56], [0, 0, 0], WOOD); box(g, [0.5, 0.2, 0.02], [0, 0.28, 0.285], WOOD_D); box(g, [0.12, 0.03, 0.03], [0, 0.4, 0.3], "#2b2f3a");
    cyl(g, [0.05, 0.07, 0.16], [0, 0.55, 0], DARK); cyl(g, [0.12, 0.17, 0.2], [0, 0.7, 0], "#ffe7b0", { emissive: "#ffd27a", emissiveIntensity: 0.9 });
  },
  bedside_table_deluxe: (g) => {
    box(g, [0.78, 0.62, 0.66], [0, 0, 0], "#80552f");
    box(g, [0.84, 0.07, 0.72], [0, 0.62, 0], "#c99b61");
    for (const y of [0.2, 0.43]) { box(g, [0.66, 0.015, 0.02], [0, y, 0.34], "#d7b679"); cyl(g, [0.035, 0.035, 0.03], [0, y + 0.03, 0.35], STEEL); }
    for (const x of [-0.28, 0.28]) for (const z of [-0.22, 0.22]) box(g, [0.06, 0.12, 0.06], [x, 0, z], WOOD_D);
  },
  bedside_lamp: (g) => {
    cyl(g, [0.2, 0.25, 0.06], [0, 0, 0], WOOD_D);
    cyl(g, [0.045, 0.055, 0.55], [0, 0.06, 0], STEEL, { metalness: 0.55 });
    cyl(g, [0.19, 0.07, 0.22], [0, 0.59, 0], "#fff0c4", { emissive: "#ffd98b", emissiveIntensity: 1.1 });
  },
  dressing_table: (g) => {
    box(g, [1.7, 0.1, 0.68], [0, 0.78, 0], WOOD_L);
    for (const x of [-0.72, 0.72]) box(g, [0.24, 0.7, 0.62], [x, 0.08, 0], WOOD);
    for (const x of [-0.72, 0.72]) { box(g, [0.17, 0.025, 0.015], [x, 0.42, 0.32], WOOD_D); cyl(g, [0.025, 0.025, 0.02], [x, 0.46, 0.34], STEEL); }
    box(g, [0.94, 1.02, 0.075], [0, 0.87, -0.27], WOOD_D);
    box(g, [0.78, 0.86, 0.025], [0, 0.91, -0.22], "#b9cdd2", { metalness: 0.78, roughness: 0.12 });
    for (const x of [-0.76, 0.76]) box(g, [0.08, 0.12, 0.08], [x, 0, -0.25], WOOD_D);
    box(g, [0.46, 0.38, 0.42], [0, 0, 0.58], "#a37b56"); box(g, [0.5, 0.08, 0.5], [0, 0.42, 0.58], "#c99b61");
  },
  premium_wardrobe: (g) => {
    box(g, [1.9, 2.18, 0.86], [0, 0, 0], "#6e4a2c");
    for (const x of [-0.47, 0.47]) {
      box(g, [0.84, 2.0, 0.035], [x, 0.08, 0.45], "#a67c52");
      box(g, [0.7, 1.8, 0.02], [x, 0.18, 0.48], "#b9cdd2", { metalness: 0.82, roughness: 0.12 });
      cyl(g, [0.025, 0.025, 0.08], [x + (x < 0 ? 0.32 : -0.32), 1.02, 0.49], "#c7a45d", { metalness: 0.7 });
    }
    box(g, [1.98, 0.08, 0.92], [0, 2.18, 0], "#c99b61");
  },
  desk: (g) => {
    deskTop(g); box(g, [0.5, 0.55, 0.78], [0.6, 0.22, 0], WOOD); box(g, [0.42, 0.14, 0.02], [0.6, 0.5, 0.4], WOOD_D); box(g, [0.1, 0.03, 0.03], [0.6, 0.56, 0.41], "#2b2f3a");
    box(g, [0.56, 0.02, 0.38], [-0.35, 0.85, 0.02], "#c9ced6", { metalness: 0.5, roughness: 0.4 });
    const lid = box(g, [0.56, 0.38, 0.02], [-0.35, 0.86, -0.18], "#9aa3b2", { metalness: 0.5, roughness: 0.4 }); lid.rotation.x = -0.18;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.32), new THREE.MeshBasicMaterial({ map: screenTex("pc") })); scr.position.set(0, 0, 0.012); lid.add(scr);
    cyl(g, [0.06, 0.05, 0.1], [0.1, 0.85, 0.2], "#e8a23a"); box(g, [0.28, 0.02, 0.2], [0.35, 0.85, 0.22], "#f8f4ea");
  },
  plastic_chair: (g) => {
    box(g, [0.5, 0.05, 0.48], [0, 0.45, 0.02], "#3f6fd1"); box(g, [0.5, 0.42, 0.05], [0, 0.5, -0.22], "#3f6fd1");
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) cyl(g, [0.025, 0.025, 0.46], [sx * 0.21, 0, sz * 0.2 + 0.02], STEEL);
  },
  office_chair: (g) => {
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2, leg = box(g, [0.34, 0.04, 0.05], [Math.cos(a) * 0.17, 0.08, Math.sin(a) * 0.17], DARK); leg.rotation.y = -a; cyl(g, [0.035, 0.035, 0.04], [Math.cos(a) * 0.33, 0, Math.sin(a) * 0.33], "#111"); }
    cyl(g, [0.04, 0.04, 0.32], [0, 0.1, 0], STEEL); box(g, [0.56, 0.1, 0.52], [0, 0.42, 0.02], "#2b3a55"); box(g, [0.52, 0.62, 0.09], [0, 0.52, -0.25], "#2b3a55"); box(g, [0.1, 0.06, 0.34], [0.32, 0.64, 0], DARK); box(g, [0.1, 0.06, 0.34], [-0.32, 0.64, 0], DARK);
  },
  bookshelf: (g) => {
    box(g, [0.86, 1.9, 0.4], [0, 0, -0.2], WOOD); box(g, [0.78, 1.8, 0.02], [0, 0.05, -0.02], WOOD_D);
    const r = rng(3), cols = ["#c0392b", "#2980b9", "#27ae60", "#f1c40f", "#8e44ad", "#e67e22", "#ecf0f1"];
    for (let s = 0; s < 4; s++) { box(g, [0.82, 0.03, 0.38], [0, 0.42 + s * 0.42, -0.2], WOOD_L); let x = -0.36; while (x < 0.34) { const w = 0.05 + r() * 0.05, h = 0.22 + r() * 0.12; box(g, [w, h, 0.26], [x + w / 2, 0.05 + s * 0.42 + 0.0, -0.2], cols[Math.floor(r() * cols.length)]); x += w + 0.01; } }
  },
  display_shelf: (g) => {
    box(g, [0.82, 1.82, 0.42], [0, 0, -0.18], "#795233");
    for (const y of [0.12, 0.56, 1.0, 1.44, 1.82]) box(g, [0.9, 0.055, 0.5], [0, y, 0], "#c89b61");
    for (let i = 0; i < 7; i++) { const x = -0.34 + (i % 3) * 0.32, y = 0.2 + Math.floor(i / 3) * 0.44; box(g, [0.16, 0.26, 0.16], [x, y, 0.08], ["#e8a23a", "#507d69", "#7183b3"][i % 3]); }
  },
  gaming_pc: (g) => {
    deskTop(g, "#1c2230"); box(g, [0.26, 0.55, 0.46], [0.7, 0.85, -0.05], "#14171f"); box(g, [0.02, 0.45, 0.4], [0.575, 0.9, -0.05], glow("#7c4dff", 1.6));
    for (const s of [-1, 1]) { const m = box(g, [0.7, 0.4, 0.04], [s * 0.38, 1.0, -0.2], "#0b0d12"); m.rotation.y = -s * 0.22; const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.34), new THREE.MeshBasicMaterial({ map: screenTex("pc") })); sc.position.z = 0.022; m.add(sc); box(g, [0.06, 0.2, 0.06], [s * 0.38, 0.85, -0.22], "#111"); }
    box(g, [0.62, 0.025, 0.2], [-0.1, 0.85, 0.18], glow("#00e5ff", 1.1)); box(g, [0.14, 0.02, 0.2], [0.35, 0.85, 0.18], "#222");
  },
  gas_cooker: (g) => {
    box(g, [0.72, 0.8, 0.6], [-0.04, 0, 0.05], "#d7dbe0", { metalness: 0.25 }); box(g, [0.72, 0.03, 0.6], [-0.04, 0.8, 0.05], "#4a4f5a");
    for (const x of [-0.22, 0.14]) { cyl(g, [0.11, 0.11, 0.03], [x, 0.83, 0.08], "#15171c"); cyl(g, [0.05, 0.05, 0.035], [x, 0.83, 0.08], "#ff7a3a", { emissive: "#ff5a1f", emissiveIntensity: 0.6 }); }
    for (const x of [-0.24, -0.08, 0.08]) cyl(g, [0.035, 0.035, 0.04], [x, 0.6, 0.37], "#15171c").rotation.x = Math.PI / 2;
    box(g, [0.5, 0.35, 0.02], [-0.04, 0.08, 0.36], "#2b2f3a"); cyl(g, [0.14, 0.14, 0.5], [0.32, 0, -0.28], "#c0392b"); cyl(g, [0.06, 0.06, 0.06], [0.32, 0.5, -0.28], "#aeb7c4");
  },
  fridge: (g) => {
    box(g, [0.78, 1.82, 0.74], [0, 0, 0], "#dfe6ea", { metalness: 0.2, roughness: 0.5 }); box(g, [0.78, 0.02, 0.01], [0, 1.18, 0.375], "#8a97a3");
    box(g, [0.03, 0.4, 0.05], [0.3, 1.25, 0.4], STEEL); box(g, [0.03, 0.6, 0.05], [0.3, 0.45, 0.4], STEEL);
  },
  water_dispenser: (g) => {
    box(g, [0.42, 1.0, 0.4], [0, 0, 0], "#f2f4f6"); box(g, [0.34, 0.14, 0.04], [0, 0.55, 0.21], "#cfd6dd"); box(g, [0.05, 0.1, 0.06], [-0.07, 0.62, 0.24], "#2e86de"); box(g, [0.05, 0.1, 0.06], [0.07, 0.62, 0.24], "#e84118");
    cyl(g, [0.2, 0.2, 0.5], [0, 1.0, 0], "#7ec8f8", { transparent: true, opacity: 0.72, roughness: 0.15 }); cyl(g, [0.07, 0.12, 0.08], [0, 1.5, 0], "#7ec8f8");
  },
  counter: (g) => {
    box(g, [1.9, 0.82, 0.8], [0, 0, 0], "#efe9db"); box(g, [1.96, 0.05, 0.86], [0, 0.82, 0], "#3d4350");
    for (const x of [-0.45, 0.45]) box(g, [0.82, 0.62, 0.02], [x, 0.1, 0.405], WOOD, { roughness: 0.6 });
    box(g, [0.5, 0.26, 0.38], [0.55, 0.87, -0.1], "#1d2128"); box(g, [0.3, 0.18, 0.01], [0.48, 0.91, 0.1], "#6b7a8f", { metalness: 0.6, roughness: 0.2 });
    box(g, [0.5, 0.04, 0.4], [-0.5, 0.87, 0.05], "#b9c2cc", { metalness: 0.7, roughness: 0.3 }); cyl(g, [0.025, 0.025, 0.28], [-0.5, 0.9, -0.28], STEEL);
  },
  rug: (g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.025, 1.86), [mat("#8a3a2a"), mat("#8a3a2a"), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }), mat("#8a3a2a"), mat("#8a3a2a"), mat("#8a3a2a")]);
    m.position.y = 0.0125; m.receiveShadow = true; g.add(m);
  },
  premium_rug: (g) => {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.035, 1.86), mat("#b59a6b", { roughness: 1 })); edge.position.y = 0.0175; edge.receiveShadow = true; g.add(edge);
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.012, 1.72), [mat("#274f48"), mat("#274f48"), new THREE.MeshStandardMaterial({ map: rugTex(), roughness: 1 }), mat("#274f48"), mat("#274f48"), mat("#274f48")]);
    top.position.y = 0.041; top.receiveShadow = true; g.add(top);
  },
  armchair: (g) => seat(g, "#e1a43b"),
  sofa: (g) => { seat(g, "#2f8f83", 1.86); box(g, [0.5, 0.12, 0.5], [-0.5, 0.52, 0.1], "#e8a23a").rotation.y = 0.3; },
  loveseat: (g) => premiumSofa(g, "#859b91", 1.72),
  velvet_sofa: (g) => premiumSofa(g, "#315a4c", 2.42),
  designer_sofa: (g) => premiumSofa(g, "#715b7c", 2.55),
  center_table_glass: (g) => centreTable(g, "#d2a46f", STEEL, true),
  center_table_wood: (g) => centreTable(g, "#a87547", WOOD_D),
  center_table_marble: (g) => {
    centreTable(g, mat("#e8e5de", { roughness: 0.28 }), "#b99b66");
    for (const x of [-0.5, 0.5]) { const vein = box(g, [0.72, 0.006, 0.012], [x, 0.53, 0.02], "#8a9290"); vein.rotation.y = x * 0.35; }
  },
  center_table_designer: (g) => {
    const gold = mat("#c49b56", { metalness: 0.78, roughness: 0.22 });
    centreTable(g, mat("#bce7e8", { transparent: true, opacity: 0.52, metalness: 0.25, roughness: 0.08 }), gold, true);
    cyl(g, [0.26, 0.38, 0.3], [0, 0.08, 0], gold, { metalness: 0.78 });
  },
  tv_stand: (g) => mediaStand(g, 1.78, "#5d402d"),
  smart_tv: (g) => tvOn(g, screenTex("match"), 1.62),
  large_smart_tv: (g) => {
    mediaStand(g, 1.86, "#242a32");
    const frame = box(g, [1.82, 1.12, 0.08], [0, 0.52, -0.11], "#101218");
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.72, 1.02), new THREE.MeshStandardMaterial({ map: screenTex("match"), emissive: "#ffffff", emissiveMap: screenTex("match"), emissiveIntensity: 0.9, roughness: 0.3 }));
    frame.add(scr); scr.position.set(0, 0, 0.044);
  },
  floor_lamp: (g) => floorLamp(g),
  curtain_stand: (g) => {
    box(g, [0.82, 0.08, 0.18], [0, 0, 0], STEEL);
    for (const x of [-0.34, 0.34]) box(g, [0.045, 1.9, 0.045], [x, 0.05, 0], STEEL);
    cyl(g, [0.025, 0.025, 0.8], [0, 1.92, 0], "#c9a45f", { metalness: 0.7 }).rotation.z = Math.PI / 2;
    for (const x of [-0.2, 0.2]) box(g, [0.38, 1.72, 0.035], [x, 0.12, 0], x < 0 ? "#678b78" : "#8c6074", { roughness: 0.95 });
  },
  wall_art: (g) => framedDisplay(g),
  framed_photos: (g) => {
    for (const x of [-0.25, 0.25]) {
      box(g, [0.42, 0.58, 0.055], [x, 0.82, 0], WOOD_D);
      box(g, [0.34, 0.5, 0.025], [x, 0.84, 0.04], WHITE);
      ball(g, 0.13, [x, 0.9, 0.058], x < 0 ? "#d58a65" : "#678b78", {}, [0.72, 1, 0.05]);
      box(g, [0.3, 0.16, 0.02], [x, 0.68, 0.06], x < 0 ? "#f0c978" : "#7d94b5");
    }
    for (const x of [-0.3, 0.3]) { const leg = box(g, [0.035, 0.95, 0.035], [x, 0, -0.16], WOOD_D); leg.rotation.x = -0.12; }
  },
  wall_clock: (g) => {
    box(g, [0.08, 1.7, 0.08], [0, 0, 0], WOOD_D);
    box(g, [0.52, 0.72, 0.08], [0, 0.94, 0], WOOD);
    cyl(g, [0.23, 0.23, 0.035], [0, 1.05, 0.1], WHITE).rotation.x = Math.PI / 2;
    cyl(g, [0.018, 0.018, 0.05], [0, 1.05, 0.1], "#252a36");
    box(g, [0.018, 0.16, 0.014], [0.035, 1.1, 0.12], "#252a36").rotation.z = -0.5;
    box(g, [0.018, 0.12, 0.014], [-0.03, 1.02, 0.12], "#252a36").rotation.z = 0.9;
    for (const x of [-0.27, 0.27]) box(g, [0.08, 0.1, 0.08], [x, 0, 0], WOOD_D);
  },
  vase: (g) => vase(g, "#3f7890"),
  flower_arrangement: (g) => vase(g, "#eee4d2", true),
  chandelier: (g) => {
    floorLamp(g, "#fff0bf", "#b89a5d");
    for (const a of [0, 2.1, 4.2]) { const x = Math.cos(a) * 0.24, z = Math.sin(a) * 0.24; ball(g, 0.095, [x, 1.3, z], "#bde7ef", { transparent: true, opacity: 0.72, emissive: "#ffe4a0", emissiveIntensity: 0.5 }); }
  },
  designer_light: (g) => {
    const gold = mat("#c39a57", { metalness: 0.72, roughness: 0.25 });
    cyl(g, [0.25, 0.32, 0.06], [0, 0, 0], gold);
    for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3, x = Math.cos(a) * 0.17, z = Math.sin(a) * 0.17; const stem = box(g, [0.035, 1.5, 0.035], [x, 0.05, z], gold); stem.rotation.z = Math.cos(a) * 0.2; ball(g, 0.15, [x * 1.8, 1.55 + i * 0.06, z * 1.8], ["#e9d5a5", "#bad9e1", "#f4d3cd"][i], { emissive: "#fff0c0", emissiveIntensity: 1.1 }); }
  },
  accent_chair: (g) => seat(g, "#72536e", 0.86, true),
  plant: (g) => {
    cyl(g, [0.24, 0.17, 0.4], [0, 0, 0], "#c97b4a"); cyl(g, [0.22, 0.22, 0.04], [0, 0.38, 0], "#3a2a1c");
    const r = rng(11); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2 + r(), tilt = 0.12 + r() * 0.25, h = 0.7 + r() * 0.75;
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.07 + r() * 0.03, h, 4), mat(i % 3 ? "#3e9b6b" : "#6cc08b")); l.scale.z = 0.35; l.position.set(Math.cos(a) * 0.06, 0.4 + h / 2, Math.sin(a) * 0.06); l.rotation.set(Math.sin(a) * tilt, a, -Math.cos(a) * tilt); l.castShadow = true; g.add(l); }
  },
  mirror: (g) => {
    const f = box(g, [0.7, 1.7, 0.06], [0, 0.05, -0.1], WOOD_D); f.rotation.x = -0.1; f.position.y = 0.9;
    const gl = box(g, [0.6, 1.6, 0.02], [0, 0, 0.035], "#c9e4f2", { metalness: 0.85, roughness: 0.08, emissive: "#9fd2ee", emissiveIntensity: 0.25 }); gl.position.y = 0; f.add(gl);
    box(g, [0.5, 0.05, 0.4], [0, 0, -0.1], WOOD_D);
  },
  tv: (g) => tvOn(g, screenTex("match")),
  console: (g) => {
    tvOn(g, screenTex("game"), 1.5); box(g, [0.1, 0.32, 0.24], [0.6, 0.54, 0.05], "#f4f4f6"); box(g, [0.02, 0.28, 0.02], [0.65, 0.56, 0.17], glow("#2e86de", 1.2));
    for (const x of [0.2, 0.34]) { const p = box(g, [0.13, 0.04, 0.09], [x, 0.54, 0.2], "#f4f4f6"); p.rotation.y = 0.3; }
  },
  speakers: (g) => { for (const s of [-1, 1]) { box(g, [0.34, 1.0, 0.34], [s * 0.24, 0, 0], "#1d2128"); cyl(g, [0.12, 0.12, 0.03], [s * 0.24, 0.28, 0.18], "#444b58").rotation.x = Math.PI / 2; cyl(g, [0.06, 0.06, 0.03], [s * 0.24, 0.75, 0.18], "#444b58").rotation.x = Math.PI / 2; } },
  piano: (g) => {
    box(g, [1.9, 1.4, 0.56], [0, 0, -0.14], "#16181d", { roughness: 0.35 }); box(g, [1.8, 0.07, 0.3], [0, 0.72, 0.2], "#16181d"); box(g, [1.7, 0.04, 0.26], [0, 0.79, 0.2], WHITE);
    for (let i = 0; i < 14; i++) if (![2, 6, 9, 13].includes(i)) box(g, [0.06, 0.03, 0.15], [-0.78 + i * 0.12, 0.83, 0.15], "#0b0b0e");
    box(g, [1.0, 0.4, 0.03], [0, 1.0, -0.13], "#f1ece0"); for (const s of [-1, 1]) box(g, [0.07, 0.72, 0.5], [s * 0.88, 0, 0.1], "#16181d");
  },
  pool: (g) => {
    box(g, [2.86, 0.7, 1.86], [0, 0.1, 0], "#5a3a22"); box(g, [2.4, 0.04, 1.4], [0, 0.8, 0], "#1f8a55", { roughness: 1 });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { box(g, [0.14, 0.1, 0.14], [sx * 1.3, 0.8, sz * 0.78], "#14171c"); box(g, [0.18, 0.1, 0.18], [sx * 1.33, 0, sz * 0.82], "#3d2614"); }
    const r = rng(5); ["#fff", "#e74c3c", "#f1c40f", "#2980b9", "#111", "#27ae60"].forEach((c, i) => ball(g, 0.055, [0.35 + (i % 3) * 0.12, 0.89, -0.15 + Math.floor(i / 3) * 0.14 + r() * 0.04], c));
    ball(g, 0.055, [-0.7, 0.89, 0.1], "#fff"); const cue = box(g, [0.03, 0.03, 1.1], [-0.45, 0.89, 0.55], "#d9b47a"); cue.rotation.y = 0.5;
  },
  fan: (g) => {
    cyl(g, [0.2, 0.22, 0.05], [0, 0, 0], DARK); cyl(g, [0.025, 0.025, 0.95], [0, 0.04, 0], STEEL); box(g, [0.18, 0.18, 0.2], [0, 1.0, 0], "#e8edf2");
    const head = new THREE.Group(); head.position.set(0, 1.1, 0.14); g.add(head);
    const blades = new THREE.Group(); head.add(blades); for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.34, 0.015), mat("#7fb2e5", { transparent: true, opacity: 0.9 })); b.position.y = 0.17; const arm = new THREE.Group(); arm.rotation.z = (i * Math.PI * 2) / 3; arm.add(b); blades.add(arm); }
    const cage = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 6, 28), mat(STEEL)); head.add(cage); cage.position.z = 0.04; const cage2 = cage.clone(); cage2.scale.setScalar(0.5); head.add(cage2);
    g.userData.spin = blades;
  },
  generator: (g) => {
    box(g, [0.78, 0.08, 0.56], [0, 0, 0], "#2b2f3a"); box(g, [0.7, 0.5, 0.5], [0, 0.08, 0], "#e0572a"); box(g, [0.3, 0.3, 0.02], [0.17, 0.2, 0.26], "#1d2128"); cyl(g, [0.05, 0.05, 0.04], [0.28, 0.45, 0.2], "#1d2128");
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, [0.03, 0.62, 0.03], [sx * 0.37, 0, sz * 0.26], STEEL); box(g, [0.78, 0.03, 0.03], [0, 0.62, 0.26], STEEL); box(g, [0.78, 0.03, 0.03], [0, 0.62, -0.26], STEEL);
    box(g, [0.12, 0.08, 0.02], [-0.2, 0.3, 0.26], glow("#2fbf71", 1.2)); cyl(g, [0.09, 0.09, 0.1], [-0.18, 0.58, 0], "#c0392b");
  },
  flower_pots: (g) => {
    for (const [x, c, k] of [[-0.2, "#c8553d", "#e8588a"], [0.2, "#6f8fb0", "#f2c230"]]) { cyl(g, [0.14, 0.1, 0.26], [x, 0, 0], c); ball(g, 0.17, [x, 0.38, 0], "#4a9867", {}, [1, 0.8, 1]); for (let j = 0; j < 4; j++) ball(g, 0.05, [x + (j - 1.5) * 0.07, 0.5 + (j % 2) * 0.04, (j % 2) * 0.06], k); }
  },
  wheelie_bin: (g) => {
    box(g, [0.5, 0.78, 0.55], [0, 0.06, 0], "#2f6b4f"); box(g, [0.54, 0.07, 0.6], [0, 0.84, 0], "#25543f"); box(g, [0.3, 0.04, 0.04], [0, 0.92, -0.2], "#1a1d22");
    for (const x of [-0.23, 0.23]) cyl(g, [0.07, 0.07, 0.05], [x, 0, -0.24], "#15171b");
  },
  post_light: (g) => {
    cyl(g, [0.12, 0.14, 0.06], [0, 0, 0], "#2b2f3a"); cyl(g, [0.03, 0.04, 1.35], [0, 0.06, 0], "#2b2f3a"); box(g, [0.2, 0.26, 0.2], [0, 1.4, 0], "#fbe3a0", { emissive: "#ffcc67", emissiveIntensity: 1.1 }); box(g, [0.26, 0.05, 0.26], [0, 1.66, 0], "#2b2f3a");
  },
  garden_statue: (g) => {
    box(g, [0.5, 0.22, 0.5], [0, 0, 0], "#a9a69c"); box(g, [0.34, 0.14, 0.34], [0, 0.22, 0], "#bdb9ad"); cyl(g, [0.1, 0.16, 0.5], [0, 0.36, 0], "#cfcbbf"); ball(g, 0.12, [0, 0.98, 0], "#d6d2c6"); box(g, [0.34, 0.06, 0.1], [0, 0.72, 0], "#cfcbbf");
  },
  // ---- the compound range (outdoor pieces) ----
  patio_chair: (g) => patioChair(g, 0, 0, 0, "#c9a36a", "#4f9d84"),
  patio_side_table: (g) => {
    cyl(g, [0.34, 0.34, 0.06], [0, 0.56, 0], "#a8794a"); cyl(g, [0.06, 0.09, 0.56], [0, 0, 0], "#7a5533"); cyl(g, [0.26, 0.28, 0.04], [0, 0, 0], "#7a5533");
    cyl(g, [0.07, 0.06, 0.1], [0.08, 0.62, 0.04], "#eee7da"); ball(g, 0.05, [-0.1, 0.68, -0.05], "#e25942");
  },
  patio_dining_set: (g) => {
    box(g, [1.7, 0.07, 0.95], [0, 0.72, 0], "#a8794a"); for (const [x, z] of [[-0.75, -0.38], [0.75, -0.38], [-0.75, 0.38], [0.75, 0.38]]) box(g, [0.07, 0.72, 0.07], [x, 0, z], "#7a5533");
    for (const x of [-0.45, 0.45]) { patioChair(g, x, -0.82, Math.PI, "#c9a36a", "#e8a23a"); patioChair(g, x, 0.82, 0, "#c9a36a", "#e8a23a"); }
    cyl(g, [0.03, 0.03, 2.05], [0, 0.04, 0], "#6e7378"); parasol(g, 0, 2.05, 1.2, ["#f4efe2", "#e8a23a"]);
  },
  outdoor_sofa: (g) => {
    box(g, [2.8, 0.14, 0.9], [0, 0.18, 0], "#8b5e3c"); for (const x of [-1.4, 1.4]) box(g, [0.14, 0.62, 0.9], [x, 0.18, 0], "#8b5e3c"); box(g, [2.8, 0.55, 0.12], [0, 0.18, -0.4], "#8b5e3c");
    for (const x of [-0.92, 0, 0.92]) { box(g, [0.88, 0.2, 0.68], [x, 0.32, 0.08], "#e9e2d2"); box(g, [0.86, 0.46, 0.2], [x, 0.5, -0.28], "#e9e2d2").rotation.x = -0.12; }
    for (const [x, c] of [[-1.05, "#4f9d84"], [1.05, "#e8a23a"]]) { const p = box(g, [0.36, 0.34, 0.12], [x, 0.56, -0.05], c); p.rotation.z = x * 0.12; }
    for (const [x, z] of [[-1.3, -0.38], [1.3, -0.38], [-1.3, 0.38], [1.3, 0.38]]) box(g, [0.07, 0.18, 0.07], [x, 0, z], "#5b3d27");
  },
  swing_bench: (g) => {
    for (const x of [-0.95, 0.95]) for (const z of [-0.4, 0.4]) { const l = box(g, [0.07, 2.3, 0.07], [x * 0.92, 0, z * 1.9], "#7a5533"); l.rotation.z = x * 0.07; }
    box(g, [2.1, 0.09, 0.1], [0, 2.24, 0], "#7a5533"); box(g, [2.3, 0.05, 1.2], [0, 2.3, 0], "#f4efe2"); for (const x of [-0.9, -0.45, 0, 0.45, 0.9]) box(g, [0.14, 0.052, 1.22], [x + 0.22, 2.3, 0], "#e8a23a");
    for (const x of [-0.75, 0.75]) cyl(g, [0.012, 0.012, 1.75], [x, 0.5, 0.05], "#6e7378");
    box(g, [1.7, 0.1, 0.66], [0, 0.46, 0.05], "#b07a4a"); box(g, [1.7, 0.6, 0.08], [0, 0.52, -0.26], "#b07a4a").rotation.x = -0.14; box(g, [1.5, 0.12, 0.54], [0, 0.56, 0.08], "#4f9d84");
  },
  picnic_table: (g) => {
    for (let i = 0; i < 4; i++) box(g, [2.7, 0.06, 0.22], [0, 0.74, -0.34 + i * 0.226], "#a8794a");
    for (const z of [-0.78, 0.78]) { box(g, [2.7, 0.06, 0.3], [0, 0.42, z], "#a8794a"); } for (const x of [-1.0, 1.0]) { box(g, [0.08, 0.76, 0.1], [x, 0, -0.5], "#7a5533").rotation.x = 0.2; box(g, [0.08, 0.76, 0.1], [x, 0, 0.5], "#7a5533").rotation.x = -0.2; box(g, [0.08, 0.06, 1.7], [x, 0.4, 0], "#7a5533"); }
  },
  sun_lounger: (g) => {
    box(g, [0.78, 0.07, 1.0], [0, 0.34, 0.45], "#d9d2c1"); box(g, [0.78, 0.07, 0.98], [0, 0.55, -0.45], "#d9d2c1").rotation.x = 0.52; box(g, [0.7, 0.1, 0.92], [0, 0.4, 0.45], "#f4efe2"); box(g, [0.7, 0.1, 0.9], [0.0, 0.6, -0.45], "#f4efe2").rotation.x = 0.52;
    for (const [x, z] of [[-0.34, 0.85], [0.34, 0.85], [-0.34, -0.05], [0.34, -0.05]]) box(g, [0.05, 0.34, 0.05], [x, 0, z], "#5b6168"); box(g, [0.5, 0.12, 0.22], [0, 0.64, -0.78], "#e8a23a").rotation.x = 0.52;
  },
  fire_pit: (g) => {
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; box(g, [0.26, 0.2, 0.2], [Math.cos(a) * 0.4, 0, Math.sin(a) * 0.4], i % 2 ? "#8f8c82" : "#a9a69c").rotation.y = -a; }
    cyl(g, [0.34, 0.34, 0.05], [0, 0.04, 0], "#2b2a28"); const f = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 8), glow("#ff8a2a", 1.8)); f.position.y = 0.32; g.add(f); const f2 = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.32, 8), glow("#ffd36b", 2)); f2.position.y = 0.3; g.add(f2);
    for (const [x, z] of [[0, -0.9], [0, 0.9], [-0.9, 0], [0.9, 0]]) { const l = cyl(g, [0.2, 0.2, 0.55], [x, 0.2, z], "#8b5e3c", {}, 12); l.rotation.z = Math.PI / 2; l.rotation.y = Math.atan2(x, z); l.position.y = 0.25; }
  },
  outdoor_rug: (g) => {
    box(g, [2.9, 0.03, 1.9], [0, 0, 0], "#2f6f74"); box(g, [2.7, 0.034, 1.7], [0, 0, 0], "#efe6cf"); box(g, [2.5, 0.038, 1.5], [0, 0, 0], "#2f6f74");
    for (let i = -3; i <= 3; i++) box(g, [0.14, 0.042, 1.5], [i * 0.34, 0, 0], i % 2 ? "#e8a23a" : "#efe6cf");
  },
  bird_bath: (g) => {
    cyl(g, [0.2, 0.26, 0.1], [0, 0, 0], "#bdb9ad"); cyl(g, [0.09, 0.13, 0.62], [0, 0.1, 0], "#d1cdc0"); cyl(g, [0.38, 0.14, 0.16], [0, 0.72, 0], "#c9c5b8");
    cyl(g, [0.32, 0.32, 0.02], [0, 0.86, 0], "#8fc4d6", { transparent: true, opacity: 0.8 }); ball(g, 0.06, [0.1, 0.94, 0.04], "#c0522b"); ball(g, 0.04, [0.15, 0.97, 0.04], "#c0522b"); box(g, [0.05, 0.02, 0.025], [0.2, 0.96, 0.04], "#e8a23a");
  },
  topiary_pair: (g) => {
    for (const x of [-0.24, 0.24]) { cyl(g, [0.16, 0.12, 0.3], [x, 0, 0], "#efe6cf"); cyl(g, [0.02, 0.02, 0.28], [x, 0.3, 0], "#6e4a2c"); ball(g, 0.23, [x, 0.78, 0], "#3f7a45"); ball(g, 0.14, [x, 1.1, 0], "#4f8a52"); }
  },
  bbq_grill: (g) => {
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat("#2b2f3a", { metalness: 0.3 })); bowl.rotation.x = Math.PI; bowl.position.y = 0.95; bowl.castShadow = true; g.add(bowl);
    for (const [x, z] of [[-0.25, -0.2], [0.25, -0.2], [0, 0.28]]) { const l = box(g, [0.04, 0.78, 0.04], [x, 0, z], "#2b2f3a"); l.rotation.z = x * 0.2; }
    cyl(g, [0.34, 0.34, 0.02], [0, 0.92, 0], "#b8c0c8", { metalness: 0.6 }, 20); box(g, [0.5, 0.04, 0.3], [0, 0.4, 0], "#2b2f3a"); box(g, [0.5, 0.05, 0.05], [0, 0.88, 0.38], "#a8794a"); ball(g, 0.05, [0.12, 0.96, 0.05], "#e0572a");
  },
  garden_gazebo: (g) => {
    box(g, [2.9, 0.1, 2.9], [0, 0, 0], "#a8794a"); for (let i = 0; i < 7; i++) box(g, [2.9, 0.012, 0.02], [0, 0.1, -1.2 + i * 0.4], "#7a5533");
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) box(g, [0.14, 2.4, 0.14], [x, 0.1, z], "#f4efe2");
    box(g, [2.9, 0.12, 0.12], [0, 2.46, -1.3], "#f4efe2"); box(g, [2.9, 0.12, 0.12], [0, 2.46, 1.3], "#f4efe2"); box(g, [0.12, 0.12, 2.9], [-1.3, 2.46, 0], "#f4efe2"); box(g, [0.12, 0.12, 2.9], [1.3, 2.46, 0], "#f4efe2");
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 0.95, 4), mat("#7a4b32")); roof.rotation.y = Math.PI / 4; roof.position.y = 3.05; roof.castShadow = true; g.add(roof); ball(g, 0.1, [0, 3.58, 0], "#c9a45a");
    for (const [x, z, w, d] of [[0, -1.18, 2.3, 0.4], [-1.18, 0, 0.4, 2.3], [1.18, 0, 0.4, 2.3]]) { box(g, [w, 0.08, d], [x, 0.5, z], "#8b5e3c"); box(g, [w > d ? w : 0.08, 0.5, w > d ? 0.08 : d], [x + (w > d ? 0 : x > 0 ? 0.16 : -0.16), 0.56, z + (w > d ? -0.16 : 0)], "#8b5e3c"); }
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glow("#ffd98a", 1.2)); l.position.set(0, 2.2, 0); g.add(l);
  },
  dining_set: (g) => {
    box(g, [1.3, 0.06, 0.86], [0, 0.72, 0], WOOD_L);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, [0.07, 0.72, 0.07], [sx * 0.6, 0, sz * 0.38], WOOD_D);
    for (const [cx, cz, face] of [[-0.35, 0.68, 0], [0.35, 0.68, 0], [-0.35, -0.68, Math.PI], [0.35, -0.68, Math.PI]]) {
      const c = new THREE.Group(); c.position.set(cx, 0, cz); c.rotation.y = face; g.add(c); // each chair looks at the table
      box(c, [0.42, 0.05, 0.4], [0, 0.44, 0], "#3a3f4b"); box(c, [0.42, 0.45, 0.05], [0, 0.46, 0.19], "#3a3f4b");
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(c, [0.04, 0.44, 0.04], [sx * 0.17, 0, sz * 0.16], DARK);
    }
    cyl(g, [0.08, 0.06, 0.12], [0, 0.78, 0], "#c97b4a"); ball(g, 0.11, [0, 1.0, 0], "#3e9b6b", {}, [1, 1.2, 1]);
    box(g, [0.3, 0.01, 0.22], [-0.38, 0.78, 0.1], "#f8f4ea"); // a place mat
  },
  inverter: (g) => {
    box(g, [0.58, 0.28, 0.4], [0, 0, 0], "#1d2128"); box(g, [0.3, 0.2, 0.34], [-0.12, 0.28, 0], "#2b3140"); box(g, [0.5, 0.52, 0.36], [0, 0.28, 0], WHITE, { roughness: 0.4 });
    box(g, [0.36, 0.1, 0.01], [0, 0.62, 0.185], "#0a1f14"); box(g, [0.05, 0.05, 0.01], [-0.12, 0.45, 0.185], glow("#2fbf71", 1.6)); box(g, [0.05, 0.05, 0.01], [0, 0.45, 0.185], glow("#ffd166", 1.2)); box(g, [0.05, 0.05, 0.01], [0.12, 0.45, 0.185], "#2a2f38");
  },
  ac: (g) => {
    box(g, [0.5, 1.7, 0.4], [0, 0, 0], "#f4f6f8", { roughness: 0.4 }); for (let i = 0; i < 6; i++) box(g, [0.4, 0.015, 0.02], [0, 0.95 + i * 0.05, 0.205], "#9aa7b6");
    box(g, [0.18, 0.07, 0.01], [0, 1.45, 0.205], glow("#4aa8ff", 1.3)); box(g, [0.34, 0.5, 0.02], [0, 0.35, 0.205], "#e5e9ee");
    cyl(g, [0.02, 0.02, 0.5], [0.2, 1.7, -0.1], STEEL);
  },
  ...Object.fromEntries([
    "kitchen_island", "bar_stool", "pantry_cabinet", "quartz_counter", "french_fridge", "microwave_solo", "built_in_oven", "electric_kettle", "blender", "dish_rack", "fruit_bowl", "round_dining_set",
    "bathtub", "shower_enclosure", "bathroom_vanity", "towel_rail", "soap_set", "toilet_roll_holder", "laundry_basket", "bath_mirror",
    "pendant_cluster", "led_strip", "recessed_spotlight", "wall_sconce", "table_lamp", "neon_sign", "smart_ambient_light",
    "wallpaper_roll", "fluted_wall_panel", "terrazzo_finish", "herringbone_floor", "marble_floor", "acoustic_wall", "photo_collage", "floating_shelf", "decorative_mirror",
    "gaming_station", "racing_chair", "ultrawide_monitor", "soundbar", "projector", "record_player",
    "balcony_set", "garden_bench", "planter_trio", "garden_fountain", "hammock", "garden_lights",
    "aquarium", "sculpture", "indoor_waterfall", "display_cabinet", "shoe_rack", "coat_stand", "storage_boxes", "washing_machine", "ironing_board", "book_stack", "decorative_tray"
  ].map((key) => [key, (g) => catalogPiece(g, key)])),
};

/** Exposed for the catalogue test: every item the shop can sell needs a real model, not the generic placeholder. */
export const FURNITURE_MODEL_KEYS = Object.freeze(Object.keys(BUILD));

/** A fresh model of the item: { group, w, d } where the group is centred on its footprint and `group.userData.spin` (if any) is a part that should spin. */
export function buildFurniture(key) {
  const def = ITEMS[key], g = new THREE.Group(); g.name = key;
  if (!def || !BUILD[key]) throw new Error(`Missing furniture model: ${key}`);
  BUILD[key](g);
  g.userData.key = key;
  g.traverse((o) => { if (o.isMesh && !o.material.map) o.material.flatShading = false; });
  return g;
}

/** Gives a whole piece a soft glow (selected), or takes it away. Remembers each material's own emissive. */
export function setGlow(group, on, color = "#3fd08a", k = 0.38) {
  group.traverse((o) => { if (!o.isMesh) return; for (const m of [].concat(o.material)) { if (!m.emissive) continue; m.userData.e ??= { c: m.emissive.clone(), i: m.emissiveIntensity };
    if (on) { m.emissive.set(color); m.emissiveIntensity = k; } else { m.emissive.copy(m.userData.e.c); m.emissiveIntensity = m.userData.e.i; } } });
}
