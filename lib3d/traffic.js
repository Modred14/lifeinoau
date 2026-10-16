// lib3d/traffic.js
// The life on the road during a trip: a few NPC cars, the odd keke and bus, some people walking, and the real players who are travelling at the same time.
// It is deliberately sparse (the road is meant to feel lived in, not crowded). Everything follows the road by steering, so there are no routes to compute,
// and anything that drifts too far from the camera is moved to a fresh spot near it. Metres, x east, z south, y up; nose towards +z like vehicles.js.
import * as THREE from "three";
import { randomRoadNear, roadHalfWidth } from "./roadnet.js";
import { createNpc, npcSpec } from "./avatar/npc.js";
import { carBodyGeometry, CAR_WHEELS, CAR_WHEEL_R, CAR_COLORS, makeKeke, makeBus, makeCar, rollWheels } from "./vehicles.js";

export const DENSITY = { cars: 6, kekes: 2, buses: 1, peds: 10 }; // within about 250 m of the camera


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
  // ---- people: real rigged characters, built by the same pipeline as the player (see avatar/npc.js). Each walker keeps a character while it is near the camera;
  //      one that has wandered off is given a new face, clothes and build before it comes back, so the road never fills with the same few people. ----
  const nPed = density.peds, WALK_V = 1.4; // the walk clip's own pace in metres per second; playing it at speed/WALK_V stops the feet sliding
  let gone = false, npcSeq = seed * 1000;
  const pedAnim = ["idle", "phone", "talk", "lookAround"]; // what a person does when they stop for a moment
  const addNpc = (a, av) => { av.root.visible = false; av.root.position.set(0, -50, 0); group.add(av.root); a.npc = av; a.cur = null; };
  const loadNpc = async (a) => { try { const av = await createNpc(npcSpec(++npcSeq, { role: rnd() < 0.08 ? "staff" : "student" })); if (gone) { av.dispose(); return null; } return av; } catch { return null; } };

  // ---- agents ----
  const mk = (kind) => ({ kind, on: false, x: 0, z: 0, hx: 1, hz: 0, v: 0, vmax: 8, look: 0, phase: rnd() * 6, side: rnd() < 0.5 ? 1 : -1, color: 0, suv: false, colors: [0, 0, 0, 0] });
  const cars = Array.from({ length: nCars }, () => mk("car")), peds = Array.from({ length: nPed }, () => ({ ...mk("ped"), pause: 0, nextPause: 2 + rnd() * 12, act: "idle", cur: null, npc: null }));
  peds.forEach(async (a) => { const av = await loadNpc(a); if (av) addNpc(a, av); }); // the walkers appear as their characters finish loading
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
    if (a.kind === "ped") { a.pause = 0; a.nextPause = 3 + rnd() * 14; if (a.npc && !a.loading) { a.loading = true; loadNpc(a).then((av) => { a.loading = false; if (!av) return; // swap in a new person only if the old one is not being looked at
        if (a.npc && (!a.on || Math.hypot(a.x - focus().x, a.z - focus().z) > 60)) { group.remove(a.npc.root); a.npc.dispose(); addNpc(a, av); } else av.dispose(); }); } }
    return true;
  }
  function steerTo(a, dt) { // keep to the road: look ahead along a few headings and lean towards the one with the most road under it
    a.timer -= dt; if (a.timer > 0) return; a.timer = 0.25 + rnd() * 0.15;
    const L = a.kind === "ped" ? 5 : 9, h0 = Math.atan2(a.hz, a.hx); let best = null, bs = -1e9;
    for (const d of [-0.9, -0.45, 0, 0.45, 0.9]) { const ang = h0 + d, hw = roadHalfWidth(net, a.x + Math.cos(ang) * L, a.z + Math.sin(ang) * L); if (hw <= 0.5) continue; const s = Math.min(hw, 6) - Math.abs(d) * 1.2 + (d === 0 ? 1.4 : 0) + rnd() * 0.5; if (s > bs) { bs = s; best = ang; } }
    a.want = best == null ? h0 + Math.PI : best; // a dead end: turn round
  }
  function advance(a, dt, others) {
    if (a.kind === "ped") { // now and then someone stops to check their phone, chat or look around, then walks on
      if (a.pause > 0) { a.pause -= dt; if (a.pause <= 0) a.nextPause = 15 + rnd() * 30; }
      else { a.nextPause -= dt; if (a.nextPause <= 0 && a.v < 2) { a.pause = 4 + rnd() * 9; a.act = pedAnim[1 + Math.floor(rnd() * 3)]; } }
    }
    if (!(a.kind === "ped" && a.pause > 0)) steerTo(a, dt);
    const h0 = Math.atan2(a.hz, a.hx); let dh = (((a.want ?? h0) - h0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI; dh = Math.max(-1, Math.min(1, dh)) * Math.min(1, dt * (a.kind === "ped" ? 4 : 2.2)); a.hx = Math.cos(h0 + dh); a.hz = Math.sin(h0 + dh);
    let target = a.kind === "ped" && a.pause > 0 ? 0 : a.vmax; const rx = -a.hz, rz = a.hx;
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
      if (!e) { const model = t.mode === "keke" ? makeKeke() : t.mode === "bus" ? makeBus() : t.mode === "car" ? makeCar() : null, walker = model ? null : makeWalker("#8d5a3b", "#2f62c4", "#1f2f55"), root = model ? model.root : new THREE.Group(), tag = nameTag(t.name, { bg: "rgba(21,128,61,0.88)" });
        if (walker) { // on foot: the player's own look, drawn like everyone else, replaces the stand-in as soon as it has loaded
          e = { root, model, walker, tag, x: t.x, z: t.z, h: t.h, tx: t.x, tz: t.z, th: t.h, phase: 0, at: now };
          createNpc(npcSpec(t.id, { gender: t.gender === "F" ? "F" : "M", force: { look: t.look ?? undefined } }), { lod: false }).then((av) => { if (!live.has(t.id) || live.get(t.id) !== e || gone) { av.dispose(); return; } if (av.kind !== "glb") { av.dispose(); root.add(walker.root); return; } e.av = av; e.cur = null; root.add(av.root); }).catch(() => root.add(walker.root));
        }
        tag.position.set(0, model ? model.height + 0.9 : 2.2, 0); root.add(tag); group.add(root); root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        e = e ?? { root, model, walker, tag, x: t.x, z: t.z, h: t.h, tx: t.x, tz: t.z, th: t.h, phase: 0, at: now }; live.set(t.id, e); }
      Object.assign(e, { tx: t.x, tz: t.z, th: t.h, at: now, mode: t.mode });
    }
    for (const [id, e] of live) if (!seen.has(id)) { group.remove(e.root); e.tag.userData.dispose(); if (e.av) e.av.dispose(); e.root.traverse((o) => { if (!e.av || !e.av.root.getObjectById(o.id)) o.geometry?.dispose?.(); }); live.delete(id); }
  }

  let spawnCool = 0, clock = 0;
  function update(dt) {
    clock += dt;
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
    peds.forEach((a) => { const av = a.npc; if (!av) return;
      if (!a.on) { av.root.visible = false; return; }
      const [x, z] = lane(a), dist = Math.hypot(a.x - f.x, a.z - f.z);
      av.root.position.set(x, 0.1, z); av.root.rotation.y = Math.atan2(a.hx, a.hz);
      const moving = a.v > 0.2, want = moving ? "walk" : a.pause > 0 ? a.act : "idle";
      if (want !== a.cur && av.has(want) && av.play(want, { fade: 0.35 })) a.cur = want;
      if (moving && a.cur === "walk") av.setSpeed(Math.max(0.5, Math.min(1.7, a.v / WALK_V)));
      av.tick(clock, dt, dist); });
    // real players: slide towards the latest reported spot (they report about every two seconds)
    for (const e of live.values()) { const k = Math.min(1, dt * 3), px = e.x, pz = e.z; e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; let dh = ((e.th - e.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI; e.h += dh * k; e.root.position.set(e.x, 0.05, e.z); e.root.rotation.y = e.h; const d = Math.hypot(e.x - px, e.z - pz);
      if (e.model) rollWheels(e.model, d);
      else if (e.av) { const v = d / Math.max(dt, 1e-3), want = v > 0.25 ? "walk" : "idle"; if (want !== e.cur && e.av.play(want, { fade: 0.3 })) e.cur = want; if (want === "walk") e.av.setSpeed(Math.max(0.5, Math.min(1.9, v / WALK_V))); e.av.update(clock, dt); e.av.root.position.y = 0.05; }
      else e.walker.pose((e.phase += d * 2.4), Math.min(1, d / dt / 1.2)); }
  }
  function dispose() { gone = true; for (const e of live.values()) { e.tag.userData.dispose(); e.av?.dispose(); } for (const a of peds) a.npc?.dispose(); group.traverse((o) => { if (o.userData.npcMesh || o.isSkinnedMesh) return; o.geometry?.dispose?.(); }); disposables.forEach((g) => g.dispose()); bodies.dispose(); wheelsM.dispose(); parent.remove(group); }
  return { update, setTravellers, dispose, peds /* read-only, for tests */ };
}