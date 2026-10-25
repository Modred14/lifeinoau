// lib3d/vehicles.js
// The vehicles of the game: the cars of YK Autos (one model per car, measured from the real thing: lib3d/vehicleSpecs.js), the keke and the OAU shuttle bus (lib3d/vehicleUtility.js),
// a plain family car, and the pieces the traffic shares. The shapes are built from side profiles and bent into place (lib3d/vehicleKit.js), then given real wheels (rubber, rim, brake),
// glass, lamps that light under the brake, mirrors and doors that open.
// Everything is drawn in metres, nose towards +z, wheels touching y = 0. The trip scales the whole world to scene units. A vehicle's own +x is its LEFT.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { carById } from "../lib/cars.js";
import * as K from "./vehicleKit.js";
import { CAR_SPECS, BUS_SPEC } from "./vehicleSpecs.js";
import { buildKeke, UTILITY } from "./vehicleUtility.js";

/** A box as geometry with a colour baked in, so many boxes can be merged into one mesh. (w across, h tall, l long, centred at x, y, z.) */
export function box(w, h, l, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, l); if (rx) g.rotateX(rx); g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute("color", new THREE.BufferAttribute(a, 3)); return g;
}
const merged = (parts) => { const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p))); parts.forEach((p) => p.dispose()); return g; };
const bodyMat = () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });

// ------------------------------------------------------------------ the car builder
const rect = (z0, z1, y0, y1) => [[z0, y0], [z1, y0], [z1, y1], [z0, y1]];
const mirrorPoly = (p) => p.map(([x, y]) => [-x, y]).reverse();
/** The part of a polygon between two vertical lines (Sutherland-Hodgman). */
function clipZ(poly, z0, z1) {
  const cut = (pts, inside, at) => { const out = []; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], ia = inside(a), ib = inside(b); if (ia) out.push(a); if (ia !== ib) out.push(at(a, b)); } return out; };
  let p = cut(poly, (a) => a[0] >= z0, (a, b) => { const t = (z0 - a[0]) / (b[0] - a[0]); return [z0, a[1] + t * (b[1] - a[1])]; });
  if (p.length) p = cut(p, (a) => a[0] <= z1, (a, b) => { const t = (z1 - a[0]) / (b[0] - a[0]); return [z1, a[1] + t * (b[1] - a[1])]; });
  return p;
}
/** How the body slab is bent: the sides lean in towards the top, tuck under at the sills, and the nose and tail corners are rounded off in plan. */
function lowerWarp(S) {
  const hw = S.W / 2, w = S.warp, zn = S.L / 2;
  return (x, y, z) => {
    const u = Math.min(1, Math.abs(x) / hw); let sx = 1, zz = z;
    if (w.tum) sx *= 1 - w.tum * Math.pow(K.cl((y - w.y1) / (w.y2 - w.y1), 0, 1), 1.6);
    if (w.sill) sx *= 1 - w.sill * Math.pow(K.cl((w.sillY - y) / w.sillY, 0, 1), 2);
    if (z > w.nz0) { const t = K.cl((z - w.nz0) / (zn - w.nz0), 0, 1); sx *= 1 - (w.nTaper ?? 0) * t * t; zz -= (w.nCut ?? 0) * Math.pow(u, w.nRnd ?? 2.6) * K.sstep(0, 1, t); }
    if (z < -w.tz0) { const t = K.cl((-z - w.tz0) / (zn - w.tz0), 0, 1); sx *= 1 - (w.tTaper ?? 0) * t * t; zz += (w.tCut ?? 0) * Math.pow(u, w.tRnd ?? 2.6) * K.sstep(0, 1, t); }
    return [x * sx, y, zz];
  };
}
/** The glasshouse: sides lean in (tumblehome), the roof has a slight crown, and the ends are rounded in plan. */
function cabinWarp(c) {
  return (x, y, z) => {
    const u = Math.min(1, Math.abs(x) / c.hw), t = K.cl((y - c.y0) / (c.y1 - c.y0), 0, 1); let zz = z;
    const sx = 1 - c.tum * t, yy = y - (c.crown ?? 0) * u * u * K.sstep(0.82, 1, t);
    if (z > c.fz0) zz -= (c.fCut ?? 0) * Math.pow(u, 2.4) * K.sstep(0, 1, (z - c.fz0) / 0.7);
    if (z < c.rz0) zz += (c.rCut ?? 0) * Math.pow(u, 2.4) * K.sstep(0, 1, (c.rz0 - z) / 0.7);
    return [x * sx, yy, zz];
  };
}
/** A window shape on the side of the glasshouse: from z0 to z1, under the roof line, above the belt. */
function winPoly(S, z0, z1, m = 0.045, low = 0.035) {
  const c = S.cabin, yb = c.y0 + low, pts = [[z0, yb], [z1, yb]];
  for (let i = 0; i <= 8; i++) { const z = z1 + ((z0 - z1) * i) / 8, t = K.yAt(c.pts, z, "max"); pts.push([z, Math.max(yb + 0.012, (t ?? yb) - m)]); }
  return pts;
}
/** A strip of glass on a slanted face (windscreen / rear glass), as a grid so it follows the curve of the body. a, b: [z, y] along the slope, bottom to top. */
function glassPatch(F, hw, a, b, { kx = 0.87, from = 0.07, to = 0.93, off = 0.006, nu = 8, nv = 3 } = {}) {
  const dz = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dz, dy) || 1; let ny = -dz / len, nz = dy / len; if (ny < 0) { ny = -ny; nz = -nz; }
  const pos = [], nor = [], at = (i, j) => { const s = from + ((to - from) * j) / nv, z = a[0] + dz * s, y = a[1] + dy * s, xf = (-kx + (2 * kx * i) / nu) * hw, p = F(xf, y, z); return [p[0], p[1] + ny * off, p[2] + nz * off]; };
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
    for (const t of [[0, 1, 2], [0, 2, 3]]) { const e1 = new THREE.Vector3(...q[t[1]]).sub(new THREE.Vector3(...q[t[0]])), e2 = new THREE.Vector3(...q[t[2]]).sub(new THREE.Vector3(...q[t[0]])), n = e1.cross(e2).normalize(); const flip = n.y * ny + n.z * nz < 0, tri = flip ? [t[0], t[2], t[1]] : t, nn = flip ? n.negate() : n; for (const k of tri) { pos.push(...q[k]); nor.push(nn.x, nn.y, nn.z); } }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3)); return g;
}

