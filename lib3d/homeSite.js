// lib3d/homeSite.js
// Everything about a home compound once it stands on a lot (lib3d/homeLot.js), in the map's own metres: what is solid, where a car may drive, where people and vehicles start, where each owned vehicle is parked.
// It is the SAME compound the home screen draws and drives in (lib/plot.js, lib3d/compoundParking.js), only carried onto the map's coordinates, so a vehicle that leaves the gate on the home screen is at the
// very same place on the very same lot when the map takes over. Pure JS (no three.js): the tests run it against the real map.
import { CELL_M } from "./compoundUnits.js";
import { compoundWorld, planParking } from "./compoundParking.js";
import { lotFrame, lotShape } from "./homeLot.js";
import { entranceOf, WALL_T as SHELL_T, HOLE_W } from "./houseShell.js";
import { doorLink } from "./compoundWalk.js";

export const HOME_OWNER = "home"; // the tag on every solid a compound adds to the shared collision world (CollisionWorld.removeOwned)
const WALL_T = SHELL_T;  // a wall of the house is this thick (lib3d/houseShell.js): the house is solid out to its outer face
const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

/**
 * The site of a compound. `items` are the player's placed things (outdoor ones are solid), `vehicles` the owned ones: [{ id, modelId, color }].
 * Returns { F, polys, walls, drivable(x, z), toCell(x, z), slots, spawn, door, cw }.
 */
export function homeSite(room, items, vehicles, lot) {
  const { P, anchor } = lotShape(room), F = lotFrame(room, lot), cw = compoundWorld(room, items ?? []), pl = P.plot, ax = [lot.dz, -lot.dx], az = [lot.dx, lot.dz];
  const toCell = (x, z) => { const u = ((x - lot.x) * ax[0] + (z - lot.z) * ax[1]) / CELL_M, v = ((x - lot.x) * az[0] + (z - lot.z) * az[1]) / CELL_M; return [anchor.x + u, anchor.z + v]; };
  const dirOf = (hx, hz) => [hx * ax[0] + hz * az[0], hx * ax[1] + hz * az[1]]; // a heading in cells -> in metres
  const rectPts = (r) => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, z]) => F.toWorld(x, z));
  // the house is solid out to its outer wall face exactly (the door sits on that edge); the wider margin round it is only for parking and driving (planParking)
  const footprint = { x0: -WALL_T, x1: room.w + WALL_T, z0: -WALL_T, z1: room.d + WALL_T };
  const polys = cw.solids.map((s) => ({ kind: s.kind, pts: rectPts(s.kind === "house" ? footprint : s) }));
  // the boundary wall, a hand's width inside the plot's edge, open at the vehicle gate and the footgate
  const e = 0.2, walls = [], seg = (xa, za, xb, zb) => { if (Math.hypot(xb - xa, zb - za) > 0.05) { const [ax1, az1] = F.toWorld(xa, za), [bx1, bz1] = F.toWorld(xb, zb); walls.push([ax1, az1, bx1, bz1]); } };
  seg(pl.x0 + e, pl.z0 + e, pl.x1 - e, pl.z0 + e); seg(pl.x0 + e, pl.z0 + e, pl.x0 + e, pl.z1 - e); seg(pl.x1 - e, pl.z0 + e, pl.x1 - e, pl.z1 - e);
  let cx = pl.x0 + e; for (const gp of [P.gate, P.footGate].sort((a, b) => a.x0 - b.x0)) { seg(cx, pl.z1 - e, gp.x0, pl.z1 - e); cx = gp.x1; } seg(cx, pl.z1 - e, pl.x1 - e, pl.z1 - e);
  // where a car may drive besides the real road: the lawn, the driveway, the gate and a lip over the kerb so there is no gap between the gate and the asphalt (the map's road is the carriageway beyond)
  const lip = { x0: cw.gate.x0, x1: cw.gate.x1, z0: pl.z1 - 1.6, z1: P.kerb + 1.4 };
  const drive = [cw.lawn, cw.drive, lip, { x0: P.apron.x0, x1: P.apron.x1, z0: pl.z1 - 0.5, z1: P.kerb + 1.4 }];
  const drivable = (x, z) => { const [cx1, cz1] = toCell(x, z); return drive.some((r) => inRect(r, cx1, cz1)); };
  const park = planParking(room, vehicles ?? [], items ?? []).slots.map((s) => { const [x, z] = F.toWorld(s.x, s.z), [hx, hz] = dirOf(Math.sin(s.yaw), Math.cos(s.yaw)); return { id: s.id, x, z, hx, hz, len: s.len * CELL_M, wid: s.wid * CELL_M }; });
  const out = dirOf(0, 1), step = (cxx, czz, k) => F.toWorld(cxx, czz + k);
  const doorStep = step(P.doorOut.x, P.doorOut.z, 1.6), footGateMid = step((P.footGate.x0 + P.footGate.x1) / 2, pl.z1, 1.0);
  const spawn = { doorStep: { x: doorStep[0], z: doorStep[1], hx: out[0], hz: out[1] }, footGate: { x: footGateMid[0], z: footGateMid[1], hx: out[0], hz: out[1] } };
  const [dX, dZ] = F.toWorld(P.doorOut.x, P.doorOut.z);
  return { F, polys, walls, drivable, toCell, slots: park, spawn, door: { x: dX, z: dZ, nx: out[0], nz: out[1] }, cw, dirOf, lot };
}

