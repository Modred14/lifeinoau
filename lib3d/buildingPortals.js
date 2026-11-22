// lib3d/buildingPortals.js
// The one place that says where a building's door is, where a person stands when they come out of it, and where they stand when they go in. Pure JS (no three.js, no DOM):
// it runs in the browser, in the trip flow (lib3d/tripflow.js) and in the tests, over the same collision world and walking planner the map uses.
//
// A PORTAL is derived from the building's real outline and door (lib3d/roadnet.js doorOf), never from a generic spawn point:
//   door       the door in the wall: { x, z, nx, nz (the unit normal pointing OUT of the building), width }
//   entrance   where a person stands just inside the wall when they have gone in (the mirror of the exit about the wall)
//   exit       where a person stands on the outside, facing away from the building, when they have come out: in front of the door, on ground they can walk on,
//              clear of walls, clear of the swept area of the open leaf, off the carriageway where the ground allows, facing the way out
//   hinge      the side the leaf is hinged on ("left" | "right" | "in"), chosen so the person who has just come out is NOT in its way
// Entering and leaving are the same movement run in opposite directions along entrance <-> door <-> exit (tripflow.js beginEnter / beginLeave), so what is
// outside the door is always exactly what you walk out onto.
//
// Data-driven: PORTAL_OVERRIDES adjusts one building by its place id ({ out: [metres...], shift: [metres...] } = where in front of the door to try standing),
// so a building with an awkward porch never needs code. A new building needs NOTHING here: it gets a portal from its outline like every other.
import { destinationOf } from "./roadnet.js";
import { WALK_R } from "./walker.js";
import { planDoorOpening, doorLocal } from "./doorway.js";

/** How far in front of the door to try standing (m), and how far to either side of its middle (m), nearest and most central first. The clearance is what a walker needs round it. */
export const PORTAL = Object.freeze({ out: [1.6, 2.0, 2.5, 3.1, 3.8], shift: [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1], clearance: WALK_R + 0.12, inside: 1.6, halfStep: 0.5 });

/** Per-building adjustments by place id: { out: [m...], shift: [m...] }. Empty on purpose: every building in the game has a portal worked out from its own outline. */
export const PORTAL_OVERRIDES = {};

const bad = (id, reason) => ({ id, ok: false, reason });

/**
 * The portal of one place. svc: the world services (lib3d/worldsvc.js). place: { id, x, z, bid? } (a named place or { id: "bld_12", bid: 12 }).
 * Returns { id, bid, ok: true, door, entrance, halfway, exit, hinge, onRoad, shift, out } or { id, ok: false, reason: "nopos" | "nobuilding" | "blocked" }.
 */
export function portalFor(svc, place, { overrides = PORTAL_OVERRIDES } = {}) {
  if (!place || (place.x == null && place.bid == null)) return bad(place?.id, "nopos");
  const { net, world, graph } = svc, B = destinationOf(net, place); if (!B.building) return bad(place.id, "nobuilding");
  const D = B.door, ov = overrides[place.id] ?? {}, tx = D.nz, tz = -D.nx, scratch = {};
  const isRoad = (x, z) => (graph ? graph.surfaceAt(x, z, scratch).cls === 1 : false);
  const outs = ov.out ?? PORTAL.out, shifts = ov.shift ?? PORTAL.shift;
  let best = null, anyFree = null, rank = 0;
  for (const d of outs) for (const s of shifts) {
    rank++;
    const x = D.x + D.nx * d + tx * s, z = D.z + D.nz * d + tz * s;
    if (world.blockedAt(x, z, PORTAL.clearance) || doorLocal(D, x, z).v < 0.8) continue;
    const road = isRoad(x, z), cand = { x, z, d, s, road, rank };
    anyFree ??= cand;
    const open = planDoorOpening(world, D, { x, z }, { isRoad });   // is this spot out of the way of the leaf, whichever way it swings? (dist 0: no step back is needed)
    if (!open.ok || open.dist > 0.02) continue;
    cand.hinge = open.hinge;
    // a spot off the carriageway beats one on it; otherwise the nearest and most central wins
    if (!best || (best.road && !cand.road)) best = cand;
  }
  const pick = best ?? anyFree; if (!pick) return bad(place.id, "blocked");
  const hinge = best ? best.hinge : "in";   // nowhere clear of a leaf that swings out: the leaf swings into the building instead, and nothing outside is in its way
  const exit = { x: pick.x, z: pick.z, hx: D.nx, hz: D.nz, yaw: Math.atan2(D.nx, D.nz) };
  return { id: place.id, bid: B.building.id, ok: true, door: { x: D.x, z: D.z, nx: D.nx, nz: D.nz, width: D.width }, entrance: { x: D.x - D.nx * PORTAL.inside, z: D.z - D.nz * PORTAL.inside, hx: D.nx, hz: D.nz },
    halfway: { x: D.x + D.nx * PORTAL.halfStep, z: D.z + D.nz * PORTAL.halfStep }, exit, hinge, onRoad: pick.road, shift: pick.s, out: pick.d };
}

/** The portals of a list of places (the ones with a building), as { [id]: portal }. */
export function portalsFor(svc, places, opts) { const out = {}; for (const p of places) { const r = portalFor(svc, p, opts); if (r.ok) out[p.id] = r; } return out; }

/** Where along entrance -> halfway -> exit a person is, `k` of the way (0..1), for both directions. Returns { x, z, passedWall } (passedWall: they are on the outside of the wall line). */
export function portalWalk(portal, k, { leaving }) {
  const a = portal.entrance, b = portal.halfway, c = portal.exit, l1 = Math.hypot(b.x - a.x, b.z - a.z), l2 = Math.hypot(c.x - b.x, c.z - b.z), tot = l1 + l2 || 1, s = Math.max(0, Math.min(1, k)) * tot;
  const along = leaving ? s : tot - s, at = along <= l1 ? { x: a.x + (b.x - a.x) * (l1 ? along / l1 : 1), z: a.z + (b.z - a.z) * (l1 ? along / l1 : 1) } : { x: b.x + (c.x - b.x) * (l2 ? (along - l1) / l2 : 1), z: b.z + (c.z - b.z) * (l2 ? (along - l1) / l2 : 1) };
  return { ...at, passedWall: doorLocal(portal.door, at.x, at.z).v > 0 };
}
/** Length (m) of the walk through the doorway between entrance and exit. */
export const portalLength = (portal) => Math.hypot(portal.halfway.x - portal.entrance.x, portal.halfway.z - portal.entrance.z) + Math.hypot(portal.exit.x - portal.halfway.x, portal.exit.z - portal.halfway.z);
