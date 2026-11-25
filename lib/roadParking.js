// lib/roadParking.js
// Where the player left their own car on the CAMPUS ROAD (as opposed to the home compound, whose parking the server keeps: lib/carService.js parkCar).
// The trip engine (lib3d/tripflow.js) reports the pose when the player leaves the car and goes about their business (into a building, to another page); the next trip that
// starts at the same place with the same car puts the car back exactly there, and the player walks to it. One record per player: parking a car somewhere else replaces it.
// It lives in memory and in sessionStorage (so a reload keeps it), goes stale after PARK_TTL_MS, and is never used for a different place, car or player.
// Pure JS: the storage is injected, so the tests use it too.

export const PARK_TTL_MS = 6 * 3600_000;
const KEY = "oau:roadPark:v1";
let mem = null;

const num = (v) => typeof v === "number" && Number.isFinite(v);
const memoryStore = () => { let s = null; return { getItem: () => s, setItem: (_, v) => { s = v; }, removeItem: () => { s = null; } }; };
let store = (() => { try { return typeof sessionStorage !== "undefined" ? sessionStorage : memoryStore(); } catch { return memoryStore(); } })();
/** Tests: swap the storage and forget what is in memory. */
export function _resetRoadParking(s) { mem = null; store = s ?? memoryStore(); }

/** A pose that can be stored: finite position and a unit-ish heading. null for anything else. */
export function cleanRoadPose(p) {
  if (!p || ![p.x, p.z, p.hx, p.hz].every(num) || Math.abs(p.x) > 6000 || Math.abs(p.z) > 6000) return null;
  const l = Math.hypot(p.hx, p.hz); if (l < 1e-6) return null;
  return { x: p.x, z: p.z, hx: p.hx / l, hz: p.hz / l, len: num(p.len) && p.len > 1 && p.len < 12 ? p.len : null, wid: num(p.wid) && p.wid > 0.8 && p.wid < 4 ? p.wid : null };
}
const read = () => { if (mem) return mem; try { const t = store.getItem(KEY); if (t) mem = JSON.parse(t); } catch { mem = null; } return mem; };
const write = (r) => { mem = r; try { r ? store.setItem(KEY, JSON.stringify(r)) : store.removeItem(KEY); } catch { /* storage is a convenience: memory still holds it */ } };

/** Remember that `playerId`'s car `modelId` stands at `pose` in front of place `placeId`. Returns the stored record, or null when it was refused. */
export function saveRoadParking({ playerId, modelId, color = "", placeId, pose }, now = Date.now()) {
  const p = cleanRoadPose(pose); if (!playerId || !modelId || !placeId || !p) return null;
  const r = { playerId: String(playerId), modelId: String(modelId), color: String(color ?? ""), placeId: String(placeId), pose: p, at: now }; write(r); return r;
}
/** The stored parking if it is for this player, this car and this place and is fresh; otherwise null. Does not consume it. */
export function peekRoadParking({ playerId, modelId, placeId }, now = Date.now()) {
  const r = read(); if (!r || r.playerId !== String(playerId) || r.modelId !== String(modelId) || r.placeId !== String(placeId)) return null;
  if (!(now - r.at >= -60_000 && now - r.at <= PARK_TTL_MS)) { write(null); return null; }
  return r;
}
/** The same, and forgotten: a trip that takes the car owns it from here on, so it can never be put in the world twice. */
export function takeRoadParking(q, now = Date.now()) { const r = peekRoadParking(q, now); if (r) write(null); return r; }
export const forgetRoadParking = () => write(null);
