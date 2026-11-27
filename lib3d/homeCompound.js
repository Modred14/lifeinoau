// lib3d/homeCompound.js
// The player's own home compound, standing on the map. It is drawn from the very same pieces the home screen draws (lib3d/plot3d.js, lib3d/houseShell.js, lib3d/furnitureModels.js, the vehicle factory), on the lot
// that lib3d/homeLot.js found beside a real road, and what is solid and what a car may drive over comes from lib3d/homeSite.js. So the house, the garage, the gate, the owned vehicles and the street are
// one place: you walk out of the footgate onto the real pavement and drive out of the gate onto the real carriageway, in the one scene, with nothing to load in between.
// Browser side (three.js). The pure parts (lot, site, collision) are in homeLot.js / homeSite.js and are tested headlessly.
import * as THREE from "three";
import { buildPlot, GROUND } from "./plot3d.js";
import { buildHouseShell, WALL_T, entranceOf, HOLE_W } from "./houseShell.js";
import { buildFurniture } from "./furnitureModels.js";
import { tree } from "./trees.js";
import { makeVehicle } from "./vehicles.js";
import { ROAD_TOP } from "./roadsurface.js";
import { CELL_M } from "./compoundUnits.js";
import { homeLot, compoundRing } from "./homeLot.js";
import { homeSite, homePortal, homeBuilding, addSiteCollision, removeSiteCollision } from "./homeSite.js";
import { ITEMS, sizeOf } from "../lib/furniture.js";
import { isOutside } from "../lib/room.js";

const inRing = (x, z, p) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) if ((p[i][1] > z) !== (p[j][1] > z) && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; return c; };

export const WALL_H = 3.4; // the same height the home screen gives the walls (lib3d/room.js)
const LAWN_Y = -0.3;      // an outdoor piece stands this far down from the floor level, on the lawn (as on the home screen)

/**
 * Puts the compound on the map. `parent` is the trip's metre-space group; `svc` the world services. `room` is the home's room (lib/room.js roomFor), `items` its placed things, `vehicles` the owned
 * vehicles [{ id, modelId, color }], `anchor` the home place's { x, z } (the lot is the nearest free one beside a road), `seed` the character id (spreads people over the nearby lots).
 * `activeId` is the vehicle the trip itself draws and drives (the others are parked here as scenery with a solid body).
 * Returns null when there is no free lot, else { site, lot, portal, B, drivable, activeSlot, update(dt, x, z), dispose() }.
 */
