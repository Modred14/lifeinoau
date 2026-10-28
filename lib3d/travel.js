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
import { S, EX } from "./campusReal.js";
import { buildRoadNet, isRoad, walkable, Path } from "./roadnet.js";
import { makeKeke, makeBus, makeVehicle, rollWheels, addDriver } from "./vehicles.js";
import { KINDS, seatOf } from "./trafficsim.js";
import { loadServices } from "./worldsvc.js";
import { planTrip } from "./tripplan.js";
import { planRetarget, RETARGET_WHY } from "./tripretarget.js";
import { sightBlocked } from "./destinations.js";
import { SWING } from "./doorway.js";
import { createTripFlow } from "./tripflow.js";
import { createTraffic, makeWalker } from "./traffic.js";
import { createPlayerTags, isTaggable } from "./playerTags.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { lookKey } from "../lib/look.js";
import { paintBase, drawMini, drawPreview } from "./minimap.js";
import { createGuide } from "./tripguide.js";
import { CAM, PITCH, clamp, ease, frame, clearBack, followBack, zoomByPinch, zoomByWheel, angDiff, followYaw } from "./tripcam.js";
import { createKeys, isActKey } from "./tripkeys.js";
import { stepKeySteer } from "./keysteer.js";
import { attachTripPointer } from "./tripinput.js";

let netCache = null;
/** The road net for this campus data, built once (about a tenth of a second). */
export function getNet(data) { if (netCache?.data !== data) netCache = { data, net: buildRoadNet(data) }; return netCache.net; }
/** A place id to something with a position: named places come from the data; "bld_12" is building 12 with no name. */
export function resolvePlace(data, id) {
  if (id?.startsWith("bld_")) { const bd = data.buildings.find((b) => b.id === Number(id.slice(4))); if (!bd) return null; const n = bd.pts.length; return { id, bid: bd.id, x: bd.pts.reduce((t, p) => t + p[0], 0) / n, z: bd.pts.reduce((t, p) => t + p[1], 0) / n }; }
  const p = data.places.find((q) => q.id === id); return p && !p.offmap ? p : null;
}

const smoothK = (x) => x * x * (3 - 2 * x);
const yawOf = (hx, hz) => Math.atan2(hx, hz);
const lerp = (a, b, k) => a + (b - a) * k;

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

/**
 * The door of a building: a frame, a leaf that swings open, and a dark doorway behind it. The leaf is hinged on the left or the right (as seen from outside) and swings out into the
 * street, or (only when the street has no room for it) in. Returns { group, open(k, hinge), dispose }. k is how far it is open: 0 shut, 1 fully open.
 */
