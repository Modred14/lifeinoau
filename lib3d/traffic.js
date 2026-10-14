// lib3d/traffic.js
// The life on the road during a trip: a few NPC cars, the odd keke and bus, some people walking, and the real players who are travelling at the same time.
// It is deliberately sparse (the road is meant to feel lived in, not crowded). Everything follows the road by steering, so there are no routes to compute,
// and anything that drifts too far from the camera is moved to a fresh spot near it. Metres, x east, z south, y up; nose towards +z like vehicles.js.
import * as THREE from "three";
import { randomRoadNear, roadHalfWidth } from "./roadnet.js";
import { carBodyGeometry, CAR_WHEELS, CAR_WHEEL_R, CAR_COLORS, makeKeke, makeBus, makeCar, rollWheels } from "./vehicles.js";

export const DENSITY = { cars: 6, kekes: 2, buses: 1, peds: 10 }; // within about 250 m of the camera
const SKIN = ["#8d5a3b", "#6b4229", "#a8704a", "#4f301f", "#7a4a30"], SHIRT = ["#e4e0d4", "#2f62c4", "#c0312f", "#2f7a45", "#e3b83a", "#6b3fa0", "#dd6b27", "#1f2f55", "#e58aa8"], TROUSER = ["#1d1f23", "#3b4048", "#1f2f55", "#a8946a", "#6a4429"];

/** A name floating above someone's head, as a sprite (metres). */
export function nameTag(text, { color = "#ffffff", bg = "rgba(13,19,33,0.78)" } = {}) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d");
  g.font = "600 26px system-ui, sans-serif"; const w = Math.min(244, g.measureText(text).width + 28);
  g.fillStyle = bg; g.beginPath(); g.roundRect((256 - w) / 2, 10, w, 44, 22); g.fill(); g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text.length > 16 ? text.slice(0, 15) + "…" : text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false })); s.scale.set(2.4, 0.6, 1); s.renderOrder = 20; s.userData.dispose = () => { t.dispose(); s.material.dispose(); }; return s;
}

/** A walking figure made of boxes (for NPCs and for real players seen from a distance). Returns { root, pose(phase, amount) }. */
export function makeWalker(skin, shirt, trouser) {
  const root = new THREE.Group(), m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), part = (w, h, d, x, y, z, c, pivotTop) => { const g = new THREE.BoxGeometry(w, h, d); if (pivotTop) g.translate(0, -h / 2, 0); const o = new THREE.Mesh(g, m(c)); o.position.set(x, y, z); o.castShadow = true; root.add(o); return o; };
  part(0.42, 0.6, 0.24, 0, 1.15, 0, shirt); const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), m(skin)); head.position.y = 1.6; root.add(head);
  const l1 = part(0.16, 0.82, 0.18, -0.11, 0.86, 0, trouser, true), l2 = part(0.16, 0.82, 0.18, 0.11, 0.86, 0, trouser, true), a1 = part(0.1, 0.56, 0.12, -0.27, 1.43, 0, skin, true), a2 = part(0.1, 0.56, 0.12, 0.27, 1.43, 0, skin, true);
  return { root, pose(phase, k) { const s = Math.sin(phase) * 0.7 * k; l1.rotation.x = s; l2.rotation.x = -s; a1.rotation.x = -s * 0.8; a2.rotation.x = s * 0.8; } };
}

const R = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * parent: a group in metres. net: the road net. focus(): { x, z } the camera's ground point. hero(): { x, z, hx, hz, v } the player's own vehicle or person (cars keep clear of it).
 * Returns { update(dt, t), setTravellers(list), dispose() }.
 */
