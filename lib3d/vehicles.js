// lib3d/vehicles.js
// Low-poly vehicles for the trips: a keke (three-wheeler), a bus (danfo style), a car, and the shared pieces the traffic uses.
// Everything is drawn in metres, nose towards +z, wheels touching y = 0. The trip scales the whole world to scene units.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const mats = new Map();
/** One shared material per colour: vehicles are plain and there can be dozens of them. */
const mat = (hex, o = {}) => { const k = hex + JSON.stringify(o); if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, metalness: 0.15, ...o })); return mats.get(k); };

/** A box as geometry with a colour baked in, so many boxes can be merged into one mesh. (w across, h tall, l long, centred at x, y, z.) */
export function box(w, h, l, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, l); if (rx) g.rotateX(rx); g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g;
}
const wheelGeo = (r, w) => { const g = new THREE.CylinderGeometry(r, r, w, 14); g.rotateZ(Math.PI / 2); return g; };
const merged = (parts) => { const g = mergeGeometries(parts.map((p) => p.index ? p.toNonIndexed() : p)); parts.forEach((p) => p.dispose()); return g; };
const bodyMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
const tyreMat = mat("#16181c", { roughness: 0.9, metalness: 0 }), glassOf = "#27374a", chromeOf = "#c9ced6";

/** Wheels that can spin: returns the meshes so the caller can turn them (rotation.x). */
function wheels(root, list, r, w) { const g = wheelGeo(r, w), out = []; for (const [x, z] of list) { const m = new THREE.Mesh(g, tyreMat); m.position.set(x, r, z); m.castShadow = true; root.add(m); out.push(m); } return out; }

/** A sedan or SUV body (paint colour + dark glass + lights) as one merged geometry. Also used, instanced, for the traffic. */
export function carBodyGeometry(paint = "#c0392b", suv = false) {
  const L = suv ? 4.7 : 4.5, W = 1.85, h0 = suv ? 0.5 : 0.42, bh = suv ? 0.78 : 0.62, ch = suv ? 0.72 : 0.55, cl = suv ? 2.9 : 2.3;
  const p = [
    box(W, bh, L, 0, h0 + bh / 2, 0, paint),                                           // lower body
    box(W - 0.2, ch, cl, 0, h0 + bh + ch / 2, suv ? -0.25 : -0.3, paint),              // cabin
    box(W - 0.16, ch - 0.14, cl + 0.02, 0, h0 + bh + ch / 2 + 0.01, suv ? -0.25 : -0.3, glassOf), // glass band (slightly proud of the cabin sides)
    box(W - 0.12, 0.06, cl - 0.5, 0, h0 + bh + ch + 0.02, suv ? -0.25 : -0.3, paint),  // roof
    box(0.5, 0.18, 0.06, 0, h0 + 0.22, L / 2 + 0.01, chromeOf),                       // grille
    box(0.38, 0.16, 0.08, -0.62, h0 + 0.5, L / 2 - 0.02, "#fff5c8"), box(0.38, 0.16, 0.08, 0.62, h0 + 0.5, L / 2 - 0.02, "#fff5c8"), // headlights
    box(0.36, 0.14, 0.08, -0.65, h0 + 0.5, -L / 2 + 0.02, "#c4161c"), box(0.36, 0.14, 0.08, 0.65, h0 + 0.5, -L / 2 + 0.02, "#c4161c"), // tail lights
    box(W + 0.04, 0.12, 0.16, 0, h0 + 0.1, L / 2 - 0.1, "#202328"), box(W + 0.04, 0.12, 0.16, 0, h0 + 0.1, -L / 2 + 0.1, "#202328"), // bumpers
  ];
  return merged(p);
}
export const CAR_WHEELS = [[-0.88, 1.4], [0.88, 1.4], [-0.88, -1.4], [0.88, -1.4]];
export const CAR_WHEEL_R = 0.34;
export const CAR_COLORS = ["#c0392b", "#2c5aa0", "#e8e8e8", "#1f1f23", "#4a4f57", "#d9a441", "#2e7d5b", "#7b3f2a", "#b9bec7", "#8e2d6b"];

/** The player's own car: dark, a little grander than the traffic. Returns { root, wheels (spinnable), front (steerable pair), length, width }. */
export function makeCar(paint = "#1c1d21") {
  const root = new THREE.Group(), body = new THREE.Mesh(carBodyGeometry(paint, false), bodyMat()); body.castShadow = true; body.receiveShadow = true; root.add(body);
  const ws = wheels(root, CAR_WHEELS, CAR_WHEEL_R, 0.26);
  return { root, wheels: ws, front: [ws[0], ws[1]], length: 4.5, width: 1.85, height: 1.5, door: { side: 1, z: 0.35 }, seatZ: 0 };
}

