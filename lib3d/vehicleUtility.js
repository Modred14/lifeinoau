// lib3d/vehicleUtility.js
// The keke napep: a green Bajaj RE three-wheeler. One steering front wheel, two rear wheels under a rounded engine body, a black canopy on four posts, open sides,
// a windscreen, a round head lamp, and the driver built in on his bench behind the handlebar. Metres, nose +z, wheels on y = 0, x is the LEFT (as in vehicles.js).
// (The OAU shuttle bus is a spec like the cars: see BUS_SPEC in vehicleSpecs.js and makeBus in vehicles.js.)
import * as THREE from "three";
import * as K from "./vehicleKit.js";

/** The real sizes the game uses for the keke (traffic, trip and garage all read these). */
export const UTILITY = {
  keke: { len: 2.78, wid: 1.3, height: 1.72, wheelbase: 1.95, track: 1.04, wr: 0.26, tw: 0.12, seat: { x: 0, y: 0.62, z: -0.72 }, driver: null, doorZ: -0.45 },
};
const KEKE_GREEN = "#2f8f3a";

const slabAt = (pts, hw, bevel = 0.03) => K.slab(pts, hw, bevel, 2);

export function buildKeke(paint) {
  const D = UTILITY.keke, root = new THREE.Group(), parts = new K.Parts(), lamps = K.lampMaterials(), hex = paint || KEKE_GREEN;
  const flatCache = {}, f = (c, o) => (flatCache[c] ??= K.flat(c, o));
  const mats = { paint: K.MATS.paint, trim: K.MATS.trim, glass: K.MATS.glass, chrome: K.MATS.chrome, dark: K.MATS.dark, plate: K.MATS.plate, tyre: K.MATS.tyre, alloy: K.MATS.alloy, seat: () => f("#1d1d20", { roughness: 0.9 }),
    lampF: () => lamps.head, lampR: () => lamps.tail, amber: () => lamps.amber, shirt: () => f("#c9a227", { roughness: 0.9 }), skin: () => f("#6b4a35", { roughness: 0.8 }), pants: () => f("#2c3340", { roughness: 0.9 }), canopy: () => f("#16171a", { roughness: 0.85 }), steel: () => f("#8b9096", { roughness: 0.45, metalness: 0.3 }) };
  const mat = (k) => (mats[k] ?? K.MATS.trim)();
  const sm = (g) => K.smooth(g, 0.9);

  // ---- green body: the nose cowl over the front wheel, the floor, the rear engine body with its mudguards
  parts.add("paint", sm(slabAt([[0.42, 0.56], [1.22, 0.56], [1.24, 0.3], [1.38, 0.3], [1.42, 0.64], [1.34, 0.99], [1.02, 1.07], [0.42, 1.07]], 0.34, 0.05)));
  parts.add("paint", sm(slabAt([[-1.36, 0.3], [0.5, 0.3], [0.5, 0.4], [-0.02, 0.4], [-0.02, 0.56], [-1.36, 0.56]], 0.58, 0.03)));               // floor and sill
  parts.add("paint", sm(slabAt([[-1.4, 0.34], [-0.3, 0.34], [-0.28, 0.84], [-0.62, 0.88], [-1.3, 0.86], [-1.4, 0.7]], 0.58, 0.07)));               // the rear body (engine under the bench)
  for (const s of [1, -1]) parts.add("paint", sm(slabAt([[-1.22, 0.5], [-0.58, 0.5], [-0.58, 0.74], [-0.9, 0.82], [-1.22, 0.76]], 0.075, 0.03).translate(s * 0.6, 0, 0)));      // wheel arches
  parts.add("paint", sm(slabAt([[0.4, 0.56], [0.9, 0.56], [0.88, 0.58], [0.4, 0.58]], 0.02, 0.005)));
  // the front mudguard, an arc over the steering wheel
  parts.add("trim", K.box(0.4, 0.04, 0.2, 0, 0.3, 1.4));                                                                                   // the bumper
  // ---- the canopy: black roof on four posts, the rear panel, the windscreen between the front posts
  parts.add("canopy", sm(slabAt([[-1.4, 1.5], [-1.34, 1.66], [0.3, 1.72], [0.62, 1.68], [0.7, 1.58], [0.5, 1.56], [0.3, 1.6], [-1.3, 1.55]], 0.66, 0.05)));
  for (const s of [1, -1]) {
    parts.add("steel", K.strut([s * 0.58, 1.07, 0.78], [s * 0.6, 1.58, 0.5], 0.032)); parts.add("steel", K.strut([s * 0.6, 0.86, -1.3], [s * 0.62, 1.55, -1.34], 0.032));
    parts.add("steel", K.strut([s * 0.6, 0.86, -0.48], [s * 0.62, 1.56, -0.5], 0.026));
  }
  parts.add("canopy", K.box(1.2, 0.58, 0.03, 0, 1.19, -1.37)); parts.add("glass", K.box(0.62, 0.22, 0.034, 0, 1.3, -1.372));
  parts.add("glass", K.quad([-0.58, 1.07, 0.78], [0.58, 1.07, 0.78], [0.6, 1.57, 0.5], [-0.6, 1.57, 0.5], [0, 0.4, 0.9]), K.quad([-0.58, 1.07, 0.78], [-0.6, 1.57, 0.5], [0.6, 1.57, 0.5], [0.58, 1.07, 0.78], [0, -0.4, -0.9]));
  parts.add("steel", K.box(0.04, 0.02, 0.2, 0, 1.585, 0.5));                                                                              // wiper hint on the screen top
  // ---- seats: the driver's bench and the passenger bench with its backrest
  parts.add("seat", K.box(0.46, 0.1, 0.36, 0, 0.5, 0.2)); parts.add("seat", K.box(0.46, 0.28, 0.07, 0, 0.7, -0.01));
  parts.add("seat", K.box(1.04, 0.12, 0.5, 0, 0.9, -0.88)); parts.add("seat", K.box(1.04, 0.42, 0.08, 0, 1.14, -1.1));
  // ---- handlebar and steering column, head lamp, mirrors, tail lamps, plate
  parts.add("steel", K.strut([0, 0.8, 0.72], [0, 1.0, 0.56], 0.04)); parts.add("trim", K.strut([-0.34, 1.04, 0.52], [0.34, 1.04, 0.52], 0.034));
  parts.add("chrome", new THREE.CylinderGeometry(0.1, 0.1, 0.08, 18).rotateX(Math.PI / 2).translate(0, 0.9, 1.4)); parts.add("lampF", new THREE.CylinderGeometry(0.082, 0.082, 0.09, 18).rotateX(Math.PI / 2).translate(0, 0.9, 1.403));
  for (const s of [1, -1]) {
    parts.add("trim", K.strut([s * 0.6, 1.2, 0.66], [s * 0.74, 1.22, 0.7], 0.02)); parts.add("trim", K.pill(0.1, 0.14, 0.03, 0.02).translate(s * 0.76, 1.22, 0.7));
    parts.add("lampR", K.box(0.08, 0.1, 0.03, s * 0.46, 0.72, -1.42)); parts.add("amber", K.box(0.05, 0.05, 0.03, s * 0.46, 0.6, -1.42));
  }
  parts.add("plate", K.box(0.34, 0.12, 0.02, 0, 0.5, -1.41));
  // ---- the driver, sitting on the bench (built in)
  const drv = new K.Parts();
  drv.add("pants", K.box(0.36, 0.14, 0.44, 0, 0.58, 0.12)); drv.add("shirt", K.box(0.4, 0.52, 0.24, 0, 0.88, -0.02)); drv.add("skin", K.box(0.17, 0.17, 0.17, 0, 1.23, -0.02));
  drv.add("shirt", K.strut([-0.22, 1.0, 0.0], [-0.18, 0.98, 0.5], 0.09), K.strut([0.22, 1.0, 0.0], [0.18, 0.98, 0.5], 0.09)); drv.add("pants", K.strut([-0.1, 0.56, 0.3], [-0.1, 0.34, 0.5], 0.12), K.strut([0.1, 0.56, 0.3], [0.1, 0.34, 0.5], 0.12));
  for (const m of drv.meshes(undefined, mat)) { m.castShadow = true; root.add(m); }
  for (const m of parts.meshes(hex, mat)) { m.castShadow = true; m.receiveShadow = m.name === "paint"; root.add(m); }
  // ---- wheels: one steering at the front (with its fork), two at the back
  const tyre = K.tyreGeo(D.wr, D.tw), rim = (s) => K.rimGeo(D.wr, D.tw, { style: "steel", side: s }), ws = [], pv = [], rimMats = { tyre: mats.tyre, alloy: () => f("#d4d7dc", { roughness: 0.4, metalness: 0.3 }), dark: mats.dark, trim: mats.trim };
  const front = K.mountWheel(root, 0, 1.0, D.wr, { tyre, rim: rim(1), mats: rimMats });
  const fork = new K.Parts(); for (const s of [1, -1]) fork.add("steel", K.box(0.03, 0.46, 0.04, s * 0.085, 0.2, 0)); fork.add("steel", K.box(0.2, 0.03, 0.04, 0, 0.44, 0));
  for (const m of fork.meshes(undefined, mat)) { m.castShadow = true; front.pivot.add(m); }
  ws.push(front.spin); pv.push(front.pivot);
  for (const x of [-D.track / 2, D.track / 2]) { const w = K.mountWheel(root, x, 1.0 - D.wheelbase, D.wr, { tyre, rim: rim(x > 0 ? 1 : -1), mats: rimMats }); ws.push(w.spin); }
  const keke = { root, wheels: ws, front: pv, length: D.len, width: D.wid, height: D.height, wheelbase: D.wheelbase, track: D.track, door: { side: -1, z: D.doorZ }, seatZ: D.seat.z, seat: D.seat, driver: null, doors: null, id: "keke", shape: "keke", lamps,
    setDoor() {}, setBrake(on) { lamps.tail.emissiveIntensity = on ? 2.6 : 0.28; }, setHeadlights(on) { lamps.head.emissiveIntensity = on ? 1.6 : 0.18; },
    dispose() { root.traverse((o) => { if (o.isMesh) { o.geometry?.dispose?.(); if (o.userData.ownMaterial) o.material.dispose(); } }); lamps.head.dispose(); lamps.tail.dispose(); lamps.amber.dispose(); parts.dispose(); drv.dispose(); fork.dispose(); tyre.dispose(); } };
  return keke;
}
