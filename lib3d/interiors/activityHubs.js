// lib3d/interiors/activityHubs.js
// Where the activity rings stand inside a compiled interior. Pure functions (no 3D library, no database) so the 3D scene draws the rings and
// the server checks the player is standing beside one with the very same code: the result depends only on the plan, so both always agree.
//
// Each ring is { id, act, label, x, z, floor, room }. The id ("study_course:2") is the position of the entry in the building's list in
// lib/activities.js, so it never changes unless that list does. A ring is put in the room its entry names (matched on the room's name), on a
// free, reachable spot, at least MIN_GAP from every other ring so the nearest one is never ambiguous.
import { activitiesFor, labelOf } from "../../lib/activities.js";

export const MIN_GAP = 1.9; // metres between two rings (the prompt appears at 1.7 m, so one ring at a time)
const CELL = 0.4;

const inRoom = (r, x, z, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const itemsIn = (c, r) => c.items.filter((i) => i.floor === r.floor && inRoom(r, i.x, i.z));

/** Rooms an entry's `at` matches (never stairwells). Tries `at.or` when the pattern finds nothing. */
function roomsFor(c, at) {
  const tryOne = (a) => { const re = new RegExp(a.room, "i"); let rs = c.rooms.filter((r) => r.kind !== "stair" && re.test(r.name));
    if (a.item) rs = rs.filter((r) => itemsIn(c, r).some((i) => a.item.includes(i.type))); return rs; };
  let rs = tryOne(at); if (!rs.length) for (const alt of at.or ?? []) { rs = tryOne(alt); if (rs.length) { at = alt; break; } }
  if (!rs.length) return { rooms: [], at };
  if (at.each) return { rooms: rs, at };
  return { rooms: [rs[(at.nth ?? 0) % rs.length]], at };
}

/** The best free spot in `room`: reachable, off the walls, close to `anchor`, and away from the rings already placed. */
function spotIn(c, room, anchor, taken) {
  const nv = c.navPlayer[room.floor], rp = c.reach[room.floor]; let best = null, bd = Infinity;
  for (let z = room.z0 + 0.5; z <= room.z1 - 0.5; z += CELL / 2) for (let x = room.x0 + 0.5; x <= room.x1 - 0.5; x += CELL / 2) {
    const [i, j] = nv.cell(x, z); if (!nv.at(i, j) || !rp[j * nv.nx + i]) continue;
    if (taken.some((t) => t.floor === room.floor && Math.hypot(t.x - x, t.z - z) < MIN_GAP)) continue;
    const door = (c.plan.doors ?? []).some((d) => d.floor === room.floor && Math.hypot((d.axis === "x" ? d.pos : d.coord) - x, (d.axis === "x" ? d.coord : d.pos) - z) < 1.1); if (door) continue; // never stand in a doorway
    const d = Math.hypot(x - anchor.x, z - anchor.z) + (nv.free ? 0 : 0); if (d < bd) { bd = d; best = { x, z }; } }
  return best;
}

/**
 * The activity rings of an interior. `compiled` is buildInterior()'s result, `spec` the interior's classification spec (classify().spec).
 * Entries whose room cannot be found are returned in `missing` (the tests fail on them) and are never shown, so a wrong pattern can't put a ring in a wrong room.
 */
export function activityHubs(compiled, spec) {
  const entries = activitiesFor(spec), hubs = [], missing = [];
  const taken = (compiled.hubs ?? []).map((h) => ({ x: h.x, z: h.z, floor: h.floor ?? 0 }));
  entries.forEach((e, idx) => {
    const { rooms, at } = roomsFor(compiled, e.at);
    if (!rooms.length) { missing.push({ id: `${e.act}:${idx}`, act: e.act, room: e.at.room }); return; }
    let k = 0;
    for (const room of rooms) {
      const its = itemsIn(compiled, room), near = (at.near ?? at.item ?? []).length ? its.find((i) => (at.near ?? at.item).includes(i.type)) : null;
      const anchor = near ? { x: near.x, z: near.z } : { x: (room.x0 + room.x1) / 2, z: (room.z0 + room.z1) / 2 };
      const spot = spotIn(compiled, room, anchor, [...taken, ...hubs]);
      if (!spot) { missing.push({ id: `${e.act}:${idx}`, act: e.act, room: room.name, why: "no free spot" }); continue; }
      hubs.push({ id: at.each ? `${e.act}:${idx}.${k}` : `${e.act}:${idx}`, act: e.act, label: labelOf(e), x: spot.x, z: spot.z, floor: room.floor, room: room.name }); k++;
    }
  });
  return { hubs, missing };
}