/** All the parts of a car, unbent into buckets. `low` leaves out the small detail (for the instanced traffic cars). Returns { parts, F, Fc, outline, belt, doorParts(z0, z1, side) }. */
function carParts(S, { low = false } = {}) {
  const hw = S.W / 2, F = lowerWarp(S), c = S.cabin, Fc = c ? cabinWarp(c) : F, parts = new K.Parts(), axles = [S.zf, S.zr];
  const outline = K.bodyOutline(S.upper, { yb: S.yb, axles, wr: S.wr, gap: S.gap }), belt = c ? c.y0 : S.belt;
  const lowX = (z, y) => F(hw, y, z)[0], upX = (z, y) => (c ? Fc(c.hw, y, z)[0] : F(hw, y, z)[0]);
  // the body and the glasshouse
  let body = K.slab(outline, hw, S.bevel ?? 0.06, 2); K.warp(body, F); body = K.smooth(body, 0.9);
  K.splitInto(parts, body, (cx, cy, cz, nx, ny, nz) => (S.pickLower ? S.pickLower(cx, cy, cz, nx, ny, nz) : ny < -0.55 || (cy < (S.sillTrim ?? 0.24) && Math.abs(nx) > 0.5) || (cy < 0.3 && Math.abs(cz) > S.L / 2 - 0.3 && Math.abs(nz) > 0.3) ? "trim" : "paint"));
  if (c) { let cab = K.slab(c.pts, c.hw, c.bevel ?? 0.05, 2); K.warp(cab, Fc); cab = K.smooth(cab, 0.9); K.splitInto(parts, cab, (cx, cy, cz, nx, ny, nz) => (S.pickCabin ? S.pickCabin(cx, cy, cz, nx, ny, nz) : "paint")); }
  // the dark inside of each wheel well, behind the tyre
  for (const zw of axles) { const g = K.wellFill(zw, S.wr, S.yb, S.gap, (S.wx ?? S.W / 2 - S.tw / 2 - 0.03) - S.tw / 2 - 0.005); parts.add("dark", K.smooth(g, 0.5)); }
  // windows and screens
  const winPolys = c ? S.win.map(([z0, z1]) => winPoly(S, Math.min(z0, z1), Math.max(z0, z1))) : S.sideWin ?? [];
  for (const side of [1, -1]) for (const p of winPolys) parts.add("glass", K.sidePatch(p, { xOf: upX, side, lift: 0.004 }));
  if (S.screens?.f) parts.add("glass", glassPatch(c ? Fc : F, c ? c.hw : hw, S.screens.f[0], S.screens.f[1], S.screenOpts?.f));
  if (S.screens?.r) parts.add("glass", glassPatch(c ? Fc : F, c ? c.hw : hw, S.screens.r[0], S.screens.r[1], S.screenOpts?.r));
  // doors: the seam and skin of the two that do not open (the two that do are built apart, see doorParts)
  const doorSkin = (z0, z1, side, into, ghost = false) => {
    const e = 0.005, low0 = S.doorLow ?? 0.3, lowerR = rect(z0, z1, low0, belt), upper = c ? clipZ(S.upperFrame?.(S) ?? c.pts.map(([z, y]) => [z, y - 0.075]), z0, z1) : S.upperPoly ? clipZ(S.upperPoly, z0, z1) : null;
    const wins = winPolys.map((p) => clipZ(p, z0 + 0.025, z1 - 0.025)).filter((p) => p.length >= 3);
    if (!ghost) into.add("trim", K.sidePatch(rect(z0 - e, z1 + e, low0 - e, belt + e), { xOf: lowX, side, lift: 0.008 }));
    into.add("paint", K.sidePatch(lowerR, { xOf: lowX, side, lift: ghost ? 0.006 : 0.013 }));
    if (upper && upper.length >= 3) { if (!ghost) into.add("trim", K.sidePatch(upper.map(([z, y]) => [z + (z <= z0 + 0.001 ? -e : z >= z1 - 0.001 ? e : 0), y]), { xOf: upX, side, lift: 0.005 })); into.add("paint", K.sidePatch(upper, { xOf: upX, side, lift: ghost ? 0.006 : 0.009 })); }
    for (const p of wins) into.add("glass", K.sidePatch(p, { xOf: upX, side, lift: ghost ? 0.007 : 0.013 }));
    if (!ghost) { const zh = side > 0 ? z0 + 0.14 : z0 + 0.14; into.add(S.handle ?? "chrome", K.box(0.02, 0.028, 0.15, side * (lowX(zh, belt - 0.07) + 0.017), belt - 0.07, zh)); }
  };
  if (!low) for (const [z0, z1, side] of S.doors.extra) doorSkin(Math.min(z0, z1), Math.max(z0, z1), side, parts);
  else for (const [z0, z1, side] of S.doors.extra) doorSkin(Math.min(z0, z1), Math.max(z0, z1), side, parts);
  // mirrors
  if (S.mirror && !low) for (const side of [1, -1]) {
    const y = S.mirror.y ?? belt + 0.12 - (S.mirror.drop ?? 0), x = side * (lowX(S.mirror.z, belt) + (c ? 0.02 : 0.045) + (S.mirror.out ?? 0.045)), g = K.pill(0.13, 0.1, 0.19, 0.03); g.translate(x, y, S.mirror.z);
    parts.add(S.mirror.k ?? "paint", g); parts.add("trim", K.strut([side * (lowX(S.mirror.z, belt) - 0.01), y - 0.04, S.mirror.z + 0.02], [x - side * 0.04, y, S.mirror.z], 0.03));
  }
  // lamps, grille, plates: flat shapes on the nose and tail, bent with the body
  if (!low) for (const d of S.decals ?? []) for (const p of d.m ? [d.poly, mirrorPoly(d.poly)] : [d.poly]) parts.add(d.k, K.faceDecal(p, { pts: outline, depth: d.depth ?? 0.06, inset: d.inset ?? 0.025, side: d.s, F, bevel: d.bevel ?? 0 }));
  if (!low) S.extras?.({ parts, F, Fc, S, outline, belt, K, lowX, upX });
  return { parts, F, Fc, outline, belt, lowX, upX, doorSkin, hw, c };
}