/** A keke napep: yellow three-wheeler with a black canopy, open at the sides. */
export function makeKeke() {
  const root = new THREE.Group(), Y = "#f2c21b", K = "#17181b", p = [
    box(1.2, 0.55, 1.6, 0, 0.62, -0.25, Y),                       // body shell behind the driver
    box(1.1, 0.12, 1.0, 0, 0.98, -0.5, "#3a2f2a"),               // passenger bench
    box(1.1, 0.5, 0.1, 0, 1.2, -0.98, "#3a2f2a"),                // bench back
    box(0.9, 0.5, 0.7, 0, 0.55, 0.9, Y),                          // front cowl
    box(0.7, 0.55, 0.06, 0, 1.2, 1.0, glassOf, -0.35),           // windscreen
    box(1.4, 0.08, 2.15, 0, 1.95, -0.15, K),                      // canopy
    box(0.07, 1.0, 0.07, -0.65, 1.45, 0.78, K), box(0.07, 1.0, 0.07, 0.65, 1.45, 0.78, K), box(0.07, 1.0, 0.07, -0.65, 1.45, -1.05, K), box(0.07, 1.0, 0.07, 0.65, 1.45, -1.05, K), // pillars
    box(0.3, 0.14, 0.1, 0, 0.62, 1.37, "#fff5c8"),               // headlight
    box(1.25, 0.1, 0.06, 0, 0.9, -1.06, K),                       // black stripe at the back
    box(0.6, 0.06, 0.06, 0, 1.12, 0.78, K),                       // handlebar
    box(0.3, 0.45, 0.25, 0, 0.98, 0.3, "#556a8a"),               // the driver's back
    box(0.16, 0.16, 0.16, 0, 1.35, 0.3, "#6b4a35"),              // and head
  ], body = new THREE.Mesh(merged(p), bodyMat()); body.castShadow = true; body.receiveShadow = true; root.add(body);
  const ws = wheels(root, [[-0.62, -0.7], [0.62, -0.7], [0, 1.15]], 0.27, 0.16);
  return { root, wheels: ws, front: [ws[2]], length: 2.8, width: 1.4, height: 2, door: { side: 1, z: -0.1 }, seatZ: -0.4, open: true };
}

/** A danfo-style minibus: yellow with a black stripe, a row of windows, and a door on the right. */
export function makeBus() {
  const root = new THREE.Group(), Y = "#f0b81c", K = "#17181b", L = 6.4, W = 2.1, H = 2.0, p = [
    box(W, H, L, 0, 0.55 + H / 2, 0, Y),
    box(W + 0.02, 0.35, L + 0.02, 0, 1.1, 0, K),                                         // the black stripe
    box(W + 0.03, 0.62, L - 1.5, 0, 1.95, -0.3, glassOf),                                // the windows
    box(W - 0.1, 0.08, L - 0.1, 0, 0.55 + H + 0.04, 0, "#e6e6e2"),                      // roof
    box(W - 0.3, 0.7, 0.06, 0, 1.95, L / 2 + 0.02, glassOf),                            // windscreen
    box(0.5, 0.2, 0.08, -0.7, 0.9, L / 2 + 0.02, "#fff5c8"), box(0.5, 0.2, 0.08, 0.7, 0.9, L / 2 + 0.02, "#fff5c8"),
    box(0.45, 0.2, 0.08, -0.75, 0.95, -L / 2 - 0.02, "#c4161c"), box(0.45, 0.2, 0.08, 0.75, 0.95, -L / 2 - 0.02, "#c4161c"),
    box(W + 0.08, 0.2, 0.25, 0, 0.5, L / 2 - 0.05, "#202328"), box(W + 0.08, 0.2, 0.25, 0, 0.5, -L / 2 + 0.05, "#202328"),
    box(0.04, 1.5, 1.0, W / 2 + 0.01, 1.35, 1.3, "#222a33"),                              // the door
  ], body = new THREE.Mesh(merged(p), bodyMat()); body.castShadow = true; body.receiveShadow = true; root.add(body);
  const ws = wheels(root, [[-0.95, 2.0], [0.95, 2.0], [-0.95, -1.9], [0.95, -1.9]], 0.5, 0.32);
  return { root, wheels: ws, front: [ws[0], ws[1]], length: L, width: W, height: 2.6, door: { side: 1, z: 1.3 }, seatZ: 0 };
}

/** Spin a vehicle's wheels for the distance it just moved, and turn the front ones (radians) for steering. */
export function rollWheels(v, metres, steer = 0) {
  for (const w of v.wheels) w.rotation.x += metres / (w.geometry.parameters.radiusTop || 0.3);
  for (const f of v.front ?? []) f.rotation.y = steer;
}