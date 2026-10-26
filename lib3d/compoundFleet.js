// lib3d/compoundFleet.js
// The player's vehicles inside the home compound of the 3D room (lib3d/room.js): every owned vehicle parked on the lawn where lib3d/compoundParking.js puts it, a tap on one
// to get in, and driving it out through the gate with the driving model of lib3d/garageDrive.js. Browser only (three.js).
//
//   const fleet = createCompoundFleet({ scene, camera, stage, cb: { onDrive(d), onLeave(d) } });
//   fleet.setRoom(room, items); fleet.setVehicles([{ id, modelId, color }]);   // parks them
//   fleet.pick(raycaster) -> id | null;  fleet.start(id) -> boolean;  fleet.stop({ park });  fleet.setInput({ throttle, steer });  fleet.update(dt)
//
// onDrive({ driving, speed (km/h), hit, reverse }) reports the car while it is driven; onLeave({ id, modelId, color, v (m/s), yaw }) fires once, when the whole vehicle is on the road
// outside the gate. The room scene is in cells and the models in metres, so a model is scaled by 1 / CELL_M and the physics runs in metres.
import * as THREE from "three";
import { makeVehicle, rollWheels } from "./vehicles.js";
import { planParking, metresWorld, onCarriageway, CELL_M } from "./compoundParking.js";
import { createDriver } from "./garageDrive.js";
import { garageVehicleSize } from "./garageLayout.js";
import { GROUND } from "./plot3d.js";

const K = 1 / CELL_M;
const KEYMAP = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", " ": "down" };

