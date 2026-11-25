// lib/driveHandoff.js
// The hand-over between the home compound and the town map: the player drove a vehicle out of the gate, and the map picks the same vehicle up on the road, still moving.
// It carries the exact pose (position and heading in compound cells) so the map starts the walker or the car where the home screen left them.
// It lives in memory only (the two pages are one single-page app, so this survives the move between them) and goes stale after a minute, so an old drive-out can never put a
// car on the road later. Pure JS: no browser APIs, so the tests use it too.
import { OWN_CAR_MAX } from "./travel.js";
import { topSpeedMps } from "./vehiclePerformance.js";

export const HANDOFF_TTL_MS = 60_000;
let pending = null;

/** Records a drive-out: which vehicle (model and paint) and how fast it was going (m/s, along its nose; never negative, never more than that car's real top speed). */
export function setDriveHandoff({ modelId = "", color = "", v = 0, walk = false, pose = null, snap = "", go = false } = {}, now = Date.now()) {
  const speed = Number.isFinite(v) ? Math.max(0, Math.min(topSpeedMps(modelId) ?? OWN_CAR_MAX, v)) : 0;
  pending = { modelId: String(modelId ?? ""), color: String(color ?? ""), v: speed, walk: !!walk, pose: cleanPose(pose), snap: cleanSnap(snap), go: !!go, at: now };
  return pending;
}
/** The last frame of the home screen as a small JPEG data URL, so the map can show it until its own first frame is ready (no dark screen in between). Anything else, or over 700 kB, is dropped. */
export function cleanSnap(u) { return typeof u === "string" && /^data:image\/(jpeg|webp|png);base64,/.test(u) && u.length < 700_000 ? u : ""; }
/** The exact place the home screen ended on, in the compound's own cells: { cx, cz, hx, hz } (hx, hz a unit heading), or null when it is missing or not numbers. The map checks it against the lot before using it. */
export function cleanPose(p) {
  if (!p || ![p.cx, p.cz, p.hx, p.hz].every(Number.isFinite)) return null;
  const l = Math.hypot(p.hx, p.hz); if (l < 1e-6) return null;
  return { cx: p.cx, cz: p.cz, hx: p.hx / l, hz: p.hz / l };
}
/** The drive-out waiting for the map, or null (none, or too old). Does not consume it. */
export function peekDriveHandoff(now = Date.now()) { if (pending && now - pending.at > HANDOFF_TTL_MS) pending = null; return pending; }
/** The same, and it is gone: the map starts the drive exactly once. */
export function takeDriveHandoff(now = Date.now()) { const p = peekDriveHandoff(now); pending = null; return p; }
export const clearDriveHandoff = () => { pending = null; };
/** The home screen is going away: a handoff that was only prepared (not yet sent on its way to the map with `go: true`) is dropped; one that is on its way stays for the map to take. (Clearing it unconditionally here wiped every walk-out as the route changed.) */
export const dropUncommittedHandoff = () => { if (pending && !pending.go) pending = null; };