/** The doors that open: a skin hinged at its front edge, and the dark opening behind it that shows only when it is ajar. Returns { left, right, set(side, k) }. */
function makeDoors(root, S, built, paintHex, mat) {
  const out = {}, hw = S.W / 2;
  for (const [name, side] of [["left", 1], ["right", -1]]) {
    const [z0, z1] = S.doors[name], pivot = new THREE.Group(), hole = new THREE.Group(), d = new K.Parts(), h = new K.Parts();
    built.doorSkin(z0, z1, side, d); d.translate(-side * hw, 0, -z1); pivot.position.set(side * hw, 0, z1);
    for (const m of d.meshes(paintHex, (k) => K.dbl(mat(k)))) { m.castShadow = true; pivot.add(m); }
    // the opening: dark where the door was
    const e = 0.0, belt = built.belt, c = built.c, low0 = S.doorLow ?? 0.3;
    h.add("dark", K.sidePatch(rect(z0 + 0.03, z1 - 0.03, low0 + 0.03, belt), { xOf: built.lowX, side, lift: 0.0 }));
    if (c) h.add("dark", K.sidePatch(clipZ(winPoly(S, z0, z1, 0.02, 0.0), z0 + 0.03, z1 - 0.03), { xOf: built.upX, side, lift: 0.0 })); void e;
    for (const m of h.meshes(paintHex, (k) => mat(k))) hole.add(m); hole.visible = false;
    root.add(pivot, hole); out[name] = { side, z: (z0 + z1) / 2, len: z1 - z0, pivot, hole, k: 0, parts: [d, h] };
  }
  out.set = (side, k) => { const d = side > 0 ? out.left : out.right, v = Math.max(0, Math.min(1, k)); d.k = v;
    if (S.slide && side < 0) { d.pivot.position.set(side * (hw + 0.07 * v), 0, d.z + d.len / 2 - v * d.len * 0.92); d.hole.visible = v > 0.015; return; }
    d.pivot.rotation.y = -d.side * v * DOOR_OPEN_ANGLE; d.hole.visible = v > 0.015; };
  return out;
}
export const DOOR_OPEN_ANGLE = 1.15, DOOR_LEN = 1.0, DOOR_Z = { left: 0.3, right: -0.5 };