/** Registers the compound's solids in the shared collision world, tagged so the whole compound can be taken away again. */
export function addSiteCollision(world, site) {
  for (const p of site.polys) world.addPolygon(p.pts, { kind: "home-" + p.kind, owner: HOME_OWNER });
  for (const [ax, az, bx, bz] of site.walls) world.addWall(ax, az, bx, bz, { kind: "home-wall", owner: HOME_OWNER });
}
export const removeSiteCollision = (world) => world.removeOwned(HOME_OWNER);

/** Is the place (x, z) on the compound's own ground, inside the plot's rectangle? */
export const onSite = (site, x, z) => { const [cx, cz] = site.toCell(x, z); return inRect(site.cw.P.plot, cx, cz); };

/** The door of the house as the trip logic wants it (the same shape as lib3d/buildingPortals.js): where it is, which way is out, where a person stands inside and outside. All in metres. Pure. */
export function homePortal(room, site) {
  const ent = entranceOf(room), F = site.F, W = room.w, D = room.d, n = site.dirOf(ent.outX, ent.outZ);
  const face = F.toWorld(ent.cx + W / 2 + ent.outX * WALL_T, ent.cz + D / 2 + ent.outZ * WALL_T);        // on the wall's outer face
  const out = doorLink(room).outside, outside = F.toWorld(out.x + ent.outX * 0.6, out.z + ent.outZ * 0.6);    // outside the door, beyond the step
  const width = HOLE_W * CELL_M, door = { x: face[0], z: face[1], nx: n[0], nz: n[1], width };
  return { id: "home", bid: -1, ok: true, door, entrance: { x: face[0] - n[0] * 1.6, z: face[1] - n[1] * 1.6, hx: n[0], hz: n[1] }, halfway: { x: face[0] + n[0] * 0.5, z: face[1] + n[1] * 0.5 },
    exit: { x: outside[0], z: outside[1], hx: n[0], hz: n[1], yaw: Math.atan2(n[0], n[1]) }, hinge: "in", onRoad: false, shift: 0, out: 1.6 };
}


/** The home as the trip logic sees a building to go into (the shape lib3d/roadnet.js destinationOf gives): its door, and the ground in front of it. Pure. */
export function homeBuilding(site, portal) {
  const pts = site.polys.find((p) => p.kind === "house")?.pts ?? [];
  return { building: { id: "home", bid: -1, pts }, door: portal.door, front: { x: portal.exit.x, z: portal.exit.z }, kerb: { x: portal.exit.x, z: portal.exit.z } };
}

/** Where a car stands in the middle of the vehicle gate, nose towards the street, as a pose in metres { x, z, hx, hz }: where the home screen's drive-out hands over to the map. Pure. */
export function gateStand(site) {
  const P = site.cw.P, out = site.dirOf(0, 1), [x, z] = site.F.toWorld(P.doorC ?? (P.gate.x0 + P.gate.x1) / 2, P.kerb - 0.6);
  return { x, z, hx: out[0], hz: out[1] };
}
