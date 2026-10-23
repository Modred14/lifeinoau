// A private, walkable parking yard attached to the player's current home.
// Vehicles come from the authenticated Ride endpoint and use the game's driveable models.
import * as THREE from "three";
import { createStage } from "./stage.js";
import { makeVehicle } from "./vehicles.js";
import { createAvatar } from "./avatar/loadAvatar.js";
import { garageLayout, garageWalkPath } from "./garageLayout.js";

export function createHomeGarage(container, vehicles, options = {}) {
  const layout = garageLayout(vehicles), stage = createStage(container, { fov: 48, far: 180, maxDpr: 1.5, shadows: true, controls: { enablePan: true, enableDamping: true, dampingFactor: 0.08, minDistance: 8, maxDistance: 45, minPolarAngle: 0.28, maxPolarAngle: 1.35 } });
  const { scene, camera, controls, THREE: T } = stage, group = new T.Group(), carMeshes = new Map(), disposed = [];
  scene.background = new T.Color("#b9d0da"); scene.fog = new T.Fog("#b9d0da", 65, 155); scene.add(group);
  scene.add(new T.HemisphereLight(0xf3f7ff, 0x71785e, 1.35));
  const sun = new T.DirectionalLight(0xfff1d5, 2.2); sun.position.set(-18, 28, 14); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -28, right: 28, top: 32, bottom: -28, near: 1, far: 90 }); sun.shadow.normalBias = 0.08; scene.add(sun);
  const mat = (color, roughness = 0.85, extra = {}) => { const m = new T.MeshStandardMaterial({ color, roughness, ...extra }); disposed.push(m); return m; };
  const M = { paving: mat("#989d9b"), road: mat("#42484a"), line: mat("#ede7d2"), wall: mat("#ddd6c8"), trim: mat("#f5f1e7"), roof: mat("#4b5962"), glass: mat("#75a7b1", 0.28, { metalness: 0.12 }), door: mat("#4c382b"), green: mat("#416c43"), leaf: mat("#62834d"), warm: mat("#f9d88b", 0.25, { emissive: "#ffcc67", emissiveIntensity: 0.8 }), metal: mat("#34444b", 0.55), concrete: mat("#777e7c"), grass: mat("#688553") };
  const box = (w, h, d, x, y, z, material, cast = false) => { const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material); mesh.position.set(x, y + h / 2, z); mesh.castShadow = cast; mesh.receiveShadow = true; group.add(mesh); return mesh; };
  const cyl = (r, h, x, y, z, material) => { const mesh = new T.Mesh(new T.CylinderGeometry(r, r, h, 8), material); mesh.position.set(x, y + h / 2, z); mesh.castShadow = true; group.add(mesh); return mesh; };
  // Asphalt access lane and a generously sized paved yard. Its width follows the collection size.
  box(layout.width, 0.18, 31, 0, -0.09, -0.5, M.paving);
  box(layout.width + 8, 0.12, 8, 0, -0.13, 16, M.road);
  for (let x = -layout.width / 2 - 3; x <= layout.width / 2 + 3; x += 4) box(2.1, 0.025, 0.13, x, 0.04, 16, M.line);
  // House frontage: entry porch, windows, roof edge and a wide garage door facing the parking yard.
  box(layout.houseWidth, 4.8, 0.55, 0, 0, -15.1, M.wall, true);
  box(layout.houseWidth + 0.6, 0.34, 0.8, 0, 4.8, -15.1, M.roof, true);
  box(layout.houseWidth + 1.3, 0.2, 4, 0, 0.02, -16.3, M.concrete);
  box(2.1, 2.5, 0.12, 0, 0, -14.78, M.door, true);
  box(2.35, 0.16, 0.2, 0, 2.45, -14.7, M.trim);
  for (const x of [-layout.houseWidth * 0.31, layout.houseWidth * 0.31]) { box(2.1, 1.75, 0.1, x, 1.5, -14.77, M.glass); box(2.25, 0.1, 0.16, x, 2.35, -14.68, M.trim); box(0.1, 1.85, 0.16, x, 1.45, -14.68, M.trim); }
  box(Math.min(4.2, layout.houseWidth * 0.32), 2.4, 0.14, layout.houseWidth * 0.34, 0.1, -14.72, M.metal, true); // resident garage shutter
  // Bay stripes and wheel stops. Spacing leaves clearance around the widest model in the catalogue.
  const columns = layout.columns, spacing = 3.8, half = ((columns - 1) * spacing) / 2;
  for (const rowZ of [-5, 5]) for (let i = 0; i < columns; i++) { const x = i * spacing - half;
    box(0.055, 0.018, 7, x - 1.7, 0.01, rowZ, M.line); box(0.055, 0.018, 7, x + 1.7, 0.01, rowZ, M.line);
    box(2.9, 0.12, 0.24, x, 0.02, rowZ + (rowZ < 0 ? -3.1 : 3.1), M.concrete);
    box(0.6, 0.025, 0.14, x, 0.03, rowZ + (rowZ < 0 ? 2.1 : -2.1), M.line);
  }
  // Planting strips, low boundary walls, and warm bollard lights make the yard read as a home exterior.
  box(0.5, 0.55, 27, -layout.width / 2 - 0.4, 0, 0.3, M.concrete); box(0.5, 0.55, 27, layout.width / 2 + 0.4, 0, 0.3, M.concrete);
  for (const side of [-1, 1]) for (let z = -9; z <= 11; z += 4) { const x = side * (layout.width / 2 + 1.3); cyl(0.13, 1.8, x, 0, z, M.metal); const light = new T.Mesh(new T.SphereGeometry(0.18, 8, 6), M.warm); light.position.set(x, 1.82, z); group.add(light); }
  for (const side of [-1, 1]) for (let z = -12; z <= 12; z += 3.5) { const x = side * (layout.width / 2 + 1.7); const shrub = new T.Mesh(new T.IcosahedronGeometry(0.85, 1), M.leaf); shrub.position.set(x, 0.65, z); shrub.scale.set(1.3, 0.85, 0.9); shrub.castShadow = true; group.add(shrub); }
  for (const slot of layout.slots) { const v = makeVehicle(slot.modelId || "", slot.color); v.root.position.set(slot.x, 0, slot.z); v.root.rotation.y = slot.yaw; v.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); group.add(v.root); carMeshes.set(String(slot.id), { ...slot, vehicle: v }); }

  const target = new T.Vector3(0, 0, 1), home = new T.Vector3(0, 7, 25); controls.target.copy(target); camera.position.copy(home); controls.update();
  const start = { x: 0, z: 12 }, player = new T.Group(); scene.add(player); let avatar = null, fallback = null, path = [], selected = null, near = null, alive = true, lastNear = "";
  const fallbackBody = () => { fallback = new T.Group(); const body = new T.Mesh(new T.CapsuleGeometry(0.28, 0.8, 3, 7), mat("#416c83")); body.position.y = 0.82; const head = new T.Mesh(new T.SphereGeometry(0.19, 9, 7), mat("#9b7153")); head.position.y = 1.42; fallback.add(body, head); return fallback; };
  player.position.set(start.x, 0, start.z); scene.add(player);
  createAvatar(options.look, options.gender ?? "M").then((a) => { if (!alive) return a.dispose(); avatar = a; avatar.root.position.set(0, 0, 0); player.add(avatar.root); if (fallback) player.remove(fallback); }).catch(() => { fallback = fallbackBody(); player.add(fallback); });
  const ground = new T.Plane(new T.Vector3(0, 1, 0), 0), hit = new T.Vector3(), ray = new T.Raycaster(), ndc = new T.Vector2(); let down = null;
  const aim = (e) => { const r = stage.renderer.domElement.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); };
  const click = (e) => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; aim(e); const list = [...carMeshes.values()], found = ray.intersectObjects(list.map((v) => v.vehicle.root), true)[0];
    if (found) { let node = found.object; while (node && !node.userData.garageId) node = node.parent; const id = node?.userData.garageId ?? list.find((v) => v.vehicle.root === node)?.id ?? list.find((v) => v.vehicle.root === found.object.parent)?.id;
      const item = list.find((v) => String(v.id) === String(id)) ?? list.find((v) => v.vehicle.root === found.object || v.vehicle.root.children.includes(found.object)); if (item) { selected = item.id; options.onSelect?.(item.id); const side = item.x >= player.position.x ? -1 : 1; const goal = { x: item.x + side * 2.1, z: item.z + (item.row === 0 ? 0.2 : -0.2) }; path = garageWalkPath(player.position, goal, layout).slice(1); } return; }
    if (ray.ray.intersectPlane(ground, hit)) path = garageWalkPath(player.position, { x: hit.x, z: hit.z }, layout).slice(1);
  };
  for (const [id, item] of carMeshes) item.vehicle.root.traverse((o) => { o.userData.garageId = id; });
  const canvas = stage.renderer.domElement, pointerDown = (e) => { down = { x: e.clientX, y: e.clientY }; }, pointerUp = (e) => { click(e); down = null; };
  canvas.addEventListener("pointerdown", pointerDown); canvas.addEventListener("pointerup", pointerUp);
  let gait = "";
  stage.onFrame((t, dt) => { if (avatar) avatar.update(t, dt); if (!path.length) { if (avatar && gait !== "idle") { avatar.play("idle", { fade: 0.2 }); gait = "idle"; } return; }
    if (avatar && gait !== "walk") { avatar.play("walk", { fade: 0.15 }); gait = "walk"; }
    let left = Math.min(0.08, dt) * 2.2;
    while (left > 0 && path.length) { const p = path[0], dx = p.x - player.position.x, dz = p.z - player.position.z, d = Math.hypot(dx, dz); if (d < 0.12) { path.shift(); continue; } const take = Math.min(left, d); player.position.x += dx / d * take; player.position.z += dz / d * take; player.rotation.y = Math.atan2(dx, dz); left -= take; }
    const dx = player.position.x - controls.target.x, dz = player.position.z - controls.target.z; controls.target.x += dx; controls.target.z += dz; camera.position.x += dx; camera.position.z += dz;
  });
  stage.onFrame(() => { if (selected == null) { if (near !== null) { near = null; lastNear = ""; options.onNear?.(null); } return; } const item = carMeshes.get(String(selected)); if (!item) return; const d = Math.hypot(player.position.x - item.x, player.position.z - item.z), next = d <= 3.2 ? item.id : null; if (String(next) !== lastNear) { lastNear = String(next); near = next; options.onNear?.(next); } });
  return { layout, select(id) { selected = id; }, dispose() { alive = false; canvas.removeEventListener("pointerdown", pointerDown); canvas.removeEventListener("pointerup", pointerUp); avatar?.dispose(); stage.dispose(); for (const m of disposed) m.dispose(); group.traverse((o) => { if (o.isMesh) o.geometry?.dispose(); }); } };
}