/** One finished car from a spec. Returns { root, wheels (spinners), front (steering pivots), length, width, height, door, seat, driver, doors, setDoor, setBrake, setHeadlights, dispose, ... }. */
function buildCar(S, paint) {
  const root = new THREE.Group(), built = carParts(S), lamps = K.lampMaterials(), hex = paint || S.ref;
  const accent = S.accent ? K.flat(S.accent, { roughness: 0.5 }) : K.MATS.trim();
  const mats = { paint: K.MATS.paint, trim: K.MATS.trim, glass: K.MATS.glass, chrome: K.MATS.chrome, dark: K.MATS.dark, plate: K.MATS.plate, lampF: () => lamps.head, lampR: () => lamps.tail, amber: () => lamps.amber, accent: () => accent, tyre: K.MATS.tyre, alloy: () => (S.wheel.color ? K.flat(S.wheel.color, { roughness: 0.4, metalness: 0.3 }) : K.MATS.alloy()), seat: K.MATS.seat };
  const mat = (k) => (mats[k] ?? K.MATS.trim)(); const meshes = built.parts.meshes(hex, mat); for (const m of meshes) root.add(m);
  // wheels
  const wx = S.wx ?? S.W / 2 - S.tw / 2 - 0.03, tyre = K.tyreGeo(S.wr, S.tw), rims = { 1: K.rimGeo(S.wr, S.tw, { style: S.wheel.style, side: 1, caliper: !!S.caliper }), [-1]: K.rimGeo(S.wr, S.tw, { style: S.wheel.style, side: -1, caliper: !!S.caliper }) };
  const caliperMat = S.caliper ? K.flat(S.caliper, { roughness: 0.5 }) : null, ws = [], pv = [];
  for (const [x, z] of [[-wx, S.zf], [wx, S.zf], [-wx, S.zr], [wx, S.zr]]) { const w = K.mountWheel(root, x, z, S.wr, { tyre, rim: rims[x > 0 ? 1 : -1], mats, accentMat: caliperMat }); ws.push(w.spin); pv.push(w.pivot); }
  const doors = makeDoors(root, S, built, hex, mat);
  const v = { root, wheels: ws, front: [pv[0], pv[1]], length: S.L, width: S.W, height: S.H, wheelbase: S.zf - S.zr, track: 2 * wx, door: { side: -1, z: -0.5 }, seatZ: 0, seat: S.seat, driver: S.driver, doors, setDoor: doors.set, id: S.id, shape: "car", lamps,
    setBrake(on) { lamps.tail.emissiveIntensity = on ? 2.6 : 0.28; }, setHeadlights(on) { lamps.head.emissiveIntensity = on ? 1.6 : 0.18; },
    dispose() { root.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); if (o.userData.ownMaterial) o.material.map?.dispose(), o.material.dispose(); } }); lamps.head.dispose(); lamps.tail.dispose(); lamps.amber.dispose(); for (const d of [doors.left, doors.right]) d.parts.forEach((p) => p.dispose()); built.parts.dispose(); } };
  return v;
}

