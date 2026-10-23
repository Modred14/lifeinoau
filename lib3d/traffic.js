// lib3d/traffic.js
// The life on the road during a trip: a few NPC cars, the odd keke and bus, some people walking, and the real players who are travelling at the same time.
// It is deliberately sparse (the road is meant to feel lived in, not crowded). What moves and where is decided by lib3d/trafficsim.js (vehicles follow lanes on the road
// graph, give way at junctions and keep their distance); this file only draws it. Metres, x east, z south, y up; nose towards +z like vehicles.js.
import * as THREE from "three";
import { createTrafficSim } from "./trafficsim.js";
import { createNpc, npcSpec } from "./avatar/npc.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { lookKey } from "../lib/look.js";
import { carBodyGeometry, CAR_WHEELS, CAR_WHEEL_R, CAR_COLORS, makeKeke, makeBus, makeCar, rollWheels } from "./vehicles.js";

export const DENSITY = { cars: 6, kekes: 2, buses: 1, peds: 10 }; // within about 250 m of the camera


/** A walking figure made of boxes (for NPCs and for real players seen from a distance). Returns { root, pose(phase, amount) }. */
export function makeWalker(skin, shirt, trouser) {
  const root = new THREE.Group(), m = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }), part = (w, h, d, x, y, z, c, pivotTop) => { const g = new THREE.BoxGeometry(w, h, d); if (pivotTop) g.translate(0, -h / 2, 0); const o = new THREE.Mesh(g, m(c)); o.position.set(x, y, z); o.castShadow = true; root.add(o); return o; };
  part(0.42, 0.6, 0.24, 0, 1.15, 0, shirt); const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), m(skin)); head.position.y = 1.6; root.add(head);
  const l1 = part(0.16, 0.82, 0.18, -0.11, 0.86, 0, trouser, true), l2 = part(0.16, 0.82, 0.18, 0.11, 0.86, 0, trouser, true), a1 = part(0.1, 0.56, 0.12, -0.27, 1.43, 0, skin, true), a2 = part(0.1, 0.56, 0.12, 0.27, 1.43, 0, skin, true);
  return { root, pose(phase, k) { const s = Math.sin(phase) * 0.7 * k; l1.rotation.x = s; l2.rotation.x = -s; a1.rotation.x = -s * 0.8; a2.rotation.x = s * 0.8; } };
}

const R = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/**
 * parent: a group in metres. svc: the world services (lib3d/worldsvc.js: road graph and collision world). focus(): { x, z } the camera's ground point.
 * tags: an optional name-tag layer (lib3d/playerTags.js). Real players on the road get a tag that follows them; the NPC cars and walkers never do.
 * Returns { update(dt), setTravellers(list), dispose(), sim }. `sim` is the traffic simulation: the trip uses it for the vehicle that carries the player,
 * and tells it where the player is so vehicles give way to them.
 */
