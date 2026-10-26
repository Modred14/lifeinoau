// lib3d/homeGarage.js
// A private, walkable and driveable parking compound attached to the player's current home.
// Vehicles come from the authenticated Ride endpoint and use the game's driveable models. The compound (lib3d/garageLayout.js) has a wide driveway lane that runs
// from the house straight through an open gate onto the road; every bay opens onto that lane, and lib3d/garageDrive.js lets the player steer a car out along it.
import * as THREE from "three";
import { createStage } from "./stage.js";
import { makeVehicle, rollWheels } from "./vehicles.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { garageLayout, garageWalkPath, garageVehicleSize, G } from "./garageLayout.js";
import { driveWorld, createDriver, onRoad } from "./garageDrive.js";

export function createHomeGarage(container, vehicles, options = {}) {
  const layout = garageLayout(vehicles), L = layout;
  const stage = createStage(container, { fov: 48, far: 220, maxDpr: 1.5, shadows: true, controls: { enablePan: true, enableDamping: true, dampingFactor: 0.08, minDistance: 8, maxDistance: 70, minPolarAngle: 0.28, maxPolarAngle: 1.35 } });
  const { scene, camera, controls, THREE: T } = stage, group = new T.Group(), carMeshes = new Map(), disposed = [];
  scene.background = new T.Color("#b9d0da"); scene.fog = new T.Fog("#b9d0da", 80, 190); scene.add(group);
  scene.add(new T.HemisphereLight(0xf3f7ff, 0x71785e, 1.35));
  const sun = new T.DirectionalLight(0xfff1d5, 2.2); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  const sx = L.halfW + 5, sz = L.depth / 2 + 5; Object.assign(sun.shadow.camera, { left: -sx, right: sx, top: sz, bottom: -sz, near: 1, far: 120 }); sun.shadow.normalBias = 0.08;
  sun.position.set(-18, 34, L.center.z + 8); sun.target.position.set(0, 0, L.center.z); scene.add(sun, sun.target);
  const mat = (color, roughness = 0.85, extra = {}) => { const m = new T.MeshStandardMaterial({ color, roughness, ...extra }); disposed.push(m); return m; };
  const M = { paving: mat("#989d9b"), lane: mat("#80878a"), joint: mat("#6f7678"), road: mat("#42484a"), line: mat("#ede7d2"), wall: mat("#ddd6c8"), trim: mat("#f5f1e7"), roof: mat("#4b5962"), glass: mat("#75a7b1", 0.28, { metalness: 0.12 }), door: mat("#4c382b"), dark: mat("#20262a"), leaf: mat("#62834d"), warm: mat("#f9d88b", 0.25, { emissive: "#ffcc67", emissiveIntensity: 0.8 }), metal: mat("#34444b", 0.55), concrete: mat("#777e7c"), pavement: mat("#c2bfb3"), kerb: mat("#c9c6bb"), grass: mat("#688553"), canopy: mat("#9fc4cc", 0.2, { transparent: true, opacity: 0.32, depthWrite: false }), nWall: mat("#d9cfc0"), nRoof: mat("#7b6a5a") };
  const rect = (x0, x1, z0, z1, y, h, material, cast = false) => { const mesh = new T.Mesh(new T.BoxGeometry(x1 - x0, h, z1 - z0), material); mesh.position.set((x0 + x1) / 2, y + h / 2, (z0 + z1) / 2); mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  const cyl = (r, h, x, y, z, material) => { const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 8), material); mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; group.add(mesh); return mesh; };
  const W = L.halfW, lane = L.laneHalf, gate = L.front.gate, wallT = G.WALL / 2, rd = L.road;

  // ---- the ground: compound paving, the driveway lane, the footpath with a dropped kerb at the gate, and the road ----
  rect(-W, W, L.zTop, L.frontZ, -0.18, 0.18, M.paving);
  rect(-lane, lane, L.zTop + 0.55, L.road.z0, -0.01, 0.012, M.lane); // the driveway lane, one surface from the house to the road
  for (let z = L.zTop + 3; z < L.road.z0; z += 3) rect(-lane, lane, z - 0.03, z + 0.03, 0.0, 0.006, M.joint);
  rect(-rd.x1, rd.x1, L.pavement.z0, rd.z0, -0.18, 0.18, M.pavement);
  rect(gate[0], gate[1], L.pavement.z0 - 0.1, rd.z0, -0.01, 0.012, M.lane); // the dropped kerb: the lane carries on across the footpath
  rect(-rd.x1, rd.x1, rd.z0, rd.z1, -0.18, 0.17, M.road);
  rect(-rd.x1, gate[0], rd.z0 - 0.1, rd.z0 + 0.08, -0.18, 0.2, M.kerb); rect(gate[1], rd.x1, rd.z0 - 0.1, rd.z0 + 0.08, -0.18, 0.2, M.kerb); // kerbs, not across the gate
  rect(-rd.x1, rd.x1, rd.z1 - 0.08, rd.z1 + 0.1, -0.18, 0.2, M.kerb);
  rect(-rd.x1, rd.x1, rd.z1 + 0.1, rd.z1 + 2.6, -0.18, 0.18, M.pavement);
  for (let x = -rd.x1 + 1; x < rd.x1 - 2; x += 4) rect(x, x + 2.1, (rd.z0 + rd.z1) / 2 - 0.07, (rd.z0 + rd.z1) / 2 + 0.07, -0.015, 0.012, M.line);
  rect(-rd.x1, rd.x1, rd.z0 + 0.15, rd.z0 + 0.3, -0.015, 0.012, M.line); // a stop line is not needed: a give-way edge marking where the driveway meets the road
  for (const side of [-1, 1]) rect(side * (lane + 0.02) - 0.06, side * (lane + 0.02) + 0.06, L.zTop + 0.8, L.frontZ - 0.5, 0.0, 0.01, M.line); // the driveway's edge lines

  // ---- the house frontage with the garage shutter in line with the driveway ----
  rect(-W, W, L.zTop, L.houseZ, 0, 4.8, M.wall, true); rect(-W - 0.3, W + 0.3, L.zTop - 0.2, L.houseZ + 0.45, 4.8, 0.34, M.roof, true);
  const gw = Math.min(5.2, lane * 1.7);
  rect(-gw / 2 - 0.15, gw / 2 + 0.15, L.houseZ - 0.02, L.houseZ + 0.08, 0, 3.1, M.trim); rect(-gw / 2, gw / 2, L.houseZ - 0.01, L.houseZ + 0.1, 0, 2.9, M.dark); // the open garage door
  rect(-gw / 2, gw / 2, L.houseZ + 0.1, L.houseZ + 0.2, 2.7, 0.2, M.metal); // the shutter, rolled up
  for (const x of [-W * 0.55, -W * 0.3, W * 0.3, W * 0.55]) { rect(x - 1, x + 1, L.houseZ - 0.01, L.houseZ + 0.1, 1.5, 1.75, M.glass); rect(x - 1.12, x + 1.12, L.houseZ + 0.08, L.houseZ + 0.2, 3.2, 0.12, M.trim); }
  rect(-W, W, L.houseZ, L.houseZ + 1.0, -0.17, 0.2, M.concrete); // the step along the house

  // ---- the compound wall: both sides, and the front wall with the gate left open ----
  rect(-W - wallT, -W + wallT, L.zTop, L.frontZ, 0, 1.0, M.concrete, true); rect(W - wallT, W + wallT, L.zTop, L.frontZ, 0, 1.0, M.concrete, true);
  rect(-W, gate[0], L.frontZ - wallT, L.frontZ + wallT, 0, 1.0, M.concrete, true); rect(gate[1], W, L.frontZ - wallT, L.frontZ + wallT, 0, 1.0, M.concrete, true);
  for (const x of [gate[0], gate[1]]) { rect(x - 0.3, x + 0.3, L.frontZ - 0.3, L.frontZ + 0.3, 0, 1.7, M.wall, true); rect(x - 0.38, x + 0.38, L.frontZ - 0.38, L.frontZ + 0.38, 1.7, 0.1, M.trim); const lamp = new T.Mesh(new T.SphereGeometry(0.2, 8, 6), M.warm); lamp.position.set(x, 1.95, L.frontZ); group.add(lamp); }
  for (const side of [-1, 1]) for (let z = L.zTop + 5; z < L.frontZ - 2; z += 5) { const x = side * (lane + 0.5); cyl(0.09, 0.6, x, 0, z, M.metal); const l = new T.Mesh(new T.SphereGeometry(0.14, 8, 6), M.warm); l.position.set(x, 0.66, z); group.add(l); } // low bollard lights along the driveway
  for (const side of [-1, 1]) for (let z = L.zTop + 2; z < L.frontZ - 1; z += 3) { const shrub = new T.Mesh(new T.IcosahedronGeometry(0.55, 1), M.leaf); shrub.position.set(side * (W + 0.9), 0.5, z); shrub.scale.set(1.1, 0.8, 1); shrub.castShadow = true; group.add(shrub); }

  // ---- covered bays: a see-through roof on posts behind the cars' tails, so nothing stands in the way of a car swinging out ----
  const b0 = L.bays0 - G.PITCH / 2, b1 = L.bays0 + (L.perSide - 1) * G.PITCH + G.PITCH / 2;
  for (const side of [-1, 1]) { const xa = side * (lane + 0.05), xb = side * (lane + G.NOSE + G.BAY_D); rect(Math.min(xa, xb), Math.max(xa, xb), b0, b1, 3.0, 0.1, M.canopy); rect(Math.min(xa, xb), Math.max(xa, xb), b0 - 0.05, b0 + 0.05, 2.95, 0.15, M.metal); }
  for (const p of L.posts) cyl(p.r, 3.0, p.x, 0, p.z, M.metal);
  for (const side of [-1, 1]) for (let i = 0; i < L.perSide; i++) { const z = L.bays0 + i * G.PITCH;
    rect(side * (lane + 0.5) - 0.03, side * (lane + 0.5) + 0.03, z - 1.85, z + 1.85, 0.0, 0.006, M.line); // the bay's mouth is open: a thin line marks where it begins
    for (const dz of [-G.PITCH / 2 + 0.1, G.PITCH / 2 - 0.1]) rect(side < 0 ? -(lane + G.NOSE + G.BAY_D) : lane + 0.5, side < 0 ? -(lane + 0.5) : lane + G.NOSE + G.BAY_D, z + dz - 0.03, z + dz + 0.03, 0.0, 0.006, M.line); // bay lines
    rect(side * (lane + G.NOSE + G.BAY_D - 0.6) - 0.15, side * (lane + G.NOSE + G.BAY_D - 0.6) + 0.15, z - 1.4, z + 1.4, 0.0, 0.12, M.concrete); } // wheel stops

  // ---- the neighbours either side, outside the wall: a gap, a lawn and a house, so nothing here touches another plot ----
  for (const side of [-1, 1]) { const x0 = side * (W + 2), x1 = side * (W + 14); rect(Math.min(x0, x1), Math.max(x0, x1), L.zTop, L.frontZ, -0.18, 0.18, M.grass); }

  // ---- the vehicles ----
  for (const slot of layout.slots) { const v = makeVehicle(slot.modelId || "", slot.color); v.root.position.set(slot.x, 0, slot.z); v.root.rotation.y = slot.yaw; v.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); group.add(v.root); carMeshes.set(String(slot.id), { ...slot, vehicle: v }); }
  for (const [id, item] of carMeshes) item.vehicle.root.traverse((o) => { o.userData.garageId = id; });

  // ---- camera, and the person ----
  const home = { target: new T.Vector3(0, 0, L.center.z - 1), dist: Math.max(36, L.depth * 1.05) };
  controls.target.copy(home.target); camera.position.set(0, home.dist * 0.62, home.target.z + home.dist * 0.8); controls.update();
  const start = L.start, player = new T.Group(); scene.add(player); let avatar = null, fallback = null, path = [], selected = null, near = null, alive = true, lastNear = "";
  const fallbackBody = () => { fallback = new T.Group(); const body = new T.Mesh(new T.CapsuleGeometry(0.28, 0.8, 3, 7), mat("#416c83")); body.position.y = 0.82; const head = new T.Mesh(new T.SphereGeometry(0.19, 9, 7), mat("#9b7153")); head.position.y = 1.42; fallback.add(body, head); return fallback; };
  player.position.set(start.x, 0, start.z);
  createAvatar(options.look, options.gender ?? "M").then((a) => { if (!alive) return a.dispose(); avatar = a; avatar.root.position.set(0, 0, 0); player.add(avatar.root); if (fallback) player.remove(fallback); }).catch(() => { fallback = fallbackBody(); player.add(fallback); });

  const ground = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), ray = new T.Raycaster(), ndc = new T.Vector2(); let down = null;
  const aim = (e) => { const r = stage.renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  let drive = null; // { id, item, driver, size, world }
  const click = (e) => {
    if (drive || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return; aim(e); const list = [...carMeshes.values()], found = ray.intersectObjects(list.map((v) => v.vehicle.root), true)[0];
    if (found) { let node = found.object; while (node && node.userData.garageId == null) node = node.parent; const id = node?.userData.garageId; const item = carMeshes.get(String(id)); if (item) { selected = item.id; options.onSelect?.(item.id); path = garageWalkPath(player.position, { x: item.x, z: item.z + G.PITCH / 2 }, layout).slice(1); } return; }
    if (ray.ray.intersectPlane(ground, hit)) path = garageWalkPath(player.position, { x: hit.x, z: hit.z }, layout).slice(1);
  };
  const canvas = stage.renderer.domElement, pointerDown = (e) => { down = { x: e.clientX, y: e.clientY }; }, pointerUp = (e) => { click(e); down = null; };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointerup", pointerUp);

  // ---- driving: keyboard, and a virtual stick/pedals fed through setInput (touch and mouse) ----
  const keys = new Set(), pad = { throttle: 0, steer: 0 };
  const KEYMAP = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down", ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", " ": "down" };
  const keydown = (e) => { if (!drive || e.metaKey || e.ctrlKey || e.altKey) return; const k = KEYMAP[e.key]; if (!k) return; keys.add(k); e.preventDefault(); };
  const keyup = (e) => { const k = KEYMAP[e.key]; if (k) keys.delete(k); };
  const clearInput = () => { keys.clear(); pad.throttle = 0; pad.steer = 0; };
  window.addEventListener("keydown", keydown); window.addEventListener("keyup", keyup); window.addEventListener("blur", clearInput); document.addEventListener("visibilitychange", clearInput);
  const input = () => ({ throttle: Math.max(-1, Math.min(1, (keys.has("up") ? 1 : 0) - (keys.has("down") ? 1 : 0) + pad.throttle)), steer: Math.max(-1, Math.min(1, (keys.has("right") ? 1 : 0) - (keys.has("left") ? 1 : 0) + pad.steer)) });

  const cam = { pos: new T.Vector3(), look: new T.Vector3(), ready: false }, tmp = new T.Vector3();
  let lastReport = "", wasOnRoad = false, steerShown = 0;
  function startDrive(id) {
    const item = carMeshes.get(String(id)); if (!item || drive) return false;
    const size = garageVehicleSize(item.modelId), world = driveWorld(layout, item.id), driver = createDriver(world, { x: item.x, z: item.z, yaw: item.yaw }, size);
    drive = { id: item.id, item, driver, size, world }; path = []; clearInput(); player.visible = false; stage.setManual(true); cam.ready = false; wasOnRoad = false; lastReport = ""; options.onDrive?.({ driving: true, speed: 0, onRoad: false, hit: null }); return true;
  }
  function stopDrive({ park = true } = {}) {
    if (!drive) return; const { item } = drive; drive = null; clearInput();
    if (park) { item.vehicle.root.position.set(item.x, 0, item.z); item.vehicle.root.rotation.y = item.yaw; } // back into its bay: the player parks it; nothing else moves
    player.visible = true; player.position.set(L.start.x, 0, L.start.z); path = []; stage.setManual(false);
    controls.target.copy(home.target); camera.position.set(0, home.dist * 0.62, home.target.z + home.dist * 0.8); controls.update(); options.onDrive?.({ driving: false, speed: 0, onRoad: false, hit: null });
  }
  let gait = "";
  stage.onFrame((t, dt) => {
    if (avatar) avatar.update(t, dt);
    if (drive) {
      const { driver, item, size } = drive, S = driver.state, moved = driver.step(input(), Math.min(dt, 0.1));
      item.vehicle.root.position.set(S.x, 0, S.z); item.vehicle.root.rotation.y = S.yaw; steerShown += (S.steer - steerShown) * Math.min(1, dt * 12); rollWheels(item.vehicle, moved, -steerShown);
      const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), want = tmp.set(S.x - fx * (8.5 + Math.abs(S.v) * 0.35), 5.2 + Math.abs(S.v) * 0.12, S.z - fz * (8.5 + Math.abs(S.v) * 0.35)), look = new T.Vector3(S.x + fx * 3, 0.9, S.z + fz * 3);
      if (!cam.ready) { cam.pos.copy(want); cam.look.copy(look); cam.ready = true; } else { const k = 1 - Math.exp(-dt * 4.5); cam.pos.lerp(want, k); cam.look.lerp(look, 1 - Math.exp(-dt * 7)); }
      camera.position.copy(cam.pos); camera.lookAt(cam.look);
      const kmh = Math.round(Math.abs(S.v) * 3.6), road = onRoad(layout, S.x, S.z, S.yaw, size.length, size.width), rep = `${kmh}|${road}|${S.hit ?? ""}`;
      if (rep !== lastReport) { lastReport = rep; wasOnRoad = road; options.onDrive?.({ driving: true, speed: kmh, onRoad: road, hit: S.hit, reverse: S.v < -0.2 }); }
      return;
    }
    if (!path.length) { if (avatar && gait !== "idle") { avatar.play("idle", { fade: 0.2 }); gait = "idle"; } return; }
    if (avatar && gait !== "walk") { avatar.play("walk", { fade: 0.15 }); gait = "walk"; }
    let left = Math.min(0.08, dt) * 2.2;
    while (left > 0 && path.length) { const p = path[0], dx = p.x - player.position.x, dz = p.z - player.position.z, d = Math.hypot(dx, dz); if (d < 0.12) { path.shift(); continue; } const take = Math.min(left, d); player.position.x += dx / d * take; player.position.z += dz / d * take; player.rotation.y = Math.atan2(dx, dz); left -= take; }
    const dx = player.position.x - controls.target.x, dz = player.position.z - controls.target.z; controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
  });
  stage.onFrame(() => { if (drive) return; if (selected == null) { if (near !== null) { near = null; lastNear = ""; options.onNear?.(null); } return; } const item = carMeshes.get(String(selected)); if (!item) return; const d = Math.hypot(player.position.x - item.x, player.position.z - item.z), next = d <= 3.2 ? item.id : null; if (String(next) !== lastNear) { lastNear = String(next); near = next; options.onNear?.(next); } });
  return {
    layout, select(id) { selected = id; }, startDrive, stopDrive, isDriving: () => !!drive,
    setInput({ throttle, steer } = {}) { if (throttle != null) pad.throttle = Math.max(-1, Math.min(1, throttle)); if (steer != null) pad.steer = Math.max(-1, Math.min(1, steer)); },
    carState: () => (drive ? { ...drive.driver.state } : null),
    dispose() { alive = false; canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointerup", pointerUp); window.removeEventListener("keydown", keydown); window.removeEventListener("keyup", keyup); window.removeEventListener("blur", clearInput); document.removeEventListener("visibilitychange", clearInput); avatar?.dispose(); stage.dispose(); for (const m of disposed) m.dispose(); group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); }); },
  };
}
