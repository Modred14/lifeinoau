// lib3d/homeCompound.js
// The player's own home compound, standing on the map. It is drawn from the very same pieces the home screen draws (lib3d/plot3d.js, lib3d/houseShell.js, lib3d/furnitureModels.js, the vehicle factory), on the lot
// that lib3d/homeLot.js found beside a real road, and what is solid and what a car may drive over comes from lib3d/homeSite.js. So the house, the garage, the gate, the owned vehicles and the street are
// one place: you walk out of the footgate onto the real pavement and drive out of the gate onto the real carriageway, in the one scene, with nothing to load in between.
// Browser side (three.js). The pure parts (lot, site, collision) are in homeLot.js / homeSite.js and are tested headlessly.
import * as THREE from "three";
import { buildPlot, GROUND } from "./plot3d.js";
import { buildHouseShell, WALL_T } from "./houseShell.js";
import { buildFurniture } from "./furnitureModels.js";
import { tree } from "./trees.js";
import { makeVehicle } from "./vehicles.js";
import { ROAD_TOP } from "./roadsurface.js";
import { CELL_M } from "./compoundUnits.js";
import { homeLot } from "./homeLot.js";
import { homeSite, homePortal, homeBuilding, addSiteCollision, removeSiteCollision } from "./homeSite.js";
import { ITEMS, sizeOf } from "../lib/furniture.js";
import { isOutside } from "../lib/room.js";

export const WALL_H = 3.4; // the same height the home screen gives the walls (lib3d/room.js)
const LAWN_Y = -0.3;      // an outdoor piece stands this far down from the floor level, on the lawn (as on the home screen)

/**
 * Puts the compound on the map. `parent` is the trip's metre-space group; `svc` the world services. `room` is the home's room (lib/room.js roomFor), `items` its placed things, `vehicles` the owned
 * vehicles [{ id, modelId, color }], `anchor` the home place's { x, z } (the lot is the nearest free one beside a road), `seed` the character id (spreads people over the nearby lots).
 * `activeId` is the vehicle the trip itself draws and drives (the others are parked here as scenery with a solid body).
 * Returns null when there is no free lot, else { site, lot, portal, B, drivable, activeSlot, update(dt, x, z), dispose() }.
 */
export function createHomeCompound({ parent, svc, room, items = [], vehicles = [], anchor, seed = "", activeId = null }) {
  const lot = homeLot(svc, room, anchor, seed); if (!lot) return null;
  const site = homeSite(room, items, vehicles, lot), portal = homePortal(room, site), F = site.F;
  removeSiteCollision(svc.world); addSiteCollision(svc.world, site);
  // the house is its footprint exactly (the solid the walker plans round and the door opens in), not the wider apron the vehicles keep clear
  const root = new THREE.Group(); root.name = "home-compound"; parent.add(root);
  const mats = [], mat = (color, o = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...o }); mats.push(m); return m; };
  const frame = new THREE.Group(); frame.position.set(F.group.x, ROAD_TOP - GROUND * CELL_M, F.group.z); frame.rotation.y = F.group.rotY; frame.scale.setScalar(CELL_M); root.add(frame);

  const plot = buildPlot(room, { mat, tree, embedded: true }); frame.add(plot.group);
  const shell = buildHouseShell(room, WALL_H); frame.add(shell.group);
  // the walls behind the cladding: a solid house (nobody goes inside here; the door leads to the home screen), a shade inside the cladding so the two never fight
  const W = room.w, D = room.d, core = new THREE.Mesh(new THREE.BoxGeometry(W + WALL_T * 2 - 0.1, WALL_H, D + WALL_T * 2 - 0.1), mat("#2a2622", { roughness: 1 })); core.position.y = WALL_H / 2; frame.add(core);
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

  const doorAt = portal.door;
  function update(dt, px, pz) { // the front door opens as someone comes close to it, from either side
    const near = Math.min(1, Math.max(0, 1 - (Math.hypot(px - doorAt.x, pz - doorAt.z) / CELL_M - 0.9) / 1.9));
    shell.update(dt, { mix: 1, near });
  }
  function dispose() {
    for (const id of bodies) svc.world.removeBody(id);
    removeSiteCollision(svc.world);
    parent.remove(root); for (const c of cars) { parent.remove(c.root); c.dispose?.(); }
    plot.group.traverse((o) => { if (!o.geometry?.userData?.shared) o.geometry?.dispose?.(); }); plot.release?.(); shell.dispose();
    frame.traverse((o) => { if (o.parent && outdoor.includes(o)) o.traverse((q) => { q.geometry?.dispose?.(); }); }); for (const m of mats) m.dispose();
  }
  const B = homeBuilding(site, portal);
  return { site, lot, portal, B, drivable: site.drivable, activeSlot, update, dispose, root };
}