export function createTraffic({ parent, svc, focus, density = DENSITY, seed = 7, tags = null }) {
  const rnd = R(seed), group = new THREE.Group(); parent.add(group);
  const disposables = [];
  const sim = createTrafficSim({ graph: svc.graph, world: svc.world, focus, rnd, density: { vehicles: density.cars + density.kekes + density.buses, peds: density.peds, limits: { car: density.cars, keke: density.kekes, bus: density.buses } } });
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
  const addNpc = (s, av) => { av.root.visible = false; av.root.position.set(0, -50, 0); group.add(av.root); s.npc = av; s.cur = null; };
  const loadNpc = async () => { try { const av = await createNpc(npcSpec(++npcSeq, { role: rnd() < 0.08 ? "staff" : "student" })); if (gone) { av.dispose(); return null; } return av; } catch { return null; } };
  // a pool of characters; the simulation's pedestrians take one each while they are alive
  const pedSlots = Array.from({ length: nPed }, () => ({ id: null, npc: null, cur: null, loading: false }));
  pedSlots.forEach(async (s) => { const av = await loadNpc(); if (av) addNpc(s, av); }); // the walkers appear as their characters finish loading
  // ---- keke and bus models: a pool, each taken by one simulated vehicle while it is alive ----
  const pools = { keke: Array.from({ length: density.kekes }, () => ({ id: null, model: makeKeke() })), bus: Array.from({ length: density.buses }, () => ({ id: null, model: makeBus() })) };
  for (const s of [...pools.keke, ...pools.bus]) { s.model.root.visible = false; s.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; }); group.add(s.model.root); }
  const carSlots = Array.from({ length: nCars }, () => ({ id: null, phase: 0, color: CAR_COLORS[0] }));
  const tmp = new THREE.Matrix4(), base = new THREE.Matrix4(), loc = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1), col = new THREE.Color();
  const hide = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---- real players on the road, drawn at the spot they last reported and eased towards each new one ----
  const live = new Map();
  function setTravellers(list) {
    const now = performance.now(), seen = new Set();
    for (const t of list) {
      seen.add(t.id); let e = live.get(t.id);
      const key = lookKey(t.look, t.gender);
      if (e && e.walker && e.key !== key) { group.remove(e.root); tags?.remove(t.id); if (e.av) e.av.dispose(); live.delete(t.id); e = undefined; } // they changed their look: draw the new one, not the old
      if (!e) { const model = t.mode === "keke" ? makeKeke() : t.mode === "bus" ? makeBus() : t.mode === "car" ? makeCar() : null, walker = model ? null : makeWalker("#8d5a3b", "#2f62c4", "#1f2f55"), root = model ? model.root : new THREE.Group(), tag = new THREE.Object3D();
        if (walker) { // on foot: the player's own look, drawn like everyone else, replaces the stand-in as soon as it has loaded
          e = { root, model, walker, tag, key, x: t.x, z: t.z, h: t.h, tx: t.x, tz: t.z, th: t.h, phase: 0, at: now };
          // A real player is built by createAvatar from exactly their saved look: the same body, skin tone, hair, clothes and size they have in their room and in every building.
          // (Never through npcSpec: that adds random NPC variation, and gives a random person to a player whose look is not set.) If the model cannot load, the built-in
          // character in the same look is used, so the stand-in box figure is only for a character that could not be built at all.
          createAvatar(t.look, t.gender === "F" ? "F" : "M", { lod: false }).then((av) => { if (!live.has(t.id) || live.get(t.id) !== e || gone) { av.dispose(); return; } av.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.npcMesh = true; } }); /* the avatar owns its meshes: dispose() below must not free the shared model geometry */ e.av = av; e.cur = null; root.add(av.root); }).catch(() => root.add(walker.root));
        }
        tag.position.set(0, model ? model.height + 0.9 : 2.2, 0); root.add(tag); group.add(root); tags?.set(t.id, { name: t.name, anchor: tag }); root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        e = e ?? { root, model, walker, tag, x: t.x, z: t.z, h: t.h, tx: t.x, tz: t.z, th: t.h, phase: 0, at: now }; live.set(t.id, e); }
      Object.assign(e, { tx: t.x, tz: t.z, th: t.h, at: now, mode: t.mode });
      tags?.set(t.id, { name: t.name, anchor: e.tag }); // a no-op for the same player; refuses anyone who may not carry a tag
    }
    for (const [id, e] of live) if (!seen.has(id)) { group.remove(e.root); tags?.remove(id); if (e.av) e.av.dispose(); e.root.traverse((o) => { if (!e.av || !e.av.root.getObjectById(o.id)) o.geometry?.dispose?.(); }); live.delete(id); }
  }

  let clock = 0;
  /** Gives each live id a slot in `slots` (and frees the slots of ids that have gone). */
  function assign(slots, ids) { const live = new Set(ids); for (const s of slots) if (s.id != null && !live.has(s.id)) s.id = null; for (const id of ids) if (!slots.some((s) => s.id === id)) { const s = slots.find((x) => x.id == null); if (s) { s.id = id; s.fresh = true; } } }

  /** Advances the simulation and draws it. */
  function update(dt) {
    clock += dt; sim.update(dt); const f = focus();
    const npcs = sim.vehicles.filter((v) => v.role === "npc" && !v.custom && !v.done), byId = new Map(npcs.map((v) => [v.id, v]));
    // cars
    assign(carSlots, npcs.filter((v) => v.kind === "car").map((v) => v.id));
    carSlots.forEach((s, i) => { const a = s.id == null ? null : byId.get(s.id);
      if (!a) { bodies.setMatrixAt(i, hide); for (let w = 0; w < 4; w++) wheelsM.setMatrixAt(i * 4 + w, hide); return; }
      s.phase += (a.v * dt) / CAR_WHEEL_R; q.setFromAxisAngle(up, a.yaw); base.compose(v3.set(a.x, 0.05, a.z), q, sc); bodies.setMatrixAt(i, base); bodies.setColorAt(i, col.set(CAR_COLORS[Math.floor(a.tint * CAR_COLORS.length) % CAR_COLORS.length]));
      CAR_WHEELS.forEach(([wx, wz], w) => { tmp.makeRotationX(s.phase); loc.makeTranslation(wx, CAR_WHEEL_R, wz).multiply(tmp); wheelsM.setMatrixAt(i * 4 + w, tmp.multiplyMatrices(base, loc)); }); });
    bodies.instanceMatrix.needsUpdate = true; wheelsM.instanceMatrix.needsUpdate = true; if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    // kekes and buses
    for (const kind of ["keke", "bus"]) { assign(pools[kind], npcs.filter((v) => v.kind === kind).map((v) => v.id));
      for (const s of pools[kind]) { const a = s.id == null ? null : byId.get(s.id); s.model.root.visible = !!a; if (!a) continue; s.model.root.position.set(a.x, 0.05, a.z); s.model.root.rotation.y = a.yaw; rollWheels(s.model, a.v * dt); } }
    // people
    const peds = sim.peds, pById = new Map(peds.map((p) => [p.id, p]));
    for (const s of pedSlots) if (s.id != null && !pById.has(s.id)) s.id = null;
    for (const p of peds) if (!pedSlots.some((s) => s.id === p.id)) { const s = pedSlots.find((x) => x.id == null && x.npc); if (s) { s.id = p.id;
      if (!s.loading) { s.loading = true; loadNpc().then((av) => { s.loading = false; if (!av) return; // swap in a new person only if the old one is not being looked at
        const pp = pById.get(s.id); if (s.npc && (!pp || Math.hypot(pp.x - focus().x, pp.z - focus().z) > 60)) { group.remove(s.npc.root); s.npc.dispose(); addNpc(s, av); } else av.dispose(); }); } } }
    for (const s of pedSlots) { const av = s.npc; if (!av) continue; const p = s.id == null ? null : pById.get(s.id);
      if (!p) { av.root.visible = false; continue; }
      const dist = Math.hypot(p.x - f.x, p.z - f.z); av.root.position.set(p.x, 0.1, p.z); av.root.rotation.y = Math.atan2(p.hx, p.hz);
      const moving = p.v > 0.2 && !(p.pause > 0), want = moving ? "walk" : p.pause > 0 ? p.act : "idle";
      if (want !== s.cur && av.has(want) && av.play(want, { fade: 0.35 })) s.cur = want;
      if (moving && s.cur === "walk") av.setSpeed(Math.max(0.5, Math.min(1.7, p.v / WALK_V)));
      av.tick(clock, dt, dist); }
    // real players: slide towards the latest reported spot (they report about every two seconds)
    for (const e of live.values()) { const k = Math.min(1, dt * 3), px = e.x, pz = e.z; e.x += (e.tx - e.x) * k; e.z += (e.tz - e.z) * k; let dh = ((e.th - e.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI; e.h += dh * k; e.root.position.set(e.x, 0.05, e.z); e.root.rotation.y = e.h; const d = Math.hypot(e.x - px, e.z - pz);
      if (e.model) rollWheels(e.model, d);
      else if (e.av) { const v = d / Math.max(dt, 1e-3), want = v > 0.25 ? "walk" : "idle"; if (want !== e.cur && e.av.play(want, { fade: 0.3 })) e.cur = want; if (want === "walk") e.av.setSpeed(Math.max(0.5, Math.min(1.9, v / WALK_V))); e.av.update(clock, dt); e.av.root.position.y = 0.05; }
      else e.walker.pose((e.phase += d * 2.4), Math.min(1, d / dt / 1.2)); }
  }
  function dispose() { gone = true; for (const [id, e] of live) { tags?.remove(id); e.av?.dispose(); } for (const s of pedSlots) s.npc?.dispose(); sim.dispose?.(); group.traverse((o) => { if (o.userData.npcMesh || o.isSkinnedMesh) return; o.geometry?.dispose?.(); }); disposables.forEach((g) => g.dispose()); bodies.dispose(); wheelsM.dispose(); parent.remove(group); }
  return { update, setTravellers, dispose, sim, peds: pedSlots /* read-only, for tests */ };
}