// lib3d/vehicleKit.js
// The building blocks of the vehicle models in lib3d/vehicles.js. Pure three.js, no DOM needed (text decals are skipped when there is no canvas, so the models also build headless in the tests).
// Metres, nose towards +z, y up, wheels touching y = 0; a vehicle's own +x is its LEFT.
//
// A body is made the way a clay model is: a SIDE PROFILE (z, y) is extruded across the width with rounded edges (`slab`), then bent into shape by a `warp` function
// (the nose and tail round off in plan, the sides lean in towards the roof, the sills tuck under). Anything that sits on the surface (lamps, grilles, door lines, mirrors)
// is built in the same unbent space and bent by the SAME warp, so it follows the curve instead of floating off it.
// Parts are collected into named buckets (paint, trim, glass, chrome, lamps, ...) and each bucket becomes one mesh with one shared material, so a car is about ten draw calls.
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

export const cl = (v, a, b) => Math.max(a, Math.min(b, v));
export const sstep = (a, b, v) => { const t = cl((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const V2 = (p) => new THREE.Vector2(p[0], p[1]);

// ---------------------------------------------------------------- materials (shared by every vehicle; only the lamps are per vehicle, so they can light up)
const shared = new Map();
const once = (k, make) => { let m = shared.get(k); if (!m) { m = make(); shared.set(k, m); } return m; };
/** A plain colour, shared by colour + options. */
export const flat = (hex, o = {}) => once("flat" + hex + JSON.stringify(o), () => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.6, metalness: 0.1, ...o }));
export const MATS = {
  paint: () => once("paint", () => new THREE.MeshPhysicalMaterial({ vertexColors: true, color: 0xffffff, roughness: 0.4, metalness: 0.18, clearcoat: 0.6, clearcoatRoughness: 0.12 })),
  trim: () => flat("#17191c", { roughness: 0.78, metalness: 0.04 }),
  glass: () => once("glass", () => new THREE.MeshPhysicalMaterial({ color: "#222f3d", roughness: 0.05, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.03 })),
  chrome: () => flat("#eceff3", { roughness: 0.22, metalness: 0.12 }),
  tyre: () => flat("#111214", { roughness: 0.94, metalness: 0 }),
  alloy: () => flat("#c6ccd4", { roughness: 0.38, metalness: 0.1 }),
  dark: () => flat("#0c0d0f", { roughness: 0.85, metalness: 0.05 }),
  disc: () => flat("#6c7078", { roughness: 0.5, metalness: 0.4 }),
  seat: () => flat("#2b2622", { roughness: 0.9, metalness: 0 }),
  plate: () => flat("#f1efe6", { roughness: 0.6, metalness: 0 }),
};
/** The same material drawn on both faces (door skins swing open, so you see their inside too). */
export const dbl = (m) => once("dbl" + m.uuid, () => { const c = m.clone(); c.side = THREE.DoubleSide; return c; });
/** Lamps are per vehicle: the head lamps glow a little, the tail lamps glow harder under the brake. */
export function lampMaterials() {
  return {
    head: new THREE.MeshStandardMaterial({ color: "#f6f4ea", emissive: "#fff3c4", emissiveIntensity: 0.18, roughness: 0.1, metalness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: "#7d1016", emissive: "#ff1f2b", emissiveIntensity: 0.28, roughness: 0.2, metalness: 0.1 }),
    amber: new THREE.MeshStandardMaterial({ color: "#c47a1c", emissive: "#ff9a1f", emissiveIntensity: 0.12, roughness: 0.3 }),
  };
}

// ---------------------------------------------------------------- geometry plumbing
/** Positions + normals only (and a baked colour when asked): every geometry that is merged must have the same attributes. */
export function finish(g, color) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (color != null) { const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute("color", new THREE.BufferAttribute(a, 3)); }
  return g;
}
const nonIndexed = (g) => (g.index ? g.toNonIndexed() : g);
/** Smooth shading across soft edges, crisp across hard ones (`angle` radians). */
export function smooth(g, angle = 0.85) { const src = nonIndexed(g); src.deleteAttribute("normal"); const out = toCreasedNormals(src, angle); return out; }
/** Applies F(x, y, z) -> [x, y, z] to every vertex. */
export function warp(g, F) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const r = F(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, r[0], r[1], r[2]); } p.needsUpdate = true; return g; }
export function flipWinding(g) {
  const g2 = nonIndexed(g), p = g2.attributes.position, n = g2.attributes.normal;
  for (let i = 0; i < p.count; i += 3) for (const a of [p, n]) if (a) { const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1); a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2)); a.setXYZ(i + 2, x, y, z); }
  return g2;
}

