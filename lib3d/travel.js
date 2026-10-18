// lib3d/travel.js
// One trip across the campus, in 3D. It takes over the map's camera, then runs the whole story:
//   keke / bus / your car with a driver:  the vehicle comes, you get in, it drives the road in exactly 8 / 10 / 5 seconds, you get out, walk to the door and go in.
//   trek / your own car:                  you steer (stick, keys or buttons); a mini map shows the way; when you reach the building you go in.
// The fare is paid the moment the ride stops (o.onArrive), before you get out. Metres everywhere inside; the world group scales them to scene units.
import * as THREE from "three";
import { S } from "./campusReal.js";
import { buildRoadNet, destinationOf, drivePlan, findPath, isRoad, drivable, walkable, nearestWalkable, Path } from "./roadnet.js";
import { makeKeke, makeBus, makeVehicle, rollWheels } from "./vehicles.js";
import { createTraffic, nameTag, makeWalker } from "./traffic.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { paintBase, drawMini, drawPreview } from "./minimap.js";
import { rideSeconds } from "../lib/travel.js";

let netCache = null;
/** The road net for this campus data, built once (about a tenth of a second). */
export function getNet(data) { if (netCache?.data !== data) netCache = { data, net: buildRoadNet(data) }; return netCache.net; }
/** A place id to something with a position: named places come from the data; "bld_12" is building 12 with no name. */
export function resolvePlace(data, id) {
  if (id?.startsWith("bld_")) { const bd = data.buildings.find((b) => b.id === Number(id.slice(4))); if (!bd) return null; const n = bd.pts.length; return { id, bid: bd.id, x: bd.pts.reduce((t, p) => t + p[0], 0) / n, z: bd.pts.reduce((t, p) => t + p[1], 0) / n }; }
  const p = data.places.find((q) => q.id === id); return p && !p.offmap ? p : null;
}

const smoother = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (t * 6 - 15) + 10); };
const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const yawOf = (hx, hz) => Math.atan2(hx, hz);