export function createHomeCompound({ parent, svc, room, items = [], vehicles = [], anchor, seed = "", activeId = null, interior = false }) {
  const lot = homeLot(svc, room, anchor, seed); if (!lot) return null;
  const site = homeSite(room, items, vehicles, lot, { interior }), portal = homePortal(room, site), F = site.F;
  removeSiteCollision(svc.world); addSiteCollision(svc.world, site);
  // the house is its footprint exactly (the solid the walker plans round and the door opens in), not the wider apron the vehicles keep clear
  // the yard, the house and the driveway are cleared of trees, stalls and banners for as long as the compound stands (lib3d/campuslife/decor.js)
  const ring = compoundRing(room, lot), restoreDecor = svc.world.suspendDecor?.((p) => p.tag.pts.some(([x, z]) => inRing(x, z, ring)));
  const root = new THREE.Group(); root.name = "home-compound"; parent.add(root);
  const mats = [], mat = (color, o = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }); mats.push(m); return m; };
  const frame = new THREE.Group(); frame.position.set(F.group.x, ROAD_TOP - GROUND * CELL_M, F.group.z); frame.rotation.y = F.group.rotY; frame.scale.setScalar(CELL_M); root.add(frame);

  const plot = buildPlot(room, { mat, tree, embedded: true }); frame.add(plot.group);
  const shell = buildHouseShell(room, WALL_H); frame.add(shell.group);
  // the walls behind the cladding: a solid house (nobody goes inside here; the door leads to the home screen), a shade inside the cladding so the two never fight
  const W = room.w, D = room.d, indoor = [];
  if (!interior) { const core = new THREE.Mesh(new THREE.BoxGeometry(W + WALL_T * 2 - 0.1, WALL_H, D + WALL_T * 2 - 0.1), mat("#2a2622", { roughness: 1 })); core.position.y = WALL_H / 2; frame.add(core); }
  else { // a house you can walk into: the inner faces of the four walls (a doorway in the front one) and the things that stand indoors
    const ent = entranceOf(room), wallM = mat("#dcd5c5", { roughness: 0.95 }), HW = HOLE_W / 2, DOOR_TOP = 2.32, T = 0.06;
    const interiorG = new THREE.Group(); interiorG.name = "home-interior"; frame.add(interiorG);
    const panel = (w, h, x, y, z, rotY) => { const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, T), wallM); g.position.set(x, y, z); g.rotation.y = rotY; g.receiveShadow = true; interiorG.add(g); };
    const sides = { N: [0, -D / 2 + T / 2, 0, W], S: [0, D / 2 - T / 2, 0, W], W: [-W / 2 + T / 2, 0, Math.PI / 2, D], E: [W / 2 - T / 2, 0, Math.PI / 2, D] };
    for (const [k, [x, z, rot, len]] of Object.entries(sides)) {
      if (k !== ent.side) { panel(len, WALL_H, x, WALL_H / 2, z, rot); continue; }
      const along = k === "S" || k === "N" ? ent.cx : ent.cz, put = (lo, hi, y, h) => { if (hi - lo < 0.02) return; const c = (lo + hi) / 2; if (rot) panel(hi - lo, h, x, y, z + c, rot); else panel(hi - lo, h, x + c, y, z, rot); };
      put(-len / 2, along - HW, WALL_H / 2, WALL_H); put(along + HW, len / 2, WALL_H / 2, WALL_H); put(along - HW, along + HW, DOOR_TOP + (WALL_H - DOOR_TOP) / 2, WALL_H - DOOR_TOP);
    }
    // the things placed indoors, where the home screen puts them
    for (const it of items) {
      if (!it || it.placed === false || it.x == null || !ITEMS[it.key] || isOutside(room, it)) continue;
      const g = buildFurniture(it.key), [w, d] = sizeOf(it.key, it.rot ?? 0);
      g.position.set(it.x + w / 2 - W / 2, 0, it.z + d / 2 - D / 2); g.rotation.y = (-(it.rot ?? 0) * Math.PI) / 2; g.userData.itemId = String(it.id); g.userData.item = it; indoor.push(g); interiorG.add(g);
    }
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.34, D + 0.3), mat("#bdb6a6", { roughness: 1 })); floor.position.y = -0.17; frame.add(floor);

  // whatever is out on the lawn (the same pieces, the same places as the home screen)
  const outdoor = [];
  for (const it of items) {
    if (!it || it.placed === false || it.x == null || !ITEMS[it.key] || !isOutside(room, it)) continue;
    const g = buildFurniture(it.key), [w, d] = sizeOf(it.key, it.rot ?? 0); g.position.set(it.x + w / 2 - W / 2, LAWN_Y, it.z + d / 2 - D / 2); g.rotation.y = (-(it.rot ?? 0) * Math.PI) / 2;
    frame.add(g); outdoor.push(g);
  }

  // the owned vehicles standing where the home screen parks them; the active one is drawn by the trip, so its slot is only reported
  const bodies = [], cars = [], byId = new Map(vehicles.map((v) => [String(v.id), v]));
  let activeSlot = null;
  for (const s of site.slots) {
    if (activeId != null && String(s.id) === String(activeId)) { activeSlot = s; continue; }
    const v = byId.get(String(s.id)); if (!v) continue;
    const m = makeVehicle(v.modelId, v.color); m.root.position.set(s.x, ROAD_TOP, s.z); m.root.rotation.y = Math.atan2(s.hx, s.hz); parent.add(m.root); cars.push(m);
    const id = "park:" + s.id; svc.world.setBody(id, { x: s.x, z: s.z, hx: s.hx, hz: s.hz, hl: s.len / 2, hw: s.wid / 2 }); bodies.push(id);
  }

  const doorAt = portal.door; let view = "chase", mix = 1, inNow = false;
  /** "chase": third person; the roof and the outer skin of the walls melt away while the person is inside. "cutaway": roof and outer skin are always off, so the whole inside can be seen. */
  const setView = (v) => { view = v === "cutaway" ? "cutaway" : "chase"; };
  function update(dt, px, pz) { // the front door opens as someone comes close to it, from either side
    const near = Math.min(1, Math.max(0, 1 - (Math.hypot(px - doorAt.x, pz - doorAt.z) / CELL_M - 0.9) / 1.9));
    inNow = interior && site.insideHouse(px, pz);
    const want = !interior ? 1 : view === "cutaway" ? 0 : inNow ? 0 : 1; mix += (want - mix) * (1 - Math.exp(-dt * 6));
    shell.update(dt, { mix: Math.abs(want - mix) < 0.01 ? want : mix, near });
  }
  function dispose() {
    for (const id of bodies) svc.world.removeBody(id);
    removeSiteCollision(svc.world);
    restoreDecor?.(); parent.remove(root); for (const c of cars) { parent.remove(c.root); c.dispose?.(); }
    plot.group.traverse((o) => { if (!o.geometry?.userData?.shared) o.geometry?.dispose?.(); }); plot.release?.(); shell.dispose();
    frame.traverse((o) => { if (o.parent && (outdoor.includes(o) || indoor.includes(o))) o.traverse((q) => { q.geometry?.dispose?.(); }); }); for (const m of mats) m.dispose();
  }
  /** The piece of furniture under a ray (a THREE.Raycaster already aimed), or null: { item, point }. Only things indoors can be picked. */
  const pick = (ray) => { if (!indoor.length) return null; const hit = ray.intersectObjects(indoor, true)[0]; if (!hit) return null; let o = hit.object; while (o && !o.userData.item) o = o.parent; return o ? { item: o.userData.item, point: hit.point } : null; };
  const B = homeBuilding(site, portal);
  return { pick, site, lot, portal, B, drivable: site.drivable, activeSlot, update, dispose, root, setView, get view() { return view; }, get inside() { return inNow; } };
}