/** A group of named buckets of geometry; `meshes()` merges each bucket into one mesh. */
export class Parts {
  constructor() { this.b = new Map(); }
  add(name, ...gs) { for (const g of gs) if (g) { let a = this.b.get(name); if (!a) this.b.set(name, (a = [])); a.push(g); } return this; }
  /** One merged, vertex-coloured geometry for the whole thing (the cheap instanced traffic cars). colours: bucket -> hex. */
  colored(colors) { const list = []; for (const [k, gs] of this.b) for (const g of gs) list.push(finish(g.clone(), colors[k] ?? "#888888")); return list.length ? mergeGeometries(list) : null; }
  /** Meshes per bucket. `paint` hex colours the paint bucket (vertex colours); `mat(name)` gives the material of any other bucket. */
  meshes(paintHex, mat) {
    const out = [];
    for (const [k, gs] of this.b) {
      const geo = mergeGeometries(gs.map((g) => finish(g.clone(), k === "paint" ? paintHex : undefined))); if (!geo) continue;
      if (k === "paint") shadeByHeight(geo);
      const m = new THREE.Mesh(geo, mat(k)); m.name = k; m.castShadow = k !== "glass" || true; m.receiveShadow = k === "paint"; out.push(m);
    }
    return out;
  }
  translate(x, y, z) { for (const gs of this.b.values()) gs.forEach((g) => g.translate(x, y, z)); return this; }
  dispose() { for (const gs of this.b.values()) gs.forEach((g) => g.dispose()); this.b.clear(); }
}
/** Bakes a little ambient shade into the vertex colours: the lower body is darker (it reflects the road and sits in the wheel arches), the top a touch lighter. */
export function shadeByHeight(g) {
  const p = g.attributes.position, c = g.attributes.color; if (!c) return g;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), f = 0.74 + 0.26 * sstep(0.18, 0.75, y) + 0.04 * sstep(1.0, 1.5, y); c.setXYZ(i, c.getX(i) * f, c.getY(i) * f, c.getZ(i) * f); }
  c.needsUpdate = true; return g;
}
/** Sorts the triangles of a geometry into buckets: pick(cx, cy, cz, nx, ny, nz) -> bucket name. */
export function splitInto(parts, g, pick) {
  const src = nonIndexed(g), p = src.attributes.position, n = src.attributes.normal, groups = new Map();
  for (let i = 0; i < p.count; i += 3) {
    const cx = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, cz = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3;
    const nx = n.getX(i) + n.getX(i + 1) + n.getX(i + 2), ny = n.getY(i) + n.getY(i + 1) + n.getY(i + 2), nz = n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2), l = Math.hypot(nx, ny, nz) || 1;
    const k = pick(cx, cy, cz, nx / l, ny / l, nz / l); let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(i);
  }
  for (const [k, idx] of groups) {
    const pos = new Float32Array(idx.length * 9), nor = new Float32Array(idx.length * 9); let o = 0;
    for (const i of idx) for (let j = 0; j < 3; j++) { pos[o] = p.getX(i + j); pos[o + 1] = p.getY(i + j); pos[o + 2] = p.getZ(i + j); nor[o] = n.getX(i + j); nor[o + 1] = n.getY(i + j); nor[o + 2] = n.getZ(i + j); o += 3; }
    const sub = new THREE.BufferGeometry(); sub.setAttribute("position", new THREE.BufferAttribute(pos, 3)); sub.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); parts.add(k, sub);
  }
  src.dispose?.(); if (src !== g) g.dispose();
}

// ---------------------------------------------------------------- bodies
/**
 * A solid from a side profile: pts = [[z, y], ...] (a closed outline), extruded sideways to a total width of 2 * hw, every edge rounded by `bevel`.
 * Returned UNBENT (a plain slab); bend it with warp(). Normals are not set: call smooth() after warping.
 */