export function createTraffic({ parent, net, focus, hero, density = DENSITY, seed = 7 }) {
  const rnd = R(seed), group = new THREE.Group(); parent.add(group);
  const disposables = [];
  // ---- cars: one instanced mesh for the paint, glass and lights, one for the wheels ----
  const nCars = density.cars, bodyGeo = carBodyGeometry("#ffffff", false), suvGeo = carBodyGeometry("#ffffff", true);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 }), Math.max(1, nCars));
  const wheelGeo = new THREE.CylinderGeometry(CAR_WHEEL_R, CAR_WHEEL_R, 0.26, 10); wheelGeo.rotateZ(Math.PI / 2);
  const wheelsM = new THREE.InstancedMesh(wheelGeo, new THREE.MeshStandardMaterial({ color: "#16181c", roughness: 0.9 }), Math.max(1, nCars * 4));
  bodies.castShadow = true; bodies.frustumCulled = false; wheelsM.frustumCulled = false; group.add(bodies, wheelsM); disposables.push(bodyGeo, suvGeo, wheelGeo);
  // ---- people: six instanced parts ----
  const nPed = density.peds, geos = { torso: new THREE.BoxGeometry(0.42, 0.6, 0.24), head: new THREE.SphereGeometry(0.12, 8, 6), leg: new THREE.BoxGeometry(0.16, 0.82, 0.18), arm: new THREE.BoxGeometry(0.1, 0.56, 0.12) };
  geos.leg.translate(0, -0.41, 0); geos.arm.translate(0, -0.28, 0);
  const inst = (g) => { const m = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ roughness: 0.8 }), Math.max(1, nPed)); m.frustumCulled = false; m.castShadow = true; group.add(m); return m; };
  const P = { torso: inst(geos.torso), head: inst(geos.head), legL: inst(geos.leg), legR: inst(geos.leg), armL: inst(geos.arm), armR: inst(geos.arm) }; Object.values(geos).forEach((g) => disposables.push(g));

  // ---- agents ----
  const mk = (kind) => ({ kind, on: false, x: 0, z: 0, hx: 1, hz: 0, v: 0, vmax: 8, look: 0, phase: rnd() * 6, side: rnd() < 0.5 ? 1 : -1, color: 0, suv: false, colors: [0, 0, 0, 0] });
  const cars = Array.from({ length: nCars }, () => mk("car")), peds = Array.from({ length: nPed }, () => mk("ped"));
  const big = [...Array.from({ length: density.kekes }, () => { const a = mk("keke"); a.model = makeKeke(); return a; }), ...Array.from({ length: density.buses }, () => { const a = mk("bus"); a.model = makeBus(); return a; })];
  for (const a of big) { a.model.root.visible = false; a.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; }); group.add(a.model.root); }
  const tmp = new THREE.Matrix4(), base = new THREE.Matrix4(), loc = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);

  function place(a, near, far) { // somewhere on the road, the right distance from the camera, heading the way the road runs
    const f = focus(), p = randomRoadNear(net, rnd, f.x, f.z, near, far, 14); if (!p) return false;
    let best = -1, bd = 0;
    for (let k = 0; k < 8; k++) { const ang = (k / 8) * Math.PI * 2, hw = roadHalfWidth(net, p.x + Math.cos(ang) * 8, p.z + Math.sin(ang) * 8); if (hw > best) { best = hw; bd = ang; } }
    if (best <= 0) return false; a.x = p.x; a.z = p.z; a.hx = Math.cos(bd); a.hz = Math.sin(bd); a.timer = 0; a.on = true;
    a.vmax = a.kind === "ped" ? 1.1 + rnd() * 0.6 : a.kind === "bus" ? 6 + rnd() * 3 : a.kind === "keke" ? 6 + rnd() * 3 : 6 + rnd() * 5; a.v = a.vmax * 0.8; a.side = rnd() < 0.5 ? 1 : -1;
    if (a.kind === "car") { a.suv = rnd() < 0.3; a.colors = [CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)]]; }
    if (a.kind === "ped") a.colors = [SKIN[Math.floor(rnd() * SKIN.length)], SHIRT[Math.floor(rnd() * SHIRT.length)], TROUSER[Math.floor(rnd() * TROUSER.length)]];
    return true;
  }
  function steerTo(a, dt) { // keep to the road: look ahead along a few headings and lean towards the one with the most road under it
    a.timer -= dt; if (a.timer > 0) return; a.timer = 0.25 + rnd() * 0.15;
    const L = a.kind === "ped" ? 5 : 9, h0 = Math.atan2(a.hz, a.hx); let best = null, bs = -1e9;
    for (const d of [-0.9, -0.45, 0, 0.45, 0.9]) { const ang = h0 + d, hw = roadHalfWidth(net, a.x + Math.cos(ang) * L, a.z + Math.sin(ang) * L); if (hw <= 0.5) continue; const s = Math.min(hw, 6) - Math.abs(d) * 1.2 + (d === 0 ? 1.4 : 0) + rnd() * 0.5; if (s > bs) { bs = s; best = ang; } }
    a.want = best == null ? h0 + Math.PI : best; // a dead end: turn round
  }
  function advance(a, dt, others) {
    steerTo(a, dt);
    const h0 = Math.atan2(a.hz, a.hx); let dh = (((a.want ?? h0) - h0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI; dh = Math.max(-1, Math.min(1, dh)) * Math.min(1, dt * (a.kind === "ped" ? 4 : 2.2)); a.hx = Math.cos(h0 + dh); a.hz = Math.sin(h0 + dh);
    let target = a.vmax; const rx = -a.hz, rz = a.hx;
    for (const o of others) { if (o === a || !o.on) continue; const dx = o.x - a.x, dz = o.z - a.z, f = dx * a.hx + dz * a.hz, s = Math.abs(dx * rx + dz * rz); if (f > 0 && f < 16 && s < 2.4 && o.hx * a.hx + o.hz * a.hz > 0.3) target = Math.min(target, f < 5 ? 0 : (o.v ?? 0) * 0.9); }
    a.v += (target - a.v) * Math.min(1, dt * 2.5); a.x += a.hx * a.v * dt; a.z += a.hz * a.v * dt; a.phase += a.v * dt * (a.kind === "ped" ? 4.5 : 1);
  }
  const lane = (a) => { const hw = roadHalfWidth(net, a.x, a.z), off = a.kind === "ped" ? Math.max(0, hw * 0.7) * a.side : Math.min(1.6, hw * 0.45); return [a.x - a.hz * off, a.z + a.hx * off]; };

  // ---- real players on the road, drawn at the spot they last reported and eased towards each new one ----
  const live = new Map();
  function setTravellers(list) {
    const now = performance.now(), seen = new Set();
    for (const t of list) {
      seen.add(t.id); let e = live.get(t.id);
      if (!e) { const model = t.mode === "keke" ? makeKeke() : t.mode === "bus" ? makeBus() : t.mode === "car" ? makeCar() : null, walker = model ? null : makeWalker(SKIN[2], SHIRT[1], TROUSER[1]), root = model ? model.root : walker.root, tag = nameTag(t.name, { bg: "rgba(21,128,61,0.88)" });
        tag.position.set(0, model ? model.height + 0.9 : 2.2, 0); root.add(tag); group.add(root); root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        e = { root, model, walker, tag, x: t.x, z: t.z, h: t.h, tx: t.x, tz: t.z, th: t.h, phase: 0, at: now }; live.set(t.id, e); }
      Object.assign(e, { tx: t.x, tz: t.z, th: t.h, at: now, mode: t.mode });
    }
    for (const [id, e] of live) if (!seen.has(id)) { group.remove(e.root); e.tag.userData.dispose(); e.root.traverse((o) => { o.geometry?.dispose?.(); }); live.delete(id); }
  }

  let spawnCool = 0;
  function update(dt) {
    const f = focus(), hr = hero(), fast = (hr?.v ?? 0) > 22, all = [...cars, ...big, ...(hr ? [{ ...hr, on: true }] : [])];
    spawnCool -= dt;
    for (const a of [...cars, ...big, ...peds]) {
      const far = Math.hypot(a.x - f.x, a.z - f.z);
      if (!a.on || far > 300) { if (spawnCool <= 0 && place(a, 80, 230)) spawnCool = 0.15; else if (!a.on || far > 300) a.on = false; }
      if (!a.on) continue;
      if (a.kind === "ped") advance(a, dt, []); else advance(a, dt, all);
      if (hr && a.kind !== "ped" && fast) { const dx = a.x - hr.x, dz = a.z - hr.z; if (dx * hr.hx + dz * hr.hz > 0 && Math.hypot(dx, dz) < 30 && Math.abs(dx * -hr.hz + dz * hr.hx) < 3.5) a.on = false; } // out of the way of a speeding ride
      else if (hr && !fast && a.kind !== "ped") { const dx = a.x - hr.x, dz = a.z - hr.z, d = Math.hypot(dx, dz); if (d < 3.6) { a.x += (dx / (d || 1)) * (3.6 - d); a.z += (dz / (d || 1)) * (3.6 - d); a.v = Math.min(a.v, 1); } } // a gentle bump: they give way
    }
    // cars
    cars.forEach((a, i) => { if (!a.on) { bodies.setMatrixAt(i, hide); for (let w = 0; w < 4; w++) wheelsM.setMatrixAt(i * 4 + w, hide); return; }
      const [x, z] = lane(a); q.setFromAxisAngle(up, Math.atan2(a.hx, a.hz) + 0); base.compose(v3.set(x, 0.05, z), q, sc); bodies.setMatrixAt(i, base); bodies.setColorAt(i, col.set(a.colors[0]));
      CAR_WHEELS.forEach(([wx, wz], w) => { tmp.makeRotationX(a.phase * 0.8); loc.makeTranslation(wx, CAR_WHEEL_R, wz).multiply(tmp); wheelsM.setMatrixAt(i * 4 + w, tmp.multiplyMatrices(base, loc)); }); });
    bodies.instanceMatrix.needsUpdate = true; wheelsM.instanceMatrix.needsUpdate = true; if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    for (const a of big) { a.model.root.visible = a.on; if (!a.on) continue; const [x, z] = lane(a); a.model.root.position.set(x, 0.05, z); a.model.root.rotation.y = Math.atan2(a.hx, a.hz); rollWheels(a.model, a.v * dt); }
    // people
    peds.forEach((a, i) => { if (!a.on) { for (const k in P) P[k].setMatrixAt(i, hide); return; }
      const [x, z] = lane(a), sw = Math.sin(a.phase) * 0.7 * Math.min(1, a.v / 1.2); q.setFromAxisAngle(up, Math.atan2(a.hx, a.hz)); base.compose(v3.set(x, 0.05, z), q, sc);
      const put = (m, ox, oy, oz, ang) => { loc.makeTranslation(ox, oy, oz); if (ang) { tmp.makeRotationX(ang); loc.multiply(tmp); } m.setMatrixAt(i, tmp.multiplyMatrices(base, loc)); };
      put(P.torso, 0, 1.15, 0); put(P.head, 0, 1.6, 0); put(P.legL, -0.11, 0.86, 0, sw); put(P.legR, 0.11, 0.86, 0, -sw); put(P.armL, -0.27, 1.43, 0, -sw * 0.8); put(P.armR, 0.27, 1.43, 0, sw * 0.8);
      P.torso.setColorAt(i, col.set(a.colors[1])); P.head.setColorAt(i, col.set(a.colors[0])); P.armL.setColorAt(i, col); P.armR.setColorAt(i, col); P.legL.setColorAt(i, col.set(a.colors[2])); P.legR.setColorAt(i, col); });
    for (const k in P) { P[k].instanceMatrix.needsUpdate = true; if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true; }
    // real players: slide towards the latest reported spot (they report about every two seconds)
    for (const e of live.values()) { const k = Math.min(1, dt * 3), px = e.x, pz = e.z; e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; let dh = ((e.th - e.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI; e.h += dh * k; e.root.position.set(e.x, 0.05, e.z); e.root.rotation.y = e.h; const d = Math.hypot(e.x - px, e.z - pz);
      if (e.model) rollWheels(e.model, d); else e.walker.pose((e.phase += d * 2.4), Math.min(1, d / dt / 1.2)); }
  }
  function dispose() { for (const e of live.values()) e.tag.userData.dispose(); group.traverse((o) => { o.geometry?.dispose?.(); }); disposables.forEach((g) => g.dispose()); bodies.dispose(); wheelsM.dispose(); Object.values(P).forEach((m) => m.dispose()); parent.remove(group); }
  return { update, setTravellers, dispose };
}