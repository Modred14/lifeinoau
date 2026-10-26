// lib/driveHandoff.js
// The hand-over between the home compound and the town map: the player drove a vehicle out of the gate, and the map picks the same vehicle up on the road, still moving.
// It lives in memory only (the two pages are one single-page app, so this survives the move between them) and goes stale after a minute, so an old drive-out can never put a
// car on the road later. Pure JS: no browser APIs, so the tests use it too.
import { OWN_CAR_MAX } from "./travel.js";

export const HANDOFF_TTL_MS = 60_000;
let pending = null;

/** Records a drive-out: which vehicle (model and paint) and how fast it was going (m/s, along its nose; never negative, never more than the car can do). */
export function setDriveHandoff({ modelId = "", color = "", v = 0 } = {}, now = Date.now()) {
  const speed = Number.isFinite(v) ? Math.max(0, Math.min(OWN_CAR_MAX, v)) : 0;
  pending = { modelId: String(modelId ?? ""), color: String(color ?? ""), v: speed, at: now };
  return pending;
}
/** The drive-out waiting for the map, or null (none, or too old). Does not consume it. */
export function peekDriveHandoff(now = Date.now()) { if (pending && now - pending.at > HANDOFF_TTL_MS) pending = null; return pending; }
/** The same, and it is gone: the map starts the drive exactly once. */
export function takeDriveHandoff(now = Date.now()) { const p = peekDriveHandoff(now); pending = null; return p; }
export const clearDriveHandoff = () => { pending = null; };