export function slab(pts, hw, bevel = 0.05, segs = 2) {
  const sh = new THREE.Shape(pts.map(V2)), b = Math.min(bevel, hw * 0.45), depth = Math.max(0.01, 2 * hw - 2 * b);
  const g = new THREE.ExtrudeGeometry(sh, { depth, steps: 1, bevelEnabled: b > 0.001, bevelThickness: b, bevelSize: b, bevelOffset: -b, bevelSegments: segs, curveSegments: 4 });
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const sx = p.getX(i), sy = p.getY(i), sz = p.getZ(i); p.setXYZ(i, -(sz - depth / 2), sy, sx); }   // shape x -> car z, extrusion -> car x (a proper rotation, so faces stay outward)
  p.needsUpdate = true; g.deleteAttribute("uv"); g.deleteAttribute("normal"); return g;
}
/** z of the outline at height y: the front-most ('max') or rear-most ('min') crossing. */
export function zAt(pts, y, mode = "max") {
  let best = null;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[1] - y) * (b[1] - y) > 0 || a[1] === b[1]) continue; const t = (y - a[1]) / (b[1] - a[1]), z = a[0] + t * (b[0] - a[0]); if (best == null || (mode === "max" ? z > best : z < best)) best = z; }
  return best;
}
/** y of the outline at position z: the top-most ('max') or lowest ('min') crossing. */
export function yAt(pts, z, mode = "max") {
  let best = null;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; if ((a[0] - z) * (b[0] - z) > 0 || a[0] === b[0]) continue; const t = (z - a[0]) / (b[0] - a[0]), y = a[1] + t * (b[1] - a[1]); if (best == null || (mode === "max" ? y > best : y < best)) best = y; }
  return best;
}
/** The outline of a car's lower body from its upper edge (rear to front, starting and ending on the underside): adds the flat underside and a round wheel arch over each axle. */
export function bodyOutline(upper, { yb, axles, wr, gap = 0.06, n = 12 }) {
  const pts = [...upper], R = wr + gap;   // `upper` starts and ends on the underside (y = yb)
  for (const zw of [...axles].sort((a, b) => b - a)) {
    const s = cl((yb - wr) / R, -1, 1), phi0 = Math.asin(s);
    for (let i = 0; i <= n; i++) { const phi = phi0 + ((Math.PI - 2 * phi0) * i) / n; pts.push([zw + R * Math.cos(phi), wr + R * Math.sin(phi)]); }
  }
  return pts;
}
/** The dark inside of a wheel well, a half disc the width of the gap between the tyres. Returns an unbent slab. */
export function wellFill(zw, wr, yb, gap, hw) {
  const R = wr + gap, pts = [], s = cl((yb - wr) / R, -1, 1), phi0 = Math.asin(s), n = 12;
  for (let i = 0; i <= n; i++) { const phi = phi0 + ((Math.PI - 2 * phi0) * i) / n; pts.push([zw + R * Math.cos(phi), wr + R * Math.sin(phi)]); }
  return slab(pts, hw, 0, 1);
}