export function createCompoundFleet({ scene, camera, stage, cb = {} }) {
  const root = new THREE.Group(); scene.add(root);
  const meshes = new Map(), keys = new Set(), pad = { throttle: 0, steer: 0 }, padMat = new THREE.MeshStandardMaterial({ color: "#a3a6a1", roughness: 0.95 });
  let room = null, items = [], vehicles = [], plan = null, half = [0, 0], timer = 0, dirty = false, drive = null, alive = true, steerShown = 0, lastReport = "", saved = null;

  function clear() {
    for (const m of meshes.values()) { root.remove(m.vehicle.root); root.remove(m.pad); m.vehicle.root.traverse((o) => { o.geometry?.dispose?.(); }); m.pad.geometry.dispose(); }
    meshes.clear();
  }
  function rebuild() {
    dirty = false; clear(); plan = null; if (!room || !alive) return;
    plan = planParking(room, vehicles, items); half = [room.w / 2, room.d / 2];
    for (const s of plan.slots) {
      const v = makeVehicle(s.modelId || "", s.color); v.root.scale.setScalar(K);
      v.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } o.userData.fleetId = String(s.id); });
      const pad = new THREE.Mesh(new THREE.BoxGeometry(s.wid + 0.5, 0.03, s.len + 0.7), padMat); pad.receiveShadow = true;
      place(v, s.x * 1, s.z * 1, s.yaw, false); pad.position.set(s.x - half[0], GROUND + 0.015, s.z - half[1]); pad.rotation.y = s.yaw;
      root.add(v.root, pad); meshes.set(String(s.id), { slot: s, vehicle: v, pad });
    }
    cb.onPlan?.({ placed: plan.slots.length, unplaced: plan.unplaced.length });
  }
  const later = () => { if (drive) { dirty = true; return; } clearTimeout(timer); timer = setTimeout(rebuild, 0); }; // planning takes a moment: never inside the call that asked for it
  const place = (v, cx, cz, yaw, onRoad) => { v.root.position.set(cx - half[0], GROUND + (onRoad ? -0.03 : 0.03), cz - half[1]); v.root.rotation.y = yaw; };

  const kd = (e) => { if (!drive || e.metaKey || e.ctrlKey || e.altKey) return; const k = KEYMAP[e.key]; if (!k) return; keys.add(k); e.preventDefault(); };
  const ku = (e) => { const k = KEYMAP[e.key]; if (k) keys.delete(k); };
  const clearInput = () => { keys.clear(); pad.throttle = 0; pad.steer = 0; };
  window.addEventListener("keydown", kd); window.addEventListener("keyup", ku); window.addEventListener("blur", clearInput); document.addEventListener("visibilitychange", clearInput);
  const input = () => ({ throttle: Math.max(-1, Math.min(1, (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0) + pad.throttle)), steer: Math.max(-1, Math.min(1, (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0) + pad.steer)) });

  const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), ready: false }, want = new THREE.Vector3();

  function start(id) {
    const m = meshes.get(String(id)); if (!m || drive || !plan) return false;
    const s = m.slot, size = garageVehicleSize(s.modelId), world = metresWorld(plan.cw, plan.slots, s.id);
    drive = { id: String(s.id), m, size, driver: createDriver(world, { x: s.x * CELL_M, z: s.z * CELL_M, yaw: s.yaw }, size), left: false };
    saved = { pos: camera.position.clone(), target: stage.controls.target.clone() }; stage.setManual(true); cam.ready = false; steerShown = 0; lastReport = ""; clearInput();
    cb.onDrive?.({ driving: true, speed: 0, hit: null, reverse: false }); return true;
  }
  function stop({ park = true } = {}) {
    if (!drive) return; const { m } = drive; drive = null; clearInput();
    if (park) place(m.vehicle, m.slot.x, m.slot.z, m.slot.yaw, false);
    stage.setManual(false); if (saved) { camera.position.copy(saved.pos); stage.controls.target.copy(saved.target); stage.controls.update(); saved = null; }
    cb.onDrive?.({ driving: false, speed: 0, hit: null, reverse: false }); if (dirty) later();
  }

  function update(dt) {
    if (!drive) return;
    const { driver, m, size } = drive, S = driver.state, moved = driver.step(drive.left ? { throttle: 0, steer: 0 } : input(), Math.min(dt, 0.1));
    const cx = S.x / CELL_M, cz = S.z / CELL_M, onRoad = cz > plan.cw.P.road.z0;
    place(m.vehicle, cx, cz, S.yaw, onRoad); steerShown += (S.steer - steerShown) * Math.min(1, dt * 12); rollWheels(m.vehicle, moved, -steerShown);
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), v = Math.abs(S.v), back = 17 + v * 0.7, px = cx - half[0], pz = cz - half[1];
    want.set(px - fx * back, 10 + v * 0.25, pz - fz * back);
    if (!cam.ready) { cam.pos.copy(want); cam.look.set(px + fx * 3, 0.8, pz + fz * 3); cam.ready = true; }
    else { cam.pos.lerp(want, 1 - Math.exp(-dt * 4.5)); cam.look.lerp(want.set(px + fx * 3, 0.8, pz + fz * 3), 1 - Math.exp(-dt * 7)); }
    camera.position.copy(cam.pos); camera.lookAt(cam.look);
    const kmh = Math.round(v * 3.6), rep = `${kmh}|${S.hit ?? ""}|${S.v < -0.2}`;
    if (rep !== lastReport) { lastReport = rep; cb.onDrive?.({ driving: true, speed: kmh, hit: S.hit, reverse: S.v < -0.2 }); }
    if (!drive.left && onCarriageway(plan.cw, cx, cz, S.yaw, m.slot.len, m.slot.wid)) { drive.left = true; cb.onLeave?.({ id: m.slot.id, modelId: m.slot.modelId, color: m.slot.color, v: S.v, yaw: S.yaw, size }); }
  }

  return {
    setRoom(r, its) { room = r; items = its ?? items; later(); },
    setItems(its) { items = its ?? []; if (room) later(); },
    setVehicles(list) { const key = (l) => l.map((v) => `${v.id}:${v.modelId}:${v.color}`).join("|"); if (key(list) === key(vehicles)) return; vehicles = list; if (room) later(); },
    pick(ray) { const hits = ray.intersectObjects([...meshes.values()].map((m) => m.vehicle.root), true); for (const h of hits) { let o = h.object; while (o && o.userData.fleetId == null) o = o.parent; if (o) return o.userData.fleetId; } return null; },
    start, stop, update, isDriving: () => !!drive, plan: () => plan,
    setInput({ throttle, steer } = {}) { if (throttle != null) pad.throttle = Math.max(-1, Math.min(1, throttle)); if (steer != null) pad.steer = Math.max(-1, Math.min(1, steer)); },
    dispose() { alive = false; clearTimeout(timer); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.removeEventListener("blur", clearInput); document.removeEventListener("visibilitychange", clearInput); clear(); scene.remove(root); padMat.dispose(); },
  };
}