// ------------------------------------------------------------------ the public models
const FAMILY = "corolla-2011", GENERIC = "camry-2014";
const specById = (id) => { const s = CAR_SPECS[id] ?? CAR_SPECS[FAMILY]; s.id ??= id; return s; };
const wheelX = (S) => S.wx ?? S.W / 2 - S.tw / 2 - 0.03;
/** The player's family car (the one that comes with the game): a plain sedan in the paint given. */
export function makeCar(paint = "#1c1d21") { const v = buildCar(specById(FAMILY), paint); v.id = ""; return v; }
/** The car a player bought, by its lib/cars.js id, in the paint they chose (a Cybertruck is bare steel). No id or an unknown id: the family car, as before. */
export function makeVehicle(modelId, paint) {
  const car = carById(modelId);
  if (!car || !CAR_SPECS[car.id]) return makeCar(paint || undefined);
  return buildCar(specById(car.id), car.fixedPaint ?? (paint || undefined));
}
/** A keke napep: a green Bajaj three-wheeler with a black canopy, open at the sides. */
export function makeKeke() { return buildKeke(); }
/** The OAU shuttle bus: a white Dongfeng-style minibus with a sliding door on the kerb side. */
/** The OAU shuttle bus is the reference minibus stretched into a proper shuttle (a longer, wider, taller body on a long wheelbase), so it stands visibly above the cars. */
export const BUS_SCALE = { x: 1.12, y: 1.15, z: 1.35, wheel: 1.12 };
export function makeBus() {
  const v = buildCar(BUS_SPEC, BUS_SPEC.ref), root = v.root, k = BUS_SCALE, shell = new THREE.Group(), pivots = new Set(v.wheels.map((w) => w.parent));
  // "OAU SHUTTLE BUS" on the lower panel between the door and the front wheel, both sides
  for (const side of [1, -1]) { const l = K.labelMesh("OAU SHUTTLE BUS", 0.78, 0.17, { bg: "#f2f3f5", fg: "#14418a" }); l.position.set(side * 0.846, 0.66, 0.72); l.rotation.y = side * Math.PI / 2; root.add(l); }
  for (const c of [...root.children]) if (!pivots.has(c)) shell.add(c);
  shell.scale.set(k.x, k.y, k.z); root.add(shell);
  for (const p of pivots) { p.position.x *= k.x; p.position.z *= k.z; p.position.y *= k.wheel; for (const w of p.children) { w.scale.setScalar(k.wheel); w.userData.r *= k.wheel; } }
  const sc = ({ x, y, z }) => ({ x: x * k.x, y: y * k.y, z: z * k.z });
  Object.assign(v, { id: "bus", shape: "bus", length: BUS_SPEC.L * k.z, width: BUS_SPEC.W * k.x, height: BUS_SPEC.H * k.y, wheelbase: (BUS_SPEC.zf - BUS_SPEC.zr) * k.z, track: v.track * k.x, seat: sc(BUS_SPEC.seat), driver: sc(BUS_SPEC.driver) });
  v.root.userData.shell = shell; return v;
}