/** A ribbon of chevrons lying on the road along `path` (width in metres). Returns { mesh, tex, dispose }. */
function ribbon(path, width, color) {
  const n = Math.max(2, Math.floor(path.len / 2)), pos = [], uv = [], idx = [], c = document.createElement("canvas"); c.width = 64; c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(8, 0, 48, 128); g.fillStyle = "#fff"; g.beginPath(); g.moveTo(10, 100); g.lineTo(32, 56); g.lineTo(54, 100); g.lineTo(54, 118); g.lineTo(32, 76); g.lineTo(10, 118); g.closePath(); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; const p = {};
  for (let i = 0; i <= n; i++) { const s = (path.len * i) / n; path.at(s, p); const rx = -p.hz * width / 2, rz = p.hx * width / 2; pos.push(p.x - rx, 0, p.z - rz, p.x + rx, 0, p.z + rz); uv.push(0, s / (width * 1.6), 1, s / (width * 1.6)); if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g2.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g2.setIndex(idx);
  const mesh = new THREE.Mesh(g2, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  mesh.position.y = 0.22; mesh.renderOrder = 5; mesh.frustumCulled = false;
  return { mesh, tex, dispose() { g2.dispose(); mesh.material.dispose(); tex.dispose(); } };
}

/** The door of a building: a frame, a panel that swings open, and a dark doorway behind it. Returns { group, open(k), dispose }. */
function buildDoor(door) {
  const w = door.width, group = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#6b3f26", roughness: 0.7 }), dark = new THREE.MeshBasicMaterial({ color: "#0b0d12" }), frame = new THREE.MeshStandardMaterial({ color: "#efe9d8", roughness: 0.8 }), glow = new THREE.MeshBasicMaterial({ color: "#ffe29a" });
  const add = (geo, m, x, y, z, parent = group) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  add(new THREE.PlaneGeometry(w, 2.5), dark, 0, 1.25, 0.06);
  add(new THREE.BoxGeometry(0.18, 2.7, 0.3), frame, -w / 2 - 0.09, 1.35, 0.1); add(new THREE.BoxGeometry(0.18, 2.7, 0.3), frame, w / 2 + 0.09, 1.35, 0.1); add(new THREE.BoxGeometry(w + 0.5, 0.22, 0.34), frame, 0, 2.62, 0.1);
  add(new THREE.BoxGeometry(w + 0.6, 0.06, 0.06), glow, 0, 2.8, 0.2); add(new THREE.BoxGeometry(w * 0.9, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: "#9b2f2f" }), 0, 0.04, 0.8); // a light above the door and a red mat
  const hinge = new THREE.Group(); hinge.position.set(-w / 2, 0, 0.1); group.add(hinge); add(new THREE.BoxGeometry(w, 2.45, 0.08), wood, w / 2, 1.225, 0, hinge); add(new THREE.BoxGeometry(0.08, 0.08, 0.14), glow, w - 0.2, 1.1, 0.07, hinge);
  group.position.set(door.x + door.nx * 0.04, 0.1, door.z + door.nz * 0.04); group.rotation.y = yawOf(door.nx, door.nz);
  return { group, open: (k) => { hinge.rotation.y = -k * 1.7; }, dispose() { group.traverse((o) => { o.geometry?.dispose?.(); }); } };
}

/**
 * Starts a trip. env: { stage, campus, light, data }. o: {
 *   from, to: place ids, mode: "trek"|"keke"|"bus"|"car", driver: boolean, look, gender, people: [{ name, gender, look }] or a Promise of that list (real players at the destination; the trip does not wait for it),
 *   input: { jx, jy, steer, gas, brake, run } (mutable; the on-screen controls write to it), miniCanvas(): canvas|null, previewCanvas(): canvas|null,
 *   onState(s), onArrive(): Promise<boolean>, onEnter(), onEnd(reason) }.
 * Returns { setTravellers(list), pos(), route(), dispose(), horn() }. Resolves once the scene is set up.
 */
export async function startTrip(env, o) {
  const { stage, campus, light, data } = env, net = getNet(data), base = paintBase(data, net), cam = stage.camera, ctl = stage.controls;
  const fromP = resolvePlace(data, o.from) ?? resolvePlace(data, "senate"), toP = resolvePlace(data, o.to);
  if (!toP) throw new Error("That place has no position on the map yet.");
  const A = destinationOf(net, fromP), B = destinationOf(net, toP), mode = o.mode, secs = rideSeconds(mode, !!o.driver), auto = secs != null, input = o.input ?? {};
  const world = new THREE.Group(); world.scale.setScalar(S); stage.scene.add(world);
  const saved = { near: cam.near, fov: cam.fov, shadow: { l: light.sun.shadow.camera.left, r: light.sun.shadow.camera.right, t: light.sun.shadow.camera.top, b: light.sun.shadow.camera.bottom } };
  stage.setManual(true); campus.setTripMode(true); campus.setSelected(null); cam.near = 0.03; cam.updateProjectionMatrix();
  Object.assign(light.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 }); light.sun.shadow.camera.updateProjectionMatrix();
  const disposers = []; let alive = true;

  // ---- the route ----
  const roadRoute = mode === "trek" ? null : drivePlan(net, A, B);
  let route = mode === "trek" ? findPath(net, A.front, B.front, "walk") : roadRoute;
  if (!route) route = new Path([[A.front.x, A.front.z], [B.front.x, B.front.z]]);
  let rb = null; const setRibbon = () => { if (rb) { world.remove(rb.mesh); rb.dispose(); } rb = ribbon(route, mode === "trek" ? 1.3 : 2.4, mode === "trek" ? "#4aa8ff" : "#2fe38a"); world.add(rb.mesh); }; setRibbon(); disposers.push(() => rb.dispose());
  // a beam of light over the destination so it can be seen from far away
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.set(B.front.x, 35, B.front.z); world.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(B.front.x, 0.25, B.front.z); world.add(ring);
  disposers.push(() => { beam.geometry.dispose(); beam.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); });
  let door = null; if (B.building) { door = buildDoor(B.door); world.add(door.group); disposers.push(door.dispose); }

  // ---- who is travelling ----
  const hero = { x: A.front.x, z: A.front.z, hx: 0, hz: 1, v: 0 }, camPt = { x: hero.x, z: hero.z };
  const me = { x: A.front.x, z: A.front.z, hx: 0, hz: 1 }; // the person
  let avatar = null, vehicle = null;
  const mkAvatar = async () => { try { return await createAvatar(o.look, o.gender); } catch { const w = makeWalker("#7f5236", "#1f2f55", "#a8946a"); return { root: w.root, play: () => false, update: () => {}, dispose() {}, walker: w }; } };
  avatar = await mkAvatar(); if (!alive) { avatar.dispose(); return null; } world.add(avatar.root); disposers.push(() => { world.remove(avatar.root); avatar.dispose(); });
  const placeAvatar = () => { avatar.root.position.set(me.x, 0.1, me.z); avatar.root.rotation.y = yawOf(me.hx, me.hz); };
  let walking = false; const setWalk = (w) => { if (w !== walking) { walking = w; avatar.play(w ? "walk" : "idle"); } };
  const avatarPhase = { p: 0 };
  if (mode !== "trek") { const m = mode === "keke" ? makeKeke() : mode === "bus" ? makeBus() : makeVehicle(o.car, o.carColor); vehicle = m; world.add(m.root); disposers.push(() => { world.remove(m.root); m.root.traverse((x) => x.geometry?.dispose?.()); }); }

  // real players waiting around the destination
  const there = [];
  (async () => { const list = await (o.people ?? []); /* an array, or a promise of one: the trip never waits for it */ for (const p of list.slice(0, 8)) { if (!alive) return; try { const av = await createAvatar(p.look, p.gender), tag = nameTag(p.name, { bg: "rgba(21,128,61,0.88)" });
    for (let k = 0; k < 14; k++) { const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 6, x = B.front.x + Math.cos(a) * r, z = B.front.z + Math.sin(a) * r; if (walkable(net, x, z) && !isRoad(net, x, z) || k === 13) { av.root.position.set(x, 0.1, z); av.root.rotation.y = Math.random() * 6.28; break; } }
    tag.position.set(0, 2.2, 0); av.root.add(tag); av.play("idle"); world.add(av.root); there.push({ av, tag }); } catch { /* a player whose model fails to load is simply not drawn */ } } })();
  disposers.push(() => { for (const t of there) { world.remove(t.av.root); t.tag.userData.dispose(); t.av.dispose(); } });

  const traffic = createTraffic({ parent: world, net, focus: () => camPt, hero: () => hero });
  disposers.push(() => traffic.dispose());

  // ---- state machine ----
  const state = { phase: "start", t: 0 };
  const go = (p) => { state.phase = p; state.t = 0; state.w0 = performance.now(); };
  const len = route.len, half = vehicle ? vehicle.length / 2 : 0;
  const s0 = vehicle ? Math.min(len * 0.4, half + 1.2) : 0, s1 = vehicle ? Math.max(s0, len - (half + 1.4)) : len;
  let s = s0, car = { v: 0, ang: 0, steer: 0 }, walkRoute = null, walkS = 0, boardT = 0, payPromise = null, entered = false, doorK = 0, camYaw = 0, camPitch = 0, userYaw = 0, userPitch = 0, userAt = -9, drag = null, time = 0, hornT = 0, lastState = 0, rerouteAt = 0;
  const p0 = route.at(s0, {}); if (vehicle) { hero.x = p0.x; hero.z = p0.z; hero.hx = p0.hx; hero.hz = p0.hz; vehicle.root.position.set(p0.x, 0.1, p0.z); vehicle.root.rotation.y = yawOf(p0.hx, p0.hz); car.ang = Math.atan2(p0.hx, p0.hz); }
  const p00 = route.at(0, {}); me.hx = vehicle ? p0.x - A.front.x : p00.hx; me.hz = vehicle ? p0.z - A.front.z : p00.hz; { const l = Math.hypot(me.hx, me.hz) || 1; me.hx /= l; me.hz /= l; }
  placeAvatar(); camYaw = yawOf(vehicle ? p0.hx : me.hx, vehicle ? p0.hz : me.hz); camPt.x = me.x; camPt.z = me.z;
  state.phase = "intro";

  // ---- controls: keys, and dragging the picture to look around ----
  const keys = new Set(), kd = (e) => { if (e.target?.closest?.("input,textarea")) return; keys.add(e.key.toLowerCase()); if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault(); }, ku = (e) => keys.delete(e.key.toLowerCase());
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); disposers.push(() => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); });
  const el = stage.renderer.domElement, pd = (e) => { drag = [e.clientX, e.clientY, userYaw, userPitch]; }, pm = (e) => { if (!drag) return; userYaw = drag[2] - (e.clientX - drag[0]) * 0.006; userPitch = Math.max(-0.4, Math.min(0.7, drag[3] + (e.clientY - drag[1]) * 0.004)); userAt = time; }, pu = () => { drag = null; };
  el.addEventListener("pointerdown", pd); window.addEventListener("pointermove", pm); window.addEventListener("pointerup", pu); disposers.push(() => { el.removeEventListener("pointerdown", pd); window.removeEventListener("pointermove", pm); window.removeEventListener("pointerup", pu); });
  const K = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0), read = () => ({ fwd: Math.max(K("w", "arrowup"), input.jy > 0 ? input.jy : 0), back: Math.max(K("s", "arrowdown"), input.jy < 0 ? -input.jy : 0), right: Math.max(K("d", "arrowright"), input.jx > 0 ? input.jx : 0) - Math.max(K("a", "arrowleft"), input.jx < 0 ? -input.jx : 0), run: keys.has("shift") || !!input.run, gas: Math.max(K("w", "arrowup"), input.gas ?? 0), brake: Math.max(K("s", "arrowdown") || K(" ", " "), input.brake ?? 0), steer: Math.max(-1, Math.min(1, K("d", "arrowright") - K("a", "arrowleft") + (input.steer ?? 0))) });

  // ---- each phase ----
  function walkTo(tx, tz, dt, speed) { const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz); if (d < 0.15) return true; const k = Math.min(d, speed * dt) / d; me.x += dx * k; me.z += dz * k; me.hx = dx / d; me.hz = dz / d; setWalk(true); avatarPhase.p += speed * dt * 2.4; return false; }
  function pose() { if (avatar.walker) avatar.walker.pose(avatarPhase.p, walking ? 1 : 0); }
  const arrive = () => { go("paying"); payPromise = Promise.resolve(o.onArrive?.() ?? true).then((ok) => { if (!alive) return; if (ok === false) { o.onEnd?.("failed"); return; } startAlight(); }).catch(() => { o.onEnd?.("failed"); }); };
  function startAlight() {
    const r = vehicle ? { x: -hero.hz, z: hero.hx } : { x: 0, z: 0 }, w = vehicle ? vehicle.width / 2 + 0.8 : 0; me.x = hero.x + r.x * w; me.z = hero.z + r.z * w; avatar.root.visible = true; placeAvatar();
    const from = nearestWalkable(net, me.x, me.z) ?? me; walkRoute = findPath(net, from, B.front, "walk") ?? new Path([[me.x, me.z], [B.front.x, B.front.z]]); walkS = 0; go("alight");
  }

  function update(dt) {
    time += dt; state.t += dt; const inp = read();
    if (state.phase === "intro") { if (state.t > 1.3) go(vehicle ? "board" : "trek"); }
    else if (state.phase === "board") { // walk to the vehicle and get in
      const r = { x: -hero.hz, z: hero.hx }, tx = hero.x + r.x * (vehicle.width / 2 + 0.4), tz = hero.z + r.z * (vehicle.width / 2 + 0.4), dist = Math.hypot(tx - me.x, tz - me.z);
      if (walkTo(tx, tz, dt, Math.max(2.4, dist / 1.8))) { avatar.root.visible = false; setWalk(false); go(auto ? "ride" : "drive"); } }
    else if (state.phase === "ride") { // the vehicle drives itself, taking exactly `secs` seconds
      const wt = (performance.now() - state.w0) / 1000, k0 = smoother(Math.max(0, wt - dt) / secs), k1 = smoother(Math.min(1, wt / secs)), ds = (s1 - s0) * (k1 - k0); s = s0 + (s1 - s0) * k1; const p = route.at(s, {}); hero.v = ds / dt; hero.x = p.x; hero.z = p.z; hero.hx = p.hx; hero.hz = p.hz; rollWheels(vehicle, ds); vehicle.root.position.set(p.x, 0.1 + Math.sin(time * 9) * 0.01, p.z); vehicle.root.rotation.y = yawOf(p.hx, p.hz);
      if (wt >= secs) { hero.v = 0; arrive(); } }
    else if (state.phase === "drive") { // you steer your own car
      const sp = Math.abs(car.v), want = inp.steer * (0.55 - Math.min(0.4, sp * 0.012)); car.steer += (want - car.steer) * Math.min(1, dt * 7);
      const dist = Math.hypot(hero.x - B.front.x, hero.z - B.front.z), nearEnd = dist < 16, vmax = isRoad(net, hero.x, hero.z) ? 28 : 9;
      if (nearEnd) car.v = Math.max(0, car.v - 26 * dt); // arrival assist: the car brakes itself to a stop at the door
      else { let acc = inp.gas * 11 - (car.v > 0 ? 3 : -3) * (inp.gas ? 0 : 1); if (inp.brake) acc -= car.v > 0.3 ? 26 : 0; if (inp.brake && car.v <= 0.3) acc = -8; car.v = Math.max(-4, Math.min(vmax, car.v + acc * dt)); if (!inp.gas && !inp.brake && Math.abs(car.v) < 0.3) car.v = 0; }
      car.ang += (car.v / 2.8) * Math.tan(car.steer) * dt; const hx = Math.sin(car.ang), hz = Math.cos(car.ang), nx = hero.x + hx * car.v * dt, nz = hero.z + hz * car.v * dt;
      if (drivable(net, nx, nz)) { hero.x = nx; hero.z = nz; } else if (drivable(net, nx, hero.z)) { hero.x = nx; car.v *= 0.9; } else if (drivable(net, hero.x, nz)) { hero.z = nz; car.v *= 0.9; } else car.v *= -0.25;
      hero.hx = hx; hero.hz = hz; hero.v = car.v; rollWheels(vehicle, car.v * dt, car.steer); vehicle.root.position.set(hero.x, 0.1, hero.z); vehicle.root.rotation.y = car.ang; s = route.nearest(hero.x, hero.z, s, 120);
      if (nearEnd && car.v < 0.4) { car.v = 0; hero.v = 0; arrive(); } }
    else if (state.phase === "trek") { // you walk
      const f = { x: Math.sin(camYaw + Math.PI), z: Math.cos(camYaw + Math.PI) }, r = { x: -f.z, z: f.x }, ax = (inp.fwd - inp.back) * f.x + inp.right * r.x, az = (inp.fwd - inp.back) * f.z + inp.right * r.z, m = Math.min(1, Math.hypot(ax, az));
      if (m > 0.05) { const speed = (inp.run ? 8.5 : 4.2) * m, nx = me.x + (ax / Math.hypot(ax, az)) * speed * dt, nz = me.z + (az / Math.hypot(ax, az)) * speed * dt;
        if (walkable(net, nx, nz)) { me.x = nx; me.z = nz; } else if (walkable(net, nx, me.z)) me.x = nx; else if (walkable(net, me.x, nz)) me.z = nz;
        const want = Math.atan2(ax, az), cur = yawOf(me.hx, me.hz), a = cur + angDiff(cur, want) * Math.min(1, dt * 12); me.hx = Math.sin(a); me.hz = Math.cos(a); setWalk(true); avatarPhase.p += speed * dt * 2.4; hero.v = speed; if (inp.fwd > 0.3 && Math.abs(angDiff(camYaw, yawOf(me.hx, me.hz) + Math.PI)) < 2.2 && time - userAt > 1.5) camYaw += angDiff(camYaw, yawOf(me.hx, me.hz) + Math.PI) * Math.min(1, dt * 1.1); } else { setWalk(false); hero.v = 0; }
      hero.x = me.x; hero.z = me.z; hero.hx = me.hx; hero.hz = me.hz; placeAvatar(); s = route.nearest(me.x, me.z, s, 150);
      if (time > rerouteAt && Math.hypot(me.x - route.at(s, {}).x, me.z - route.at(s, {}).z) > 40) { rerouteAt = time + 8; const nr = findPath(net, me, B.front, "walk"); if (nr) { route = nr; s = 0; setRibbon(); } }
      if (Math.hypot(me.x - B.front.x, me.z - B.front.z) < 3.2) { setWalk(false); arrive(); } }
    else if (state.phase === "alight") { // out of the vehicle, along to the door
      walkS += 2.6 * dt; const p = walkRoute.at(walkS, {}); me.x = p.x; me.z = p.z; me.hx = p.hx; me.hz = p.hz; setWalk(true); avatarPhase.p += 2.6 * dt * 2.4; placeAvatar();
      if (walkS >= walkRoute.len - 0.05) { setWalk(false); go("door"); } }
    else if (state.phase === "door") {
      if (!B.building) { if (state.t > 0.6) finishEnter(); }
      else { me.hx = -B.door.nx; me.hz = -B.door.nz; placeAvatar(); doorK = Math.min(1, state.t / 0.7); door.open(doorK); if (state.t > 0.9) go("enter"); } }
    else if (state.phase === "enter") { // through the doorway
      const k = Math.min(1, state.t / 1.4), d = -B.door.nx, e = -B.door.nz, fx = B.front.x, fz = B.front.z; me.x = fx + (d * 3.2) * k; me.z = fz + (e * 3.2) * k; me.hx = d; me.hz = e; setWalk(true); avatarPhase.p += 2.4 * dt * 2.4; placeAvatar();
      if (k > 0.55) avatar.root.visible = false; if (k >= 1) finishEnter(); }
    if (state.phase !== "board") pose();
    avatar.update?.(time, dt);
  }
  function finishEnter() { if (entered) return; entered = true; go("inside"); o.onEnter?.(); }

  // ---- camera ----
  function follow(dt) {
    const veh = !!vehicle && ["ride", "drive", "paying"].includes(state.phase), t = veh ? hero : me, sp = Math.abs(hero.v ?? 0);
    const headYaw = veh ? yawOf(hero.hx, hero.hz) + Math.PI : camYaw; // camera yaw: the direction from the target back to the camera
    if (veh) { const d = angDiff(camYaw, headYaw); camYaw += d * Math.min(1, dt * (state.phase === "ride" ? 5 : 3)); }
    else if (state.phase === "alight" || state.phase === "door" || state.phase === "enter" || state.phase === "intro" || state.phase === "board") { const want = yawOf(me.hx, me.hz) + Math.PI, d = angDiff(camYaw, want); camYaw += d * Math.min(1, dt * 1.6); }
    if (time - userAt > 2.5) { userYaw *= Math.pow(0.2, dt); userPitch *= Math.pow(0.4, dt); }
    const back = veh ? 8 + Math.min(34, sp * 0.16) : 3.6, height = (veh ? 3.8 + Math.min(18, sp * 0.09) : 1.9) + userPitch * back * 1.2, yaw = camYaw + userYaw;
    camPt.x = t.x; camPt.z = t.z;
    const cx = t.x + Math.sin(yaw) * back, cz = t.z + Math.cos(yaw) * back, k = Math.min(1, dt * (time < 1.4 ? 3.2 : 12));
    cam.position.x += (cx * S - cam.position.x) * k; cam.position.z += (cz * S - cam.position.z) * k; cam.position.y += (height * S - cam.position.y) * k;
    const look = veh ? 1.2 : 1.3, ahead = veh ? Math.min(10, sp * 0.1) : 0; ctl.target.set((t.x - Math.sin(yaw) * ahead) * S, look * S, (t.z - Math.cos(yaw) * ahead) * S); cam.lookAt(ctl.target);
    const fov = 42 + Math.min(18, sp * 0.12); if (Math.abs(cam.fov - fov) > 0.2) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 4); cam.updateProjectionMatrix(); }
  }

  const off = stage.onFrame((tm, dt) => {
    if (!alive) return; update(dt); traffic.update(dt); rb.tex.offset.y -= dt * 1.6;
    beam.material.opacity = 0.2 + Math.sin(time * 3) * 0.08; ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08); hornT = Math.max(0, hornT - dt);
    follow(dt);
    // the little map and (when open) the full preview
    const live = { x: hero.x, z: hero.z, hx: hero.hx, hz: hero.hz, route: route, mode: mode === "car" && !auto ? "car" : mode, dest: { x: B.front.x, z: B.front.z }, from: { x: A.front.x, z: A.front.z } }, drive = mode !== "trek", mini = o.miniCanvas?.(), prev = o.previewCanvas?.();
    live.mode = drive ? "drive" : "trek"; if (mini) drawMini(mini, base, live); if (prev) drawPreview(prev, base, live);
    if (time - lastState > 0.1) { lastState = time; const remain = Math.max(0, route.len - (state.phase === "alight" || state.phase === "door" || state.phase === "enter" ? route.len : s)); const left = Math.hypot(hero.x - B.front.x, hero.z - B.front.z);
      o.onState?.({ phase: state.phase, mode, auto, secs, left: auto && state.phase === "ride" ? Math.max(0, secs - (performance.now() - state.w0) / 1000) : null, remain: Math.round(state.phase === "alight" ? left : remain), speed: Math.round(Math.abs(hero.v ?? 0) * 3.6), canHorn: mode === "car" && state.phase === "drive" }); }
  });

  const api = {
    traffic, setTravellers: (l) => traffic.setTravellers(l), pos: () => ({ x: hero.x, z: hero.z, h: Math.atan2(hero.hx, hero.hz) }), route: () => route,
    horn() { if (hornT > 0) return; hornT = 0.4; o.onHorn?.(); },
    dispose() { if (!alive) return; alive = false; off?.(); for (const d of disposers.reverse()) { try { d(); } catch { /* clean up as much as possible */ } } stage.scene.remove(world); stage.setManual(false); campus.setTripMode(false);
      cam.near = saved.near; cam.fov = saved.fov; cam.updateProjectionMatrix(); Object.assign(light.sun.shadow.camera, { left: saved.shadow.l, right: saved.shadow.r, top: saved.shadow.t, bottom: saved.shadow.b }); light.sun.shadow.camera.updateProjectionMatrix(); },
  };
  return api;
}