/** A box built in unbent space and warped (segmented, so it can follow a curve). */
export function surfBox(w, h, d, cx, cy, cz, F, seg = [1, 3, 1]) {
  const g = new THREE.BoxGeometry(w, h, d, seg[0], seg[1], seg[2]); g.translate(cx, cy, cz); if (F) warp(g, F); return g;
}
/** A flat lump from a polygon seen from the front (x, y), pushed out of a face of the body: `pts` is the side outline (to find the face), `side` +1 front / -1 back. */
export function faceDecal(poly, { pts, depth = 0.05, inset = 0.02, side = 1, F = null, bevel = 0 }) {
  const sh = new THREE.Shape(poly.map(V2)), g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 }), p = g.attributes.position, mode = side > 0 ? "max" : "min";
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), s = p.getZ(i), zf = zAt(pts, y, mode) ?? 0; p.setXYZ(i, x, y, zf + side * (s - inset)); }
  p.needsUpdate = true; g.deleteAttribute("uv"); g.deleteAttribute("normal"); const out = side < 0 ? flipWinding(g) : g; if (out !== g) g.dispose(); if (F) warp(out, F); return smooth(out, 0.6);
}
/** A flat lump from a polygon seen from the SIDE (z, y), laid on the car's side at |x| = xOf(z, y) (+ lift), for door lines, glass, vents. side +1 left, -1 right. */
export function sidePatch(poly, { xOf, lift = 0.004, thick = 0.012, side = 1 }) {
  const sh = new THREE.Shape(poly.map(V2)), g = new THREE.ShapeGeometry(sh, 4), p = g.attributes.position, idx = g.index, pos = [], nor = [];
  const at = (z, y, o) => [side * (xOf(z, y) + lift + o), y, z];
  for (let i = 0; i < idx.count; i += 3) {
    const t = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)].map((k) => [p.getX(k), p.getY(k)]);
    const a = at(t[0][0], t[0][1], thick), b = at(t[1][0], t[1][1], thick), c = at(t[2][0], t[2][1], thick); const tri = side > 0 ? [a, b, c] : [a, c, b];
    // the winding of ShapeGeometry faces +z; after the turn to the side it faces away from the car on one side only, so fix it per side
    const e1 = new THREE.Vector3(tri[1][0] - tri[0][0], tri[1][1] - tri[0][1], tri[1][2] - tri[0][2]), e2 = new THREE.Vector3(tri[2][0] - tri[0][0], tri[2][1] - tri[0][1], tri[2][2] - tri[0][2]), nrm = e1.cross(e2).normalize();
    const out = nrm.x * side >= 0 ? tri : [tri[0], tri[2], tri[1]], nn = out === tri ? nrm : nrm.clone().negate();
    for (const v of out) { pos.push(...v); nor.push(nn.x, nn.y, nn.z); }
  }
  const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g2.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); g.dispose(); return g2;
}
/** A quad (or triangle) from four 3D points, both faces, for windscreens: wound so its normal points along `out`. */
export function quad(p0, p1, p2, p3, out) {
  const a = p0.map((v) => v), pts = [p0, p1, p2, p3], pos = [], nor = [], e1 = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]), e2 = new THREE.Vector3(p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]), n = e1.cross(e2).normalize();
  const flip = n.dot(new THREE.Vector3(...out)) < 0, order = flip ? [[0, 2, 1], [0, 3, 2]] : [[0, 1, 2], [0, 2, 3]], nn = flip ? n.clone().negate() : n; void a;
  for (const t of order) for (const i of t) { pos.push(...pts[i]); nor.push(nn.x, nn.y, nn.z); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); return g;
}
/** A thin bar between two points (pillars, rails, wipers). */
export function strut(a, b, t = 0.04, t2 = t) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length(), g = new THREE.BoxGeometry(t, t2, len);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(0, 1, 0)); m.setPosition((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); g.applyMatrix4(m); return g;
}
/** A rounded box (door mirror housings, lamp lumps), centred. */
export function pill(w, h, d, r = 0.02) {
  const sh = new THREE.Shape(), x = w / 2, y = h / 2, k = Math.min(r, x, y);
  sh.moveTo(-x + k, -y); sh.lineTo(x - k, -y); sh.quadraticCurveTo(x, -y, x, -y + k); sh.lineTo(x, y - k); sh.quadraticCurveTo(x, y, x - k, y); sh.lineTo(-x + k, y); sh.quadraticCurveTo(-x, y, -x, y - k); sh.lineTo(-x, -y + k); sh.quadraticCurveTo(-x, -y, -x + k, -y);
  const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: Math.min(r, d / 3), bevelSize: Math.min(r, d / 3), bevelSegments: 1, curveSegments: 3 }); g.translate(0, 0, -d / 2); g.deleteAttribute("uv"); return smooth(g, 0.7);
}
export const box = (w, h, d, cx = 0, cy = 0, cz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(cx, cy, cz); return g; };

// ---------------------------------------------------------------- wheels
/** The rubber: a rounded tyre profile turned about the x axis. */
export function tyreGeo(r, w, seg = 28) {
  const pr = [[0.58, -0.5], [0.72, -0.5], [0.88, -0.475], [0.972, -0.36], [1, -0.2], [1, 0.2], [0.972, 0.36], [0.88, 0.475], [0.72, 0.5], [0.58, 0.5]];
  const g = new THREE.LatheGeometry(pr.map(([a, b]) => new THREE.Vector2(r * a, w * b)), seg); g.rotateZ(Math.PI / 2); return finish(g);
}
/**
 * The wheel face and what is behind it. `side` +1 when the outside faces +x (the left wheels), -1 for the right ones.
 * style: "spoke5" | "spoke10" | "star" | "steel" | "aero" | "disc". Returns { alloy, dark, accent } geometries (accent is the brake caliper).
 */