// ---- the cheap shapes for the traffic (one instanced mesh for every car, one for every wheel) ----
const traffic = CAR_SPECS[GENERIC] ?? CAR_SPECS[FAMILY];
export const CAR_WHEELS = [[-wheelX(traffic), traffic.zf], [wheelX(traffic), traffic.zf], [-wheelX(traffic), traffic.zr], [wheelX(traffic), traffic.zr]];
export const CAR_WHEEL_R = traffic.wr;
export const CAR_COLORS = ["#c0392b", "#2c5aa0", "#e8e8e8", "#1f1f23", "#4a4f57", "#d9a441", "#2e7d5b", "#7b3f2a", "#b9bec7", "#8e2d6b"];
const FLAT = { paint: "#ffffff", trim: "#17191c", glass: "#27374a", chrome: "#c9ced6", dark: "#0c0d0f", lampF: "#fff5c8", lampR: "#c4161c", plate: "#eeeeee", accent: "#c9ced6" };
/** A sedan or SUV body (paint colour + dark glass + lights) as one merged geometry with colours baked in, drawn instanced for the traffic. */
export function carBodyGeometry(paint = "#c0392b", suv = false) {
  const S = CAR_SPECS[suv ? "gle-2018" : GENERIC] ?? traffic, { parts } = carParts(S, { low: true }), g = parts.colored({ ...FLAT, paint }); parts.dispose(); return g;
}
/** One wheel (tyre and rim) with colours baked in, for the instanced traffic wheels. */
export function trafficWheelGeometry() {
  const r = CAR_WHEEL_R, w = traffic.tw, t = K.finish(K.tyreGeo(r, w, 14), "#121315"), rim = K.rimGeo(r, w, { style: "disc", side: 1, seg: 12 }), a = rim.alloy ? K.finish(rim.alloy, "#aeb3bb") : null, b = rim.dark ? K.finish(rim.dark, "#2a2d31") : null;
  const out = mergeGeometries([t, a, b].filter(Boolean)); [t, a, b].forEach((g) => g?.dispose()); return out;
}

/**
 * Puts a seated driver in a car or a bus, at `seat` ({ x, y, z } in the vehicle's own space: x is the LEFT, so the driver of a right-hand-traffic car sits at +x).
 * (The keke already has its driver built in.) Returns the group, so the caller can remove it.
 */
export function addDriver(vehicle, seat, shirt = "#3b6ea5") {
  const g = new THREE.Group(), skin = "#6b4a35", parts = [box(0.44, 0.55, 0.26, 0, 0.3, 0, shirt), box(0.18, 0.14, 0.18, 0, 0.72, 0, skin), box(0.12, 0.3, 0.12, -0.14, 0.18, 0.22, shirt, -0.9), box(0.12, 0.3, 0.12, 0.14, 0.18, 0.22, shirt, -0.9), box(0.42, 0.12, 0.5, 0, -0.02, 0.18, "#2c3340")];
  const m = new THREE.Mesh(merged(parts), bodyMat()); m.castShadow = true; g.add(m); g.position.set(seat.x, seat.y + 0.2, seat.z); vehicle.root.add(g); vehicle.driver3d = g; return g;
}

/** Spin a vehicle's wheels for the distance it just moved, and turn the front ones (radians, + is left) for steering: the wheel on the inside of the turn turns more (Ackermann). */
export function rollWheels(v, metres, steer = 0) {
  for (const w of v.wheels) w.rotation.x += metres / (w.userData.r || 0.3);
  const f = v.front; if (!f?.length) return;
  if (f.length === 1 || !v.wheelbase) { for (const p of f) p.rotation.y = steer; return; }
  const s = Math.abs(steer); if (s < 1e-4) { for (const p of f) p.rotation.y = 0; return; }
  const R = v.wheelbase / Math.tan(Math.min(s, 1.2)), tr = v.track ?? 1.5, inner = Math.atan(v.wheelbase / Math.max(0.2, R - tr / 2)), outer = Math.atan(v.wheelbase / (R + tr / 2)), sg = Math.sign(steer);
  f[1].rotation.y = sg * (steer > 0 ? inner : outer); f[0].rotation.y = sg * (steer > 0 ? outer : inner);   // f[0] is the right wheel, f[1] the left
}
export { UTILITY };