function buildDoor(door) {
  const w = door.width, group = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: "#6b3f26", roughness: 0.7 }), dark = new THREE.MeshBasicMaterial({ color: "#0b0d12" }), frame = new THREE.MeshStandardMaterial({ color: "#efe9d8", roughness: 0.8 }), glow = new THREE.MeshBasicMaterial({ color: "#ffe29a" });
  const add = (geo, m, x, y, z, parent = group) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); parent.add(o); return o; };
  add(new THREE.PlaneGeometry(w, 2.5), dark, 0, 1.25, 0.06);
  add(new THREE.BoxGeometry(0.18, 2.7, 0.3), frame, -w / 2 - 0.09, 1.35, 0.1); add(new THREE.BoxGeometry(0.18, 2.7, 0.3), frame, w / 2 + 0.09, 1.35, 0.1); add(new THREE.BoxGeometry(w + 0.5, 0.22, 0.34), frame, 0, 2.62, 0.1);
  add(new THREE.BoxGeometry(w + 0.6, 0.06, 0.06), glow, 0, 2.8, 0.2); add(new THREE.BoxGeometry(w * 0.9, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: "#9b2f2f" }), 0, 0.04, 0.8); // a light above the door and a red mat
  const hinge = new THREE.Group(), leaf = new THREE.Group(); hinge.position.set(-w / 2, 0, 0.1); hinge.add(leaf); group.add(hinge);
  add(new THREE.BoxGeometry(w, 2.45, 0.08), wood, 0, 1.225, 0, leaf); const knob = add(new THREE.BoxGeometry(0.08, 0.08, 0.14), glow, w / 2 - 0.2, 1.1, 0.07, leaf);
  group.position.set(door.x + door.nx * 0.04, 0.1, door.z + door.nz * 0.04); group.rotation.y = yawOf(door.nx, door.nz);
  let cur = "left", sign = -1;
  // left: hinge on the left post, swings out (turning the wrong way would swing it into the wall); right: the mirror image; in: the left hinge, the other way round
  const side = (h) => { cur = h; const L = h === "right" ? -1 : 1; hinge.position.x = -L * w / 2; leaf.position.x = L * w / 2; knob.position.x = L * (w / 2 - 0.2); sign = h === "right" ? 1 : h === "in" ? 1 : -1; };
  return { group, open: (k, h = "left") => { if (h !== cur) side(h); hinge.rotation.y = sign * k * SWING; }, dispose() { group.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); }); group.removeFromParent(); } };
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
  let plan = planTrip(svc, { from: fromP, to: toP, mode, driver: !!o.driver }), curTo = toP.id, enterable = o.isEnterable ? !!o.isEnterable(toP.id) : true;
  if (!plan.ok) { const e = Object.assign(new Error(WHY[plan.reason] ?? "That trip cannot be planned."), { reason: plan.reason === "unreachable" ? "unreachable" : "noroad", text: WHY[plan.reason] }); throw e; }
  let B = plan.B; const driven = !!plan.driven, auto = driven;
  const world = new THREE.Group(); world.scale.setScalar(S); stage.scene.add(world);
  const saved = { near: cam.near, fov: cam.fov, shadow: { l: light.sun.shadow.camera.left, r: light.sun.shadow.camera.right, t: light.sun.shadow.camera.top, b: light.sun.shadow.camera.bottom } };
  stage.setManual(true); campus.setTripMode(true); campus.setSelected(null); cam.near = 0.03; cam.updateProjectionMatrix();
  Object.assign(light.sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 }); light.sun.shadow.camera.updateProjectionMatrix();
  const disposers = []; let alive = true;

  // ---- the guide: a ribbon of chevrons on the way to go, and the beam over the destination ----
  // The route is NEVER the one planned when the trip began: lib3d/tripguide.js works it out from where the traveller is now to where they are going, again whenever the leg changes
  // (on foot -> in the vehicle -> on foot) or they leave the route, and shows only the part still ahead. This block only draws it.
  let guide = createGuide({ nav: svc.nav, graph: svc.graph, plan }); const rb = makeRibbon(); world.add(rb.mesh); disposers.push(() => rb.dispose());
  let gd = guide.update(0, { phase: "intro", x: plan.start.x, z: plan.start.z }), rbRev = -1, rbAt = -9;
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); beam.position.set(B.front.x, 35, B.front.z); world.add(beam);
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })); ring.rotation.x = -Math.PI / 2; ring.position.set(B.front.x, 0.25, B.front.z); world.add(ring);
  disposers.push(() => { beam.geometry.dispose(); beam.material.dispose(); ring.geometry.dispose(); ring.material.dispose(); });
  // the door is drawn only for a place with a door to open (an enterable building): never for an open-air place, a statue or a gate
  let door = null; const setDoor = () => { door?.dispose(); door = B.building && enterable ? buildDoor(B.door) : null; if (door) world.add(door.group); }; setDoor(); disposers.push(() => door?.dispose());
  // where to stop your own car: a green bay on the kerb at the drop-off (drawn only while you drive)
  const bay = new THREE.Group(), bayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#3fd08a", transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }));
  bay.add(bayMesh); bay.position.y = 0.2; bay.visible = false; world.add(bay); disposers.push(() => { bayMesh.geometry.dispose(); bayMesh.material.dispose(); });
  const setBay = () => { if (plan.drop) { bay.position.set(plan.drop.x, 0.2, plan.drop.z); bay.rotation.y = Math.atan2(plan.drop.hx, plan.drop.hz); } };

  // ---- the person and the vehicle ----
  let avatar = null; const mkAvatar = async () => { try { return await createAvatar(o.look, o.gender); } catch { const w = makeWalker("#7f5236", "#1f2f55", "#a8946a"); return { root: w.root, play: () => false, has: () => false, setSpeed() {}, update: () => {}, dispose() {}, walker: w }; } };
  avatar = await mkAvatar(); if (!alive) { avatar.dispose(); return null; } world.add(avatar.root); disposers.push(() => { world.remove(avatar.root); avatar.dispose(); });
  let vehicle = null;
  if (mode !== "trek") { const m = mode === "keke" ? makeKeke() : mode === "bus" ? makeBus() : makeVehicle(o.car, o.carColor); if (plan.driven && (m.driver ?? KINDS[plan.kind].driver)) addDriver(m, m.driver ?? KINDS[plan.kind].driver, mode === "bus" ? "#c0762b" : "#3b6ea5"); m.root.visible = false; vehicle = m; world.add(m.root); disposers.push(() => { world.remove(m.root); if (m.dispose) m.dispose(); else m.root.traverse((x) => x.geometry?.dispose?.()); }); }

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
  // `epoch` rises whenever the destination changes: an answer that was asked about an EARLIER destination (it arrives late) is dropped, never drawn over the new one
  let epoch = 0;
  (async () => { const e = epoch, l = await (o.people ?? []); if (alive && e === epoch) syncThere(l); /* an array, or a promise of one: the trip never waits for it */ })();
  const pollThere = o.pollPeople ? setInterval(async () => { const e = epoch; try { const l = await o.pollPeople(); if (alive && e === epoch && Array.isArray(l)) syncThere(l); } catch { /* try again next time */ } }, 5000) : null;
  disposers.push(() => { clearInterval(pollThere); for (const id of [...there.keys()]) dropThere(id); });

  const camPt = { x: plan.start.x, z: plan.start.z };
  const traffic = createTraffic({ parent: world, svc, focus: () => camPt, tags }); disposers.push(() => traffic.dispose());

  // ---- the journey ----
  const flow = createTripFlow({ svc, sim: traffic.sim }, { plan, enterable, dims: vehicle && mode === "car" ? { len: vehicle.length, wid: vehicle.width, id: vehicle.id, seat: vehicle.seat, driver: vehicle.driver } : null, rnd: Math.random, free: !!o.free, spawn: o.spawn ?? null, onArrive: () => o.onArrive?.() ?? true, onEnter: () => o.onEnter?.(), onEnd: (why) => { if (alive) o.onEnd?.(why); }, onNotice: (m) => o.onNotice?.(m) });
  disposers.push(() => flow.dispose()); setBay();
  const P = flow.person, F = flow.state, WK = flow.walker;
  let camYaw = Math.atan2(-(plan.start.x - (plan.doorIn?.x ?? plan.goal.x)), -(plan.start.z - (plan.doorIn?.z ?? plan.goal.z))), userYaw = 0, userPitch = 0, userAt = -9, time = 0, hornT = 0, lastState = 0, camBack = CAM.walk.back, zoomW = 1, zoomV = 1, leadX = 0, leadZ = 0;
  camPt.x = P.x; camPt.z = P.z; WK.hx = Math.sin(camYaw + Math.PI); WK.hz = Math.cos(camYaw + Math.PI);
  if (flow.own) { camYaw = Math.atan2(flow.own.hx, flow.own.hz) + Math.PI; camPt.x = flow.own.x; camPt.z = flow.own.z; }   // a drive that starts at the wheel: the camera is already behind the car

  // ---- controls: keys (cleared when the window loses focus, so a key never sticks), and dragging the picture to look around ----
  // lib3d/tripkeys.js: keys are told apart by where they are on the keyboard (so W A S D work on any layout), a shortcut such as Cmd+D is never a control, letting go of Cmd drops everything
  // held (a Mac sends no key-up for the others while it is down), and losing focus or hiding the tab clears the lot, so a key can never stay "pressed" and steer the car by itself.
  const kb = createKeys(), kd = (e) => { if (kb.press(e)) e.preventDefault(); }, ku = (e) => kb.release(e), blur = () => kb.clear(), hide = () => { if (document.hidden) kb.clear(); };
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", blur); document.addEventListener("visibilitychange", hide);
  disposers.push(() => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", blur); document.removeEventListener("visibilitychange", hide); });
  // Looking round, zooming and (on a touch screen, while driving) swiping to steer all come through lib3d/tripinput.js: every finger is tracked by its own id on the canvas only, so a finger on
  // the on-screen stick or a button is never also read as a camera drag, a second finger pinches instead of rotating, and the orbit controls are switched off for the whole trip (stage.setManual).
  const inVehNow = () => !!vehicle && ["ride", "drive", "paying"].includes(F.phase);
  // the camera frames the vehicle while you are in it, and eases between the two framings (never a jump): 0 = on foot, 1 = in the vehicle
  let vehMix = flow.own ? 1 : 0;
  const el = stage.renderer.domElement, pointer = attachTripPointer(el, {
    mode: () => (!alive || F.phase === "inside" ? "none" : "look"),
    look: (dYaw, dPitch) => { if (inVehNow()) userYaw = clamp(userYaw - dYaw, -1.7, 1.7); else camYaw -= dYaw; userPitch = clamp(userPitch + dPitch, PITCH.min, PITCH.max); userAt = time; },
    zoom: (scale) => { if (inVehNow()) zoomV = zoomByPinch(zoomV, scale, "veh"); else zoomW = zoomByPinch(zoomW, scale, "walk"); },
    wheel: (dy) => { if (inVehNow()) zoomV = zoomByWheel(zoomV, dy, "veh"); else zoomW = zoomByWheel(zoomW, dy, "walk"); },
  });
  disposers.push(() => pointer.detach());
  const driving = () => F.phase === "drive";
  // One-shot buttons (the HUD buttons and the E / F keys) are read once and cleared every frame, so a press is never seen twice and never lingers into a later phase.
  const taken = (n) => { const v = !!input[n]; input[n] = false; return v; };
  const keyHit = new Set(), kh = (e) => { if (isActKey(e)) keyHit.add("act"); };
  window.addEventListener("keydown", kh); disposers.push(() => window.removeEventListener("keydown", kh));
  // The keys steer through lib3d/keysteer.js: a key moves the steering towards full lock at a limited rate and lets it back to straight, like a wheel, instead of throwing it to full lock.
  let keySteer = 0;
  const read = (dt = 0) => {
    const kk = kb.read(), drive = driving(), afoot = F.phase === "afoot", act = keyHit.delete("act"), exitBtn = taken("exit"), enterBtn = taken("enter"), closeBtn = taken("close"), doorBtn = taken("door"), goInBtn = taken("goin"), stopBtn = taken("stop"), atDoor = F.phase === "door";
    keySteer = drive ? stepKeySteer(keySteer, kk.steer, dt) : 0;
    const wheel = Math.max(-1, Math.min(1, (input.steer ?? 0) + keySteer));   // the on-screen wheel and the keys add up; +1 is a right turn
    return { fwd: Math.max(kk.up, input.jy > 0 ? input.jy : 0), back: Math.max(kk.down, input.jy < 0 ? -input.jy : 0), right: Math.max(kk.right, input.jx > 0 ? input.jx : 0) - Math.max(kk.left, input.jx < 0 ? -input.jx : 0), run: !!kk.run || !!input.run,
      gas: drive ? Math.max(kk.up, input.gas ?? 0) : 0, brake: drive ? Math.max(kk.down, kk.space, input.brake ?? 0) : 0, steer: drive ? wheel : 0,
      exit: drive && (exitBtn || act), enter: afoot && (enterBtn || (act && F.canEnter)), close: afoot && (closeBtn || (act && !F.canEnter && F.canClose)),
      door: atDoor && (doorBtn || (act && F.door === "closed")), goIn: atDoor && (goInBtn || (act && F.door === "open")), stop: stopBtn };   // Open Door / Go in / stop the automatic walk: the buttons, and E or F for the door
  };

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
    const veh = flow.vehicle, doors = !!vehicle?.doors, sk = doors ? F.seatK ?? 0 : P.seated && veh ? 1 : 0, sp = WK.speed, vehYaw = veh ? veh.yaw ?? veh.ang ?? yawOf2(veh.hx, veh.hz) : 0, onFootYaw = yawOf2(P.hx, P.hz);
    // hidden only while sitting inside a closed car (its glass is dark); visible the whole time the door is open and while stepping in or out
    const inside = sk >= 0.98 && !vehicle?.open && !(doors && F.vehDoorK > 0.03) && ["ride", "drive", "paying"].includes(F.phase);
    avatar.root.visible = P.visible && !inside;
    const seat = P.seat ?? seatOf(plan.kind), k = smoothK(sk);   // a trek (on foot) has no vehicle kind: nobody sits, so the seat only has to exist (it used to throw every frame, which stopped the camera and the picture)
    avatar.root.position.set(P.x, 0.1 + (seat.y - 0.55) * k, P.z); avatar.root.rotation.y = onFootYaw + angDiff(onFootYaw, vehYaw) * k;
    if (sk >= 0.5) { if (gait !== "sit") { gait = "sit"; if (!(avatar.has?.("sit") && avatar.play("sit"))) avatar.play("idle"); avatar.setSpeed?.(1); } }
    else {
      // the gait matches the speed: standing, a walk, or a run, played at the pace the feet really cover
      const want = sp < 0.15 ? "idle" : sp < 3.4 ? "walk" : "run";
      if (want !== gait) { gait = want; if (!(avatar.has?.(want) && avatar.play(want))) avatar.play(want === "idle" ? "idle" : "walk"); }
      if (want !== "idle") avatar.setSpeed?.(Math.max(0.6, Math.min(3, sp / (want === "walk" ? 1.4 : 3.6)))); else avatar.setSpeed?.(1);
      if (avatar.walker) avatar.walker.pose((avatar.walker._p = (avatar.walker._p ?? 0) + sp * dt * 2.4), Math.min(1, sp / 1.2));
    }
  }
  let lastVx = null, lastVz = null, lastYaw = null, lastSpeed = null, steerShown = 0;
  vehicle?.root && (vehicle.root.rotation.order = "YXZ");
  function drawVehicle(dt) {
    if (!vehicle) return; const v = flow.vehicle; vehicle.root.visible = !!v && !(flow.hero?.done);
    if (!v) return;
    const own = !!flow.own, yaw = own ? v.ang : v.yaw ?? yawOf2(v.hx, v.hz), moved = lastVx == null ? 0 : Math.hypot(v.x - lastVx, v.z - lastVz); lastVx = v.x; lastVz = v.z;
    vehicle.root.position.set(v.x, 0.1, v.z); vehicle.root.rotation.set(own ? v.pitch ?? 0 : 0, yaw, own ? v.roll ?? 0 : 0); // the front wheels: your own car shows its steering; every other vehicle steers by how fast it is turning (the bicycle model, from its heading change)
    let steer = 0, braking = false;
    if (own) { steer = v.steer; braking = (v.brk ?? 0) > 0.08 || (v.reversing && Math.abs(v.v) < 0.5); }
    else { const dy = lastYaw == null || dt <= 0 ? 0 : angDiff(lastYaw, yaw) / dt, sp = Math.abs(v.v ?? 0); steer = sp > 0.4 ? Math.max(-0.6, Math.min(0.6, Math.atan((vehicle.wheelbase ?? 2.7) * dy / sp))) : 0; braking = lastSpeed != null && dt > 0 && (sp - lastSpeed) / dt < -0.9 || sp < 0.15; steerShown += (steer - steerShown) * Math.min(1, dt * 8); steer = steerShown; lastSpeed = sp; }
    lastYaw = yaw; vehicle.setBrake?.(braking);
    rollWheels(vehicle, (v.v >= 0 ? 1 : -1) * moved, steer);
    // the doors: the one in use swings by how open it is, the other stays shut
    if (vehicle.doors) { const side = F.vehDoorSide ?? -1; vehicle.setDoor(side, F.vehDoorK ?? 0); vehicle.setDoor(-side, 0); }
  }

  // ---- camera: follows the person, or the vehicle while you ride in it; never ends up inside a wall; every smoothing step depends on elapsed time, not on frames ----
  function follow(dt) {
    const inVeh = inVehNow(), v = flow.vehicle, sp = Math.abs(F.speed ?? 0);
    // the framing eases between "on foot" and "in the vehicle" (about half a second), so getting in or out never makes the camera jump
    vehMix = ease(vehMix, inVeh && v ? 1 : 0, 2.6, dt); const m = vehMix, tgt = v ? { x: lerp(P.x, v.x, m), z: lerp(P.z, v.z, m) } : P;
    const headYaw = v ? yawOf2(v.hx, v.hz) + Math.PI : camYaw; // camera yaw: the direction from the target back to the camera
    if (inVeh && v) camYaw = followYaw(camYaw, headYaw, sp, dt, F.phase === "ride");   // behind the car, following its turns a moment late rather than snapping with them (tripcam.js: always the short way round, never wound up)
    else if (["alight", "exit", "door", "enter", "intro", "board", "approach", "reenter"].includes(F.phase) && WK.mode !== "manual" && !pointer.active) { const want = yawOf2(P.hx, P.hz) + Math.PI, d = angDiff(camYaw, want); camYaw += d * (1 - Math.exp(-dt * 1.6)); }
    // in a vehicle, looking round springs back to the road ahead; on foot the view stays exactly where the player put it (it never swings by itself while they steer)
    if (inVeh && !pointer.active && time - userAt > 1.2) { userYaw *= Math.exp(-dt * 2.2); userPitch *= Math.exp(-dt * 1.4); }
    if (!inVeh) userYaw *= Math.exp(-dt * 6);
    const fw = frame({ inVeh: false, speed: 0, zoom: zoomW, pitch: userPitch }), fv = frame({ inVeh: true, speed: sp, zoom: zoomV, pitch: userPitch }), fr = { back: lerp(fw.back, fv.back, m), height: lerp(fw.height, fv.height, m), aim: lerp(fw.aim, fv.aim, m), fov: lerp(fw.fov, fv.fov, m) };
    const yaw = camYaw + userYaw, bx = Math.sin(yaw), bz = Math.cos(yaw);
    camPt.x = tgt.x; camPt.z = tgt.z;
    // a wall between the person and the camera (centre and either side, so corners too) pulls the camera in at once; it eases back out when the wall is gone
    camBack = followBack(camBack, clearBack(svc.world, tgt.x, tgt.z, bx, bz, fr.back), dt);
    const hgt = fr.height * (0.7 + 0.3 * Math.min(1, camBack / fr.back)), cx = tgt.x + bx * camBack, cz = tgt.z + bz * camBack, k = 1 - Math.exp(-dt * (time < 1.4 ? 3.2 : 12)), ky = 1 - Math.exp(-dt * (time < 1.4 ? 3.2 : 7));
    cam.position.x += (cx * S - cam.position.x) * k; cam.position.z += (cz * S - cam.position.z) * k; cam.position.y += (hgt * S - cam.position.y) * ky;
    // look a little ahead of a walking person, so where they are going stays in view; smoothed so a change of direction never snaps the view
    const leadWant = !inVeh && WK.speed > 0.3 ? Math.min(CAM.walk.lead, WK.speed * 0.8) : 0; leadX = ease(leadX, P.hx * leadWant, 2.5, dt); leadZ = ease(leadZ, P.hz * leadWant, 2.5, dt);
    const ahead = m * Math.min(10, sp * 0.1); ctl.target.set((tgt.x + leadX - bx * ahead) * S, fr.aim * S, (tgt.z + leadZ - bz * ahead) * S); cam.lookAt(ctl.target);
    if (Math.abs(cam.fov - fr.fov) > 0.05) { cam.fov += (fr.fov - cam.fov) * (1 - Math.exp(-dt * 4)); cam.updateProjectionMatrix(); }
  }

  /** For the driver: which way the road to the destination goes, as an angle from straight ahead (positive = to the right), about 22 m along the guide. */
  function turnTo() {
    const v = flow.own; if (!v || !gd?.pts?.length) return null; let acc = 0, tx = gd.pts.at(-1)[0], tz = gd.pts.at(-1)[1];
    for (let i = 1; i < gd.pts.length; i++) { acc += Math.hypot(gd.pts[i][0] - gd.pts[i - 1][0], gd.pts[i][1] - gd.pts[i - 1][1]); if (acc >= 22) { tx = gd.pts[i][0]; tz = gd.pts[i][1]; break; } }
    const dx = tx - v.x, dz = tz - v.z, l = Math.hypot(dx, dz) || 1; return Math.atan2((dx * -v.hz + dz * v.hx) / l, (dx * v.hx + dz * v.hz) / l);
  }
  // what the destination tags need to know: where the traveller is, where the camera is, and whether a building hides a tag
  const heights = new Map(data.buildings.map((b) => [b.id, b.h * EX])), camM = { x: 0, y: 0, z: 0 };
  /** Sends the trip to another place (a tapped name tag). Nothing changes unless it works: { ok: true } or { ok: false, reason, text }. */
  function retarget(toId) {
    if (!alive) return { ok: false, reason: "phase", text: RETARGET_WHY.phase };
    if (toId === curTo) return { ok: false, reason: "same", text: RETARGET_WHY.same };
    const toP2 = resolvePlace(data, toId); if (!toP2) return { ok: false, reason: "nopos", text: RETARGET_WHY.nopos };
    const at = F.phase === "drive" && flow.vehicle ? flow.vehicle : P, r = planRetarget(svc, flow.plan, { at: { x: at.x, z: at.z }, to: toP2 }); if (!r.ok) return { ok: false, reason: r.reason, text: RETARGET_WHY[r.reason] };
    const en = o.isEnterable ? !!o.isEnterable(toId) : true, res = flow.retarget(r.plan, en); if (!res.ok) return res;
    plan = flow.plan; B = plan.B; curTo = toId; enterable = en; epoch++;
    guide = createGuide({ nav: svc.nav, graph: svc.graph, plan }); rbRev = -1; gd = guide.update(0, { phase: F.phase, x: at.x, z: at.z, goal: flow.approachDoor });   // a new trip's guide: nothing of the old route is kept
    beam.position.set(B.front.x, 35, B.front.z); ring.position.set(B.front.x, 0.25, B.front.z); setDoor(); setBay(); syncThere([]);
    if (o.pollPeople) { const e = epoch; Promise.resolve(o.pollPeople()).then((l) => { if (alive && e === epoch && Array.isArray(l)) syncThere(l); }).catch(() => {}); }   // who is at the new door, in the background
    return { ok: true };
  }

  const off = stage.onFrame((tm, dt0) => {
    if (!alive) return; const dt = Math.min(dt0, 0.1); time += dt;
    // what the person is asking for: a direction in the world from the stick / keys and where the camera looks (the same for walking and for steering the car)
    const inp = read(dt), viewYaw = camYaw + (inVehNow() ? userYaw : 0), f = { x: Math.sin(viewYaw + Math.PI), z: Math.cos(viewYaw + Math.PI) }, // the stick is relative to the view the player SEES
       r = { x: -f.z, z: f.x }, ax = (inp.fwd - inp.back) * f.x + inp.right * r.x, az = (inp.fwd - inp.back) * f.z + inp.right * r.z, m = Math.min(1, Math.hypot(ax, az));
    traffic.update(dt);
    if (inp.stop) flow.stopAuto(); if (inp.door) flow.pressDoor(); if (inp.goIn) flow.enterNow();
    flow.update(dt, { dx: ax, dz: az, mag: m, run: inp.run, gas: inp.gas, brake: inp.brake, steer: inp.steer, exit: inp.exit, enter: inp.enter, close: inp.close });
    lastPhase = F.phase;
    drawPerson(dt); drawVehicle(dt); door?.open(F.doorK, F.hinge); bay.visible = driving() && !!plan.drop && !flow.free; if (bay.visible) bay.scale.set(1, 1, 1 + Math.sin(time * 3) * 0.02);
    beam.visible = ring.visible = !flow.free; if (door) door.group.visible = !flow.free;   // a free drive has no destination to point at
    beam.material.opacity = 0.2 + Math.sin(time * 3) * 0.08; ring.scale.setScalar(1 + Math.sin(time * 3) * 0.08); hornT = Math.max(0, hornT - dt);
    avatar.update?.(time, dt); follow(dt); tags.update();
    // the route, from where the traveller is NOW (the vehicle while riding in it, the person otherwise) to where they are going
    const pos = inVehNow() && flow.vehicle ? flow.vehicle : P, hero = flow.hero;
    gd = guide.update(dt, { phase: F.phase, x: pos.x, z: pos.z, goal: flow.approachDoor, ride: hero && ["board", "ride"].includes(F.phase) ? { s: hero.s, path: hero.route?.path } : null });
    if (gd.show && !flow.free) { rb.mesh.visible = true; if (gd.rev !== rbRev || time - rbAt > (gd.kind === "drive" ? 0.12 : 0.2)) { rbRev = gd.rev; rbAt = time; rb.set(gd.pts, gd.s, gd.kind === "walk" ? 1.3 : 2.4, gd.kind === "walk" ? "#4aa8ff" : "#2fe38a"); } rb.tex.offset.y -= dt * 1.6; } else rb.mesh.visible = false;
    const live = { x: pos.x, z: pos.z, hx: pos.hx, hz: pos.hz, route: { pts: gd.pts, len: gd.len }, mode: gd.kind === "walk" ? "trek" : "drive", dest: { x: B.front.x, z: B.front.z } }, mini = o.miniCanvas?.(), prev = o.previewCanvas?.();
    if (mini) drawMini(mini, base, live); if (prev) drawPreview(prev, base, live);
    if (time - lastState > 0.1) { lastState = time; o.onState?.({ phase: F.phase, mode, auto, free: flow.free, eta: flow.free ? null : F.eta, left: flow.free ? null : F.eta, remain: Math.round(flow.remainMetres()), speed: Math.round(Math.abs(F.speed ?? 0) * 3.6), canHorn: mode === "car" && F.phase === "drive", ownCar: mode === "car" && !plan.driven, canExit: !!F.canExit, exiting: !!F.exiting, canEnter: !!F.canEnter, canClose: !!F.canClose, steerAngle: flow.own ? flow.own.steer : 0, gear: flow.own ? (flow.own.reversing || flow.own.v < -0.05 ? "R" : "D") : "", estimate: plan.secs, notice: F.notice, routeKind: gd.kind, routeLen: Math.round(gd.len), settling: F.pay === "pending" && ["door", "enter"].includes(F.phase), walking: F.phase === "approach" && WK.mode, autoWalk: WK.mode === "auto", parts: plan.parts,
        door: F.door, hasDoor: !!(B.building && enterable), canOpen: !!F.canOpen, canGoIn: !!F.canGoIn, auto: !!F.auto, to: curTo, turn: F.phase === "drive" && !flow.free ? turnTo() : null }); }
  });

  const api = {
    traffic, get plan() { return plan; }, get to() { return curTo; }, retarget, setLook,
    tagView: () => { camM.x = cam.position.x / S; camM.y = cam.position.y / S; camM.z = cam.position.z / S; return { me: { x: P.x, z: P.z }, cam: camM, occluded: (it) => sightBlocked(svc.world, heights, camM, it, it.bid) }; }, setTravellers: (l) => traffic.setTravellers(l), pos: () => { const inV = !!flow.vehicle && ["ride", "drive", "paying"].includes(F.phase), p = inV ? flow.vehicle : P; return { x: p.x, z: p.z, h: Math.atan2(p.hx, p.hz), mode: inV ? mode : "trek" }; }, route: () => gd, cancel: () => flow.cancel(),
    horn() { if (hornT > 0) return; hornT = 0.4; o.onHorn?.(); },
    dispose() { if (!alive) return; alive = false; off?.(); for (const d of disposers.reverse()) { try { d(); } catch { /* clean up as much as possible */ } } /* the map may already be torn down (the player tapped Home mid-drive): put the shared scene back as far as it still exists, and never throw */
      const safe = (f) => { try { f(); } catch { /* the stage or campus is already disposed */ } };
      safe(() => stage.scene.remove(world)); safe(() => stage.setManual(false)); safe(() => campus.setTripMode(false));
      safe(() => { cam.near = saved.near; cam.fov = saved.fov; cam.updateProjectionMatrix(); });
      safe(() => { Object.assign(light.sun.shadow.camera, { left: saved.shadow.l, right: saved.shadow.r, top: saved.shadow.t, bottom: saved.shadow.b }); light.sun.shadow.camera.updateProjectionMatrix(); }); },
  };
  return api;
}