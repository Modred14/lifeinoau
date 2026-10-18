// lib3d/interiors/lectureEncounter.js
// Where everyone stands during the N-QRS response in a lecture room, as a PURE function of how long ago the server settled the fight.
// No three.js, no timers, no randomness: the 3D scene (scene.js) asks this for a frame and draws it, so a screen that reconnects half way through
// shows exactly the moment it should, and two screens always agree. The steps and their lengths come from lib/lectureResponse.js (stamped by the server).
import { phaseAt } from "../../lib/lectureResponse.js";

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v)), lerp = (a, b, u) => a + (b - a) * u, ease = (u) => u * u * (3 - 2 * u);
const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Total length of a polyline [[x, z], ...]. */
export const polyLength = (poly) => { let L = 0; for (let i = 1; i < poly.length; i++) L += dist(poly[i - 1], poly[i]); return L; };
/** The point `d` metres along a polyline, and the way it is heading there: { x, z, yaw }. Clamped to both ends. */
export function polyAt(poly, d) {
  if (poly.length === 1) return { x: poly[0][0], z: poly[0][1], yaw: 0 };
  let left = Math.max(0, d), last = { x: poly[0][0], z: poly[0][1], yaw: 0 };
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], L = dist(a, b), yaw = Math.atan2(b[0] - a[0], b[1] - a[1]); last = { x: b[0], z: b[1], yaw };
    if (L < 1e-6) continue; if (left <= L) { const u = left / L; return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), yaw }; } left -= L;
  }
  return last;
}
const beside = (p, off, back = 0) => ({ x: p.x + Math.cos(p.yaw) * off - Math.sin(p.yaw) * back, z: p.z - Math.sin(p.yaw) * off - Math.cos(p.yaw) * back, yaw: p.yaw });

/**
 * One frame of the response.
 *   outcome     "ARRESTED" | "ESCAPED" | "LOST" (LOST: nobody comes)
 *   elapsedMs   server clock minus the server's settle time
 *   inbound     [[x, z], ...] from out in the street, through the front door, to where the officers stand by the lecturer
 *   doorAt      how far along `inbound` (metres) the front door is
 *   outbound    [[x, z], ...] from where the officers (and the player, when arrested) leave from, through the front door, and out into the street
 *   lecturerAt  [x, z] where the lecturer lies (and stands again once rescued)
 *   playerAt    [x, z] where the player stands in the room when the response begins
 * Returns { phase, done, fade, officers: [{ x, z, yaw, walking, visible }], lecturer: "down" | "up", player: null | { x, z, yaw, cuffed, walking }, lockPlayer }.
 * `player` is only set while the player is being taken (apprehend, escort): otherwise the player is free and is not touched.
 */
export function incidentFrame({ outcome, elapsedMs, inbound, doorAt, outbound, lecturerAt, playerAt }) {
  const ph = phaseAt(outcome, elapsedMs), out = { phase: ph.name, done: ph.done, fade: 0, officers: [], lecturer: "down", player: null, lockPlayer: false };
  const hide = () => [{ x: 0, z: 0, yaw: 0, walking: false, visible: false }, { x: 0, z: 0, yaw: 0, walking: false, visible: false }];
  if (outcome === "LOST" || ph.name === "none") { out.lecturer = "up"; out.officers = hide(); return out; }
  const L = polyLength(inbound), standAt = polyAt(inbound, L), two = (p, walking, visible = true, spread = 0.6) => [{ ...beside(p, -spread), walking, visible }, { ...beside(p, spread, 0.5), walking, visible }];
  const O = polyLength(outbound);
  if (ph.name === "dispatch") { // the van is on its way: they come into view for the last stretch of the street
    const u = clamp((ph.u - 0.35) / 0.65), p = polyAt(inbound, u * doorAt); out.officers = u > 0 ? two(p, u < 1) : hide(); return out;
  }
  if (ph.name === "enter") { out.officers = two(polyAt(inbound, doorAt + ph.u * (L - doorAt)), ph.u < 1); return out; }
  out.officers = two(standAt, false);
  if (ph.name === "rescue") { out.lecturer = ph.u < 0.55 ? "down" : "up"; return out; }
  out.lecturer = "up";
  if (outcome === "ESCAPED") {
    if (ph.name === "search") { const yaw = standAt.yaw + Math.sin(ph.u * Math.PI * 4) * 1.1; out.officers = two({ ...standAt, yaw }, false); }
    else if (ph.name === "leave") out.officers = two(polyAt(outbound, ph.u * O), ph.u < 1);
    return out;
  }
  // ARRESTED: they turn on the player
  const start = outbound[0], pl = { x: playerAt[0], z: playerAt[1] };
  if (ph.name === "apprehend") {
    const u = ease(clamp(ph.u / 0.75)), a = polyAt([[standAt.x, standAt.z], [pl.x, pl.z]], u * dist([standAt.x, standAt.z], [pl.x, pl.z])), cuffed = ph.u > 0.75;
    out.officers = two({ ...a, yaw: Math.atan2(pl.x - standAt.x, pl.z - standAt.z) }, u < 1, true, 0.7);
    out.player = { x: pl.x, z: pl.z, yaw: Math.atan2(standAt.x - pl.x, standAt.z - pl.z), cuffed, walking: false }; out.lockPlayer = true; return out;
  }
  void start;
  if (ph.name === "escort") {
    const p = polyAt(outbound, ph.u * O); out.officers = two(p, true, true, 1.0); out.player = { x: p.x, z: p.z, yaw: p.yaw, cuffed: true, walking: true }; out.lockPlayer = true; return out;
  }
  // fade: out of the door and away
  const p = polyAt(outbound, O); out.officers = two(p, false, false); out.player = { x: p.x, z: p.z, yaw: p.yaw, cuffed: true, walking: false }; out.lockPlayer = true; out.fade = ph.u; return out;
}