// lib3d/travel.js
// One trip across the campus, in 3D. It takes over the map's camera, then runs the whole story:
//   keke / bus / a car with a driver:  the vehicle is sent to the kerb nearest you, you WALK to its right-hand door round whatever is in the way, step in, it drives the
//                                      road route at its own speed (nothing is timed: the journey takes distance / speed), you step out at the kerb and walk to the door.
//   trek / your own car:               you steer (stick, keys or buttons); a mini map shows the way; your car stays on the road; when you reach the building you go in.
// What happens is decided by lib3d/tripflow.js (the state machine) on top of lib3d/tripplan.js (the plan and the estimate), lib3d/walker.js (people), lib3d/trafficsim.js
// (vehicles) and lib3d/collide.js (what is solid). This file draws it: the camera, the avatar, the vehicle models, the guide ribbon, the door, the mini map.
// The fare is settled with the server in the background the moment the ride stops (o.onArrive); you do not wait for it to step out and walk. Everything you do is local and immediate;
// what is sent to the server (lib/tripSync.js) never moves you. Metres everywhere inside; the world group scales them to scene units.
import * as THREE from "three";
import { S } from "./campusReal.js";
import { buildRoadNet, isRoad, walkable, Path } from "./roadnet.js";
import { makeKeke, makeBus, makeVehicle, rollWheels, addDriver } from "./vehicles.js";
import { KINDS } from "./trafficsim.js";
import { loadServices } from "./worldsvc.js";
import { planTrip } from "./tripplan.js";
import { createTripFlow } from "./tripflow.js";
import { createTraffic, makeWalker } from "./traffic.js";
import { createPlayerTags, isTaggable } from "./playerTags.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { lookKey } from "../lib/look.js";
import { paintBase, drawMini, drawPreview } from "./minimap.js";
import { createGuide } from "./tripguide.js";
import { CAM, PITCH, clamp, ease, frame, clearBack, followBack, zoomByPinch, zoomByWheel } from "./tripcam.js";
import { attachTripPointer } from "./tripinput.js";

let netCache = null;
/** The road net for this campus data, built once (about a tenth of a second). */
export function getNet(data) { if (netCache?.data !== data) netCache = { data, net: buildRoadNet(data) }; return netCache.net; }
/** A place id to something with a position: named places come from the data; "bld_12" is building 12 with no name. */
export function resolvePlace(data, id) {
  if (id?.startsWith("bld_")) { const bd = data.buildings.find((b) => b.id === Number(id.slice(4))); if (!bd) return null; const n = bd.pts.length; return { id, bid: bd.id, x: bd.pts.reduce((t, p) => t + p[0], 0) / n, z: bd.pts.reduce((t, p) => t + p[1], 0) / n }; }
  const p = data.places.find((q) => q.id === id); return p && !p.offmap ? p : null;
}