export function rimGeo(r, w, { style = "spoke5", side = 1, caliper = false, seg = 24 } = {}) {
  const alloy = [], dark = [], rr = r * 0.66, x0 = side * (w / 2 - 0.045);
  const cyl = (rad, len, x, rad2 = rad, open = false) => { const g = new THREE.CylinderGeometry(rad, rad2, len, seg, 1, open); g.rotateZ(Math.PI / 2); g.translate(x, 0, 0); return g; };
  dark.push(cyl(rr * 0.97, w * 0.7, -side * w * 0.05, rr * 0.97, true), cyl(rr * 0.96, 0.02, -side * w * 0.2));   // the barrel, and the dark behind the spokes
  const spokes = (n, width, thick, inner, outer, twist = 0) => { for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + twist, g = new THREE.BoxGeometry(thick, outer - inner, width); g.translate(0, (outer + inner) / 2, 0); g.rotateX(a); g.translate(x0, 0, 0); alloy.push(g); } };
  const ring = (ro, ri, x, th = 0.03) => { const sh = new THREE.Shape(); sh.absarc(0, 0, ro, 0, Math.PI * 2, false); const h = new THREE.Path(); h.absarc(0, 0, ri, 0, Math.PI * 2, true); sh.holes.push(h); const g = new THREE.ExtrudeGeometry(sh, { depth: th, bevelEnabled: false, curveSegments: seg }); g.rotateY(Math.PI / 2); g.translate(x - th / 2, 0, 0); return g; };
  if (style === "spoke5") { alloy.push(ring(rr, rr * 0.93, x0, 0.04)); spokes(5, 0.07 * r / 0.33, 0.035, rr * 0.18, rr * 0.95); alloy.push(cyl(rr * 0.2, 0.05, x0)); }
  else if (style === "spoke10") { alloy.push(ring(rr, rr * 0.94, x0, 0.04)); spokes(10, 0.045 * r / 0.33, 0.03, rr * 0.2, rr * 0.95, 0.15); alloy.push(cyl(rr * 0.2, 0.05, x0)); }
  else if (style === "star") { alloy.push(ring(rr, rr * 0.9, x0, 0.045)); spokes(5, 0.05 * r / 0.33, 0.04, rr * 0.16, rr * 0.92, 0.1); spokes(5, 0.05 * r / 0.33, 0.04, rr * 0.16, rr * 0.92, 0.1 + Math.PI / 5); alloy.push(cyl(rr * 0.2, 0.06, x0)); }
  else if (style === "steel") { alloy.push(cyl(rr * 0.98, 0.04, x0 - side * 0.01)); alloy.push(cyl(rr * 0.36, 0.07, x0 + side * 0.02, rr * 0.3)); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2, g = cyl(rr * 0.11, 0.06, x0 + side * 0.012); g.translate(0, Math.sin(a) * rr * 0.62, Math.cos(a) * rr * 0.62); dark.push(g); } }
  else if (style === "aero") { alloy.push(cyl(rr * 1.04, 0.05, x0 + side * 0.012)); }
  else { alloy.push(cyl(rr * 0.98, 0.04, x0)); }
  dark.push(cyl(r * 0.5, 0.03, side * w * 0.18));                                      // the brake disc
  const accent = caliper ? [(() => { const g = new THREE.BoxGeometry(0.05, r * 0.34, r * 0.42); g.translate(side * w * 0.2, r * 0.36, -r * 0.1); return g; })()] : [];
  const m = (list) => (list.length ? mergeGeometries(list.map((g) => finish(g))) : null);
  const out = { alloy: m(alloy), dark: m(dark), accent: m(accent) }; for (const g of [...alloy, ...dark, ...accent]) g.dispose(); return out;
}
/**
 * One wheel assembly on a vehicle: a pivot (steers about y) holding a spinner (turns about x) holding the tyre and the rim.
 * Returns { pivot, spin }; spin.userData.r is the rolling radius (rollWheels uses it).
 */
export function mountWheel(root, x, z, r, { tyre, rim, mats, accentMat }) {
  const pivot = new THREE.Group(), spin = new THREE.Group(); pivot.position.set(x, r, z); pivot.rotation.order = "YXZ"; spin.userData.r = r;
  const add = (g, m, name) => { if (!g) return; const o = new THREE.Mesh(g, m); o.name = name; o.castShadow = true; spin.add(o); };
  add(tyre, mats.tyre(), "tyre"); add(rim.alloy, mats.alloy(), "rim"); add(rim.dark, mats.dark(), "wheelDark"); add(rim.accent, accentMat ?? mats.trim(), "caliper");
  pivot.add(spin); root.add(pivot); return { pivot, spin };
}

// ---------------------------------------------------------------- text and plates (browser only; headless builds get a plain plate)
/** A canvas-textured flat label. Returns a mesh (or a plain plate when there is no canvas, as in the tests). */
export function labelMesh(text, w, h, { bg = "#f1efe6", fg = "#1b2a4a", font = "bold", border = null, scaleText = 0.62 } = {}) {
  let mat;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas"); c.width = 512; c.height = Math.max(32, Math.round(512 * (h / w))); const g = c.getContext("2d");
    if (g) {
      g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(4, 4, c.width - 8, c.height - 8); }
      g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; let px = c.height * scaleText; g.font = `${font} ${px}px Arial, Helvetica, sans-serif`;
      while (g.measureText(text).width > c.width * 0.94 && px > 8) { px -= 2; g.font = `${font} ${px}px Arial, Helvetica, sans-serif`; }
      g.fillText(text, c.width / 2, c.height / 2 + px * 0.04);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 });
    }
  }
  mat ??= flat(bg, { roughness: 0.6 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.name = "label"; m.userData.ownMaterial = !!mat.map; return m;
}