const angDiff = (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
const yawOf = (hx, hz) => Math.atan2(hx, hz);

/**
 * A ribbon of chevrons lying on the ground along a route. Made once; `set(pts, s0, width, color)` rebuilds only its shape (from the live route, which starts under the traveller), so a
 * new route never leaves an old one on screen. `s0` is how far along the whole route the first point is, so the chevrons keep their place as the start moves. Returns { mesh, tex, set, dispose }.
 */
function makeRibbon() {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "rgba(255,255,255,0.28)"; g.fillRect(8, 0, 48, 128); g.fillStyle = "#fff"; g.beginPath(); g.moveTo(10, 100); g.lineTo(32, 56); g.lineTo(54, 100); g.lineTo(54, 118); g.lineTo(32, 76); g.lineTo(10, 118); g.closePath(); g.fill();
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: tex, color: "#4aa8ff", transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8 }));
  mesh.position.y = 0.22; mesh.renderOrder = 5; mesh.frustumCulled = false; mesh.visible = false;
  const p = {};
  function set(pts, s0, width, color) {
    const path = new Path(pts.length > 1 ? pts : [pts[0], [pts[0][0] + 0.1, pts[0][1]]]), n = Math.max(2, Math.floor(path.len / 2)), pos = [], uv = [], idx = [];
    for (let i = 0; i <= n; i++) { const d = (path.len * i) / n; path.at(d, p); const rx = -p.hz * width / 2, rz = p.hx * width / 2, v = (s0 + d) / (width * 1.6); pos.push(p.x - rx, 0, p.z - rz, p.x + rx, 0, p.z + rz); uv.push(0, v, 1, v); if (i) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    const old = mesh.geometry, g2 = new THREE.BufferGeometry(); g2.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g2.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g2.setIndex(idx); mesh.geometry = g2; old.dispose(); mesh.material.color.set(color);
  }
  return { mesh, tex, set, dispose() { mesh.geometry.dispose(); mesh.material.dispose(); tex.dispose(); } };
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

/** Why a trip could not be planned, in words for the player (the page shows it). */
const WHY = { noroad: "No road reaches that place, so no ride can take you there. You can trek.", noroute: "No road route leads there from here. You can trek.", unreachable: "There is no clear way on foot between the road and that place." };

/**
 * Starts a trip. env: { stage, campus, light, data }. o: {
 *   from, to: place ids, mode: "trek"|"keke"|"bus"|"car", driver: boolean, car, carColor (the player's own car model and paint), look, gender, people: [{ name, gender, look }] or a Promise of that list (real players at the destination; the trip does not wait for it),
 *   input: { jx, jy, steer, gas, brake, run } (mutable; the on-screen controls write to it), miniCanvas(): canvas|null, previewCanvas(): canvas|null,
 *   onState(s), onArrive(): Promise<boolean>, onEnter(), onEnd(reason), onNotice(text) }.
 * o.selfName: your own character (it never gets a name tag). o.pollPeople(): optional, asked again every few seconds for the players at the destination.
 * Returns { setTravellers(list), pos(), route(), plan, dispose(), horn() }. Resolves once the scene is set up. Throws an Error with .reason when the trip cannot be planned.
 */
export async function startTrip(env, o) {
  const { stage, campus, light, data } = env, cam = stage.camera, ctl = stage.controls;
  const fromP = resolvePlace(data, o.from) ?? resolvePlace(data, "senate"), toP = resolvePlace(data, o.to);
  if (!toP) throw Object.assign(new Error("That place has no position on the map yet."), { reason: "error" });
  const svc = await loadServices(data), net = svc.net, base = paintBase(data, net), input = o.input ?? {}, mode = o.mode;
  const plan = planTrip(svc, { from: fromP, to: toP, mode, driver: !!o.driver });
  if (!plan.ok) { const e = Object.assign(new Error(WHY[plan.reason] ?? "That trip cannot be planned."), { reason: plan.reason === "unreachable" ? "unreachable" : "noroad", text: WHY[plan.reason] }); throw e; }
  const A = plan.A, B = plan.B, driven = !!plan.driven, auto = driven;
  const world = new THREE.Group(); world.scale.setScalar(S); stage.scene.add(world);
  const saved = { near: cam.near, fov: cam.fov, shadow: { l: light.sun.shadow.camera.left, r: light.sun.shadow.camera.right, t: light.sun.shadow.camera.top, b: light.sun.shadow.camera.bottom } };
  stage.setManual(true); campus.setTripMode(true); campus.setSelected(null); cam.near = 0.03; cam.updateProjectionMatrix();
  Object.assign(light.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 }); light.sun.shadow.camera.updateProjectionMatrix();
  const disposers = []; let alive = true;

  // ---- the guide: a ribbon of chevrons on the way to go, and the beam over the destination ----
  // The route is NEVER the one planned when the trip began: lib3d/tripguide.js works it out from where the traveller is now to where they are going, again whenever the leg changes
  // (on foot -> in the vehicle -> on foot) or they leave the route, and shows only the part still ahead. This block only draws it.
  const guide = createGuide({ nav: svc.nav, graph: svc.graph, plan }), rb = makeRibbon(); world.add(rb.mesh); disposers.push(() => rb.dispose());
  let gd = guide.update(0, { phase: "intro", x: plan.start.x, z: plan.start.z }), rbRev = -1, rbAt = -9;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.set(B.front.x, 35, B.front.z); world.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(B.front.x, 0.25, B.front.z); world.add(ring);
  disposers.push(() => { beam.geometry.dispose(); beam.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); });
  let door = null; if (B.building) { door = buildDoor(B.door); world.add(door.group); disposers.push(door.dispose); }

  // ---- the person and the vehicle ----
  let avatar = null; const mkAvatar = async () => { try { return await createAvatar(o.look, o.gender); } catch { const w = makeWalker("#7f5236", "#1f2f55", "#a8946a"); return { root: w.root, play: () => false, has: () => false, setSpeed() {}, update: () => {}, dispose() {}, walker: w }; } };
  avatar = await mkAvatar(); if (!alive) { avatar.dispose(); return null; } world.add(avatar.root); disposers.push(() => { world.remove(avatar.root); avatar.dispose(); });
  let vehicle = null;
  if (mode !== "trek") { const m = mode === "keke" ? makeKeke() : mode === "bus" ? makeBus() : makeVehicle(o.car, o.carColor); if (plan.driven && KINDS[plan.kind].driver) addDriver(m, KINDS[plan.kind].driver, mode === "bus" ? "#c0762b" : "#3b6ea5"); m.root.visible = false; vehicle = m; world.add(m.root); disposers.push(() => { world.remove(m.root); m.root.traverse((x) => x.geometry?.dispose?.()); }); }

  // name tags for real players (the ones waiting at the destination and the ones on the road); never for you, never for NPCs
  const tags = createPlayerTags({ container: stage.renderer.domElement.parentElement, camera: stage.camera, selfName: o.selfName ?? "", unit: S, maxDist: 45, fadeFrom: 30 });
  disposers.push(() => tags.dispose());

  // real players waiting around the destination: kept in step with the server's list, so one who leaves loses their avatar and name at once
  const there = new Map(); // public id -> { av, anchor, key } (null while the avatar is still loading)
  const dropThere = (id) => { const t = there.get(id); there.delete(id); tags.remove(id); if (t) { world.remove(t.av.root); t.av.dispose(); } };
  const spotFor = (id) => { let h = 7; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const a0 = (h % 628) / 100, r = 2.5 + ((h >>> 10) % 60) / 10;
    for (let k = 0; k < 14; k++) { const a = a0 + k * 0.9, x = B.front.x + Math.cos(a) * r, z = B.front.z + Math.sin(a) * r; if ((walkable(net, x, z) && !isRoad(net, x, z) && !svc.world.blockedAt(x, z, 0.6)) || k === 13) return { x, z, yaw: (h % 360) * Math.PI / 180 }; } };
  const addThere = async (p) => {
    if (!alive || there.has(p?.id) || there.size >= 8 || !isTaggable(p, { name: o.selfName })) return;
    there.set(p.id, null);
    try { const av = await createAvatar(p.look, p.gender); if (!alive || !there.has(p.id)) { av.dispose(); return; }
      const sp = spotFor(p.id), anchor = new THREE.Object3D(); anchor.position.set(0, 2.2, 0); av.root.add(anchor); av.root.position.set(sp.x, 0.1, sp.z); av.root.rotation.y = sp.yaw; av.play("idle"); world.add(av.root);
      there.set(p.id, { av, anchor, key: lookKey(p.look, p.gender) }); tags.set(p.id, { name: p.name, anchor, meta: { level: p.level, faculty: p.faculty } });
    } catch { there.delete(p.id); /* a player whose model fails to load is simply not drawn */ } };
  const syncThere = (list) => { const ids = new Set((list ?? []).map((p) => p?.id)); for (const id of [...there.keys()]) if (!ids.has(id)) dropThere(id); for (const p of (list ?? []).slice(0, 8)) { const t = there.get(p?.id); if (t && t.key !== lookKey(p.look, p.gender)) dropThere(p.id); /* changed their look: rebuilt below */ addThere(p); } };
  (async () => { syncThere(await (o.people ?? [])); /* an array, or a promise of one: the trip never waits for it */ })();
  const pollThere = o.pollPeople ? setInterval(async () => { try { const l = await o.pollPeople(); if (alive) syncThere(l); } catch { /* try again next time */ } }, 5000) : null;
  disposers.push(() => { clearInterval(pollThere); for (const id of [...there.keys()]) dropThere(id); });

  const camPt = { x: plan.start.x, z: plan.start.z };
  const traffic = createTraffic({ parent: world, svc, focus: () => camPt, tags }); disposers.push(() => traffic.dispose());

  // ---- the journey ----
  const flow = createTripFlow({ svc, sim: traffic.sim }, { plan, dims: vehicle && mode === "car" ? { len: vehicle.length, wid: vehicle.width } : null, rnd: Math.random, onArrive: () => o.onArrive?.() ?? true, onEnter: () => o.onEnter?.(), onEnd: (why) => { if (alive) o.onEnd?.(why); }, onNotice: (m) => o.onNotice?.(m) });
  disposers.push(() => flow.dispose());
  const P = flow.person, F = flow.state, WK = flow.walker;
  let camYaw = Math.atan2(-(plan.start.x - (plan.doorIn?.x ?? plan.goal.x)), -(plan.start.z - (plan.doorIn?.z ?? plan.goal.z))), userYaw = 0, userPitch = 0, userAt = -9, time = 0, hornT = 0, lastState = 0, camBack = CAM.walk.back, zoomW = 1, zoomV = 1, leadX = 0, leadZ = 0, swipe = 0;
  camPt.x = P.x; camPt.z = P.z; WK.hx = Math.sin(camYaw + Math.PI); WK.hz = Math.cos(camYaw + Math.PI);

  // ---- controls: keys (cleared when the window loses focus, so a key never sticks), and dragging the picture to look around ----
  const keys = new Set(), kd = (e) => { if (e.target?.closest?.("input,textarea")) return; keys.add(e.key.toLowerCase()); if (e.key === " " || e.key.startsWith("Arrow")) e.preventDefault(); }, ku = (e) => keys.delete(e.key.toLowerCase()), blur = () => keys.clear();
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", blur); disposers.push(() => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur); });
  // Looking round, zooming and (on a touch screen, while driving) swiping to steer all come through lib3d/tripinput.js: every finger is tracked by its own id on the canvas only, so a finger on
  // the on-screen stick or a button is never also read as a camera drag, a second finger pinches instead of rotating, and the orbit controls are switched off for the whole trip (stage.setManual).
  const inVehNow = () => !!vehicle && ["ride", "drive", "paying"].includes(F.phase);
  const el = stage.renderer.domElement, pointer = attachTripPointer(el, {
    mode: () => (!alive || F.phase === "inside" ? "none" : F.phase === "drive" ? "steer" : "look"),
    look: (dYaw, dPitch) => { if (inVehNow()) userYaw = clamp(userYaw - dYaw, -1.7, 1.7); else camYaw -= dYaw; userPitch = clamp(userPitch + dPitch, PITCH.min, PITCH.max); userAt = time; },
    zoom: (scale) => { if (inVehNow()) zoomV = zoomByPinch(zoomV, scale, "veh"); else zoomW = zoomByPinch(zoomW, scale, "walk"); },
    wheel: (dy) => { if (inVehNow()) zoomV = zoomByWheel(zoomV, dy, "veh"); else zoomW = zoomByWheel(zoomW, dy, "walk"); },
    steer: (v) => { swipe = v; },
  });
  disposers.push(() => pointer.detach());
  const K = (a, b) => (keys.has(a) || keys.has(b) ? 1 : 0), read = () => ({ fwd: Math.max(K("w", "arrowup"), input.jy > 0 ? input.jy : 0), back: Math.max(K("s", "arrowdown"), input.jy < 0 ? -input.jy : 0), right: Math.max(K("d", "arrowright"), input.jx > 0 ? input.jx : 0) - Math.max(K("a", "arrowleft"), input.jx < 0 ? -input.jx : 0), run: keys.has("shift") || !!input.run, gas: Math.max(K("w", "arrowup"), input.gas ?? 0), brake: Math.max(K("s", "arrowdown") || K(" ", " "), input.brake ?? 0), steer: Math.max(-1, Math.min(1, K("d", "arrowright") - K("a", "arrowleft") + (input.steer ?? 0) + swipe)) });

  // ---- drawing what the journey says ----
  let gait = "", lastPhase = "";
  // Your saved look changed while you are travelling (Settings): swap the body, keep everything else. Only the newest request counts.
  let selfTicket = 0, selfKey = lookKey(o.look, o.gender);
  const setLook = async (look, gender) => {
    const k = lookKey(look, gender); if (k === selfKey) return; selfKey = k; const mine = ++selfTicket;
    try { const av = await createAvatar(look, gender); if (!alive || mine !== selfTicket) { av.dispose(); return; } world.remove(avatar.root); avatar.dispose(); avatar = av; world.add(av.root); gait = ""; } catch { /* the old body stays */ }
  };
  const yawOf2 = (hx, hz) => Math.atan2(hx, hz);
  function drawPerson(dt) {
    const veh = flow.vehicle, seated = P.seated && veh, sp = WK.speed;
    avatar.root.visible = P.visible && !(seated && !vehicle?.open && F.phase !== "board" && F.phase !== "alight");
    if (seated) { const seat = P.seat ?? KINDS[plan.kind].seat; const yaw = veh.yaw ?? veh.ang ?? yawOf2(veh.hx, veh.hz); avatar.root.position.set(P.x, 0.1 + (seat.y - 0.55), P.z); avatar.root.rotation.y = yaw; if (gait !== "sit") { gait = "sit"; if (!(avatar.has?.("sit") && avatar.play("sit"))) avatar.play("idle"); avatar.setSpeed?.(1); } }
    else {
      avatar.root.position.set(P.x, 0.1, P.z); avatar.root.rotation.y = yawOf2(P.hx, P.hz);
      // the gait matches the speed: standing, a walk, or a run, played at the pace the feet really cover
      const want = sp < 0.15 ? "idle" : sp < 3.4 ? "walk" : "run";
      if (want !== gait) { gait = want; if (!(avatar.has?.(want) && avatar.play(want))) avatar.play(want === "idle" ? "idle" : "walk"); }
      if (want !== "idle") avatar.setSpeed?.(Math.max(0.6, Math.min(3, sp / (want === "walk" ? 1.4 : 3.6)))); else avatar.setSpeed?.(1);
      if (avatar.walker) avatar.walker.pose((avatar.walker._p = (avatar.walker._p ?? 0) + sp * dt * 2.4), Math.min(1, sp / 1.2));
    }
  }
  let lastVx = null, lastVz = null;
  function drawVehicle(dt) {
    if (!vehicle) return; const v = flow.vehicle; vehicle.root.visible = !!v && !(flow.hero?.done);
    if (!v) return;
    const own = !!flow.own, yaw = own ? v.ang : v.yaw ?? yawOf2(v.hx, v.hz), moved = lastVx == null ? 0 : Math.hypot(v.x - lastVx, v.z - lastVz); lastVx = v.x; lastVz = v.z;
    vehicle.root.position.set(v.x, 0.1, v.z); vehicle.root.rotation.y = yaw; rollWheels(vehicle, (v.v >= 0 ? 1 : -1) * moved, own ? v.steer : 0);
  }

  // ---- camera: follows the person, or the vehicle while you ride in it; never ends up inside a wall; every smoothing step depends on elapsed time, not on frames ----
  function follow(dt) {
    const inVeh = inVehNow(), v = flow.vehicle, t = inVeh && v ? v : P, sp = Math.abs(F.speed ?? 0);
    const headYaw = inVeh && v ? yawOf2(v.hx, v.hz) + Math.PI : camYaw; // camera yaw: the direction from the target back to the camera
    if (inVeh) { const d = angDiff(camYaw, headYaw); camYaw += d * (1 - Math.exp(-dt * (F.phase === "ride" ? 5 : 3))); }
    else if (["alight", "door", "enter", "intro", "board", "approach"].includes(F.phase) && WK.mode !== "manual" && !pointer.active) { const want = yawOf2(P.hx, P.hz) + Math.PI, d = angDiff(camYaw, want); camYaw += d * (1 - Math.exp(-dt * 1.6)); }
    // in a vehicle, looking round springs back to the road ahead; on foot the view stays exactly where the player put it (it never swings by itself while they steer)
    if (inVeh && !pointer.active && time - userAt > 1.2) { userYaw *= Math.exp(-dt * 2.2); userPitch *= Math.exp(-dt * 1.4); }
    if (!inVeh) userYaw = 0;
    const fr = frame({ inVeh, speed: sp, zoom: inVeh ? zoomV : zoomW, pitch: userPitch }), yaw = camYaw + userYaw, bx = Math.sin(yaw), bz = Math.cos(yaw);
    camPt.x = t.x; camPt.z = t.z;
    // a wall between the person and the camera (centre and either side, so corners too) pulls the camera in at once; it eases back out when the wall is gone
    camBack = followBack(camBack, clearBack(svc.world, t.x, t.z, bx, bz, fr.back), dt);
    const hgt = fr.height * (0.7 + 0.3 * Math.min(1, camBack / fr.back)), cx = t.x + bx * camBack, cz = t.z + bz * camBack, k = 1 - Math.exp(-dt * (time < 1.4 ? 3.2 : 12));
    cam.position.x += (cx * S - cam.position.x) * k; cam.position.z += (cz * S - cam.position.z) * k; cam.position.y += (hgt * S - cam.position.y) * k;
    // look a little ahead of a walking person, so where they are going stays in view; smoothed so a change of direction never snaps the view
    const leadWant = !inVeh && WK.speed > 0.3 ? Math.min(CAM.walk.lead, WK.speed * 0.8) : 0; leadX = ease(leadX, P.hx * leadWant, 2.5, dt); leadZ = ease(leadZ, P.hz * leadWant, 2.5, dt);
    const ahead = inVeh ? Math.min(10, sp * 0.1) : 0; ctl.target.set((t.x + leadX - bx * ahead) * S, fr.aim * S, (t.z + leadZ - bz * ahead) * S); cam.lookAt(ctl.target);
    if (Math.abs(cam.fov - fr.fov) > 0.2) { cam.fov += (fr.fov - cam.fov) * (1 - Math.exp(-dt * 4)); cam.updateProjectionMatrix(); }
  }

  const off = stage.onFrame((tm, dt0) => {
    if (!alive) return; const dt = Math.min(dt0, 0.1); time += dt;
    // what the person is asking for: a direction in the world from the stick / keys and where the camera looks (the same for walking and for steering the car)
    const inp = read(), viewYaw = camYaw + (inVehNow() ? userYaw : 0), f = { x: Math.sin(viewYaw + Math.PI), z: Math.cos(viewYaw + Math.PI) }, // the stick is relative to the view the player SEES
       r = { x: -f.z, z: f.x }, ax = (inp.fwd - inp.back) * f.x + inp.right * r.x, az = (inp.fwd - inp.back) * f.z + inp.right * r.z, m = Math.min(1, Math.hypot(ax, az));
    traffic.update(dt);
    flow.update(dt, { dx: ax, dz: az, mag: m, run: inp.run, gas: inp.gas, brake: inp.brake, steer: inp.steer });
    lastPhase = F.phase;
    drawPerson(dt); drawVehicle(dt); if (door) door.open(F.doorK);
    beam.material.opacity = 0.2 + Math.sin(time * 3) * 0.08; ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08); hornT = Math.max(0, hornT - dt);
    avatar.update?.(time, dt); follow(dt); tags.update();
    // the route, from where the traveller is NOW (the vehicle while riding in it, the person otherwise) to where they are going
    const pos = inVehNow() && flow.vehicle ? flow.vehicle : P, hero = flow.hero;
    gd = guide.update(dt, { phase: F.phase, x: pos.x, z: pos.z, goal: flow.approachDoor, ride: hero && ["board", "ride"].includes(F.phase) ? { s: hero.s, path: hero.route?.path } : null });
    if (gd.show) { rb.mesh.visible = true; if (gd.rev !== rbRev || time - rbAt > (gd.kind === "drive" ? 0.12 : 0.2)) { rbRev = gd.rev; rbAt = time; rb.set(gd.pts, gd.s, gd.kind === "walk" ? 1.3 : 2.4, gd.kind === "walk" ? "#4aa8ff" : "#2fe38a"); } rb.tex.offset.y -= dt * 1.6; } else rb.mesh.visible = false;
    const live = { x: pos.x, z: pos.z, hx: pos.hx, hz: pos.hz, route: { pts: gd.pts, len: gd.len }, mode: gd.kind === "walk" ? "trek" : "drive", dest: { x: B.front.x, z: B.front.z } }, mini = o.miniCanvas?.(), prev = o.previewCanvas?.();
    if (mini) drawMini(mini, base, live); if (prev) drawPreview(prev, base, live);
    if (time - lastState > 0.1) { lastState = time; o.onState?.({ phase: F.phase, mode, auto, eta: F.eta, left: F.eta, remain: Math.round(flow.remainMetres()), speed: Math.round(Math.abs(F.speed ?? 0) * 3.6), canHorn: mode === "car" && F.phase === "drive", estimate: plan.secs, notice: F.notice, routeKind: gd.kind, routeLen: Math.round(gd.len), settling: F.pay === "pending" && ["door", "enter"].includes(F.phase), walking: F.phase === "approach" && WK.mode, autoWalk: WK.mode === "auto", parts: plan.parts }); }
  });

  const api = {
    traffic, plan, setLook, setTravellers: (l) => traffic.setTravellers(l), pos: () => { const p = flow.vehicle && ["ride", "drive", "paying"].includes(F.phase) ? flow.vehicle : P; return { x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz) }; }, route: () => gd, cancel: () => flow.cancel(),
    horn() { if (hornT > 0) return; hornT = 0.4; o.onHorn?.(); },
    dispose() { if (!alive) return; alive = false; off?.(); for (const d of disposers.reverse()) { try { d(); } catch { /* clean up as much as possible */ } } stage.scene.remove(world); stage.setManual(false); campus.setTripMode(false);
      cam.near = saved.near; cam.fov = saved.fov; cam.updateProjectionMatrix(); Object.assign(light.sun.shadow.camera, { left: saved.shadow.l, right: saved.shadow.r, top: saved.shadow.t, bottom: saved.shadow.b }); light.sun.shadow.camera.updateProjectionMatrix(); },
  };
  return api;
}